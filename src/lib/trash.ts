// One trash for the whole app: Notes, Drive and Calendar each keep their deleted things in their
// own store; this module lists them together and restores / purges them by id.

import { useMemo } from 'react';
import { parseISO } from 'date-fns';
import { fmt } from './dates';
import { useDrive, pathOf, trashRoots, withDescendants, TRASH_DAYS, type DriveItem } from '../store/drive';
import { useNotes, notesTrashRoots, folderDescendants, type Note, type NoteFolder } from '../store/notes';
import { useCalendar, type CalendarEvent } from '../store/calendar';
import { toast } from '../store/ui';
import { locale, t } from '../i18n';

export type TrashType = 'notes' | 'drive' | 'calendar';

export type TrashEntry = { id: string; type: TrashType; name: string; deletedAt: string; place: string; placeGone: boolean } & (
  | { kind: 'note'; note: Note }
  | { kind: 'noteFolder'; folder: NoteFolder }
  | { kind: 'drive'; item: DriveItem }
  | { kind: 'event'; event: CalendarEvent }
);

export const TRASH_TYPES: { key: TrashType; label: string }[] = [
  { key: 'notes', label: t('Notes') },
  { key: 'drive', label: t('Drive') },
  { key: 'calendar', label: t('Calendrier') },
];

interface Sources {
  driveItems: DriveItem[];
  driveTrash: DriveItem[];
  noteFolders: NoteFolder[];
  trashFolders: NoteFolder[];
  trashNotes: Note[];
  eventTrash: CalendarEvent[];
}

const current = (): Sources => {
  const d = useDrive.getState();
  const n = useNotes.getState();
  return { driveItems: d.items, driveTrash: d.trash, noteFolders: n.folders, trashFolders: n.trashFolders, trashNotes: n.trashNotes, eventTrash: useCalendar.getState().trash };
};

export const eventDay = (date: string) => fmt(parseISO(date), 'EEE d MMM').replace(/^./, c => c.toUpperCase());

function notesPlace(folders: NoteFolder[], parentId: string | null) {
  if (!parentId) return { place: t('Notes'), placeGone: false };
  const names: string[] = [];
  for (let f = folders.find(x => x.id === parentId); f; f = folders.find(x => x.id === f!.parentId)) names.unshift(f.name);
  return names.length ? { place: [t('Notes'), ...names].join(' › '), placeGone: false } : { place: t('Notes · dossier supprimé'), placeGone: true };
}

function drivePlace(items: DriveItem[], parentId: string | null) {
  if (!parentId) return { place: t('Drive'), placeGone: false };
  const path = pathOf(items, parentId);
  return path.length ? { place: [t('Drive'), ...path.map(p => p.name)].join(' › '), placeGone: false } : { place: t('Drive · dossier supprimé'), placeGone: true };
}

/** Top-level deleted things of every space, newest first. */
export function collectTrash(s: Sources = current()): TrashEntry[] {
  const roots = notesTrashRoots(s.trashFolders, s.trashNotes);
  const out: TrashEntry[] = [
    ...roots.notes.map(n => ({ id: n.id, type: 'notes' as const, kind: 'note' as const, note: n, name: n.title, deletedAt: n.deletedAt ?? '', ...notesPlace(s.noteFolders, n.folderId) })),
    ...roots.folders.map(f => ({ id: f.id, type: 'notes' as const, kind: 'noteFolder' as const, folder: f, name: f.name, deletedAt: f.deletedAt ?? '', ...notesPlace(s.noteFolders, f.parentId) })),
    ...trashRoots(s.driveTrash).map(i => ({ id: i.id, type: 'drive' as const, kind: 'drive' as const, item: i, name: i.name, deletedAt: i.deletedAt ?? '', ...drivePlace(s.driveItems, i.parentId) })),
    ...s.eventTrash.map(e => ({
      id: e.id,
      type: 'calendar' as const,
      kind: 'event' as const,
      event: e,
      name: e.title,
      deletedAt: e.deletedAt ?? '',
      place: t('Calendrier · {day}', { day: eventDay(e.date) }) + (e.start ? ` · ${e.start}` : ''),
      placeGone: false,
    })),
  ];
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.name.localeCompare(b.name, locale()));
}

/** The trash, kept up to date. */
export function useTrash(): TrashEntry[] {
  const driveItems = useDrive(s => s.items);
  const driveTrash = useDrive(s => s.trash);
  const noteFolders = useNotes(s => s.folders);
  const trashFolders = useNotes(s => s.trashFolders);
  const trashNotes = useNotes(s => s.trashNotes);
  const eventTrash = useCalendar(s => s.trash);
  return useMemo(
    () => collectTrash({ driveItems, driveTrash, noteFolders, trashFolders, trashNotes, eventTrash }),
    [driveItems, driveTrash, noteFolders, trashFolders, trashNotes, eventTrash],
  );
}

/** Number of top-level entries (for the navigation badge). */
export function useTrashCount(): number {
  const driveTrash = useDrive(s => s.trash);
  const trashFolders = useNotes(s => s.trashFolders);
  const trashNotes = useNotes(s => s.trashNotes);
  const events = useCalendar(s => s.trash.length);
  return useMemo(() => {
    const r = notesTrashRoots(trashFolders, trashNotes);
    return trashRoots(driveTrash).length + r.folders.length + r.notes.length + events;
  }, [driveTrash, trashFolders, trashNotes, events]);
}

/** Days left before an entry is deleted for good. */
export function daysLeft(deletedAt: string) {
  if (!deletedAt) return TRASH_DAYS;
  return Math.max(0, Math.ceil((new Date(deletedAt).getTime() + TRASH_DAYS * 864e5 - Date.now()) / 864e5));
}

