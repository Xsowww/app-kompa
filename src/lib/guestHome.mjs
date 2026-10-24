// Who gets the public home page alone (src/landing.tsx) instead of the whole app: a visitor on « / » with no
// session kept on this device, and nothing in the address for the app (sign-in link, invitation, error…).
// Also copied as they are into preload.js by vite.config.ts (String(fn)): no imports, nothing but these two.

/** A Supabase session is kept on this device (localStorage, or sessionStorage without « Rester connecté »). */
export function hasSession() {
  try {
    for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) if (/^sb-.+-auth-token$/.test(s.key(i) || '')) return true;
  } catch {
    /* storage blocked: as without a session */
  }
  return false;
}

/** A section of the page in the hash at most (not a sign-in link's #access_token=…), and only the language or ad tags in the query. */
export function guestHome() {
  return (
    location.pathname === '/' &&
    /^(#[\w-]*)?$/.test(location.hash) &&
    location.search.slice(1).split('&').every(p => !p || /^(lang|utm_\w+|gclid|fbclid)(=|$)/.test(p)) &&
    !hasSession()
  );
}
