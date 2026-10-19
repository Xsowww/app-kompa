import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid, nowIso, uniqueName } from '../lib/utils';
import { userStorage } from '../lib/userStorage';
import { TRASH_DAYS } from './drive';
import { t } from '../i18n';

export interface NoteFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  deletedAt?: string;
  /** Key of FOLDER_COLORS (same colours as the Drive); none: grey. */
  color?: string;
}

/** A note can point to Drive files and calendar events (« Partiel de chimie » → its PDFs). */
export interface NoteLink {
  kind: 'file' | 'event';
  id: string;
}

export interface Note {
  id: string;
  title: string;
  content: string; // HTML (Tiptap)
  folderId: string | null;
  pinned?: boolean;
  links?: NoteLink[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

interface NotesState {
  folders: NoteFolder[];
  notes: Note[];
  /** Deleted folders and notes, kept TRASH_DAYS days (separate lists: nothing else has to filter them). */
  trashFolders: NoteFolder[];
  trashNotes: Note[];
  createFolder: (name: string, parentId: string | null) => NoteFolder;
  renameFolder: (id: string, name: string) => void;
  setFolderColor: (id: string, color: string | undefined) => void;
  removeFolder: (id: string) => void;
  moveFolder: (id: string, parentId: string | null) => void;
  createNote: (data?: Partial<Pick<Note, 'title' | 'content' | 'folderId'>>) => Note;
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'content' | 'folderId' | 'pinned' | 'links'>>) => void;
  removeNote: (id: string) => void;
  duplicateNote: (id: string) => Note | null;
  /** Restores trashed notes / folders (with what was deleted together with them). */
  restore: (ids: string[]) => void;
  /** Deletes trashed notes / folders for good. */
  purge: (ids: string[]) => void;
  emptyTrash: () => void;
  purgeExpired: () => void;
}

export function folderDescendants(folders: NoteFolder[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const f of folders) if (f.parentId === out[i]) out.push(f.id);
  }
  return out;
}

/** Trashed folders / notes shown at the top level of the trash (their folder wasn't deleted together with them). */
export function notesTrashRoots(trashFolders: NoteFolder[], trashNotes: Note[]) {
  const deletedAt = new Map(trashFolders.map(f => [f.id, f.deletedAt]));
  const withParent = (parent: string | null, at?: string) => !!parent && deletedAt.has(parent) && deletedAt.get(parent) === at;
  return {
    folders: trashFolders.filter(f => !withParent(f.parentId, f.deletedAt)),
    notes: trashNotes.filter(n => !withParent(n.folderId, n.deletedAt)),
  };
}

