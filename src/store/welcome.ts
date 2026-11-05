import { create } from 'zustand';
import { takeAfterLogin } from '../lib/afterLogin';

// Apart from store/session (the whole account's load): the routes and the sign-in pages read it without downloading
// every store with it.

/**
 * The welcome questionnaire, for the routes (App): `pending`, still to answer (→ /bienvenue); `unsure`, can't be known
 * yet (new device offline: the app opens, with « Termine ton profil »); `checking`, the account is being loaded (a
 * loading screen, never the app empty and then a jump to the questionnaire).
 */
export const useWelcome = create<{ pending: boolean; unsure: boolean; checking: boolean }>(() => ({ pending: false, unsure: false, checking: false }));

// Local mode has no profile row: a flag per account says the questionnaire is still to answer,
// so a reload in the middle of it doesn't skip it.
export const welcomeKey = (userId: string) => `cop:${userId}:welcome`;
export function markLocalWelcome(userId: string) {
  try {
    localStorage.setItem(welcomeKey(userId), '1');
  } catch {
    /* private mode: the questionnaire still shows now, only a reload skips it */
  }
  useWelcome.setState({ pending: true });
}

/**
 * Where to go once signed in (and the account loaded): the questionnaire when it is still to answer, else the page
 * asked for (or « / »). Straight there: going through « / » first raced with its own redirect and left a blank page.
 */
export const afterSignIn = () => (useWelcome.getState().pending ? '/bienvenue' : takeAfterLogin());
