// Text of the Drive's PDF, Word, PowerPoint and text files (CSV included), extracted in the browser so the search can look
// inside documents. Kept in its own IndexedDB database: blobStore's one is left untouched.
// Entries are keyed like blobs ("<userId>:<itemId>") so accounts sharing a browser stay apart.

import { blobStore } from './blobStore';
import { blobKey, getStorageUser } from './userStorage';
import { useDrive, categoryOf, isPlainText, type DriveItem } from '../store/drive';
import { docxText, pdfPages } from './docText';
import { fold, findIn } from './textFind';

export { fold, findIn };

// -2: texts read again with the spaces between words of PDFs put back (docText.pageText); the first one is deleted.
const DB_NAME = 'cop-pilot-text-2';
const OLD_DB = 'cop-pilot-text';
/** Stored for a file read without any text in it (a scan…), so it isn't read again. */
const NO_TEXT = '\u0000';
const STORE = 'texts';
/** Bigger files are not worth downloading and parsing just for the search. */
const MAX_FILE_SIZE = 30 * 1024 * 1024;
const MAX_TEXT = 400_000;
const MAX_PDF_PAGES = 400;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      indexedDB.deleteDatabase(OLD_DB);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

/** Logout on a shared computer: the extracted texts must not stay readable. Rebuilt on next use. */
export async function forgetTextIndex() {
  const db = await dbPromise?.catch(() => null);
  db?.close();
  dbPromise = null;
  failed.clear();
  indexedDB.deleteDatabase(DB_NAME);
  indexedDB.deleteDatabase(OLD_DB);
}

// ── Who wants to know: the searches run again when files were read ─────────

const listeners = new Set<() => void>();
let busy = false;
/** Called after each file read, and when the reading starts or stops (see `isIndexing`). */
export function onIndexChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const changed = () => listeners.forEach(fn => fn());
/** Files are being read right now (a search may find more in a moment). */
export const isIndexing = () => busy;

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Splits `text` around the matches of `query`, for highlighting. */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  text = text.normalize('NFC'); // « É » written as « E » + accent (files from a Mac) is found as « e »
  const q = fold(query.trim());
  if (!q) return [{ text, hit: false }];
  const f = fold(text);
  const parts: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (let i = f.indexOf(q); i >= 0; i = f.indexOf(q, i + q.length)) {
    if (i > pos) parts.push({ text: text.slice(pos, i), hit: false });
    parts.push({ text: text.slice(i, i + q.length), hit: true });
    pos = i + q.length;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), hit: false });
  return parts;
}

// ── Extraction ─────────────────────────────────────────────────────────────

type Kind = 'pdf' | 'docx' | 'pptx' | 'text';

function kindOf(item: Pick<DriveItem, 'kind' | 'mime' | 'name' | 'size'>): Kind | null {
  if (item.kind !== 'file' || (item.size ?? 0) > MAX_FILE_SIZE) return null;
  if (categoryOf(item) === 'pdf') return 'pdf';
  if (isPlainText(item)) return 'text';
  const name = item.name.toLowerCase();
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.pptx')) return 'pptx';
  return null;
}

/** Text of every slide of a PowerPoint file (jszip is loaded on demand). */
async function pptxText(blob: Blob) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const num = (p: string) => Number(p.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
  const paths = Object.keys(zip.files).filter(p => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b));
  const parts: string[] = [];
  for (const path of paths) {
    const xml = new DOMParser().parseFromString((await zip.file(path)?.async('string')) ?? '', 'application/xml');
    for (const p of xml.getElementsByTagName('a:p')) parts.push([...p.getElementsByTagName('a:t')].map(t => t.textContent ?? '').join(''));
  }
  return parts.join('\n');
}

