import { useDrive } from '../../store/drive';
import { indexFile } from '../../lib/textIndex';
import { MAX_FILE } from '../../lib/blobStore';

export interface PendingFile {
  file: File | null; // null = empty folder
  /** folder path relative to the drop target, e.g. ["Cours", "Maths"] */
  dirs: string[];
}

/** Collect files from a drop, walking into dropped folders when the browser allows it. */
export async function filesFromDrop(dt: DataTransfer): Promise<PendingFile[]> {
  const entries = Array.from(dt.items)
    .filter(i => i.kind === 'file')
    .map(i => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);

  if (entries.length === 0) return Array.from(dt.files).map(file => ({ file, dirs: [] }));

  const out: PendingFile[] = [];
  const walk = async (entry: FileSystemEntry, dirs: string[]): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, dirs });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children: FileSystemEntry[] = [];
      // readEntries returns results in batches
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        children.push(...batch);
      }
      if (children.length === 0) out.push({ file: null, dirs: [...dirs, entry.name] });
      for (const c of children) await walk(c, [...dirs, entry.name]);
    }
  };
  for (const e of entries) await walk(e, []);
  return out;
}

export function filesFromInput(list: FileList): PendingFile[] {
  return Array.from(list).map(file => {
    const parts = (file.webkitRelativePath || file.name).split('/');
    return { file, dirs: parts.slice(0, -1) };
  });
}

// Closing the tab mid-upload loses the files not stored yet: the browser asks first.
let uploading = 0;
const warnUnload = (e: BeforeUnloadEvent) => e.preventDefault();

/**
 * Recreate the folder structure under `parentId` and upload every file.
 * Files over the size limit are skipped (the rest still goes in) and returned by name.
 */
export async function uploadPending(pending: PendingFile[], parentId: string | null): Promise<{ count: number; tooBig: string[] }> {
  if (uploading++ === 0) window.addEventListener('beforeunload', warnUnload);
  try {
    return await uploadAll(pending, parentId);
  } finally {
    if (--uploading === 0) window.removeEventListener('beforeunload', warnUnload);
  }
}

async function uploadAll(pending: PendingFile[], parentId: string | null) {
  const drive = useDrive.getState();
  const folderIds = new Map<string, string | null>([['', parentId]]);

  const ensure = (dirs: string[]): string | null => {
    let key = '';
    let current = parentId;
    for (const d of dirs) {
      key += `/${d}`;
      if (!folderIds.has(key)) {
        const existing = useDrive.getState().items.find(i => i.kind === 'folder' && i.parentId === current && i.name === d);
        folderIds.set(key, existing ? existing.id : drive.createFolder(d, current).id);
      }
      current = folderIds.get(key)!;
    }
    return current;
  };

  let count = 0;
  const tooBig: string[] = [];
  const byFolder = new Map<string | null, File[]>();
  for (const p of pending) {
    if (p.file && p.file.size > MAX_FILE) {
      tooBig.push(p.file.name);
      continue;
    }
    const target = ensure(p.dirs);
    if (!p.file) continue;
    byFolder.set(target, [...(byFolder.get(target) ?? []), p.file]);
  }
  for (const [target, files] of byFolder) {
    const created = await drive.uploadFiles(files, target);
    // Index the text for the search right away, from the file we already have in hand.
    created.forEach((item, i) => void indexFile(item, files[i]));
    count += files.length;
  }
  return { count, tooBig };
}
