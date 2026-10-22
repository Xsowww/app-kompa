import { useDrive } from '../../store/drive';
import { indexFile } from '../../lib/textIndex';
import { MAX_FILE } from '../../lib/blobStore';
import { driveWhere, trackUpload, type UploadHandle } from '../../store/uploads';

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

/**
 * Recreate the folder structure under `parentId` and upload every file.
 * Files over the size limit are skipped (the rest still goes in) and returned by name.
 */
export async function uploadPending(pending: PendingFile[], parentId: string | null): Promise<{ count: number; tooBig: string[] }> {
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
  const tooBig: { name: string; track: UploadHandle }[] = [];
  const byFolder = new Map<string | null, { files: File[]; tracks: UploadHandle[] }>();
  for (const p of pending) {
    if (p.file && p.file.size > MAX_FILE) {
      // On the upload card too, as « Échec ».
      tooBig.push({ name: p.file.name, track: trackUpload(p.file.name, p.file.size, driveWhere(parentId)) });
      continue;
    }
    const target = ensure(p.dirs);
    if (!p.file) continue;
    const batch = byFolder.get(target) ?? { files: [], tracks: [] };
    batch.files.push(p.file);
    // The whole import is on the card from the start.
    batch.tracks.push(trackUpload(p.file.name, p.file.size, driveWhere(target)));
    byFolder.set(target, batch);
  }
  tooBig.forEach(b => b.track.fail());
  try {
    for (const [target, { files, tracks }] of byFolder) {
      const created = await drive.uploadFiles(files, target, tracks);
      // Index the text for the search right away, from the file we already have in hand.
      created.forEach((item, i) => void indexFile(item, files[i]));
      count += files.length;
    }
  } catch (e) {
    // The next folders are not sent either.
    for (const { tracks } of byFolder.values()) tracks.forEach(h => h.fail());
    throw e;
  }
  return { count, tooBig: tooBig.map(b => b.name) };
}
