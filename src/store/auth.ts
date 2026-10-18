import { create } from 'zustand';
import { uid, nowIso } from '../lib/utils';
import { setStorageUser } from '../lib/userStorage';
import { flushNow, stopSync, updateCloudProfile } from '../lib/cloudSync';
import { supabase, checkPassword, remembered, authStorageKey, revokeSession } from '../lib/supabase';
import { captchaToken } from '../lib/captcha';
import { forgetAfterLogin } from '../lib/afterLogin';
import { rememberAccount, updateSession, forgetAccount, lockAccount, savedAccount, needsCredentials } from '../lib/accounts';
import type { AuthError, User as SupabaseUser } from '@supabase/supabase-js';

// Two modes:
// - cloud (Supabase configured): real accounts, e-mail confirmation, password reset,
//   sessions handled by Supabase (passwords never touch our code).
// - local (no configuration): accounts live in this browser only, passwords kept as a
//   salted PBKDF2 hash. Handy for development or a demo.

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface StoredUser extends User {
  salt: string;
  hash: string;
}

const USERS_KEY = 'cop:users';
const SESSION_KEY = 'cop:session';

function readUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function toHex(buf: ArrayBuffer | Uint8Array) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string, salt: string): Promise<string> {
  if (crypto?.subtle) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 120_000, hash: 'SHA-256' },
      key,
      256,
    );
    return toHex(bits);
  }
  // Insecure context fallback (e.g. plain http on a LAN IP): still not clear text.
  let h = 0;
  for (const c of salt + password) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return `weak-${h}`;
}

function publicUser({ salt: _s, hash: _h, ...u }: StoredUser): User {
  return u;
}

/** Second factor (authenticator app) still required before entering the app. */
export type MfaStep = 'setup' | 'verify' | null;

export interface MfaEnrollment {
  factorId: string;
  qrCode: string; // SVG data URL
  secret: string;
  uri: string; // otpauth:// link, opens the authenticator app on a phone
}

interface AuthState {
  user: User | null;
  mfaStep: MfaStep;
  startMfaSetup: () => Promise<MfaEnrollment>;
  /** Confirms a code from the authenticator app (setup or login). */
  submitMfaCode: (code: string, factorId?: string) => Promise<void>;
  /** Removes the current authenticator so a new phone can be set up. */
  resetMfa: () => Promise<void>;
  /** Restores the session when the app starts. */
  init: () => Promise<void>;
  /** Returns null when the account must first be confirmed by e-mail (cloud mode). */
  register: (name: string, email: string, password: string) => Promise<User | null>;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  /** Opens another account saved on this device; 'credentials' when its session is gone (unused too long, revoked…). */
  /** `to`: the page to open once switched (a notification of that account). */
  switchAccount: (id: string, to?: string) => Promise<'credentials' | void>;
  /** Keeps the current account on this device and opens the login page for another one. */
  /** Leaves this account open on the device and goes to the sign-in page (`email`: the saved account to sign in to again). */
  addAccount: (email?: string) => Promise<void>;
  /** Forgets a saved account on this device and ends its kept session. */
  removeAccount: (id: string) => void;
  updateName: (name: string) => Promise<void>;
  verifyPassword: (password: string) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  /** `beforeDelete` clears what the server keeps (files, groups) once every check has passed. */
  deleteAccount: (password: string, beforeDelete?: () => Promise<void>) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  /** `code`: the authenticator code, needed when the account has a phone paired (always, online). */
  setNewPassword: (password: string, code?: string) => Promise<void>;
  /** On the reset page: the new password will need the phone's code. */
  resetNeedsCode: () => Promise<boolean>;
}

// ── Local mode helpers ──────────────────────────────────────────────────────

function startSession(user: User) {
  localStorage.setItem(SESSION_KEY, user.id);
  setStorageUser(user.id);
}

function restoreLocalSession(): User | null {
  const id = localStorage.getItem(SESSION_KEY);
  const found = id ? readUsers().find(u => u.id === id) : undefined;
  if (!found) return null;
  setStorageUser(found.id);
  rememberAccount({ id: found.id, email: found.email, name: found.name }); // in use: not stale
  return publicUser(found);
}

