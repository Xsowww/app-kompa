import { useEffect, useRef } from 'react';

/**
 * A finger on the Fichiers' items (DrivePage):
 *  - held still for LONG_PRESS ms: `onLongPress` (selection mode), the phone's own bubble and menu kept away;
 *  - held, then moved: dragged, with a chip under the finger, the folder under it lit (`onOver`), the list scrolling by
 *    itself near its top and bottom edges, and `onDrop` on a folder or a breadcrumb step;
 *  - moved before that: the page scrolls, nothing else happens;
 *  - a short tap: the click that follows does the rest (DrivePage).
 * Drop targets carry `data-drop-key` (what `onOver` gets) and `data-drop-target` (a folder's id, '' for the root).
 */
export const LONG_PRESS = 500;
/** How far a finger may wander and still be « still » (a press, a tap). */
export const SLOP = 10;
/** Height of the band, at the top and the bottom of the list, where a dragged item scrolls it. */
const EDGE = 56;

export type TouchDragOptions = {
  onLongPress: (id: string) => void;
  /** The items that go with this one (the selection when it is in it). */
  dragIds: (id: string) => string[];
  /** The chip shown under the finger. */
  ghost: (id: string, ids: string[]) => HTMLElement;
  onDragStart: (ids: string[]) => void;
  onOver: (key: string | null) => void;
  /** `target`: the folder dropped on, null for the root. */
  onDrop: (ids: string[], target: string | null) => void;
  onDragEnd: () => void;
};

type Press = {
  id: string;
  pointerId: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  phase: 'pending' | 'armed' | 'drag';
  timer: ReturnType<typeof setTimeout>;
  ids: string[];
  ghost: HTMLElement | null;
  over: { key: string; target: string | null } | null;
  frame: number;
  off: () => void;
};

/** The drop target under a point: the folder (or breadcrumb step) there, unless it is one of the items dragged. */
export function dropTargetAt(x: number, y: number, ids: string[]): { key: string; target: string | null } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-key]');
  if (!el) return null;
  const target = el.dataset.dropTarget || null;
  if (target && ids.includes(target)) return null;
  return { key: el.dataset.dropKey!, target };
}

/** How much a list scrolls in one frame for a finger at `y` (negative: up). */
export function edgeSpeed(y: number, top: number, bottom: number): number {
  if (y < top || y > bottom) return 0;
  if (y < top + EDGE) return -Math.ceil(((top + EDGE - y) / EDGE) * 14);
  if (y > bottom - EDGE) return Math.ceil(((y - (bottom - EDGE)) / EDGE) * 14);
  return 0;
}

/**
 * Stops the click a long press or a drag ends with (if the browser sends one), wherever it lands. `lifted`: the finger
 * is already up (called from its pointerup), so the click comes now or never.
 */
export function swallowNextClick(lifted = false) {
  const stop = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  // None comes (iPhone, or a finger that moved): gone before the next tap, which must not be lost.
  const off = () => setTimeout(() => window.removeEventListener('click', stop, true), 300);
  if (lifted) return off();
  window.addEventListener('pointerup', off, { once: true });
  setTimeout(() => window.removeEventListener('click', stop, true), 1500);
}

/** `scroller`: the list that scrolls, around the items. */
export function useTouchDrag(scroller: React.RefObject<HTMLElement | null>, options: TouchDragOptions) {
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  const press = useRef<Press | null>(null);

  // Once the press is held, the finger moves the item, not the list. Listened to all along, on the list itself: a
  // browser only lets a touch's moves be stopped when someone listened for them from its start.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const noScroll = (ev: TouchEvent) => {
      if (press.current && press.current.phase !== 'pending' && ev.cancelable) ev.preventDefault();
    };
    el.addEventListener('touchmove', noScroll, { passive: false });
    return () => el.removeEventListener('touchmove', noScroll);
  }, [scroller]);

  const end = () => {
    const p = press.current;
    if (!p) return;
    press.current = null;
    clearTimeout(p.timer);
    cancelAnimationFrame(p.frame);
    p.ghost?.remove();
    p.off();
  };
  useEffect(() => end, []);

  const place = (p: Press) => {
    if (p.ghost) p.ghost.style.transform = `translate(${Math.round(p.x - 14)}px, ${Math.round(p.y - 52)}px)`;
    const over = dropTargetAt(p.x, p.y, p.ids);
    if (over?.key !== p.over?.key) opts.current.onOver(over?.key ?? null);
    p.over = over;
  };

  // Near the top or the bottom of the list: it scrolls, a little faster the closer the finger is to the edge.
  const scroll = (p: Press) => {
    const el = scroller.current;
    if (el && press.current === p && p.phase === 'drag') {
      const r = el.getBoundingClientRect();
      const v = edgeSpeed(p.y, r.top, r.bottom);
      if (v) {
        const before = el.scrollTop;
        el.scrollBy(0, v);
        if (el.scrollTop !== before) place(p);
      }
    }
    p.frame = requestAnimationFrame(() => scroll(p));
  };

  const startDrag = (p: Press) => {
    p.phase = 'drag';
    p.ids = opts.current.dragIds(p.id);
    const g = opts.current.ghost(p.id, p.ids);
    Object.assign(g.style, { left: '0', top: '0' });
    g.classList.add('drive-ghost-touch');
    document.body.appendChild(g);
    p.ghost = g;
    opts.current.onDragStart(p.ids);
    place(p);
    p.frame = requestAnimationFrame(() => scroll(p));
  };

  /** To call from the item's pointerdown. Only a finger (the mouse has the browser's own drag and drop). */
  const start = (e: React.PointerEvent, id: string) => {
    end();
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    const onMove = (ev: PointerEvent) => {
      const p = press.current;
      if (!p || ev.pointerId !== p.pointerId) return;
      p.x = ev.clientX;
      p.y = ev.clientY;
      const far = Math.hypot(p.x - p.x0, p.y - p.y0) > SLOP;
      if (p.phase === 'pending' && far) end(); // a scroll
      else if (p.phase === 'armed' && far) startDrag(p);
      else if (p.phase === 'drag') place(p);
    };
    const onUp = (ev: PointerEvent) => {
      const p = press.current;
      if (!p || ev.pointerId !== p.pointerId) return;
      if (p.phase === 'drag') {
        swallowNextClick(true);
        const over = dropTargetAt(ev.clientX, ev.clientY, p.ids) ?? p.over;
        const { ids } = p;
        opts.current.onOver(null);
        end();
        if (over) opts.current.onDrop(ids, over.target);
        opts.current.onDragEnd();
      } else end();
    };
    const onCancel = (ev: PointerEvent) => {
      const p = press.current;
      if (!p || ev.pointerId !== p.pointerId) return;
      const dragged = p.phase === 'drag';
      end();
      if (dragged) {
        opts.current.onOver(null);
        opts.current.onDragEnd();
      }
    };
    // A finger's long press is no right click: neither the phone's menu nor the item's (that one is under « ⋯ »).
    const noMenu = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('contextmenu', noMenu, true);
    const p: Press = {
      id,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      phase: 'pending',
      ids: [],
      ghost: null,
      over: null,
      frame: 0,
      timer: setTimeout(() => {
        if (press.current !== p || p.phase !== 'pending') return;
        p.phase = 'armed';
        navigator.vibrate?.(12);
        swallowNextClick();
        opts.current.onLongPress(id);
      }, LONG_PRESS),
      off: () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        // The menu the phone may still send right after the finger is lifted.
        setTimeout(() => window.removeEventListener('contextmenu', noMenu, true), 400);
      },
    };
    press.current = p;
  };

  return start;
}
