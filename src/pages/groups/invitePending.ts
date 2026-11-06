// An invitation link (/agendas?invitation=…, /groupes?rejoindre=…) opened before having an account: kept on this
// device (localStorage, not the tab: it survives the sign-up, the e-mail confirmation opened in a new tab, a restart)
// and joined right after entering the app (layout/AppShell › useInvitations). Pure helpers: tests/invitePending.test.ts.

/** Where it is kept: `{ path, at }` (the link's path and query, when it was opened, ISO). */
export const INVITE_KEY = 'kompaly-invite';
/** The former place, in the tab only (still read once: a link opened just before the update). */
const OLD_KEY = 'cop-invite';
/** Kept two weeks: an invitation opened, then the account created days later. */
export const INVITE_DAYS = 14;

/** What a link says about its invitation: a shared calendar or a group, its secret, who sends it and its name. */
export interface InviteInfo {
  kind: 'agenda' | 'groupe';
  secret: string;
  /** The first name of who invites (`de=`), '' when the link has none (made before). */
  from: string;
  /** The calendar's or group's name (`nom=`), '' when the link has none. */
  name: string;
}

/** Text from a link: no control or markup character, cut short (it is shown, never trusted for anything else). */
const clean = (s: string | null, max: number) => (s ?? '').replace(/[\p{Cc}<>]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The invitation an address holds (its query, or path + query), or null. */
export function readInvite(address: string): InviteInfo | null {
  const p = new URLSearchParams(address.slice(Math.max(0, address.indexOf('?'))));
  const token = p.get('invitation');
  const code = p.get('rejoindre');
  if (token && /^[0-9a-f]{64}$/i.test(token)) return { kind: 'agenda', secret: token.toLowerCase(), from: clean(p.get('de'), 40), name: clean(p.get('nom'), 60) };
  if (code && /^[A-Za-z0-9]{6}$/.test(code)) return { kind: 'groupe', secret: code.toUpperCase(), from: clean(p.get('de'), 40), name: clean(p.get('nom'), 60) };
  return null;
}

/** The kept value for a link opened at `now`. */
export const keptInvite = (path: string, now: Date) => JSON.stringify({ path, at: now.toISOString() });

/** The link of a kept value, if it is one and still fresh at `now`. */
export function freshInvite(raw: string | null, now: Date): string | null {
  if (!raw) return null;
  try {
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    const age = now.getTime() - new Date(String(at)).getTime();
    return typeof path === 'string' && path.startsWith('/') && readInvite(path) && age >= 0 && age <= INVITE_DAYS * 864e5 ? path : null;
  } catch {
    return null;
  }
}

const storage = (s: 'local' | 'session') => {
  try {
    return s === 'local' ? localStorage : sessionStorage;
  } catch {
    return null; // storage refused (private mode of some browsers)
  }
};

/** Keeps a link opened signed out (the latest one wins). */
export function keepInvite(path: string, now = new Date()) {
  storage('local')?.setItem(INVITE_KEY, keptInvite(path, now));
}

/** The link kept, still fresh (nothing taken off). */
export const pendingInvite = (now = new Date()) => freshInvite(storage('local')?.getItem(INVITE_KEY) ?? null, now) ?? storage('session')?.getItem(OLD_KEY) ?? null;

/** The link kept, taken off (joined once, by the app that reads it). */
export function takeInvite(now = new Date()): string | null {
  const path = pendingInvite(now);
  storage('local')?.removeItem(INVITE_KEY);
  storage('session')?.removeItem(OLD_KEY);
  return path;
}
