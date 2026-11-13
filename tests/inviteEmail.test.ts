import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleInvite, inviteLinkOf, validEmail as serverValid } from '../server/invite.mjs';
// @ts-expect-error -- server module in plain JavaScript
import { buildInviteEmail } from '../server/emails.mjs';
import { inviteLink, parseEmails, validEmail } from '../src/lib/groupInvite';

// « Inviter par e-mail » (visitors' test: only a link to send oneself): the server sends the invitation, with the
// group's own link, only for whoever may invite, never saying whether an address has an account. Resend and Supabase
// are mocked here: nothing leaves this computer.

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', RESEND_API_KEY: 're_test', SITE_URL: 'https://kompaly.test' };
const GROUP = '0b5f3c1e-8a2d-4c6f-9e1a-2b3c4d5e6f70';
const TOKEN = 'a'.repeat(64);
let n = 0;

/** Supabase and Resend as fakes: who the session is, whether the database gives the secret, what was sent. */
function world({ secret = TOKEN as string | null, kind = 'agenda', resendFails = false } = {}) {
  const sent: { to: string[]; subject: string; html: string; text: string; from: string; auth: string }[] = [];
  const asked: string[] = [];
  const user = `user-${++n}`;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    asked.push(u);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (u === 'https://db.test/auth/v1/user') return json({ id: user });
    if (u.startsWith('https://db.test/rest/v1/rpc/')) {
      expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer tok-/); // the caller's own session
      return secret === null ? json(null) : json(secret);
    }
    if (u.startsWith('https://db.test/rest/v1/groups')) return json([{ name: 'Promo L2 <droit>', kind }]);
    if (u.startsWith('https://db.test/rest/v1/profiles')) return json([{ name: 'Sarah Martin' }]);
    if (u === 'https://api.resend.com/emails') {
      if (resendFails) return new Response('nope', { status: 500 });
      sent.push({ ...JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
      return json({ id: 'x' });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  return { sent, asked, user };
}

async function post(body: unknown, env: Record<string, string> = ENV) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    url: '/api/invitation/email',
    method: 'POST',
    headers: { authorization: `Bearer tok-${n}-${Math.random()}` },
    socket: { remoteAddress: `10.0.0.${n}` },
  });
  const res = { statusCode: 0, body: '', setHeader() {}, end(b: string) { this.body = b; } };
  await handleInvite(req as never, res as never, env);
  return { status: res.statusCode, data: JSON.parse(res.body || '{}') };
}

afterEach(() => vi.unstubAllGlobals());

