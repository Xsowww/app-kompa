// What every page needs, the home page alone (landing.tsx) or the app (boot.tsx): styles, the React root, the watchers.
import { createRoot, type Root } from 'react-dom/client';
// Fonts served by the site itself: faster than a third-party request, and no visitor IP sent to Google.
import './fonts/fonts.css';
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist/latin-700.css';
import '@fontsource/geist-mono/latin-500.css';
import './index.css';
import { watchErrors } from './lib/reportError';
import { watchInstall } from './lib/install';

let root: Root | undefined;
/** One React root: the home page draws in it first, the app then takes it over in place (no blank page in between). */
export const pageRoot = () => (root ??= createRoot(document.getElementById('root')!));

let quiet = 0;
/** A load the visitor didn't ask for (pages fetched ahead, App.tsx): failing, it must not reload the page. */
export function quietly<T>(load: () => Promise<T>) {
  quiet++;
  return load().finally(() => quiet--);
}

let watching = false;
/** Once per page load, whichever of the two starts first. */
export function watchPage() {
  if (watching) return;
  watching = true;
  watchErrors();
  watchInstall();
  // A new version was put online while this tab was open: the old code files it asks for are gone.
  // Reload once to get the new version (the error screen shows if that doesn't help). Offline, a reload would only
  // show the browser's « no connection » page: the page asked for says so instead (App.tsx › lazyPage).
  window.addEventListener('vite:preloadError', e => {
    if (quiet || navigator.onLine === false) return;
    if (sessionStorage.getItem('cop-reloaded')) return;
    sessionStorage.setItem('cop-reloaded', '1');
    e.preventDefault();
    location.reload();
  });
  setTimeout(() => sessionStorage.removeItem('cop-reloaded'), 10_000);
}
