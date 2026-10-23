// Everything but the language: loaded once the dictionary is there (main.tsx), so every t() is translated.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts served by the site itself: faster than a third-party request, and no visitor IP sent to Google.
import './fonts/fonts.css';
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist/latin-700.css';
import '@fontsource/geist-mono/latin-500.css';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { watchErrors } from './lib/reportError';
import { watchInstall } from './lib/install';
import { watchNewVersion } from './lib/freshness';
import { watchKeyboard } from './lib/keyboard';

watchErrors();
watchInstall();
watchNewVersion();
watchKeyboard();

// A new version was put online while this tab was open: the old code files it asks for are gone.
// Reload once to get the new version (the error screen shows if that doesn't help).
window.addEventListener('vite:preloadError', e => {
  if (sessionStorage.getItem('cop-reloaded')) return;
  sessionStorage.setItem('cop-reloaded', '1');
  e.preventDefault();
  location.reload();
});
setTimeout(() => sessionStorage.removeItem('cop-reloaded'), 10_000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