/** What was deleted together with a folder (for the preview). */
export function folderContent(entry: TrashEntry): { id: string; name: string; depth: number; folder: boolean; item?: DriveItem }[] {
  if (entry.kind === 'drive' && entry.item.kind === 'folder') {
    const trash = useDrive.getState().trash;
    const ids = new Set(withDescendants(trash, [entry.id]).filter(id => trash.find(t => t.id === id)?.deletedAt === entry.deletedAt));
    const out: ReturnType<typeof folderContent> = [];
    const walk = (parent: string, depth: number) => {
      const kids = trash
        .filter(t => t.parentId === parent && ids.has(t.id))
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, locale()) : a.kind === 'folder' ? -1 : 1));
      for (const k of kids) {
        out.push({ id: k.id, name: k.name, depth, folder: k.kind === 'folder', item: k });
        if (k.kind === 'folder') walk(k.id, depth + 1);
      }
    };
    walk(entry.id, 0);
    return out;
  }
  if (entry.kind === 'noteFolder') {
    const { trashFolders, trashNotes } = useNotes.getState();
    const same = <T extends { deletedAt?: string }>(x: T) => x.deletedAt === entry.deletedAt;
    const folders = new Set(folderDescendants(trashFolders, entry.id).filter(id => trashFolders.some(f => f.id === id && same(f))));
    const out: ReturnType<typeof folderContent> = [];
    const walk = (parent: string, depth: number) => {
      for (const f of trashFolders.filter(x => x.parentId === parent && folders.has(x.id)).sort((a, b) => a.name.localeCompare(b.name, locale()))) {
        out.push({ id: f.id, name: f.name, depth, folder: true });
        walk(f.id, depth + 1);
      }
      for (const n of trashNotes.filter(x => x.folderId === parent && same(x)).sort((a, b) => a.title.localeCompare(b.title, locale()))) {
        out.push({ id: n.id, name: n.title, depth, folder: false });
      }
    };
    walk(entry.id, 0);
    return out;
  }
  return [];
}

export interface RestoreResult {
  /** Names of what came back. */
  names: string[];
  /** Something went back to the root because its folder no longer exists. */
  orphan: boolean;
  /** Where the (first) restored thing now lives. */
  href: string | null;
}

/** Puts entries (by id) back where they were. */
export function restoreTrash(ids: string[]): RestoreResult {
  const entries = collectTrash().filter(e => ids.includes(e.id));
  if (!entries.length) return { names: [], orphan: false, href: null };
  const orphan = entries.some(e => e.placeGone);
  const by = (t: TrashType) => entries.filter(e => e.type === t).map(e => e.id);
  if (by('drive').length) useDrive.getState().restore(by('drive'));
  if (by('notes').length) useNotes.getState().restore(by('notes'));
  if (by('calendar').length) useCalendar.getState().restore(by('calendar'));
  // Names read again after the restore: one that came back next to a new one of the same name is renamed (« Biologie (2) »).
  return { names: entries.map(e => nameNow(e) ?? e.name), orphan, href: hrefOf(entries[0]) };
}

function nameNow(e: TrashEntry): string | undefined {
  if (e.kind === 'drive') return useDrive.getState().items.find(i => i.id === e.id)?.name;
  if (e.kind === 'note') return useNotes.getState().notes.find(n => n.id === e.id)?.title;
  if (e.kind === 'noteFolder') return useNotes.getState().folders.find(f => f.id === e.id)?.name;
  return undefined;
}

/** Link to a restored entry. */
function hrefOf(e: TrashEntry): string | null {
  if (e.kind === 'note') return `/notes?note=${e.id}`;
  if (e.kind === 'noteFolder') return `/notes?dossier=${e.id}`;
  if (e.kind === 'event') return `/calendrier?jour=${e.event.date}`;
  const item = useDrive.getState().items.find(i => i.id === e.id);
  if (!item) return null;
  if (item.kind === 'folder') return `/drive?dossier=${item.id}`;
  return item.parentId ? `/drive?dossier=${item.parentId}&fichier=${item.id}` : `/drive?fichier=${item.id}`;
}

/** Deletes entries (by id) for good, with what was deleted together with them. */
export function purgeTrash(ids: string[]) {
  const entries = collectTrash().filter(e => ids.includes(e.id));
  const by = (t: TrashType) => entries.filter(e => e.type === t).map(e => e.id);
  if (by('drive').length) useDrive.getState().purge(by('drive'));
  if (by('notes').length) useNotes.getState().purge(by('notes'));
  if (by('calendar').length) useCalendar.getState().purge(by('calendar'));
}

export function emptyAllTrash() {
  useDrive.getState().emptyTrash();
  useNotes.getState().emptyTrash();
  useCalendar.getState().emptyTrash();
}

/** True when this id is a note in the trash (deep links to it go to the trash). */
export const isTrashedNote = (id: string) => useNotes.getState().trashNotes.some(n => n.id === id);
/** Same for a Drive file or folder. */
export const isTrashedDriveItem = (id: string) => useDrive.getState().trash.some(i => i.id === id);

/** Deletes calendar events (to the trash), with « Annuler » in the toast. */
export function trashEvents(ids: string[]) {
  useCalendar.getState().removeMany(ids);
  toast(ids.length > 1 ? t('{n} événements mis à la corbeille', { n: ids.length }) : t('Mis à la corbeille'), 'info', { label: t('Annuler||l’action'), run: () => useCalendar.getState().restore(ids) });
}
export const trashEvent = (id: string) => trashEvents([id]);