describe('inviter par e-mail : le serveur', () => {
  it('sends the invitation with the calendar’s link, in the inviter’s language, from Resend', async () => {
    const w = world();
    const r = await post({ group: GROUP, kind: 'agenda', emails: ['Lina@Exemple.fr', 'lina@exemple.fr', 'tom@ecole.fr'], lang: 'en' });
    expect(r).toEqual({ status: 200, data: { sent: 2 } });
    expect(w.sent.map(s => s.to)).toEqual([['lina@exemple.fr'], ['tom@ecole.fr']]);
    expect(w.sent[0].auth).toBe('Bearer re_test');
    expect(w.sent[0].subject).toBe('Sarah invites you to the shared calendar “Promo L2 droit”');
    expect(w.sent[0].text).toContain(`https://kompaly.test/agendas?invitation=${TOKEN}&de=Sarah&nom=`);
    expect(w.sent[0].html).not.toContain('<droit>');
  });

  it('a group: its link and its code', async () => {
    const w = world({ secret: 'ZZ9Y8X', kind: 'groupe' });
    const r = await post({ group: GROUP, kind: 'groupe', emails: ['a@b.fr'], lang: 'fr' });
    expect(r.status).toBe(200);
    expect(w.sent[0].text).toContain('https://kompaly.test/groupes?rejoindre=ZZ9Y8X');
    expect(w.sent[0].text).toContain('code ZZ9Y8X');
    expect(w.sent[0].subject).toContain('Sarah t’invite dans « Promo L2');
  });

  it('nothing is sent by someone not allowed to invite (the database gives them no secret)', async () => {
    const w = world({ secret: null });
    expect(await post({ group: GROUP, kind: 'agenda', emails: ['a@b.fr'] })).toEqual({ status: 403, data: { error: 'forbidden' } });
    expect(w.sent).toHaveLength(0);
  });

  it('never looks up whether an address has an account', async () => {
    const w = world();
    await post({ group: GROUP, kind: 'agenda', emails: ['inconnu@exemple.fr'] });
    expect(w.asked.some(u => /auth\/v1\/admin|users\?|email=/.test(u))).toBe(false);
  });

  it('refuses badly formed addresses, more than 10, a wrong group id, a stranger without session', async () => {
    world();
    expect((await post({ group: GROUP, kind: 'agenda', emails: ['pas-une-adresse', 'ok@ok.fr'] })).data).toEqual({ error: 'bad_email', invalid: ['pas-une-adresse'] });
    world();
    expect((await post({ group: GROUP, kind: 'agenda', emails: Array.from({ length: 11 }, (_, i) => `p${i}@ex.fr`) })).data.error).toBe('too_many');
    world();
    expect((await post({ group: "x' or 1=1", kind: 'agenda', emails: ['a@b.fr'] })).data.error).toBe('bad_request');
    world();
    expect((await post({ group: GROUP, kind: 'equipe', emails: ['a@b.fr'] })).data.error).toBe('bad_request');
  });

  it('limits each account: a few requests a minute', async () => {
    const w = world();
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ group: GROUP, kind: 'agenda', emails: ['a@b.fr'] }))]), {
        url: '/api/invitation/email', method: 'POST', headers: { authorization: 'Bearer tok-same' }, socket: { remoteAddress: `10.1.0.${i}` },
      });
      const res = { statusCode: 0, body: '', setHeader() {}, end(b: string) { this.body = b; } };
      await handleInvite(req as never, res as never, ENV);
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 5).every(s => s === 200)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(w.sent).toHaveLength(5);
  });

  it('not set up (no e-mail key, local mode): « disabled », the link still works', async () => {
    world();
    expect((await post({ group: GROUP, kind: 'agenda', emails: ['a@b.fr'] }, { ...ENV, RESEND_API_KEY: '' })).data.error).toBe('disabled');
  });

  it('Resend refusing: said, never the address in the log', async () => {
    world({ resendFails: true });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await post({ group: GROUP, kind: 'agenda', emails: ['secret@exemple.fr'] })).data).toEqual({ error: 'send_failed', sent: 0 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret@exemple.fr');
    log.mockRestore();
  });
});

describe('inviter par e-mail : les adresses et le message', () => {
  it('reads what was typed or pasted, and says what is not an address', () => {
    expect(parseEmails('Lina <Lina@exemple.fr>, tom@ecole.fr; tom@ecole.fr\nzoe@mail.co')).toEqual({ emails: ['lina@exemple.fr', 'tom@ecole.fr', 'zoe@mail.co'], bad: [] });
    expect(parseEmails('lina@exemple, @x.fr, a..b@c.fr, ok@ok.fr').bad).toEqual(['lina@exemple', '@x.fr', 'a..b@c.fr']);
    for (const s of ['a@b.fr', 'prenom.nom+tag@sous.domaine.com', 'x@ex-ample.io']) expect(validEmail(s) && serverValid(s)).toBe(true);
    for (const s of ['a@b', 'a@-b.fr', '.a@b.fr', 'a b@c.fr', 'a@b.fr\r\nBcc: x@y.fr', `${'a'.repeat(65)}@b.fr`]) expect(validEmail(s) || serverValid(s)).toBe(false);
  });

  it('the server’s link is the app’s', () => {
    expect(inviteLinkOf('agenda', TOKEN, 'https://k.fr', { from: 'Sarah', name: 'Famille & co' })).toBe(inviteLink('agenda', TOKEN, 'https://k.fr', { from: 'Sarah', name: 'Famille & co' }));
    expect(inviteLinkOf('groupe', 'ZZ9Y8X', 'https://k.fr', { from: '', name: 'Promo' })).toBe(inviteLink('groupe', 'ZZ9Y8X', 'https://k.fr', { name: 'Promo' }));
  });

  it('the e-mail: escaped, in five languages, the French default', () => {
    for (const lang of ['fr', 'en', 'es', 'de', 'it', 'xx']) {
      const m = buildInviteEmail({ kind: 'agenda', from: 'Sarah', name: 'Promo', link: 'https://k.fr/agendas?invitation=1&de=S', lang });
      expect(m.html).toContain('https://k.fr/agendas?invitation=1&amp;de=S');
      expect(m.subject).toContain('Sarah');
    }
    expect(buildInviteEmail({ kind: 'groupe', from: '', name: 'X', link: 'l', lang: 'xx' }).subject).toBe('Kompaly t’invite dans « X » sur Kompaly');
  });
});
