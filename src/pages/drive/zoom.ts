import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/**
 * Zoom of a preview (a PDF, a picture) shown in the scrolling `box`: 1 = the width that fits. Ctrl + mouse wheel (and a
 * trackpad's pinch, which sends the same) and a pinch of two fingers zoom where they are; `zoomTo` for the buttons.
 * The point under the pointer stays in place. While the fingers move, `content` is only scaled (drawn again at the end).
 */
export function useZoom(box: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>) {
  const [zoom, setZoom] = useState(1);
  const current = useRef(1);
  // Where to put back the point that was under the pointer, in units of the content at zoom 1.
  const anchor = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  const zoomTo = (next: number, cx?: number, cy?: number) => {
    const el = box.current;
    const z = current.current;
    const n = clamp(next);
    if (!el || n === z) return;
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    anchor.current = { x: (el.scrollLeft + px) / z, y: (el.scrollTop + py) / z, cx: px, cy: py };
    current.current = n;
    setZoom(n);
  };
  // The listeners below, set once, call the latest one.
  const latest = useRef(zoomTo);
  useLayoutEffect(() => {
    latest.current = zoomTo;
  });

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = box.current;
    anchor.current = null;
    if (!a || !el) return;
    el.scrollTo({ left: a.x * zoom - a.cx, top: a.y * zoom - a.cy });
  }, [zoom, box]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const at = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return { cx: x - r.left, cy: y - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); // not the browser's zoom of the whole page
      const { cx, cy } = at(e.clientX, e.clientY);
      latest.current(current.current * Math.exp(-e.deltaY * 0.0025), cx, cy);
    };
    // Two fingers: the box lets the browser scroll with one finger only (touch-action), the pinch is ours.
    let pinch: { d: number; cx: number; cy: number } | null = null;
    let ratio = 1;
    const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinch = { d: spread(e.touches) || 1, ...at((e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2) };
      ratio = 1;
    };
    const onMove = (e: TouchEvent) => {
      const c = content.current;
      if (!pinch || e.touches.length !== 2 || !c) return;
      e.preventDefault();
      ratio = Math.min(ZOOM_MAX / current.current, Math.max(ZOOM_MIN / current.current, spread(e.touches) / pinch.d));
      c.style.transformOrigin = `${el.scrollLeft + pinch.cx}px ${el.scrollTop + pinch.cy}px`;
      c.style.transform = `scale(${ratio})`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!pinch || e.touches.length >= 2) return;
      const p = pinch;
      pinch = null;
      if (content.current) content.current.style.transform = '';
      latest.current(current.current * ratio, p.cx, p.cy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [box, content]);

  return { zoom, zoomTo };
}
