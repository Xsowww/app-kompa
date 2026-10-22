import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid, nowIso, uniqueName } from '../lib/utils';
import { userStorage, blobKey, trashBlobKey } from '../lib/userStorage';
import { blobStore, MAX_FILE, QUOTA, StorageError } from '../lib/blobStore';
import { cloudEnabled } from '../lib/supabase';
import { t, locale } from '../i18n';

export type DriveKind = 'folder' | 'file';

export interface DriveItem {
  id: string;
  name: string;
  kind: DriveKind;
  parentId: string | null;
  mime?: string;
  size?: number;
  createdAt: string;
  updatedAt: string;
  starred?: boolean;
  /** Folder colour (key of FOLDER_COLORS). */
  color?: string;
  /** Free labels, e.g. « Important », « S1 ». */
  tags?: string[];
  /** Set when the item is in the trash (same value for everything deleted together). */
  deletedAt?: string;
}

/** Items stay this long in the trash, then they are deleted for good. */
export const TRASH_DAYS = 30;

export interface Clipboard {
  mode: 'copy' | 'cut';
  ids: string[];
}

interface DriveState {
  items: DriveItem[];
  /** Deleted items, kept TRASH_DAYS days. Separate from `items` so nothing else has to filter them. */
  trash: DriveItem[];
  clipboard: Clipboard | null;
  createFolder: (name: string, parentId: string | null) => DriveItem;
  uploadFiles: (files: File[], parentId: string | null) => Promise<DriveItem[]>;
  rename: (id: string, name: string) => void;
  /** Moves items (and their content) to the trash. */
  remove: (ids: string[]) => void;
  /** Puts trashed items back where they were (at the root if that folder is gone). */
  restore: (ids: string[]) => void;
  /** Deletes trashed items for good, files included. */
  purge: (ids: string[]) => void;
  emptyTrash: () => void;
  purgeExpired: () => void;
  update: (id: string, patch: Partial<Pick<DriveItem, 'color' | 'tags'>>) => void;
  move: (ids: string[], targetId: string | null) => number;
  duplicate: (ids: string[]) => Promise<void>;
  copy: (ids: string[]) => void;
  cut: (ids: string[]) => void;
  /** False when refused: a folder can't go (moved or copied) into itself or one of its subfolders. */
  paste: (targetId: string | null) => Promise<boolean>;
  toggleStar: (id: string) => void;
}

export const childrenOf = (items: DriveItem[], parentId: string | null) =>
  items
    .filter(i => i.parentId === parentId)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, locale()) : a.kind === 'folder' ? -1 : 1));

/** ids + all their descendants */
export function withDescendants(items: DriveItem[], ids: string[]): string[] {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of items) {
      if (i.parentId && out.has(i.parentId) && !out.has(i.id)) {
        out.add(i.id);
        grew = true;
      }
    }
  }
  return [...out];
}

/** True when `target` is one of `ids` or inside one of them (no folder can go into itself). */
export const pasteForbidden = (items: DriveItem[], ids: string[], target: string | null) => !!target && withDescendants(items, ids).includes(target);

/** Files whose content is plain text (CSV included, though it shows a spreadsheet icon). */
export const isPlainText = (item: Pick<DriveItem, 'kind' | 'mime' | 'name'>) =>
  item.kind === 'file' && (categoryOf(item) === 'text' || /\.(csv|tsv)$/i.test(item.name));

export function pathOf(items: DriveItem[], id: string | null): DriveItem[] {
  const path: DriveItem[] = [];
  let cur = items.find(i => i.id === id);
  while (cur) {
    path.unshift(cur);
    const parent: string | null = cur.parentId;
    cur = items.find(i => i.id === parent);
  }
  return path;
}

export const folderSize = (items: DriveItem[], id: string) =>
  withDescendants(items, [id]).reduce((sum, i) => sum + (items.find(x => x.id === i)?.size ?? 0), 0);

const siblingNames = (items: DriveItem[], parentId: string | null, exceptId?: string) =>
  items.filter(i => i.parentId === parentId && i.id !== exceptId).map(i => i.name);

