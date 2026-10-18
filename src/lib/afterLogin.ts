// A page of the app opened signed out (a bookmark, a link): back to it once signed in, not to the home page.

const KEY = 'cop-after-login';
/** Signing out on purpose from a page: that page isn't one « asked for » (the next account starts at home). */
let signingOut = false;
export function forgetAfterLogin() {
  signingOut = true;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}

export function rememberAfterLogin(path: string) {
  if (signingOut) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    /* private mode: the home page then */
  }
}

/** Where to go once signed in (read only); « / » when nothing was asked. */
export function peekAfterLogin(): string {
  let p: string | null = null;
  try {
    p = sessionStorage.getItem(KEY);
  } catch {
    /* nothing kept */
  }
  return p && p.startsWith('/') && !p.startsWith('//') ? p : '/'; // only a page of this site
}

/** The same, used once. */
export function takeAfterLogin(): string {
  signingOut = false;
  const p = peekAfterLogin();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
  return p;
}
