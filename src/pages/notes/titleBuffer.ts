// « + Note » from another page: the Notes page takes 0.5 s to show up, and the keys typed meanwhile
// must not be lost. A hidden field outside React takes the focus within the click (which also opens
// the keyboard on phones), keeps what is typed, and hands it over to the new note's title.
// Enter or Tab ends the title, as in the real title field: what comes after goes to the content.

import { t } from '../../i18n';

const ID = 'note-title-buffer';

const buffer = () => document.getElementById(ID) as HTMLTextAreaElement | null;

export function startTitleBuffer() {
  buffer()?.remove();
  const el = document.createElement('textarea');
  el.id = ID;
  el.setAttribute('aria-label', t('Titre de la note'));
  el.setAttribute('autocomplete', 'off');
  // 16 px: no zoom on iPhone when it takes the focus.
  el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;resize:none;pointer-events:none';
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    // The first Enter / Tab closes the title (kept in data-split); later Enters are line breaks of the content.
    if (el.dataset.split === undefined) {
      e.preventDefault();
      el.dataset.split = String(el.value.length);
    } else if (e.key === 'Tab') e.preventDefault();
  });
  // Left for good (clicked elsewhere): nothing to hand over.
  // (after the blur: removing an element while it is being blurred throws)
  el.onblur = () => setTimeout(() => el.remove(), 0);
  document.body.appendChild(el);
  el.focus({ preventScroll: true });
}

/**
 * The title typed since `startTitleBuffer`, or null if nothing is waiting. `toContent`: Enter or Tab
 * was pressed after it; the field then stays (and keeps the keys) until `takeContentBuffer`.
 */
export function takeTitleBuffer(): { title: string; toContent: boolean } | null {
  const el = buffer();
  if (!el) return null;
  const split = el.dataset.split;
  if (split !== undefined) return { title: el.value.slice(0, Number(split)), toContent: true };
  el.onblur = null;
  el.remove();
  return { title: el.value.replace(/[\r\n]+/g, ' '), toContent: false };
}

/** What was typed after the title's Enter / Tab (lines separated by \n); the hidden field goes away. */
export function takeContentBuffer(): string {
  const el = buffer();
  if (!el) return '';
  el.onblur = null;
  el.remove();
  return el.value.slice(Number(el.dataset.split ?? el.value.length));
}
