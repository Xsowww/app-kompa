// POST /api/invitation/email — « Inviter par e-mail » (pages/groups/InviteDialog): the server sends the invitation to
// a group or a shared calendar itself, through Resend (server/emails.mjs), with the group's own invitation link.
//
// Who may invite is the database's decision, not ours: the link's secret is asked with the caller's own session to
// the functions the app already uses (group_invite_code, agenda_invite_token), which give it only to the owner and
// the members allowed to invite (and only after the second factor, when the account has one). No new SQL.
// Never says whether an address has an account (it is never looked up), never sends more than 10 addresses at once,
// a few requests a minute and 50 addresses a day per account.
//
// Body: { group: <uuid>, kind: 'groupe' | 'agenda', emails: string[] (1–10), lang: 'fr' | 'en' | 'es' | 'de' | 'it' }
// Answers: 200 { sent } · 400 { error: 'bad_request' | 'bad_email' | 'too_many', invalid? } · 401 · 403 { error:
// 'forbidden' } · 429 { error: 'rate_limited' | 'daily_limit' } · 502 { error: 'send_failed', sent } · 503 { error: 'disabled' }

import { authenticate, ipOf, rateLimited, readJson, send } from './copilot.mjs';
import { buildInviteEmail, sendEmail } from './emails.mjs';

export const MAX_ADDRESSES = 10;
const PER_IP_PER_MIN = 20;
const PER_USER_PER_MIN = 5;
const PER_USER_PER_DAY = 50;
const LANGS = ['fr', 'en', 'es', 'de', 'it'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A well-formed address, strictly: one @, a local part of the usual characters (no dot at its ends nor two in a
 * row), a domain of letters, digits and hyphens with a dot and a top level of 2 letters or more; 254 characters at most.
 */
export function validEmail(s) {
  if (typeof s !== 'string' || s.length > 254) return false;
  const m = /^([A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64})@((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63})$/.exec(s);
  return !!m && !m[1].startsWith('.') && !m[1].endsWith('.') && !m[1].includes('..');
}

/** Each account's addresses today (Paris day), in memory like the other quotas (server/copilot.mjs). */
const sentToday = new Map();
const today = () => new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
function overDaily(who, n) {
  const key = `${today()} ${who}`;
  const used = sentToday.get(key) ?? 0;
  if (used + n > PER_USER_PER_DAY) return true;
  if (sentToday.size > 20_000) for (const k of sentToday.keys()) if (!k.startsWith(today())) sentToday.delete(k);
  sentToday.set(key, used + n);
  return false;
}

/** The same link as the app's (src/lib/groupInvite › inviteLink). */
export function inviteLinkOf(kind, secret, site, { from, name }) {
  const base = kind === 'agenda' ? `${site}/agendas?invitation=${secret}` : `${site}/groupes?rejoindre=${secret}`;
  const f = String(from ?? '').trim().slice(0, 40);
  const n = String(name ?? '').trim().slice(0, 60);
  return `${base}${f ? `&de=${encodeURIComponent(f)}` : ''}${n ? `&nom=${encodeURIComponent(n)}` : ''}`;
}

/** PostgREST as the caller (their session, the public key): the database's own rules apply. */
async function asCaller(env, token, path, init = {}) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/+$/, '');
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export async function handleInvite(req, res, env = process.env) {
  if ((req.url ?? '').split('?')[0] !== '/api/invitation/email') return false;
  if (req.method !== 'POST') return (send(res, 405, { error: 'method' }), true);
  const ip = ipOf(req, env);
  if (rateLimited(`invite-ip:${ip}`, PER_IP_PER_MIN)) return (send(res, 429, { error: 'rate_limited', retryAfter: 60 }), true);
  // Not set up (local mode, no e-mail key): the link is still there to send by hand.
  const resend = (env.RESEND_API_KEY || '').trim();
  if (!resend || !(env.SUPABASE_URL || env.VITE_SUPABASE_URL) || !(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY)) return (send(res, 503, { error: 'disabled' }), true);
  const caller = await authenticate(req, env);
  if (!caller?.id) return (send(res, 401, { error: 'unauthorized' }), true);
  if (rateLimited(`invite:${caller.id}`, PER_USER_PER_MIN)) return (send(res, 429, { error: 'rate_limited', retryAfter: 60 }), true);

  let body;
  try {
    body = await readJson(req);
  } catch {
    return (send(res, 400, { error: 'bad_request' }), true);
  }
  const { group, kind, emails } = body ?? {};
  if (typeof group !== 'string' || !UUID.test(group) || (kind !== 'groupe' && kind !== 'agenda') || !Array.isArray(emails) || !emails.length)
    return (send(res, 400, { error: 'bad_request' }), true);
  if (emails.length > MAX_ADDRESSES) return (send(res, 400, { error: 'too_many', max: MAX_ADDRESSES }), true);
  const list = [...new Set(emails.map(e => (typeof e === 'string' ? e.trim().toLowerCase() : '')))];
  const invalid = list.filter(e => !validEmail(e));
  if (invalid.length) return (send(res, 400, { error: 'bad_email', invalid }), true);
  const lang = LANGS.includes(body.lang) ? body.lang : 'fr';

  // The secret, only for whoever may invite (the owner, a member allowed to): else nothing is sent.
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const secret = await asCaller(env, token, `rpc/${kind === 'agenda' ? 'agenda_invite_token' : 'group_invite_code'}`, { method: 'POST', body: JSON.stringify({ p_group: group }) });
  if (typeof secret !== 'string' || !secret) return (send(res, 403, { error: 'forbidden' }), true);
  const [row] = (await asCaller(env, token, `groups?select=name,kind&id=eq.${group}`)) ?? [];
  if (!row || (row.kind ?? 'groupe') !== kind) return (send(res, 403, { error: 'forbidden' }), true);
  const [me] = (await asCaller(env, token, `profiles?select=name&id=eq.${caller.id}`)) ?? [];
  if (overDaily(caller.id, list.length)) return (send(res, 429, { error: 'daily_limit' }), true);

  const site = (env.SITE_URL || 'https://kompaly.com').replace(/\/+$/, '');
  const from = String(me?.name ?? '').trim().split(/\s+/)[0];
  const link = inviteLinkOf(kind, secret, site, { from, name: row.name });
  const mail = buildInviteEmail({ kind, from, name: row.name, link, code: kind === 'groupe' ? secret : undefined, lang });
  let sent = 0;
  for (const to of list) {
    try {
      await sendEmail(to, mail, { key: resend, from: (env.MAIL_FROM || 'Kompaly <bonjour@kompaly.com>').trim() });
      sent++;
    } catch (e) {
      // The address isn't logged: only that a sending failed.
      console.error('[invitation]', e instanceof Error ? e.message.replace(/[^\s]+@[^\s]+/g, '…') : 'erreur');
      return (send(res, 502, { error: 'send_failed', sent }), true);
    }
  }
  send(res, 200, { sent });
  return true;
}