/** Deep copy of `ids` into `targetId`; returns new items and blob copies to perform. */
function cloneTree(items: DriveItem[], ids: string[], targetId: string | null, keepName: boolean) {
  const created: DriveItem[] = [];
  const blobCopies: [string, string][] = [];
  const time = nowIso();
  const cloneOne = (src: DriveItem, parentId: string | null, rename: boolean) => {
    const pool = [...items, ...created];
    // Pasted next to the original, a copy is named like a duplicate (« A - copie.txt »), not « A (2).txt ».
    const clash = siblingNames(pool, parentId).includes(src.name);
    const base = rename && (!keepName || clash) ? copyName(src.name) : src.name;
    const copy: DriveItem = {
      ...src,
      id: uid(),
      parentId,
      name: uniqueName(base, siblingNames(pool, parentId)),
      createdAt: time,
      updatedAt: time,
      starred: false,
    };
    created.push(copy);
    if (src.kind === 'file') blobCopies.push([src.id, copy.id]);
    for (const child of items.filter(i => i.parentId === src.id)) cloneOne(child, copy.id, false);
  };
  for (const id of ids) {
    const src = items.find(i => i.id === id);
    if (src) cloneOne(src, targetId, true);
  }
  return { created, blobCopies };
}

/** A file renamed without any extension keeps its old one (« Notes » → « Notes.txt »), so it still opens. */
export function keepExtension(oldName: string, newName: string) {
  const clean = newName.trim();
  const dot = oldName.lastIndexOf('.');
  return dot > 0 && clean.lastIndexOf('.') <= 0 ? `${clean}${oldName.slice(dot)}` : clean;
}

