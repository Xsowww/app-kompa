import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { captchaToken } from './captcha';
import { serviceFetch, setHealthCheck } from './serviceStatus';
import { t } from '../i18n';

// When VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set (see .env.example), accounts and
// data live in Supabase. Otherwise the app keeps working fully offline in this browser.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** This page was opened by a sign-in link (e-mail confirmation, Google…): read before the client clears the URL. */
export const arrivedWithLink = typeof location !== 'undefined' && /(?:^|[#&?])(?:access_token|code)=/.test(location.hash + location.search);

/**
 * The new-password page is for whoever came by a real reset e-mail, in this tab: an open session alone (or an
 * address with a made-up « ?code=x ») must not change the password without the current one (that is Profil › Compte).
 * Only Supabase's own PASSWORD_RECOVERY event, after it checked the link, opens it.
 */
const RECOVERY_KEY = 'cop-recovery';
export const inRecovery = () => {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === '1';
  } catch {
    return false;
  }
};
export const endRecovery = () => {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* storage blocked */
  }
};

/** Set just before leaving for Google or Apple: an error on the way back is theirs, not an e-mail link's. */
export const OAUTH_KEY = 'cop-oauth';

/**
 * Error carried back by a Supabase e-mail link (expired or already used link…).
 * Read before the Supabase client initialises, because the client clears the URL.
 */
let fromOAuth = false;
export const linkError: string | null = (() => {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  let oauth = false;
  try {
    oauth = !!sessionStorage.getItem(OAUTH_KEY);
    sessionStorage.removeItem(OAUTH_KEY);
  } catch {
    /* storage blocked */
  }
  const code = params.get('error_code') ?? params.get('error') ?? query.get('error');
  if (!code) return null;
  const inQuery = query.has('error');
  // Read once: a reload must not show it again (without the Google mark, it would read as a link error).
  for (const k of ['error', 'error_code', 'error_description']) query.delete(k);
  const rest = query.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
  // Back from Google or Apple without an account.
  if (oauth || inQuery) {
    fromOAuth = true;
    return code === 'access_denied' ? t('Connexion annulée.') : t('La connexion n’a pas abouti. Réessaie.');
  }
  if (code === 'otp_expired') {
    return t('Ce lien a expiré ou a déjà servi. Essaie de te connecter, ou renvoie l’e-mail de confirmation.');
  }
  return t('Ce lien n’est pas valide. Essaie de te connecter ou demande un nouvel e-mail.');
})();
/** `linkError` came back from Google or Apple (no confirmation e-mail to send again). */
export const oauthError = fromOAuth;

// « Rester connecté » : the session is kept in localStorage (still there when the browser reopens, on this
// device only) unless the student unticked it, then in sessionStorage (gone when the tab closes).
const REMEMBER = 'cop-remember';
const keep = () => {
  try {
    return localStorage.getItem(REMEMBER) !== '0';
  } catch {
    return true;
  }
};
export function setRememberMe(on: boolean) {
  try {
    if (on) localStorage.removeItem(REMEMBER);
    else localStorage.setItem(REMEMBER, '0');
  } catch {
    /* storage blocked: the default (kept) applies */
  }
}
/** True when the session is kept on this device (« Rester connecté » ticked). */
export const remembered = keep;

/** Where Supabase keeps the current session (its default key): emptied to add another account without signing out. */
export const authStorageKey = url ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token` : '';

const authStorage = {
  getItem: (k: string) => (keep() ? localStorage : sessionStorage).getItem(k),
  setItem: (k: string, v: string) => {
    (keep() ? localStorage : sessionStorage).setItem(k, v);
    (keep() ? sessionStorage : localStorage).removeItem(k);
  },
  removeItem: (k: string) => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  },
};

// serviceFetch: the « service perturbé » banner (lib/serviceStatus) learns from every request.
export const supabase = url && key ? createClient(url, key, { auth: { storage: authStorage, persistSession: true, autoRefreshToken: true }, global: { fetch: serviceFetch } }) : null;
// Listened to right away: the event comes once, while the client reads the link in the address.
supabase?.auth.onAuthStateChange(event => {
  if (event !== 'PASSWORD_RECOVERY') return;
  try {
    sessionStorage.setItem(RECOVERY_KEY, '1');
  } catch {
    /* storage blocked: the page will say the link expired */
  }
});
if (url && key) setHealthCheck(() => serviceFetch(`${url}/auth/v1/health`, { headers: { apikey: key }, cache: 'no-store' }));

/**
 * Checks a password without touching the current session (which may already be
 * verified with the second factor): a throwaway client signs in, then forgets.
 */
/** False for a wrong password; any other failure (network, too many tries) is thrown, not taken for one. */
export async function checkPassword(email: string, password: string): Promise<boolean> {
  if (!url || !key) return false;
  const tmp = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'cop-pilot-check' } });
  const { error } = await tmp.auth.signInWithPassword({ email, password, options: { captchaToken: await captchaToken() } });
  if (!error) await tmp.auth.signOut({ scope: 'local' });
  if (error && error.code !== 'invalid_credentials' && !/invalid login/i.test(error.message)) throw error;
  return !error;
}
export const cloudEnabled = supabase !== null;

export type OAuthProvider = 'google' | 'apple';
type AuthSettings = { external?: Record<string, boolean>; passkeys_enabled?: boolean };
let settings: Promise<AuthSettings> | null = null;
/** What is switched on in Supabase (read once). */
const authSettings = () =>
  (settings ??= fetch(`${url}/auth/v1/settings`, { headers: { apikey: key! } })
    .then((r): Promise<AuthSettings> | AuthSettings => (r.ok ? r.json() : {}))
    .catch((): AuthSettings => ({})));

/** Google and Apple sign-in buttons show only once they are switched on in Supabase (Authentication › Providers). */
export function oauthProviders(): Promise<OAuthProvider[]> {
  if (!url || !key) return Promise.resolve([]);
  // shortcut: Apple's button hidden until the Apple Developer account is bought; put 'apple' back in this list then.
  return authSettings().then(s => (['google'] as const).filter(p => s.external?.[p] === true));
}

/** Face ID / fingerprint sign-in: switched on in Supabase (Authentication › Passkeys) and possible in this browser. */
export function passkeysAvailable(): Promise<boolean> {
  if (!url || !key || typeof window === 'undefined' || !window.PublicKeyCredential) return Promise.resolve(false);
  return authSettings().then(s => s.passkeys_enabled === true);
}

/** Ends a session kept for an account that is not the one in use (« Retirer de cet appareil »). */
export async function revokeSession(session: { access_token: string; refresh_token: string }, before?: (client: SupabaseClient) => Promise<unknown>) {
  if (!url || !key) return;
  const tmp = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'cop-pilot-revoke' } });
  const { error } = await tmp.auth.setSession(session);
  if (error) return;
  await before?.(tmp).catch(() => undefined);
  await tmp.auth.signOut({ scope: 'local' });
}

/** Access token of the signed-in user, to authenticate calls to our own server. */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}


/** Vrai si le compte connecté est déclaré dans public.admins (tableau de bord /admin). */
export async function checkIsAdmin(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}

/** Reports and feedback still open (admins only, 0 otherwise or without the 2026-10-17 migration). */
export async function adminPendingCount(): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('admin_open_count');
  return !error && typeof data === 'number' ? data : null;
}
