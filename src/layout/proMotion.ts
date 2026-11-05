import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

export type BubbleAt = { x: number; y: number; w: number; h: number; moved: boolean } | null;

/**
 * The white bubble under the chosen icon of a pill (Affichage Pro): where that icon is (`selector` in `box`), kept up to
 * date when the page, the pill or the window changes. No slide the first time (it is simply there), then a spring.
 */
export function useBubble(box: RefObject<HTMLElement | null>, selector: string, deps: unknown[]): BubbleAt {
  const [at, setAt] = useState<BubbleAt>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = box.current?.querySelector<HTMLElement>(selector);
      setAt(prev => (el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, moved: !!prev } : null));
    };
    place();
    const seen = new ResizeObserver(place);
    if (box.current) seen.observe(box.current);
    return () => seen.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return at;
}

/** What comes in one after the other: the parts of a page's top, its cards (not those inside a card), and whatever a page marks. */
const PARTS = '.page-head > *, .card, [data-pro-in]';
/** One after the other up to this many; the rest of the screen comes with the last: the whole entrance stays under a second. */
const MOST = 10;

const still = () => document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Affichage Pro: when you go to another space, the new page's cards come in one after the other, from a blur (the
 * mock-up « Kompaly Verre »). Only what is on screen, only for a moment after the change (a page that loads its code
 * first is caught when it appears), and nothing when less motion is asked (the system's setting or Profil's).
 * What already moves (a page's own entrance) is left alone.
 */
export function useProEntrance(on: boolean, pathname: string) {
  const space = pathname.split('/')[1] ?? '';
  useEffect(() => {
    const main = document.getElementById('contenu');
    if (!on || !main || still()) return;
    const seen = new WeakSet<Element>();
    const moving = new Set<HTMLElement>();
    let n = 0;
    let frame = 0;
    const done = (el: HTMLElement) => {
      el.classList.remove('pro-in');
      el.style.removeProperty('--pro-i');
      moving.delete(el);
    };
    const run = () => {
      frame = 0;
      const H = window.innerHeight;
      const found = [...main.querySelectorAll<HTMLElement>(PARTS)]
        .filter(el => {
          if (seen.has(el)) return false;
          seen.add(el);
          if (el.parentElement?.closest('.card') || el.closest('[role="dialog"], [aria-modal], #create-button')) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < H && !el.getAnimations().length;
        })
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
      for (const { el } of found) {
        // The last ones on screen together (none pops in before those above it).
        el.style.setProperty('--pro-i', String(Math.min(n++, MOST)));
        el.classList.add('pro-in');
        moving.add(el);
        el.addEventListener('animationend', e => e.target === el && done(el));
        el.addEventListener('animationcancel', e => e.target === el && done(el));
      }
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const watch = new MutationObserver(later);
    watch.observe(main, { childList: true, subtree: true });
    later();
    // After this, what appears (a list loaded, a menu opened) simply shows.
    const stop = setTimeout(() => watch.disconnect(), 900);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(stop);
      watch.disconnect();
      moving.forEach(done);
    };
  }, [on, space]);
}
