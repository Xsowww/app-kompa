// Push notifications (reminders of events and tasks, new reports for the admins).
//
// The app puts its upcoming reminders in public.reminders (supabase/migrations/2026-10-17_rappels.sql);
// every 30 s this server takes the ones that are due and sends them to the person's devices
// (public.push_subscriptions) through their browser's push service (Google, Apple, Mozilla, Microsoft).
//
// Settings (Render › Environment), both needed, never in the code:
//   PUSH_SECRET                any long random value (Render: « Generate »); the push keys are derived from it,
//                              so changing it means every device has to turn notifications on again.
//   SUPABASE_SERVICE_ROLE_KEY  Supabase › Project Settings › API keys › secret key. Reads the reminders of every
//                              account: it stays on this server.
// Without them the site works as before; reminders only show while the app is open.

import { createECDH, hkdfSync } from 'node:crypto';
import webpush from 'web-push';
import { ipOf } from './copilot.mjs';

const SUPABASE = (() => {
  try {
    return new URL(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).origin;
  } catch {
    return '';
  }
})();
// Pasted with a space, a line break or quotes around it: cleaned (a key never contains them).
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^["']+|["']+$/g, '').trim();

/** What kind of key it is, shown by /api/sante to find a wrong paste — never the key itself. */
export const keyKind = (() => {
  if (!SERVICE_KEY) return 'absente';
  if (SERVICE_KEY.startsWith('sb_secret_')) return 'secrète';
  if (SERVICE_KEY.startsWith('sb_publishable_')) return 'publique (pas la bonne : il faut la clé secrète)';
  if (SERVICE_KEY.startsWith('eyJ')) {
    try {
      const role = JSON.parse(Buffer.from(SERVICE_KEY.split('.')[1], 'base64url').toString()).role;
      return role === 'service_role' ? 'ancienne service_role' : `ancienne ${role ?? 'inconnue'} (pas la bonne : il faut service_role)`;
    } catch {
      return 'format inconnu';
    }
  }
  return 'format inconnu';
})();
const SECRET = process.env.PUSH_SECRET || '';
const SUBJECT = (process.env.SITE_URL || 'https://kompaly.com').replace(/\/+$/, '');

const b64url = buf => Buffer.from(buf).toString('base64url');

/** The VAPID key pair (identifies this server to the push services), derived from PUSH_SECRET. */
const vapid = (() => {
  if (SECRET.length < 16) return null;
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(hkdfSync('sha256', SECRET, 'kompaly-push', 'vapid p-256', 32)));
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
})();
if (vapid) webpush.setVapidDetails(SUBJECT, vapid.publicKey, vapid.privateKey);

/** Only the browsers' push services: the address comes from the browser, it must never make this server call anything else. */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[\w-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[\w-]+\.push\.apple\.com|[\w-]+\.notify\.windows\.com)$/;
export function pushEndpointOk(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

/** Sends one notification; 'gone' when the device turned notifications off (its subscription is to delete). */
async function send(sub, payload, ttl) {
  if (!pushEndpointOk(sub.endpoint)) return 'gone';
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: ttl, urgency: 'high', timeout: 10_000 });
    return 'sent';
  } catch (e) {
    if (e?.statusCode === 404 || e?.statusCode === 410) return 'gone';
    console.error('[push] envoi', e?.statusCode ?? '', String(e?.body ?? e?.message ?? e).slice(0, 200));
    return 'error';
  }
}

