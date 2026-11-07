import { scrollMotion } from './a11y';

const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]), textarea, [contenteditable="true"]';
/** Room kept between the caret and the edge of what is visible (above the keyboard). */
const MARGIN = 12;

type Box = { top: number; bottom: number };

/**
 * How far to scroll so that `caret` is visible in `view` (0: it already is). The smallest move: the caret goes just
 * above the keyboard (or just below the top), never to the middle of the screen, never elsewhere in the text.
 */
export function caretShift(caret: Box, view: Box, margin = MARGIN): number {
  const top = view.top + margin;
  const bottom = view.bottom - margin;
  if (bottom <= top) return 0; // nothing visible to aim at (a keyboard bigger than the screen)
  if (caret.top >= top && caret.bottom <= bottom) return 0;
  // A box taller than what is visible: its top (where one types first) at the top.
  if (caret.bottom - caret.top > bottom - top || caret.top < top) return caret.top - top;
  return caret.bottom - bottom;
}

/**
 * The caret's box in a field: the line where one types, not the whole field. A long note is far taller than what the
 * keyboard leaves: bringing all of it « into view » scrolled the note to its middle, away from where one had tapped.
 */
function caretBox(el: HTMLElement): Box | null {
  if (el.isContentEditable) {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !el.contains(sel.focusNode)) return null;
    const range = document.createRange();
    range.setStart(sel.focusNode!, sel.focusOffset);
    range.collapse(true);
    const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
    if (r && r.height > 0) return { top: r.top, bottom: r.bottom };
    // An empty line: the box of its paragraph.
    const node = sel.focusNode;
    const block = (node instanceof HTMLElement ? node : node?.parentElement)?.getBoundingClientRect();
    return block && block.height > 0 ? { top: block.top, bottom: Math.min(block.bottom, block.top + 40) } : null;
  }
  const r = el.getBoundingClientRect();
  // A tall text box: the browser keeps its own caret in view; the top line only when the box itself is out of sight.
  return { top: r.top, bottom: Math.min(r.bottom, r.top + 48) };
}

/**
 * The nearest box that scrolls up and down around `el` (the page's own scroll area, a dialog's body); `false` inside
 * something fixed to the screen that doesn't scroll (Kompaly's chat places itself above the keyboard); null: the page.
 */
function scroller(el: HTMLElement): HTMLElement | null | false {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    const y = style.overflowY;
    if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    if (style.position === 'fixed') return false;
  }
  return null;
}

/**
 * Phones: the keyboard that opens can cover the field just focused (iOS only scrolls to it once you type).
 * Once the keyboard has taken its room, the caret is brought just into view, with the smallest move: the text one
 * tapped stays where it was when it is still visible.
 */
export function watchKeyboard() {
  const vv = window.visualViewport;
  if (!vv || !matchMedia('(pointer: coarse)').matches) return;
  const show = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !el.matches(FIELD)) return;
    const caret = caretBox(el);
    if (!caret) return;
    const box = scroller(el);
    // What is visible: above the keyboard, and inside the box that scrolls (a card ending above the tab bar).
    const edge = box ? box.getBoundingClientRect() : null;
    const shift = caretShift(caret, {
      top: Math.max(vv.offsetTop, edge?.top ?? -Infinity),
      bottom: Math.min(vv.offsetTop + vv.height, edge?.bottom ?? Infinity),
    });
    if (!shift) return;
    if (box) box.scrollBy({ top: shift, behavior: scrollMotion() });
    else if (box === null) window.scrollBy({ top: shift, behavior: scrollMotion() });
  };
  let timer = 0;
  const later = (ms: number) => () => {
    clearTimeout(timer);
    timer = window.setTimeout(show, ms);
  };
  // Only when the keyboard opens (the visible height shrinks): a pinch zoom, the keyboard closing move nothing.
  let height = vv.height;
  vv.addEventListener('resize', () => {
    const shrank = vv.height < height - 40;
    height = vv.height;
    if (shrank) later(100)();
  });
  document.addEventListener('focusin', later(350));
}

/**
 * A screen keyboard opens when a field gets the focus (a phone, a tablet without its keyboard): a field is focused at
 * once only when typing is the one thing to do there, never on opening a window where one may only change a day, a
 * reminder… (the keyboard covered half the screen at once and moved the page).
 */
export const softKeyboard = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
