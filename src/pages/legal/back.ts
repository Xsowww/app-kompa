/**
 * « Retour » on the legal pages: straight back to the page of the app (or the public home page) the reader came from,
 * however many legal pages were read in between (it stepped back through each one of them).
 */

const KEY = 'kompaly-legal-from';
// The addresses of pages/legal/links (not imported: that file and its words stay out of the app's first script).
const LEGAL = new Set(['/mentions-legales', '/confidentialite', '/conditions', '/tarifs', '/a-propos']);

/** The last page outside the legal pages: its address and its place in the tab's history (react-router's idx). */
export type LegalFrom = { path: string; idx: number };

export const isLegalPath = (pathname: string) => LEGAL.has(pathname.replace(/(.)\/+$/, '$1').toLowerCase());

/** Called on each page change: remembers the page when it isn't a legal one. */
export function rememberLegalFrom(pathname: string, search: string, idx: number | undefined) {
  if (isLegalPath(pathname)) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path: pathname + search, idx: idx ?? -1 }));
  } catch {
    /* private mode: « Retour » then goes to the home page */
  }
}

export function legalFrom(): LegalFrom | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as LegalFrom | null;
    return v && typeof v.path === 'string' && typeof v.idx === 'number' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Where « Retour » goes: back in the history down to the page left (`delta`, the history stays as if the legal pages had
 * been one); opened directly (a link from outside, a new tab), the home page: the app's when signed in, the public one
 * otherwise.
 */
export function legalBack(from: LegalFrom | null, idx: number | undefined): { delta: number } | { to: string } {
  if (from && from.idx >= 0 && idx !== undefined && idx > from.idx) return { delta: from.idx - idx };
  return { to: '/' };
}
