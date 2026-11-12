import { useEffect, useState, type RefObject } from 'react';
import { useCopilot } from '../../store/copilot';

/**
 * How much of `width` (the block's right part, from `right`) Kompaly's panel covers when it is at `panelLeft`, with a
 * small gap: the room to leave it. 0 when the panel doesn't reach the block, or when too little would be left for
 * seven days (then the panel stays over the page, as before).
 */
export function panelInset(right: number, width: number, panelLeft: number, gap = 12, least = 520): number {
  const inset = Math.ceil(right - panelLeft + gap);
  return inset <= gap || width - inset < least ? 0 : inset;
}

/**
 * The room to leave at the right of a block for Kompaly's panel, open beside the page on a computer: the week's
 * seven days then share what is left (the panel hid Saturday and Sunday). 0 when it is closed, when `active` is
 * false, and on phones (there the panel covers the page, as a dialog).
 */
export function usePanelInset(ref: RefObject<HTMLElement | null>, active: boolean): number {
  const open = useCopilot(s => s.pose === 'open');
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const el = ref.current;
    const panel = document.getElementById('copilot-panel');
    if (!open || !active || !el || !panel || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      if (window.innerWidth < 1024) return setInset(0);
      // Its place once open (not its box while it grows into place): from its width and its distance to the edge.
      const panelLeft = window.innerWidth - (parseFloat(getComputedStyle(panel).right) || 0) - panel.offsetWidth;
      const box = el.getBoundingClientRect();
      setInset(panelInset(box.right, box.width, panelLeft));
    };
    // Called once on observe, then when the panel is made wider or the window changes.
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [open, active, ref]);
  return open && active ? inset : 0;
}
