// The commit this page was built from (Render sets RENDER_GIT_COMMIT while building), '' elsewhere.
declare const __BUILD__: string;

/**
 * A new version went online while this tab was open: it still runs the old code.
 * - On a public page (home, sign-in, sign-up), back on the tab, it reloads: nothing to lose there.
 * - Elsewhere (a recording, a note being written…) never on its own: `onNew` offers it (« Recharger »), checked when
 *   coming back to the tab and every few minutes while it is in view.
 * `publicPage` says whether the page may reload (no store here, so the home page alone loads it without the app).
 */
export function watchNewVersion(publicPage: () => boolean, onNew?: () => void) {
  if (!__BUILD__) return;
  let checked = 0;
  let told = false;
  const check = async (back: boolean) => {
    if (document.visibilityState !== 'visible' || Date.now() - checked < 60_000) return;
    // Only back on the tab does a public page reload: not under the fingers of someone filling the sign-up form.
    const mayReload = back && publicPage();
    if (!mayReload && (!onNew || told || publicPage())) return;
    checked = Date.now();
    try {
      const res = await fetch('/api/sante', { cache: 'no-store' });
      const version = (await res.json()).version as string | undefined;
      if (!version || version === __BUILD__) return;
      if (mayReload && publicPage()) location.reload();
      else if (onNew && !told && !publicPage()) {
        told = true;
        onNew();
      }
    } catch {
      /* offline: next time */
    }
  };
  document.addEventListener('visibilitychange', () => void check(true));
  if (onNew) setInterval(() => void check(false), 5 * 60_000);
}