function copyName(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${t('{name} - copie', { name: name.slice(0, dot) })}${name.slice(dot)}` : t('{name} - copie', { name });
}

export const useDrive = create<DriveState>()(
  persist(
    (set, get) => ({
      items: [],
      trash: [],
      clipboard: null,

      createFolder(name, parentId) {
        const time = nowIso();
        const folder: DriveItem = {
          id: uid(),
          name: uniqueName(name.trim() || t('Nouveau dossier'), siblingNames(get().items, parentId)),
          kind: 'folder',
          parentId,
          createdAt: time,
          updatedAt: time,
        };
        set(s => ({ items: [...s.items, folder] }));
        return folder;
      },

      async uploadFiles(files, parentId) {
        const big = files.find(f => f.size > MAX_FILE);
        if (big) throw new StorageError(t('« {name} » est trop lourd : 50 Mo maximum par fichier.', { name: big.name }));
        if (cloudEnabled && QUOTA) {
          const used = [...get().items, ...get().trash].reduce((s, i) => s + (i.kind === 'file' ? (i.size ?? 0) : 0), 0);
          const adding = files.reduce((s, f) => s + f.size, 0);
          if (used + adding > QUOTA)
            throw new StorageError(t('Plus assez de place : {free} Mo libres sur {total} Mo. Vide la corbeille ou supprime des fichiers.', { free: Math.max(0, Math.floor((QUOTA - used) / 1048576)), total: Math.round(QUOTA / 1048576) }));
        }
        const created: DriveItem[] = [];
        for (const file of files) {
          const time = nowIso();
          const item: DriveItem = {
            id: uid(),
            name: uniqueName(file.name, siblingNames(get().items, parentId)),
            kind: 'file',
            parentId,
            mime: file.type || 'application/octet-stream',
            size: file.size,
            createdAt: time,
            updatedAt: time,
          };
          await blobStore.put(blobKey(item.id), file);
          created.push(item);
          // Shown as soon as it is stored: if a later file fails, nothing stays invisible in storage.
          set(s => ({ items: [...s.items, item] }));
        }
        return created;
      },

      rename(id, name) {
        const clean = name.trim();
        if (!clean) return;
        set(s => {
          const item = s.items.find(i => i.id === id);
          if (!item) return s;
          const finalName = uniqueName(clean, siblingNames(s.items, item.parentId, id));
          return { items: s.items.map(i => (i.id === id ? { ...i, name: finalName, updatedAt: nowIso() } : i)) };
        });
      },

      remove(ids) {
        const doomed = new Set(withDescendants(get().items, ids));
        if (!doomed.size) return;
        const deletedAt = nowIso();
        set(s => ({
          items: s.items.filter(i => !doomed.has(i.id)),
          trash: [...s.trash, ...s.items.filter(i => doomed.has(i.id)).map(i => ({ ...i, deletedAt }))],
          clipboard: s.clipboard ? { ...s.clipboard, ids: s.clipboard.ids.filter(i => !doomed.has(i)) } : null,
        }));
        for (const it of get().trash) if (doomed.has(it.id) && it.kind === 'file') void blobStore.move(blobKey(it.id), trashBlobKey(it.id));
      },

      restore(ids) {
        const { trash, items } = get();
        const back = new Set<string>();
        for (const id of ids) {
          const root = trash.find(i => i.id === id);
          if (!root) continue;
          // Everything deleted together with it comes back too.
          for (const d of withDescendants(trash, [id])) if (trash.find(i => i.id === d)?.deletedAt === root.deletedAt) back.add(d);
        }
        if (!back.size) return;
        const restored: DriveItem[] = [];
        for (const it of trash.filter(i => back.has(i.id))) {
          const { deletedAt: _d, ...clean } = it;
          const parentAlive = !clean.parentId || back.has(clean.parentId) || items.some(i => i.id === clean.parentId);
          const parentId = parentAlive ? clean.parentId : null;
          const name = back.has(parentId ?? '') ? clean.name : uniqueName(clean.name, siblingNames([...items, ...restored], parentId));
          restored.push({ ...clean, parentId, name });
        }
        set(s => ({ items: [...s.items, ...restored], trash: s.trash.filter(i => !back.has(i.id)) }));
        for (const it of restored) if (it.kind === 'file') void blobStore.move(trashBlobKey(it.id), blobKey(it.id));
      },

      purge(ids) {
        // Content deleted together with a folder goes with it; things deleted earlier on their
        // own stay in the trash (shown as separate entries, restored at the root).
        const trash = get().trash;
        const doomed = new Set(ids);
        for (const id of ids) {
          const root = trash.find(i => i.id === id);
          for (const d of withDescendants(trash, [id])) if (trash.find(i => i.id === d)?.deletedAt === root?.deletedAt) doomed.add(d);
        }
        for (const it of get().trash) {
          if (!doomed.has(it.id) || it.kind !== 'file') continue;
          void blobStore.delete(blobKey(it.id)).catch(() => undefined);
          void blobStore.delete(trashBlobKey(it.id)).catch(() => undefined);
        }
        // The server deletes a folder's content with it: what was trashed earlier from inside it
        // (kept here as a separate entry) first moves to the root, or it would vanish without its file.
        // Its updatedAt stays: the file itself was not modified.
        set(s => ({
          trash: s.trash.filter(i => !doomed.has(i.id)).map(i => (i.parentId && doomed.has(i.parentId) ? { ...i, parentId: null } : i)),
        }));
      },

      emptyTrash: () => get().purge(get().trash.map(i => i.id)),

      purgeExpired() {
        const limit = Date.now() - TRASH_DAYS * 864e5;
        const old = get().trash.filter(i => i.deletedAt && new Date(i.deletedAt).getTime() < limit).map(i => i.id);
        if (old.length) get().purge(old);
      },

      // Colour and labels are like the star: the content is unchanged, so updatedAt (Récents) stays.
      update: (id, patch) => set(s => ({ items: s.items.map(i => (i.id === id ? { ...i, ...patch } : i)) })),

      move(ids, targetId) {
        const items = get().items;
        // Forbid moving a folder into itself or one of its children.
        const forbidden = new Set(withDescendants(items, ids));
        if (targetId && forbidden.has(targetId)) return 0;
        let moved = 0;
        const next = [...items];
        for (const id of ids) {
          const idx = next.findIndex(i => i.id === id);
          if (idx < 0 || next[idx].parentId === targetId) continue;
          next[idx] = {
            ...next[idx],
            parentId: targetId,
            name: uniqueName(next[idx].name, siblingNames(next, targetId, id)),
            updatedAt: nowIso(),
          };
          moved++;
        }
        set({ items: next });
        return moved;
      },

      async duplicate(ids) {
        const items = get().items;
        const groups = new Map<string | null, string[]>();
        for (const id of ids) {
          const it = items.find(i => i.id === id);
          if (!it) continue;
          groups.set(it.parentId, [...(groups.get(it.parentId) ?? []), id]);
        }
        let all: DriveItem[] = [];
        for (const [parent, group] of groups) {
          const { created, blobCopies } = cloneTree([...items, ...all], group, parent, false);
          await Promise.all(blobCopies.map(([a, b]) => blobStore.copy(blobKey(a), blobKey(b))));
          all = [...all, ...created];
        }
        set(s => ({ items: [...s.items, ...all] }));
      },

      copy: ids => set({ clipboard: { mode: 'copy', ids } }),
      cut: ids => set({ clipboard: { mode: 'cut', ids } }),

      async paste(targetId) {
        const clip = get().clipboard;
        if (!clip || clip.ids.length === 0) return true;
        // Refused (a folder into itself): the clipboard stays, to paste elsewhere.
        if (pasteForbidden(get().items, clip.ids, targetId)) return false;
        if (clip.mode === 'cut') {
          if (get().move(clip.ids, targetId)) set({ clipboard: null });
          return true;
        }
        const { created, blobCopies } = cloneTree(get().items, clip.ids, targetId, true);
        await Promise.all(blobCopies.map(([a, b]) => blobStore.copy(blobKey(a), blobKey(b))));
        set(s => ({ items: [...s.items, ...created] }));
        return true;
      },

      toggleStar: id => set(s => ({ items: s.items.map(i => (i.id === id ? { ...i, starred: !i.starred } : i)) })),
    }),
    { name: 'drive', storage: userStorage, skipHydration: true, partialize: s => ({ items: s.items, trash: s.trash }) },
  ),
);

/** Trashed items shown at the top level of the trash (their folder wasn't deleted together with them). */
export const trashRoots = (trash: DriveItem[]) =>
  trash.filter(i => {
    const parent = i.parentId ? trash.find(t => t.id === i.parentId) : undefined;
    return !parent || parent.deletedAt !== i.deletedAt;
  });

/** Colours a folder can wear. */
export const FOLDER_COLORS: Record<string, { label: string; color: string }> = {
  bleu: { label: t('Bleu'), color: '#3b6fd8' },
  rouge: { label: t('Rouge'), color: '#d9483b' },
  orange: { label: t('Orange'), color: '#e8613c' },
  jaune: { label: t('Jaune'), color: '#d48a17' },
  vert: { label: t('Vert'), color: '#2f9e6b' },
  violet: { label: t('Violet'), color: '#7a5ad6' },
  rose: { label: t('Rose'), color: '#d6457a' },
  gris: { label: t('Gris'), color: '#78716c' },
};

/** Colour of a notes folder icon (outline and a light fill); undefined when the folder has none. */
export const folderIconStyle = (key?: string) => {
  const c = key ? FOLDER_COLORS[key]?.color : undefined;
  return c ? { color: c, fill: `color-mix(in srgb, ${c} 22%, transparent)` } : undefined;
};

/** A known colour key, else undefined (imported files, rows from the server). */
export const folderColorKey = (c: unknown) => (typeof c === 'string' && Object.hasOwn(FOLDER_COLORS, c) ? c : undefined);

export async function getFileUrl(id: string): Promise<string | null> {
  // A trashed file's content waits in the trash folder (cloud mode).
  const blob = (await blobStore.get(blobKey(id))) ?? (await blobStore.get(trashBlobKey(id)));
  return blob ? URL.createObjectURL(blob) : null;
}

export type FileCategory = 'folder' | 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'doc' | 'sheet' | 'slides' | 'archive' | 'other';

export function categoryOf(item: Pick<DriveItem, 'kind' | 'mime' | 'name'>): FileCategory {
  if (item.kind === 'folder') return 'folder';
  const mime = item.mime ?? '';
  const ext = item.name.split('.').pop()?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (['doc', 'docx', 'odt', 'rtf', 'pages'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'ods', 'csv', 'numbers'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return 'slides';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  if (mime.startsWith('text/') || ['md', 'txt', 'json', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'html', 'css'].includes(ext)) return 'text';
  return 'other';
}
