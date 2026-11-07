import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * « Retour » (the browser's, the phone's, the legal pages'): the page comes back where it was read, not at its top.
 * Each page scrolls in its own box under <main id="contenu">; their positions are kept for each entry of the history
 * and put back when one returns to it, until the reader touches the page.
 */

/** A scroll box: where it is under <main> (the index of each child on the way down), and how far it was scrolled. */
export type Spot = { path: number[]; top: number };

const KEY = 'kompaly-scroll';
const saved = new Map<string, Spot[]>(load());

function load(): [string, Spot[]][] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as [string, Spot[]][];
  } catch {
    return [];
  }
}

let writing = 0;
function persist() {
  if (writing) return;
  writing = window.setTimeout(() => {
    writing = 0;
    try {
      // The last 50 pages of the history are enough.
      sessionStorage.setItem(KEY, JSON.stringify([...saved].slice(-50)));
    } catch {
      /* private mode: kept for this visit only */
    }
  }, 300);
}

function pathOf(el: Element, root: Element): number[] | null {
  const path: number[] = [];
  for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
    if (!e.parentElement) return null;
    path.unshift([...e.parentElement.children].indexOf(e));
  }
  return path;
}

function at(root: Element, path: number[]): HTMLElement | null {
  let e: Element | undefined = root;
  for (const i of path) e = e?.children[i];
  return e instanceof HTMLElement ? e : null;
}

/** Records `spot` among the others of the same entry (one per scroll box). */
export function remember(list: Spot[], spot: Spot): Spot[] {
  const same = (s: Spot) => s.path.length === spot.path.length && s.path.every((v, i) => v === spot.path[i]);
  const rest = list.filter(s => !same(s));
  return spot.top > 0 ? [...rest, spot] : rest;
}

export function useScrollMemory() {
  const { key } = useLocation();
  const type = useNavigationType();
  const current = useRef(key);
  useLayoutEffect(() => {
    current.current = key;
  }, [key]);

  // Kept as the reader scrolls.
  useEffect(() => {
    const main = document.getElementById('contenu');
    if (!main) return;
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !main.contains(el) || el === main) return;
      const path = pathOf(el, main);
      if (!path) return;
      saved.set(current.current, remember(saved.get(current.current) ?? [], { path, top: Math.round(el.scrollTop) }));
      persist();
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  // Put back on « Retour » (POP), as soon as the page is long enough again (its data, its lazy code), for 1.5 s at most.
  useLayoutEffect(() => {
    const spots = type === 'POP' ? saved.get(key) : undefined;
    const main = document.getElementById('contenu');
    if (!spots?.length || !main) return;
    let left = [...spots];
    let frame = 0;
    const until = performance.now() + 1500;
    const stop = () => {
      cancelAnimationFrame(frame);
      left = [];
      ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(t => window.removeEventListener(t, stop, true));
    };
    const tryNow = () => {
      left = left.filter(s => {
        const el = at(main, s.path);
        if (!el || el.scrollHeight - el.clientHeight < s.top) return true;
        el.scrollTop = s.top;
        return false;
      });
      if (left.length && performance.now() < until) frame = requestAnimationFrame(tryNow);
      else stop();
    };
    ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, stop, true));
    tryNow();
    return stop;
  }, [key, type]);
}
