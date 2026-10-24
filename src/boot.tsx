// Everything but the language: loaded once the dictionary is there (main.tsx), so every t() is translated.
import { StrictMode } from 'react';
import { pageRoot, watchPage } from './page';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { useAuth } from './store/auth';
import { watchNewVersion } from './lib/freshness';
import { watchKeyboard } from './lib/keyboard';

/** Starts the app: right away (main.tsx), or when the visitor leaves the home page drawn alone (landing.tsx). */
export function start() {
  watchPage();
  // Signed out only (« Adresse confirmée » tab too: reloading it would open the account a second time).
  watchNewVersion(() => {
    const { user, confirmedElsewhere } = useAuth.getState();
    return !user && !confirmedElsewhere;
  });
  watchKeyboard();

  pageRoot().render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
