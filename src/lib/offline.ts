// Offline starts (installed app, privacy page's promise): the service worker (public/sw.js) keeps the app's files.
// It only sees the requests made once it is there: what this page loaded before (its very first visit, or the
// first one after a new version) is told to it, so the next start works without network too.

import { serviceWorker } from './push';

/** The site's own files this page loaded (scripts, styles, fonts, pictures), not its API calls. */
export const ownFiles = (urls: string[], origin: string) => urls.filter(u => u.startsWith(`${origin}/`) && !u.startsWith(`${origin}/api/`) && !u.startsWith(`${origin}/__kompaly/`));

export function keepAppOffline() {
  if (!('serviceWorker' in navigator)) return;
  const tell = async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: 'kompaly-keep', urls: ownFiles(performance.getEntriesByType('resource').map(e => e.name), location.origin) });
  };
  // A new version's worker takes over: its cache starts empty.
  navigator.serviceWorker.addEventListener('controllerchange', () => void tell().catch(() => {}));
  // After the page's own loading: the worker's start doesn't compete with it.
  const start = () => void serviceWorker().then(reg => reg && tell()).catch(() => {});
  if (document.readyState === 'complete') setTimeout(start, 1000);
  else addEventListener('load', () => setTimeout(start, 1000), { once: true });
}
