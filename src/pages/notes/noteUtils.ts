import type { DriveItem } from '../../store/drive';
import type { CalendarEvent } from '../../store/calendar';

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
