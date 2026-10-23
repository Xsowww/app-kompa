// Small keyboard / screen-reader helpers shared by dialogs, menus and lists.

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Visible, keyboard-reachable elements inside `root`, in tab order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  // visibility:hidden keeps a layout box (offsetParent) but can't take the focus: trapping Tab on it froze the dialog.
  // A disabled button with a tabindex (Kompaly's « Envoyer ») matches [tabindex] but can't take it either.
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => (el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden' && !el.matches(':disabled')) || el === document.activeElement);
}

// Recently focused elements (not menu items): where the focus goes back when a modal or a menu closes
// (a dialog's own field may already have taken the focus by the time the dialog's effect runs).
const recentFocus: HTMLElement[] = [];
if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    e => {
      const t = e.target as HTMLElement;
      if (t.closest?.('[role="menu"]')) return;
      recentFocus.push(t);
      if (recentFocus.length > 30) recentFocus.shift();
    },
    true,
  );
}
/**
 * The element focused before `overlay` opened: the last one outside it (it may be in another dialog
 * still open below, like « Mes catégories » under a confirmation). Without `overlay`: the last one outside every dialog.
 */
export const focusBeforeOverlay = (overlay?: HTMLElement) => {
  for (let i = recentFocus.length - 1; i >= 0; i--) {
    const el = recentFocus[i];
    if (el.isConnected && !(overlay ? overlay.contains(el) : el.closest('[aria-modal="true"]'))) return el;
  }
  return null;
};

/** Keep Tab / Shift+Tab inside `root` (modal dialogs). */
export function trapTab(e: KeyboardEvent, root: HTMLElement) {
  if (e.key !== 'Tab') return;
  const els = focusables(root);
  if (els.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = els[0];
  const last = els[els.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

/** Shift+F10 or the dedicated « menu » key: open the context menu from the keyboard. */
export const isMenuKey = (e: React.KeyboardEvent | KeyboardEvent) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');

/**
 * Where to open a context menu. A real right-click gives the pointer position; a menu opened
 * from the keyboard (contextmenu event or key press) is placed under the focused element.
 */
export function menuPoint(e: React.MouseEvent | React.KeyboardEvent): { x: number; y: number } {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  if ('clientX' in e) {
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (inside && (e.clientX !== 0 || e.clientY !== 0)) return { x: e.clientX, y: e.clientY };
  }
  return { x: Math.round(r.left + Math.min(24, r.width / 2)), y: Math.round(r.bottom - 4) };
}

/** Move focus with the arrow keys between the items matched by `selector` inside `root`. */
export function arrowNav(e: React.KeyboardEvent | KeyboardEvent, root: HTMLElement, selector: string, orientation: 'vertical' | 'horizontal' = 'vertical') {
  const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
  const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
  if (![next, prev, 'Home', 'End'].includes(e.key)) return false;
  const items = [...root.querySelectorAll<HTMLElement>(selector)].filter(el => !(el as HTMLButtonElement).disabled);
  if (!items.length) return false;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const to =
    e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === next ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
  items[to].focus();
  return true;
}

/** Before a row with buttons goes (cancelled): the focus moves to the next row's, else the previous one's, else `fallback`. */
export function keepFocus(row: HTMLElement | null, fallback?: HTMLElement | null) {
  if (!row?.contains(document.activeElement)) return;
  const next = (row.nextElementSibling ?? row.previousElementSibling) as HTMLElement | null;
  const index = [...row.querySelectorAll('button')].indexOf(document.activeElement as HTMLButtonElement);
  const target = next?.querySelectorAll<HTMLElement>('button')[Math.max(0, index)] ?? fallback;
  // After React removed the row.
  requestAnimationFrame(() => target?.focus());
}
