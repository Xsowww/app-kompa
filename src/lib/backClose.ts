import { useEffect, useRef } from 'react';

/**
 * The phone's Back button (Android, browser back, iOS swipe) closes what is open over the page (dialog, menu, hub,
 * Kompaly, preview) instead of leaving the page. Each open overlay has one history entry of its own over the page's
 * (the same page, marked `overlay: depth`); Back pops it and the overlay on top closes. Closed another way (button,
 * Échap), its entry is taken away a moment later — or reused by the overlay that opens next (a menu, then its dialog).
 * Tested in tests/backClose.test.ts.
 */
type State = Record<string, unknown> | null;
const open: { close: () => void }[] = [];
/** Entries of ours under the current one, itself included. */
const depthOf = (state: unknown): number => (state as { overlay?: number } | null)?.overlay ?? 0;
const depth = () => depthOf(history.state);
/** The pages' own entry (the router's `idx`): ours over it carry the same. */
const page = (state: unknown) => (state as { idx?: number } | null)?.idx;
/** The entry we are on, as last seen (a popstate only tells where we arrive). */
let at: { state: State; url: string } = { state: null, url: '' };
/** Our own history.back() on their way. */
let ours = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let push: History['pushState'] = () => {};
let replace: History['replaceState'] = () => {};

const see = () => (at = { state: history.state as State, url: location.href });

/** As many entries as open overlays. */
function sync() {
  while (depth() < open.length) push({ ...(history.state as State), overlay: depth() + 1 }, '');
  see();
}

/** Once things are settled: an entry left without its overlay goes away (one at a time), an overlay left without its entry gets one. */
function settle() {
  if (ours) return;
  if (depth() <= open.length) return sync();
  ours++;
  history.back();
}

function later() {
  clearTimeout(timer);
  timer = setTimeout(settle, 250);
}

if (typeof window !== 'undefined') {
  push = history.pushState.bind(history);
  replace = history.replaceState.bind(history);
  see();
  // Reloaded with an overlay open: its entry is still there, the overlay is not.
  if (depth()) later();
  // The pages change the address (the router, « ?ajout=1 » taken out once the form is open…).
  // From an entry of ours (a link in a menu, in a dialog): the new page takes its place, nothing is left between the
  // two pages (Back, then Forward, go from one to the other).
  history.pushState = (state, unused, url) => {
    (depth() ? replace : push)(state, unused, url);
    see();
    later(); // an overlay that stays open over the new page gets its entry back
  };
  // On an entry of ours, the address written is the page's: the entry stays ours, and gives it to the page's when it goes.
  history.replaceState = (state, unused, url) => {
    replace(depth() && !depthOf(state) ? { ...(state as State), overlay: depth() } : state, unused, url);
    see();
  };
  // First to hear it (registered before the router, capture): a Back that only closes an overlay is no navigation,
  // neither the pages nor the other listeners (lib/captcha) hear of it.
  window.addEventListener(
    'popstate',
    e => {
      const from = at;
      const was = depthOf(from.state);
      const now = depth();
      see();
      // Another page, or forward: the pages' business.
      if (now >= was || page(history.state) !== page(from.state)) {
        if (!ours) return;
        // Our own step back, overtaken by a page change: undone, the pages hear nothing of it.
        ours = 0;
        e.stopImmediatePropagation();
        return history.forward();
      }
      e.stopImmediatePropagation();
      // Out of an entry of ours, onto the same page under it: what the page wrote there meanwhile comes down with us.
      replace(now ? { ...from.state, overlay: now } : (({ overlay: _, ...rest }) => rest)(from.state!), '', from.url);
      see();
      if (ours) {
        ours--;
        return settle(); // the next one, or an overlay opened meanwhile
      }
      const closing = open.slice(now).reverse();
      // An entry whose overlay was already closed: Back goes on to what the user meant.
      if (!closing.length) history.back();
      for (const o of closing) o.close();
    },
    true,
  );
}

/** `close` is what Back does from now on, until the function returned is called (the overlay is gone). */
export function backClose(close: () => void) {
  const me = { close };
  open.push(me);
  sync();
  return () => {
    open.splice(open.indexOf(me), 1);
    later();
  };
}

/** While `on`, Back calls `onClose` instead of leaving the page. */
export function useBackClose(on: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => (on ? backClose(() => ref.current()) : undefined), [on]);
}