async function checkLocalPassword(userId: string | undefined, password: string) {
  const found = readUsers().find(u => u.id === userId);
  if (!found || (await hashPassword(password, found.salt)) !== found.hash) throw new Error('Mot de passe incorrect.');
  return found;
}

function clearLocalCache(userId: string) {
  for (const key of Object.keys(localStorage)) if (key.startsWith(`cop:${userId}:`)) localStorage.removeItem(key);
}

// ── Cloud mode helpers ──────────────────────────────────────────────────────

function fromSupabase(u: SupabaseUser): User {
  return {
    id: u.id,
    email: u.email ?? '',
    name: (u.user_metadata?.name as string | undefined) || (u.email ?? '').split('@')[0],
    createdAt: u.created_at,
  };
}

/** Supabase error → message an étudiant can understand. */
function authMessage(e: AuthError | Error): string {
  const code = (e as AuthError).code ?? '';
  const msg = e.message.toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login')) return 'E-mail ou mot de passe incorrect.';
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'Confirme d’abord ton adresse : clique sur le lien reçu par e-mail.';
  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered')) return 'Un compte existe déjà avec cet e-mail.';
  if (code === 'weak_password' || msg.includes('password should')) return 'Mot de passe trop faible : au moins 8 caractères, avec lettres et chiffres.';
  if (code.startsWith('over_') || msg.includes('rate limit')) return 'Trop de tentatives, réessaie dans quelques minutes.';
  if (code === 'same_password') return 'Le nouveau mot de passe doit être différent de l’ancien.';
  if (msg.includes('captcha')) return 'La vérification anti-robot a échoué. Recharge la page et réessaie.';
  if (code === 'insufficient_aal' || msg.includes('aal2')) return 'Entre aussi le code à 6 chiffres de ton application d’authentification.';
  if (code === 'session_not_found' || msg.includes('session missing')) return 'Ce lien a expiré ou a déjà servi : redemande un e-mail de réinitialisation.';
  if (msg.includes('fetch') || msg.includes('network')) return 'Connexion impossible, vérifie ton accès à internet.';
  return "Une erreur est survenue, réessaie dans un instant.";
}

async function cloud<R extends { data: unknown; error: AuthError | null }>(p: Promise<R>): Promise<R['data']> {
  let res;
  try {
    res = await p;
  } catch (e) {
    throw new Error(authMessage(e as Error));
  }
  if (res.error) throw new Error(authMessage(res.error));
  return res.data;
}

/** What remains to do with the second factor for the current session. */
async function nextMfaStep(): Promise<MfaStep> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return null;
  if (data.currentLevel === 'aal2') return null;
  if (data.nextLevel === 'aal2') return 'verify';
  return 'setup'; // every online account is protected by an authenticator app
}

/** Saves the account in use on this device (with its session in cloud mode, if « Rester connecté »). */
async function rememberCurrent(user: User | null) {
  if (!user) return;
  if (!supabase) return rememberAccount({ id: user.id, email: user.email, name: user.name });
  if (!remembered()) return;
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (s && s.user.id === user.id) rememberAccount({ id: user.id, email: user.email, name: user.name, session: { access_token: s.access_token, refresh_token: s.refresh_token } });
}

/**
 * Puts the account in use aside without signOut() (which would end its session for good): its latest tokens
 * go to the device's list, then this browser forgets which account is open.
 */
async function leaveSession(user: User) {
  if (!supabase) return;
  // No refresh in between: it would make the saved refresh token an already used one.
  await supabase.auth.stopAutoRefresh();
  await rememberCurrent(user);
  localStorage.removeItem(authStorageKey);
  sessionStorage.removeItem(authStorageKey);
  await supabase.auth.startAutoRefresh(); // for the next sign-in on this page
}

const OWN_SWITCH = 'cop-own-switch';

