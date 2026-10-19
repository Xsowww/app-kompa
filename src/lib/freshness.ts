import { useAuth } from '../store/auth';

// The commit this page was built from (Render sets RENDER_GIT_COMMIT while building), '' elsewhere.
declare const __BUILD__: string;

/**
 * A tab left open on a public page (home, sign-in, sign-up) while a new version went online still runs
 * the old code: back on it, it reloads. Never on a signed-in page (a recording, a note being written).
 */
export function watchNewVersion() {
  if (!__BUILD__) return;
  let checked = 0;
  document.addEventListener('visibilitychange', async () => {
    const { user, confirmedElsewhere } = useAuth.getState();
    // (« Adresse confirmée » tab: reloading it would open the account a second time)
    if (document.visibilityState !== 'visible' || user || confirmedElsewhere || Date.now() - checked < 60_000) return;
    checked = Date.now();
    try {
      const res = await fetch('/api/sante', { cache: 'no-store' });
      const version = (await res.json()).version as string | undefined;
      if (version && version !== __BUILD__ && !useAuth.getState().user) location.reload();
    } catch {
      /* offline: next time */
    }
  });
}
