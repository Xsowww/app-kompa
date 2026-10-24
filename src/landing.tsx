// The public home page alone, for a visitor (lib/guestHome): no Supabase, stores or app shell to load first.
// A link to any other page hands over to the whole app (boot.tsx), drawn in the same root: no reload.
import { StrictMode, useEffect, useLayoutEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { pageRoot, watchPage } from './page';
import LandingPage from './pages/LandingPage';
import ErrorBoundary from './components/ErrorBoundary';
import { watchNewVersion } from './lib/freshness';
import { pageHeads } from './lib/seoPages.mjs';
import { t } from './i18n';

let app: Promise<typeof import('./boot')> | undefined;
const loadApp = () => (app ??= import('./boot'));
let started = false;

watchPage();
watchNewVersion(() => !started);
// Signed in from another tab: this one opens the account too (as store/auth does).
addEventListener('storage', e => {
  if (!started && e.newValue && /^sb-.+-auth-token$/.test(e.key ?? '')) location.reload();
});
// A finger or the mouse on a link to another page: the app's code comes now, it is likely needed next.
for (const type of ['pointerover', 'focusin'])
  addEventListener(type, e => {
    if (e.target instanceof Element && e.target.closest('a[href^="/"]:not([href="/"])')) void loadApp();
  });

// Once the page is shown and the phone idle, the app's code comes too: « Se connecter » then opens at once.
// Not when the visitor saves data.
if (!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) {
  const later = () => setTimeout(() => (window.requestIdleCallback ?? setTimeout)(() => void loadApp()), 3000);
  if (document.readyState === 'complete') later();
  else addEventListener('load', later, { once: true });
}

// index.html's startup screen: put back while the app arrives (after a short moment), the app removes it (App.tsx › BootHold).
const splash = document.getElementById('boot');

// eslint-disable-next-line react-refresh/only-export-components -- an entry point, not a module to hot-reload
function Home() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    // The head in the page's language, as App.tsx › PageTitle does on « / ».
    const head = pageHeads(t)['/'];
    document.title = head.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', head.description);
    const robots = document.querySelector('meta[name="robots"]') ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'robots' }));
    robots.setAttribute('content', 'index, follow');
    splash?.remove();
  }, []);
  useEffect(() => {
    if (pathname === '/' || started) return;
    started = true;
    if (splash) document.body.prepend(Object.assign(splash, { className: 'boot late-show' }));
    void loadApp().then(m => m.start());
  }, [pathname]);
  return <LandingPage />;
}

pageRoot().render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Home />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
