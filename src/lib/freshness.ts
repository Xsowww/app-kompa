// The commit this page was built from (Render sets RENDER_GIT_COMMIT while building), '' elsewhere.
declare const __BUILD__: string;

/**
 * A tab left open on a public page (home, sign-in, sign-up) while a new version went online still runs
 * the old code: back on it, it reloads. Never on a signed-in page (a recording, a note being written):
 * `publicPage` says whether the page may reload (no store here, so the home page alone loads it without the app).
 */
export function watchNewVersion(publicPage: () => boolean) {
  if (!__BUILD__) return;
  let checked = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !publicPage() || Date.now() - checked < 60_000) return;
    checked = Date.now();
    try {
      const res = await fetch('/api/sante', { cache: 'no-store' });
      const version = (await res.json()).version as string | undefined;
      if (version && version !== __BUILD__ && publicPage()) location.reload();
    } catch {
      /* offline: next time */
    }
  });
}