export const useNotes = create<NotesState>()(
  persist(
    (set, get) => ({
      folders: [],
      notes: [],
      trashFolders: [],
      trashNotes: [],

      createFolder(name, parentId) {
        const taken = get().folders.filter(f => f.parentId === parentId).map(f => f.name);
        const folder: NoteFolder = { id: uid(), name: uniqueName(name.trim() || t('Nouveau dossier'), taken), parentId, createdAt: nowIso() };
        set(s => ({ folders: [...s.folders, folder] }));
        return folder;
      },

      renameFolder(id, name) {
        if (!name.trim()) return;
        const folder = get().folders.find(f => f.id === id);
        const taken = get().folders.filter(f => f.parentId === folder?.parentId && f.id !== id).map(f => f.name);
        set(s => ({ folders: s.folders.map(f => (f.id === id ? { ...f, name: uniqueName(name.trim(), taken) } : f)) }));
      },

      setFolderColor(id, color) {
        set(s => ({ folders: s.folders.map(f => (f.id === id ? { ...f, color } : f)) }));
      },

      removeFolder(id) {
        const doomed = new Set(folderDescendants(get().folders, id));
        const deletedAt = nowIso();
        set(s => ({
          folders: s.folders.filter(f => !doomed.has(f.id)),
          notes: s.notes.filter(n => !n.folderId || !doomed.has(n.folderId)),
          trashFolders: [...s.trashFolders, ...s.folders.filter(f => doomed.has(f.id)).map(f => ({ ...f, deletedAt }))],
          trashNotes: [...s.trashNotes, ...s.notes.filter(n => n.folderId && doomed.has(n.folderId)).map(n => ({ ...n, deletedAt }))],
        }));
      },

      moveFolder(id, parentId) {
        const folders = get().folders;
        const folder = folders.find(f => f.id === id);
        if (!folder || folder.parentId === parentId) return;
        if (parentId && folderDescendants(folders, id).includes(parentId)) return;
        // Same rule as creating or renaming: no two folders with the same name side by side.
        const taken = folders.filter(f => f.parentId === parentId && f.id !== id).map(f => f.name);
        const name = uniqueName(folder.name, taken);
        set(s => ({ folders: s.folders.map(f => (f.id === id ? { ...f, parentId, name } : f)) }));
      },

      createNote(data = {}) {
        const time = nowIso();
        const note: Note = {
          id: uid(),
          title: data.title?.trim() || t('Sans titre'),
          content: data.content ?? '',
          folderId: data.folderId ?? null,
          createdAt: time,
          updatedAt: time,
        };
        set(s => ({ notes: [...s.notes, note] }));
        return note;
      },

      // Pinning is not an edit: the « modifiée » date (and the order of the list) stays. The sync still sends
      // it: the server keeps a version whose date is equal to its own (keep_newest only refuses older ones).
      updateNote: (id, patch) =>
        set(s => ({
          notes: s.notes.map(n => (n.id === id ? { ...n, ...patch, updatedAt: Object.keys(patch).every(k => k === 'pinned') ? n.updatedAt : nowIso() } : n)),
        })),

      removeNote: id =>
        set(s => {
          const note = s.notes.find(n => n.id === id);
          if (!note) return s;
          return { notes: s.notes.filter(n => n.id !== id), trashNotes: [...s.trashNotes, { ...note, deletedAt: nowIso() }] };
        }),

      restore(ids) {
        const { trashFolders, trashNotes, folders } = get();
        const backF = new Set<string>();
        const backN = new Set<string>();
        for (const id of ids) {
          const note = trashNotes.find(n => n.id === id);
          if (note) backN.add(id);
          const folder = trashFolders.find(f => f.id === id);
          if (!folder) continue;
          // The folder, its sub-folders and notes deleted at the same time.
          for (const fid of folderDescendants(trashFolders, id)) {
            if (trashFolders.find(f => f.id === fid)?.deletedAt === folder.deletedAt) backF.add(fid);
          }
          for (const n of trashNotes) if (n.folderId && backF.has(n.folderId) && n.deletedAt === folder.deletedAt) backN.add(n.id);
        }
        const alive = (fid: string | null) => !fid || backF.has(fid) || folders.some(f => f.id === fid);
        const strip = <T extends { deletedAt?: string }>({ deletedAt: _d, ...rest }: T) => rest;
        // Back next to a folder of the same name made since: « Maths (2) », like in the Drive.
        const placed: NoteFolder[] = [];
        for (const f of get().trashFolders.filter(f => backF.has(f.id))) {
          const parentId = alive(f.parentId) ? f.parentId : null;
          const name = parentId && backF.has(parentId) ? f.name : uniqueName(f.name, [...folders, ...placed].filter(x => x.parentId === parentId).map(x => x.name));
          placed.push({ ...strip(f), parentId, name });
        }
        set(s => ({
          folders: [...s.folders, ...placed],
          notes: [...s.notes, ...s.trashNotes.filter(n => backN.has(n.id)).map(n => ({ ...strip(n), folderId: alive(n.folderId) ? n.folderId : null }))],
          trashFolders: s.trashFolders.filter(f => !backF.has(f.id)),
          trashNotes: s.trashNotes.filter(n => !backN.has(n.id)),
        }));
      },

      purge(ids) {
        // A folder goes with what was deleted together with it. What was deleted earlier on its own
        // stays in the trash, moved to the root: the server deletes a folder's content with it.
        const { trashFolders, trashNotes } = get();
        const doomedF = new Set<string>();
        for (const id of ids) {
          const root = trashFolders.find(f => f.id === id);
          if (!root) continue;
          for (const fid of folderDescendants(trashFolders, id)) if (trashFolders.find(f => f.id === fid)?.deletedAt === root.deletedAt) doomedF.add(fid);
        }
        const at = new Map(trashFolders.map(f => [f.id, f.deletedAt]));
        const doomedN = new Set(ids);
        for (const n of trashNotes) if (n.folderId && doomedF.has(n.folderId) && at.get(n.folderId) === n.deletedAt) doomedN.add(n.id);
        const time = nowIso();
        set(s => ({
          trashFolders: s.trashFolders.filter(f => !doomedF.has(f.id)).map(f => (f.parentId && doomedF.has(f.parentId) ? { ...f, parentId: null } : f)),
          trashNotes: s.trashNotes
            .filter(n => !doomedN.has(n.id))
            .map(n => (n.folderId && doomedF.has(n.folderId) ? { ...n, folderId: null, updatedAt: time } : n)),
        }));
      },

      emptyTrash: () => set({ trashFolders: [], trashNotes: [] }),

      purgeExpired() {
        const limit = Date.now() - TRASH_DAYS * 864e5;
        const old = (x: { deletedAt?: string }) => !!x.deletedAt && new Date(x.deletedAt).getTime() < limit;
        const ids = [...get().trashFolders.filter(old), ...get().trashNotes.filter(old)].map(x => x.id);
        if (ids.length) get().purge(ids);
      },

      duplicateNote(id) {
        const src = get().notes.find(n => n.id === id);
        if (!src) return null;
        return get().createNote({ title: t('{name} - copie', { name: src.title }), content: src.content, folderId: src.folderId });
      },
    }),
    { name: 'notes', storage: userStorage, skipHydration: true },
  ),
);
