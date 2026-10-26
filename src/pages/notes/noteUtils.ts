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
