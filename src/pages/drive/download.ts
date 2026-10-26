import { getFileBlob, getFileUrl, type DriveItem } from '../../store/drive';
import { toast } from '../../store/ui';
import { zipPaths } from '../../lib/zipPaths';
import { tn } from '../../i18n';

let zipping = false;

/** `getUrl` : d'où vient le contenu (par défaut, le Drive personnel). */
export function downloadItem(item: Pick<DriveItem, 'id' | 'name'>, getUrl: (id: string) => Promise<string | null> = getFileUrl) {
  void getUrl(item.id).then(url => {
    if (!url) return;
    saveUrl(url, item.name);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}

function saveUrl(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  // In the page: some browsers ignore the name of a link that isn't (Chrome, after a wait).
  document.body.append(a);
  a.click();
  a.remove();
}

/** Saves a file made in the page under its name. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  saveUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Downloads the chosen files and folders (or the whole Drive) as one .zip.
 * shortcut: the zip is built in memory (fine for a student's Drive, up to a few hundred Mo); a very big Drive would
 * need a streamed zip.
 */
export async function downloadZip(items: DriveItem[], roots: string[], name: string) {
  const entries = zipPaths(items, roots);
  const files = entries.filter(e => !e.folder);
  // One zip at a time: a double click makes one.
  if (!entries.length || zipping) return;
  zipping = true;
  try {
    await makeZip(entries, files.length, name);
  } finally {
    zipping = false;
  }
}

async function makeZip(entries: ReturnType<typeof zipPaths>, files: number, name: string) {
  toast(tn(files, 'Préparation du zip ({n} fichier)…', 'Préparation du zip ({n} fichiers)…'));
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  let missing = 0;
  for (const e of entries) {
    if (e.folder) {
      zip.folder(e.path);
      continue;
    }
    const blob = await getFileBlob(e.id).catch(() => null);
    if (blob) zip.file(e.path, blob);
    else missing++;
  }
  // Not one file could be read: no empty zip, only the message.
  if (files && missing === files) return toast(tn(missing, '{n} fichier n’a pas pu être ajouté : vérifie ta connexion et réessaie.', '{n} fichiers n’ont pas pu être ajoutés : vérifie ta connexion et réessaie.'), 'error');
  // Pictures, PDFs and videos are already compressed: stored as they are (fast, same size).
  const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  saveBlob(out, `${name.replace(/[\\/:*?"<>|]/g, '-')}.zip`);
  if (missing) toast(tn(missing, '{n} fichier n’a pas pu être ajouté : vérifie ta connexion et réessaie.', '{n} fichiers n’ont pas pu être ajoutés : vérifie ta connexion et réessaie.'), 'error');
}