/** Plain text of a file, whitespace collapsed (snippets read better on one line). */
async function extract(kind: Kind, blob: Blob) {
  const raw =
    kind === 'pdf'
      ? (await pdfPages(blob, MAX_TEXT, MAX_PDF_PAGES)).pages.join('\n')
      : kind === 'docx'
        ? await docxText(blob)
        : kind === 'pptx'
          ? await pptxText(blob)
          : await blob.slice(0, MAX_TEXT * 2).text();
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

// ── In-memory copy of the current user's index ─────────────────────────────

interface Indexed {
  text: string;
  folded: string;
}

let cache: { user: string; map: Map<string, Indexed> } | null = null;
let loading: Promise<Map<string, Indexed>> | null = null;

async function load(): Promise<Map<string, Indexed>> {
  const user = getStorageUser();
  if (!user) return new Map();
  if (cache?.user === user) return cache.map;
  if (!loading) {
    loading = (async () => {
      const range = IDBKeyRange.bound(`${user}:`, `${user}:￿`);
      const [keys, values] = await Promise.all([run('readonly', s => s.getAllKeys(range)), run<string[]>('readonly', s => s.getAll(range))]);
      const map = new Map<string, Indexed>();
      keys.forEach((k, i) => {
        const id = String(k).slice(user.length + 1);
        const text = values[i] === NO_TEXT ? '' : values[i];
        map.set(id, { text, folded: fold(text.normalize('NFC')) });
      });
      cache = { user, map };
      return map;
    })().finally(() => (loading = null));
  }
  return loading;
}

const inFlight = new Set<string>();
/** Files whose reading failed in this session (download cut, damaged file…): tried again next time. */
const failed = new Set<string>();

/** Extracts and stores the text of one file. `blob` avoids downloading it again right after an upload. */
export async function indexFile(item: DriveItem, blob?: Blob) {
  const kind = kindOf(item);
  const user = getStorageUser();
  if (!kind || !user || inFlight.has(item.id) || failed.has(item.id)) return;
  inFlight.add(item.id);
  try {
    const map = await load();
    if (map.has(item.id)) return;
    const data = blob ?? (await blobStore.get(blobKey(item.id)));
    if (!data) return void failed.add(item.id);
    let text: string;
    try {
      text = await extract(kind, data);
    } catch {
      // Damaged or protected file, or pdf.js not loaded (connection lost): not stored, read again next session.
      return void failed.add(item.id);
    }
    await run('readwrite', s => s.put(text || NO_TEXT, `${user}:${item.id}`));
    if (cache?.user === user) cache.map.set(item.id, { text, folded: fold(text) });
    changed();
  } catch {
    // IndexedDB unavailable (private browsing…): the search falls back to names only.
    failed.add(item.id);
  } finally {
    inFlight.delete(item.id);
  }
}

/** Drops entries of files that no longer exist (purged from the trash, account reset…). */
async function prune(map: Map<string, Indexed>) {
  const user = getStorageUser();
  const { items, trash } = useDrive.getState();
  const alive = new Set([...items, ...trash].map(i => i.id));
  for (const id of [...map.keys()]) {
    if (alive.has(id)) continue;
    map.delete(id);
    await run('readwrite', s => s.delete(`${user}:${id}`)).catch(() => undefined);
  }
}

/**
 * Indexes, in the background and a few at a time, the files that aren't indexed yet,
 * then keeps up with new ones. Returns a function that stops it.
 */
export function startTextIndexing(): () => void {
  let stopped = false;
  let running = false;
  let again = false;

  const pass = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const map = await load();
        await prune(map);
        const todo = useDrive.getState().items.filter(i => kindOf(i) && !map.has(i.id) && !inFlight.has(i.id) && !failed.has(i.id));
        if (todo.length && !busy) {
          busy = true;
          changed();
        }
        for (let i = 0; i < todo.length && !stopped; i += 3) {
          await Promise.all(todo.slice(i, i + 3).map(it => indexFile(it)));
          await new Promise(r => setTimeout(r, 150)); // let the page breathe
        }
      } while (again && !stopped);
    } catch {
      // ignore: retried on the next change
    } finally {
      running = false;
      busy = false;
      changed(); // also when there was nothing to read: the search stops saying « je lis encore »
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void pass(), 800);
  };
  schedule();
  const unsub = useDrive.subscribe((s, p) => {
    if (s.items !== p.items || s.trash !== p.trash) schedule();
  });
  return () => {
    stopped = true;
    clearTimeout(timer);
    unsub();
  };
}

export interface ContentMatch {
  id: string;
  /** About 160 characters around the first match. */
  snippet: string;
}

function snippetAround(text: string, at: number, len: number) {
  let start = Math.max(0, at - 60);
  let end = Math.min(text.length, at + len + 100);
  // Don't cut words in half.
  const sp = text.indexOf(' ', start);
  if (start > 0 && sp >= 0 && sp < at) start = sp + 1;
  const ep = text.lastIndexOf(' ', end);
  if (end < text.length && ep > at + len) end = ep;
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/**
 * Files of the Drive (trash excluded) whose content contains `query`, ignoring case and accents.
 * Files that were never indexed (Drive page not opened yet on this device) are not found.
 */
export async function searchFileContents(query: string, limit = 20): Promise<ContentMatch[]> {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  let map: Map<string, Indexed>;
  try {
    map = await load();
  } catch {
    return [];
  }
  const hits: (ContentMatch & { count: number })[] = [];
  for (const item of useDrive.getState().items) {
    const entry = map.get(item.id);
    if (!entry) continue;
    const { at, len } = findIn(entry.folded, q);
    if (at < 0) continue;
    let count = 0;
    for (let i = entry.folded.indexOf(q); i >= 0 && count < 50; i = entry.folded.indexOf(q, i + q.length)) count++;
    hits.push({ id: item.id, snippet: snippetAround(entry.text, at, len), count: Math.max(count, 1) });
  }
  return hits
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ id, snippet }) => ({ id, snippet }));
}
