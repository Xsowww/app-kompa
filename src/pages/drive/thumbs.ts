// Small pictures of the Drive's images and of a PDF's first page, made in the browser the first time the file shows on
// screen, then kept in their own IndexedDB database (a few KB each): the next visits show them at once, and online the
// photo is not downloaded again. Anything that fails (a format the browser can't read) keeps the file's icon.

import { categoryOf, getFileBlob, useDrive, type DriveItem } from '../../store/drive';
import { safeImageBlob } from '../../lib/safeImage';

const SIZE = 240; // px, the longest side: sharp at 2× in a tile
const MAX_BYTES = 30 * 1024 * 1024; // a huge photo would take too much memory for a small picture

type Item = Pick<DriveItem, 'id' | 'kind' | 'name' | 'mime' | 'size' | 'updatedAt'>;

export const canThumb = (item: Item) => item.kind === 'file' && ['image', 'pdf'].includes(categoryOf(item)) && (item.size ?? 0) <= MAX_BYTES;

/** A new version of the file (renamed files keep theirs: the name is not in it) gets a new picture. */
const keyOf = (item: Item) => `${item.id}:${item.updatedAt}:${item.size ?? 0}`;

// ── Cache (IndexedDB) ──
let db: Promise<IDBDatabase | null> | null = null;
function openDb() {
  db ??= new Promise(resolve => {
    try {
      const req = indexedDB.open('kompaly-thumbs', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('thumbs');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null); // private browsing: made again each time, never an error
    } catch {
      resolve(null);
    }
  });
  return db;
}
async function stored(key: string): Promise<Blob | undefined> {
  const d = await openDb();
  if (!d) return undefined;
  return new Promise(resolve => {
    const req = d.transaction('thumbs').objectStore('thumbs').get(key);
    req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : undefined);
    req.onerror = () => resolve(undefined);
  });
}
async function store(key: string, blob: Blob) {
  const d = await openDb();
  try {
    d?.transaction('thumbs', 'readwrite').objectStore('thumbs').put(blob, key);
  } catch {
    /* full: no cache, the picture still shows */
  }
}

/** Once per visit: the pictures of files gone (deleted for good, changed since) are dropped. */
let pruned = false;
async function prune() {
  const { items, trash } = useDrive.getState();
  if (pruned || !items.length) return;
  pruned = true;
  const keep = new Set([...items, ...trash].map(keyOf));
  const d = await openDb();
  try {
    const thumbs = d?.transaction('thumbs', 'readwrite').objectStore('thumbs');
    const req = thumbs?.openKeyCursor();
    if (thumbs && req)
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (!keep.has(String(c.key))) thumbs.delete(c.key);
        c.continue();
      };
  } catch {
    /* nothing to tidy */
  }
}

// ── Making them ──
function toJpeg(source: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  const scale = Math.min(1, SIZE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // a transparent PNG would turn black in a JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
}

async function imageThumb(blob: Blob, name: string) {
  const bitmap = await createImageBitmap(await safeImageBlob(blob, name));
  try {
    return await toJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

async function pdfThumb(blob: Blob) {
  const { loadPdfjs } = await import('../../lib/pdf');
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    const page = await (await task.promise).getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: SIZE / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    return await toJpeg(canvas, canvas.width, canvas.height);
  } finally {
    void task.destroy();
  }
}

// Two at a time: a folder of 200 photos must not freeze the page.
let running = 0;
const waiting: (() => void)[] = [];
async function inTurn<T>(job: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const made = new Map<string, Promise<string | null>>();

/** An object URL of the file's small picture, or null (no picture for it: its icon stays). */
export function thumbUrl(item: Item): Promise<string | null> {
  const key = keyOf(item);
  let p = made.get(key);
  if (!p) {
    p = inTurn(async () => {
      try {
        const kept = await stored(key);
        if (kept) return URL.createObjectURL(kept);
        const blob = await getFileBlob(item.id);
        if (!blob) return null;
        const jpeg = categoryOf(item) === 'pdf' ? await pdfThumb(blob) : await imageThumb(blob, item.name);
        if (!jpeg) return null;
        void store(key, jpeg);
        return URL.createObjectURL(jpeg);
      } catch {
        return null;
      } finally {
        setTimeout(() => void prune(), 5000);
      }
    });
    made.set(key, p);
  }
  return p;
}

export const thumbKey = keyOf;
