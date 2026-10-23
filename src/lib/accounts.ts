// Several accounts on one device (e.g. a « perso » account and a « travail » one): each account that
// was fully signed in here with « Rester connecté » keeps its own session, so switching takes a click
// instead of the e-mail, the password and the phone's code again.
//
// What is kept: the account's name and e-mail, and in cloud mode its Supabase session (the same tokens
// Supabase itself keeps in this browser for the current account). An account left unused for
// STALE_DAYS asks for its credentials again: its session is dropped and only the e-mail is remembered.

import { cloudEnabled, type OAuthProvider } from './supabase';
import { t } from '../i18n';

const KEY = 'cop:accounts';
export const STALE_DAYS = 14;
const STALE_MS = STALE_DAYS * 24 * 3600 * 1000;

export interface SavedAccount {
  id: string;
  email: string;
  name: string;
  /** Last time it was the account in use on this device (ms). */
  lastActive: number;
  /** Cloud mode: the session to resume. Absent in local mode, or once stale. */
  session?: { access_token: string; refresh_token: string };
  /** Signed out on purpose: still listed, but opened with the password only. */
  signedOut?: boolean;
  /** Google or Apple account without a password: opened again with that button, not a password. */
  provider?: OAuthProvider;
}

function read(): SavedAccount[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(a => a && typeof a.id === 'string' && typeof a.email === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: SavedAccount[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: switching just asks for the credentials */
  }
}

export const isStale = (a: SavedAccount, now = Date.now()) => now - a.lastActive > STALE_MS;

/** The accounts of this device, most recently used first. Stale ones lose their session here. */
export function savedAccounts(now = Date.now()): SavedAccount[] {
  const list = read();
  let changed = false;
  for (const a of list) {
    if (a.session && isStale(a, now)) {
      delete a.session;
      changed = true;
    }
  }
  if (changed) write(list);
  return list.sort((a, b) => b.lastActive - a.lastActive);
}

/** Adds or refreshes an account after a real sign-in (its session when given; `session: null` forgets it). */
export function rememberAccount(entry: Omit<SavedAccount, 'lastActive' | 'session'> & { session?: SavedAccount['session'] | null }, now = Date.now()) {
  const list = read().filter(a => a.id !== entry.id);
  const old = read().find(a => a.id === entry.id);
  const session = entry.session === null ? undefined : (entry.session ?? old?.session);
  const provider = 'provider' in entry ? entry.provider : old?.provider; // given: up to date (a password chosen since drops it)
  list.push({ id: entry.id, email: entry.email, name: entry.name, lastActive: now, ...(session && { session }), ...(provider && { provider }) });
  write(list);
}

/** New tokens of the account in use (Supabase refreshes them every hour): kept only if the account is saved. */
export function updateSession(id: string, session: NonNullable<SavedAccount['session']>, now = Date.now()) {
  const list = read();
  const a = list.find(x => x.id === id);
  if (!a) return;
  a.session = session;
  a.lastActive = now;
  write(list);
}

/** « Se déconnecter » : the account stays in the list but needs its password again. */
export function lockAccount(id: string) {
  const list = read();
  const a = list.find(x => x.id === id);
  if (!a) return;
  delete a.session;
  a.signedOut = true;
  write(list);
}

export function forgetAccount(id: string) {
  write(read().filter(a => a.id !== id));
}

export function savedAccount(id: string) {
  return savedAccounts().find(a => a.id === id);
}

/** Can it be opened with a click, or does it need its password again (unused too long, session gone)? */
export const needsCredentials = (a: SavedAccount) => isStale(a) || !!a.signedOut || (cloudEnabled && !a.session);

export const STALE_HINT = t('Ce compte n’a pas servi depuis plus de {n}\u00a0jours : entre de nouveau ton mot de passe.', { n: STALE_DAYS });

export const PROVIDER_NAMES: Record<OAuthProvider, string> = { google: 'Google', apple: 'Apple' };

/** Why a saved account asks for its password again, in the words shown above the field. */
export const reloginHint = (a: SavedAccount | undefined) =>
  a?.provider ? t('Reconnecte-toi avec {provider}.', { provider: PROVIDER_NAMES[a.provider] }) : a?.signedOut ? t('Tu t’es déconnecté de ce compte : entre ton mot de passe pour le rouvrir.') : a && isStale(a) ? STALE_HINT : t('La session de ce compte a expiré : entre de nouveau ton mot de passe.');

/**
 * Keys of the copies to drop when « Rester connecté » was unticked and the browser closed without signing out:
 * every account's data except those still kept open on this device (`kept`), and except the changes not sent yet.
 */
export function unkeptCopyKeys(keys: string[], kept: Set<string>): string[] {
  return keys.filter(k => {
    const id = /^cop:([^:]+):/.exec(k)?.[1];
    return !!id && !kept.has(id) && !k.startsWith(`cop:${id}:sync-queue`);
  });
}
