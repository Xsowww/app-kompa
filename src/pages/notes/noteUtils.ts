import type { DriveItem } from '../../store/drive';
import type { CalendarEvent } from '../../store/calendar';
import type { Note } from '../../store/notes';
import { t } from '../../i18n';

/**
 * Nothing in it: « Sans titre », no text, picture, list or other block, not pinned, no link.
 * Such a note, left behind (opened by mistake, « Nouvelle note » clicked twice), is deleted for good.
 */
export const isBlankNote = (n: Note) =>
  (!n.title.trim() || n.title === 'Sans titre' || n.title === t('Sans titre')) &&
  !n.pinned &&
  !n.links?.length &&
  !n.content.replace(/<\/?(?:p|br)\b[^>]*>|&nbsp;|\s/g, '');

// ── Paste ──────────────────────────────────────────────────────────
/**
 * A table pasted from a web page, Word or Excel: one line per row, its cells separated by « · »
 * (the editor has no tables: they came out as « NomNoteAlice15Bob12 » on one line).
 */
export function tablesToLines(html: string) {
  if (!/<table/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const table of [...doc.querySelectorAll('table')]) {
    const lines = [...table.querySelectorAll('tr')].flatMap(tr => {
      const cells = [...tr.children].filter(c => /^T[DH]$/.test(c.tagName)).map(c => (c.textContent ?? '').replace(/\s+/g, ' ').trim());
      if (!cells.some(Boolean)) return [];
      // An empty cell keeps its place (« Bob · – · Absent »): the columns stay readable.
      const p = doc.createElement('p');
      p.textContent = cells.map(c => c || '–').join(' · ');
      return [p];
    });
    table.replaceWith(...lines);
  }
  return doc.body.innerHTML;
}

/**
 * Pictures of a pasted page that could never show in the note: a file of the computer it was copied on (Word:
 * « file:///…/clip_image001.png »), a page-relative address, « cid: », a dead « blob: », plain http (blocked on our
 * https pages). They stayed as broken-image icons; only web (https) and inline (data:) pictures are kept.
 */
export function dropDeadImages(html: string) {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const url = (src?.[1] ?? src?.[2] ?? src?.[3] ?? '').trim();
    return /^(https:\/\/|data:image\/)/i.test(url) ? tag : '';
  });
}

/** What the editor does to a pasted page before reading it. */
export const cleanPastedHtml = (html: string) => dropDeadImages(tablesToLines(html));

/**
 * Does the pasted page hold text? Excel (and Word, for a table or a chart) puts a picture of what was copied beside
 * its text: the text is what is pasted then, not the picture (a picture copied alone has no text beside it).
 */
export function pastedHtmlHasText(html: string | undefined | null) {
  if (!html) return false;
  return !!html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head|title|xml)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|\s/gi, '');
}

// ── Open editor bridge ─────────────────────────────────────────────
let flushOpen: (() => void) | null = null;
/** Called by NoteEditor with its flush function, and with (null, itself) when it unmounts. */
export const registerEditorFlush = (fn: (() => void) | null, prev?: () => void) => {
  if (fn || flushOpen === prev) flushOpen = fn;
};
/** Saves the open editor's pending changes right away (e.g. before an export). */
export const flushNoteEditor = () => flushOpen?.();

// ── Links ──────────────────────────────────────────────────────────
export const fileHref = (f: DriveItem) => (f.parentId ? `/drive?dossier=${f.parentId}&fichier=${f.id}` : `/drive?fichier=${f.id}`);
export const eventHref = (e: CalendarEvent) => `/calendrier?jour=${e.date}`;

/** « kompaly.com » → « https://kompaly.com » (otherwise the link would point inside the app). */
export function withProtocol(url: string) {
  const u = url.trim();
  // Only web, mail and phone links: « javascript:// », « data:// »… become plain web addresses.
  if (/^(https?:\/\/|mailto:|tel:)/i.test(u) || /^[/#?]/.test(u)) return u;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(u)) return `mailto:${u}`;
  return `https://${u}`;
}

// ── Count and order ────────────────────────────────────────────────
/** Words of a text, as a word processor counts them (« l’arbre », « porte-clés » and « 3,5 » are one each). */
export const countWords = (text: string) => text.match(/[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu)?.length ?? 0;

export type NoteSort = 'modified' | 'created' | 'title';

/** Pinned notes first, then in the order chosen (latest change, latest made, or A → Z). */
export function sortNotes<N extends Pick<Note, 'title' | 'pinned' | 'createdAt' | 'updatedAt'>>(list: N[], by: NoteSort, lang?: string): N[] {
  return [...list].sort(
    (a, b) =>
      Number(!!b.pinned) - Number(!!a.pinned) ||
      (by === 'title' ? a.title.localeCompare(b.title, lang, { numeric: true, sensitivity: 'base' }) : by === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)),
  );
}