/** True while this tab itself is signing in (its own SIGNED_IN event must not reload it). */
let ownSignIn = false;

export const useAuth = create<AuthState>((set, get) => ({
  user: supabase ? null : restoreLocalSession(),
  mfaStep: null,

  async init() {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const user = data.session ? fromSupabase(data.session.user) : null;
    const mfaStep = user ? await nextMfaStep() : null;
    setStorageUser(user && !mfaStep ? user.id : null);
    set({ user, mfaStep });
    if (user && !mfaStep) void rememberCurrent(user);
    // All tabs of a browser share one Supabase session: signing in with another account in a
    // second tab silently switches this tab too. Reload so the screen matches the real account
    // (otherwise this tab would show, and send, one account's data while acting as another).
    const switched = (id: string | undefined) => {
      const shown = get().user?.id;
      if (shown && id && id !== shown) {
        // Switched here on purpose (account menu): no « another tab » warning.
        if (!sessionStorage.getItem(OWN_SWITCH)) sessionStorage.setItem('cop-account-switched', '1');
        location.reload();
        return true;
      }
      return false;
    };
    // Account put aside in another tab (« Se déconnecter », « Ajouter un compte »): no session here either.
    window.addEventListener('storage', e => {
      if (e.key === authStorageKey && e.newValue === null && get().user) location.reload();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      void supabase!.auth.getSession().then(async ({ data: d }) => {
        if (switched(d.session?.user.id)) return;
        if (d.session && get().mfaStep && !(await nextMfaStep())) location.reload();
        else if (d.session && !get().user) location.reload();
      });
    });
    supabase.auth.onAuthStateChange((event, session) => {
      if (session && switched(session.user.id)) return;
      // Code entered in another tab while this one waits on the security-code screen.
      if (session && get().mfaStep && !ownSignIn) {
        void nextMfaStep().then(step => {
          if (!step && get().mfaStep) location.reload();
        });
      }
      // Signed in from another tab while this one shows the login page: adopt that session.
      if (event === 'SIGNED_IN' && session && !get().user && !ownSignIn) {
        location.reload();
        return;
      }
      // Session expired or signed out in another tab.
      if (event === 'SIGNED_OUT' && get().user) {
        setStorageUser(null);
        set({ user: null, mfaStep: null });
      }
      if (event === 'USER_UPDATED' && session) set({ user: fromSupabase(session.user) });
      // New tokens every hour: the saved copy must stay the latest one (an older one no longer works).
      if (event === 'TOKEN_REFRESHED' && session && remembered()) updateSession(session.user.id, { access_token: session.access_token, refresh_token: session.refresh_token });
    });
  },

  async register(name, email, password) {
    const mail = email.trim().toLowerCase();
    if (supabase) {
      ownSignIn = true;
      const data = await cloud(
        supabase.auth.signUp({ email: mail, password, options: { data: { name: name.trim() }, emailRedirectTo: `${location.origin}/connexion`, captchaToken: await captchaToken() } }),
      ).finally(() => setTimeout(() => (ownSignIn = false), 1500));
      // An address that already has an account gets a look-alike answer and no e-mail at all.
      if (data.user && !data.user.identities?.length) throw new Error('Un compte existe déjà avec cet e-mail. Connecte-toi, ou choisis « Oublié ? » si tu n’as plus le mot de passe.');
      if (!data.session || !data.user) return null; // confirmation e-mail sent
      const user = fromSupabase(data.user);
      set({ user, mfaStep: 'setup' }); // the account is finished once the phone is paired
      return user;
    }
    const users = readUsers();
    if (users.some(u => u.email === mail)) throw new Error('Un compte existe déjà avec cet e-mail.');
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const stored: StoredUser = { id: uid(), name: name.trim(), email: mail, createdAt: nowIso(), salt, hash: await hashPassword(password, salt) };
    writeUsers([...users, stored]);
    const user = publicUser(stored);
    startSession(user);
    set({ user });
    void rememberCurrent(user);
    return user;
  },

  async login(email, password) {
    const mail = email.trim().toLowerCase();
    if (supabase) {
      ownSignIn = true;
      const token = await captchaToken();
      const data = await cloud(supabase.auth.signInWithPassword({ email: mail, password, options: { captchaToken: token } })).finally(() => setTimeout(() => (ownSignIn = false), 1500));
      const user = fromSupabase(data.user!);
      const mfaStep = await nextMfaStep();
      if (!mfaStep) setStorageUser(user.id);
      set({ user, mfaStep });
      return user;
    }
    const found = readUsers().find(u => u.email === mail);
    if (!found || (await hashPassword(password, found.salt)) !== found.hash) throw new Error('E-mail ou mot de passe incorrect.');
    const user = publicUser(found);
    startSession(user);
    set({ user });
    void rememberCurrent(user);
    return user;
  },

  async logout() {
    forgetAfterLogin(); // the page signed out from isn't one to come back to
    const user = get().user;
    const userId = user?.id;
    let sent = false;
    let ended = true;
    if (supabase) {
      sent = await flushNow().catch(() => false);
      stopSync();
      if (user && !get().mfaStep && remembered()) {
        // « Rester connecté » : the account stays one click away on the sign-in page (until STALE_DAYS
        // unused), so its session is kept, not ended. « Retirer de cet appareil » ends it for good.
        await leaveSession(user);
        ended = false;
      } else {
        // Shared computer (« Rester connecté » unticked) or code not entered yet: the session really ends,
        // and this computer stops receiving the account's notifications.
        if (userId) lockAccount(userId);
        await import('../lib/push').then(m => m.forgetThisDevice()).catch(() => undefined);
        await supabase.auth.signOut().catch(() => undefined);
      }
    } else {
      localStorage.removeItem(SESSION_KEY); // the account stays in the device's list…
      if (userId) lockAccount(userId); // …and opens again with its password only
    }
    setStorageUser(null);
    // Ordinateur partagé : tout est sur le serveur, on ne laisse rien de lisible ici.
    // Si l'envoi a échoué, on garde la copie locale pour la prochaine connexion.
    if (sent && ended && userId) {
      clearLocalCache(userId);
      void import('../lib/textIndex').then(m => m.forgetTextIndex());
    }
    set({ user: null, mfaStep: null });
  },

  async updateName(name) {
    const user = get().user;
    if (!user) return;
    if (supabase) {
      await cloud(supabase.auth.updateUser({ data: { name } }));
      await updateCloudProfile(user.id, { name });
    } else {
      writeUsers(readUsers().map(u => (u.id === user.id ? { ...u, name } : u)));
    }
    set({ user: { ...user, name } });
    void rememberCurrent({ ...user, name });
  },

  async verifyPassword(password) {
    const user = get().user;
    if (supabase) {
      const ok = await checkPassword(user?.email ?? '', password).catch((e: AuthError) => {
        throw new Error(authMessage(e));
      });
      if (!ok) throw new Error('Mot de passe incorrect.');
      return;
    }
    await checkLocalPassword(user?.id, password);
  },

  async changePassword(current, next) {
    try {
      await get().verifyPassword(current);
    } catch (e) {
      throw (e as Error).message === 'Mot de passe incorrect.' ? new Error('Mot de passe actuel incorrect.') : e;
    }
    if (supabase) {
      await cloud(supabase.auth.updateUser({ password: next }));
      return;
    }
    const users = readUsers();
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashPassword(next, salt);
    writeUsers(users.map(u => (u.id === get().user?.id ? { ...u, salt, hash } : u)));
  },

  async deleteAccount(password, beforeDelete) {
    const user = get().user;
    if (!user) return;
    await get().verifyPassword(password);
    if (supabase) {
      // The same checks as delete_my_account, made before any file is removed: a refusal
      // afterwards would leave the account without its Drive.
      if (await nextMfaStep()) throw new Error('Reconnecte-toi avec le code de ton téléphone, puis réessaie.');
      const { error: offline } = await supabase.from('profiles').select('id').eq('id', user.id).limit(1);
      if (offline) throw new Error('La suppression a échoué, réessaie plus tard.');
    }
    await beforeDelete?.();
    if (supabase) {
      const { error } = await supabase.rpc('delete_my_account');
      if (error) {
        throw new Error(
          error.code === 'PGRST202' || error.message.includes('delete_my_account')
            ? 'La suppression de compte n’est pas encore activée sur le serveur. Lance supabase/schema.sql dans Supabase.'
            : 'La suppression a échoué, réessaie plus tard.',
        );
      }
      stopSync();
      await supabase.auth.signOut().catch(() => undefined);
    } else {
      writeUsers(readUsers().filter(u => u.id !== user.id));
      localStorage.removeItem(SESSION_KEY);
    }
    clearLocalCache(user.id);
    forgetAccount(user.id);
    setStorageUser(null);
    set({ user: null });
  },

  async switchAccount(id, to = '/') {
    const current = get().user;
    const target = savedAccount(id);
    if (!target) return 'credentials';
    if (supabase) {
      if (!target.session || needsCredentials(target)) return 'credentials';
      await flushNow().catch(() => false);
      await rememberCurrent(current);
      stopSync();
      sessionStorage.setItem(OWN_SWITCH, '1');
      ownSignIn = true;
      const { data, error } = await supabase.auth.setSession(target.session);
      if (error || !data.session) {
        sessionStorage.removeItem(OWN_SWITCH);
        rememberAccount({ id: target.id, email: target.email, name: target.name, session: null });
        return 'credentials';
      }
    } else {
      // Local accounts: no session to resume once unused for long; the password again.
      if (!readUsers().some(u => u.id === id) || needsCredentials(target)) return 'credentials';
      localStorage.setItem(SESSION_KEY, id);
      sessionStorage.setItem(OWN_SWITCH, '1');
    }
    location.assign(to.startsWith('/') ? to : '/');
  },

  async addAccount(email) {
    const current = get().user;
    if (supabase) {
      await flushNow().catch(() => false);
      stopSync();
      if (current) await leaveSession(current);
    } else {
      void rememberCurrent(current);
      localStorage.removeItem(SESSION_KEY);
    }
    location.assign(`/connexion?ajout=1${email ? `&email=${encodeURIComponent(email)}` : ''}`);
  },

  removeAccount(id) {
    const a = savedAccount(id);
    forgetAccount(id);
    if (a?.session) void revokeSession(a.session, c => import('../lib/push').then(m => m.forgetThisDevice(c))).catch(() => undefined);
  },

  async resendConfirmation(email) {
    if (!supabase) return;
    await cloud(supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase(), options: { emailRedirectTo: `${location.origin}/connexion`, captchaToken: await captchaToken() } }));
  },

  async requestPasswordReset(email) {
    if (!supabase) throw new Error('La réinitialisation par e-mail n’est disponible qu’avec la version en ligne.');
    await cloud(supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${location.origin}/reinitialisation`, captchaToken: await captchaToken() }));
  },

  async setNewPassword(password, code) {
    if (!supabase) throw new Error('La réinitialisation par e-mail n’est disponible qu’avec la version en ligne.');
    // The e-mail link only proves the address: with a phone paired, Supabase also wants its code.
    if (code) {
      const { data } = await supabase.auth.mfa.listFactors();
      const factor = data?.totp.find(f => f.status === 'verified');
      if (factor) {
        // Our own verification: the auth listener must not take it for a code typed in another tab (it reloads the page).
        ownSignIn = true;
        const { error } = await supabase.auth.mfa
          .challengeAndVerify({ factorId: factor.id, code: code.replace(/\s/g, '') })
          .finally(() => setTimeout(() => (ownSignIn = false), 1500));
        if (error) throw new Error(/rate|too many/i.test(error.message) ? 'Trop de tentatives, attends un peu.' : 'Code incorrect. Tape le code Kompaly affiché en ce moment sur ton téléphone.');
      }
    }
    await cloud(supabase.auth.updateUser({ password }));
    // Signed in for good now (the link plus, when needed, the phone's code).
    const mfaStep = await nextMfaStep();
    const user = get().user;
    if (user && !mfaStep) setStorageUser(user.id);
    set({ mfaStep });
  },

  async resetNeedsCode() {
    return (await nextMfaStep()) === 'verify';
  },

  async startMfaSetup() {
    if (!supabase) throw new Error('Indisponible en mode local.');
    const key = `cop-mfa-setup:${get().user?.id}`;
    const { data: list } = await supabase.auth.mfa.listFactors();
    const pending = (list?.all ?? []).filter(f => f.status !== 'verified');
    // Page reloaded (back from the camera app, tab restored): show the same QR code as before.
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as MfaEnrollment | null;
      if (saved && pending.some(f => f.id === saved.factorId)) return saved;
    } catch {
      /* nothing saved */
    }
    // Earlier QR codes are kept (another tab or device may show one that was just scanned); the extras go once one is confirmed.
    const enroll = () => supabase!.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Kompaly ${Date.now()}`, issuer: 'Kompaly' });
    let { data, error } = await enroll();
    if (error && pending.length) {
      // Too many unfinished attempts: start over once.
      for (const f of pending) await supabase.auth.mfa.unenroll({ factorId: f.id });
      ({ data, error } = await enroll());
    }
    if (error || !data) throw new Error("Impossible de générer le QR code, réessaie dans un instant.");
    const enrollment = { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
    try {
      sessionStorage.setItem(key, JSON.stringify(enrollment));
    } catch {
      /* private mode: a reload just shows a new QR code, the old one still works */
    }
    return enrollment;
  },

  async submitMfaCode(code, factorId) {
    if (!supabase) return;
    const { data } = await supabase.auth.mfa.listFactors();
    const all = data?.all ?? [];
    // During setup, the code may come from any QR code shown so far (other tab, other device, before a reload): try each, newest first.
    const ids = factorId
      ? [factorId, ...all.filter(f => f.status !== 'verified' && f.factor_type === 'totp' && f.id !== factorId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(f => f.id)].slice(0, 5)
      : [data?.totp[0]?.id].filter((id): id is string => !!id);
    if (!ids.length) throw new Error('Aucun appareil n’est associé à ce compte.');
    ownSignIn = true;
    let error: { message: string } | null = null;
    let verified = '';
    try {
      for (const id of ids) {
        ({ error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: code.replace(/\s/g, '') }));
        if (!error) {
          verified = id;
          break;
        }
        if (/ip address|rate|too many/i.test(error.message)) break; // trying the others would not help
      }
    } finally {
      setTimeout(() => (ownSignIn = false), 1500);
    }
    if (!verified) {
      const msg = (error?.message ?? '').toLowerCase();
      throw new Error(msg.includes('ip address') ? 'Ta connexion a changé pendant la vérification (VPN, 4G/Wi-Fi). Réessaie.' : msg.includes('expired') ? 'Ce code a expiré, tape le nouveau code affiché.' : msg.includes('rate') || msg.includes('too many') ? 'Trop de tentatives, attends un peu.' : 'Code incorrect. Vérifie que tu tapes le code Kompaly affiché en ce moment.');
    }
    if (factorId) {
      // Setup done: the QR codes that weren't used are dropped, and so is the previous phone
      // (changing phones: it is only removed once the new one works).
      for (const f of all) if (f.id !== verified) await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => undefined);
      sessionStorage.removeItem(`cop-mfa-setup:${get().user?.id}`);
    }
    const user = get().user;
    if (user) setStorageUser(user.id);
    set({ mfaStep: null });
    void rememberCurrent(user); // fully signed in: saved for quick switching
  },

  async resetMfa() {
    if (!supabase) return;
    // The current phone stays until the new one is confirmed (submitMfaCode): giving up halfway
    // must not leave the account without its second factor.
    setStorageUser(null);
    set({ mfaStep: 'setup' });
  },
}));