// ── Supabase with the secret key (bypasses the access rules: only for what this file does) ──
const serviceHeaders = () => ({
  // Both, as Supabase's own client sends them (a « sb_secret_… » key is accepted there when it equals apikey).
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
});
async function rest(path, init = {}) {
  const r = await fetch(`${SUPABASE}${path}`, { ...init, headers: serviceHeaders(), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw Object.assign(new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} → ${r.status} ${(await r.text()).slice(0, 200)}`), { status: r.status });
  return r.status === 204 ? null : r.json().catch(() => null);
}

/**
 * A notification on all of a user's devices but `except` (the one asking): « Enregistrer un cours » alerts
 * reach the phone while the class is recorded on the computer. Returns false when push isn't set up.
 */
export async function pushToUser(userId, payload, except = '') {
  if (!vapid || !SUPABASE || !SERVICE_KEY || !/^[0-9a-f-]{36}$/i.test(String(userId))) return false;
  const subs = await rest(`/rest/v1/push_subscriptions?select=user_id,endpoint,p256dh,auth&user_id=eq.${userId}`);
  for (const s of subs ?? []) {
    if (s.endpoint === except) continue;
    if ((await send(s, { ...payload, user: userId }, 600)) === 'sent') pushStatus.sent++;
  }
  return true;
}

// ── The loop ────────────────────────────────────────────────────────────────
/** lastCode: the HTTP status of the last failure (or 'réseau'), shown by /api/sante — never the message itself. */
export const pushStatus = { active: false, lastRun: null, lastError: null, lastCode: null, lastHint: null, sent: 0 };

async function deliverDue() {
  const due = await rest('/rest/v1/rpc/claim_due_reminders', { method: 'POST', body: '{}' });
  if (!Array.isArray(due) || !due.length) return;
  // The people who made the changes too: their own phone (another account on it) isn't told of what they just did.
  const users = [...new Set(due.flatMap(r => [r.user_id, r.actor].filter(Boolean)))];
  const subs = await rest(`/rest/v1/push_subscriptions?select=user_id,endpoint,p256dh,auth&user_id=in.(${users.join(',')})`);
  const byUser = new Map();
  for (const s of subs ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
  const endpointsOf = id => new Set((byUser.get(id) ?? []).map(s => s.endpoint));
  const gone = [];
  await Promise.all(
    due.map(async r => {
      // Late (server restarted…): kept useful for 30 min at most, the time the reminder still makes sense.
      const ttl = Math.max(60, 1800 - Math.round((Date.now() - Date.parse(r.fire_at)) / 1000));
      const payload = { title: r.title, body: r.body, url: r.url, tag: r.key, user: r.user_id };
      const actorDevices = r.actor ? endpointsOf(r.actor) : new Set();
      for (const s of byUser.get(r.user_id) ?? []) {
        if (actorDevices.has(s.endpoint)) continue;
        const res = await send(s, payload, ttl);
        if (res === 'sent') pushStatus.sent++;
        if (res === 'gone') gone.push(s);
      }
    }),
  );
  for (const s of gone) {
    await rest(`/rest/v1/push_subscriptions?user_id=eq.${s.user_id}&endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' }).catch(() => {});
  }
}

export function startPushLoop() {
  if (!vapid || !SUPABASE || !SERVICE_KEY) {
    console.log('[push] notifications push désactivées (PUSH_SECRET et SUPABASE_SERVICE_ROLE_KEY à définir sur l’hébergeur)');
    return;
  }
  pushStatus.active = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deliverDue();
      pushStatus.lastError = null;
      pushStatus.lastCode = null;
      pushStatus.lastHint = null;
    } catch (e) {
      // Migration 2026-10-17 not applied yet, network…: said once per kind of error, retried at the next turn.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== pushStatus.lastError) console.error('[push]', msg);
      pushStatus.lastError = msg;
      pushStatus.lastCode = e?.status ?? 'réseau';
      pushStatus.lastHint = /legacy api keys are disabled/i.test(msg)
        ? 'anciennes clés désactivées dans Supabase : prends la clé secrète sb_secret_…'
        : /invalid api key|no api key/i.test(msg)
          ? 'clé refusée par Supabase (autre projet, ou mal copiée)'
          : /permission denied|42501/i.test(msg)
            ? 'clé sans les droits (clé publique ?)'
            : /PGRST202|could not find the function/i.test(msg)
              ? 'migration 2026-10-17 pas appliquée'
              : null;
    } finally {
      pushStatus.lastRun = new Date().toISOString();
      running = false;
    }
  };
  setInterval(tick, 30_000).unref();
  setTimeout(tick, 5_000).unref();
  console.log('[push] notifications push actives');
}

// ── API for the app ─────────────────────────────────────────────────────────
// GET  /api/push/cle   → { key } the public key the browser subscribes with (404 when push is not set up)
// POST /api/push/test  { subscription, delay } → a test notification to this device, after `delay` s (0-30)
const tests = new Map();
setInterval(() => tests.clear(), 60_000).unref();

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function pushTest(req) {
  if (!vapid) return [404, { error: 'push non configuré' }];
  const ip = ipOf(req, process.env);
  const count = (tests.get(ip) ?? 0) + 1;
  tests.set(ip, count);
  if (count > 5) return [429, { error: 'trop d’essais, réessaie dans une minute' }];
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) return [413, { error: 'trop long' }];
  }
  let sub, delay;
  try {
    ({ subscription: sub, delay } = JSON.parse(body));
  } catch {
    /* checked below */
  }
  const s = { endpoint: sub?.endpoint, p256dh: sub?.keys?.p256dh, auth: sub?.keys?.auth };
  if (!pushEndpointOk(s.endpoint) || typeof s.p256dh !== 'string' || typeof s.auth !== 'string') return [400, { error: 'appareil inconnu' }];
  const go = () => send(s, { title: 'Notifications activées', body: 'Tes rappels Kompaly arriveront ici, même site fermé.\nEssai', url: '/profil?onglet=notifications', tag: 'test', test: true }, 300);
  const wait = Math.min(Math.max(Number(delay) || 0, 0), 30) * 1000;
  if (wait) {
    setTimeout(go, wait).unref();
    return [202, { ok: true }];
  }
  const r = await go();
  return r === 'sent' ? [200, { ok: true }] : [502, { error: r === 'gone' ? 'appareil désabonné' : 'le service de notifications a refusé' }];
}

export async function handlePush(req, res) {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/api/push/cle' && req.method === 'GET') {
    // Not set up: no key (the app then reminds only while it is open), without an error on every page.
    json(res, 200, { key: vapid ? vapid.publicKey : null });
    return true;
  }
  if (path === '/api/push/test' && req.method === 'POST') {
    json(res, ...(await pushTest(req)));
    return true;
  }
  return false;
}
