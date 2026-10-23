const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]), textarea, [contenteditable="true"]';

/**
 * Phones: the keyboard that opens can cover the field just focused (iOS only scrolls to it once you type).
 * As soon as the keyboard has taken its room, the field is brought to the middle of what is still visible.
 */
export function watchKeyboard() {
  const vv = window.visualViewport;
  if (!vv || !matchMedia('(pointer: coarse)').matches) return;
  const show = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !el.matches(FIELD)) return;
    const r = el.getBoundingClientRect();
    if (r.top >= vv.offsetTop + 8 && r.bottom <= vv.offsetTop + vv.height - 8) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  let timer = 0;
  const later = (ms: number) => () => {
    clearTimeout(timer);
    timer = window.setTimeout(show, ms);
  };
  vv.addEventListener('resize', later(100));
  document.addEventListener('focusin', later(350));
}
