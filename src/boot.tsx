// Everything but the language: loaded once the dictionary is there (main.tsx), so every t() is translated.
import { StrictMode } from 'react';
import { pageRoot, watchPage } from './page';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { useAuth } from './store/auth';
import { toast } from './store/ui';
import { t } from './i18n';
import { watchNewVersion } from './lib/freshness';
import { watchKeyboard } from './lib/keyboard';
import { keepAppOffline } from './lib/offline';

/** Starts the app: right away (main.tsx), or when the visitor leaves the home page drawn alone (landing.tsx). */
export function start() {
  watchPage();
  // Reloads by itself signed out only (« Adresse confirmée » tab too: reloading it would open the account a second
  // time); signed in, a toast offers it.
  watchNewVersion(
    () => {
      const { user, confirmedElsewhere } = useAuth.getState();
      return !user && !confirmedElsewhere;
    },
    () => toast(t('Nouvelle version disponible'), 'info', { label: t('Recharger'), run: () => location.reload() }, { duration: 0 }),
  );
  watchKeyboard();
  // Not in development: the files there are the sources, served one by one (nothing to keep for offline).
  if (import.meta.env.PROD) keepAppOffline();

  pageRoot().render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
