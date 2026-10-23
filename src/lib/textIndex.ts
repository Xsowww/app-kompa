// Text of the Drive's PDF, Word, PowerPoint and text files (CSV included), extracted in the browser so the search can look
// inside documents. Kept in its own IndexedDB database: blobStore's one is left untouched.
// Entries are keyed like blobs ("<userId>:<itemId>") so accounts sharing a browser stay apart.

import { blobStore } from './blobStore';
import { blobKey, getStorageUser } from './userStorage';
import { useDrive, categoryOf, isPlainText, type DriveItem } from '../store/drive';
import { cloudEnabled } from './supabase';
import { docxText, pdfPages } from './docText';
import { fold, findIn, folding, glue, highlightParts, original, pageAt, unhyphen, type Glued } from './textFind';

export { fold, findIn, highlightParts };

// -2: texts read again with the spaces between words of PDFs put back (docText.pageText).
// -3: a PDF's entry also says where each of its pages starts (a result opens on its page). The older ones are deleted.
const DB_NAME = 'cop-pilot-text-3';
const OLD_DBS = ['cop-pilot-text', 'cop-pilot-text-2'];
/** Stored for a file read without any text in it (a scan…), so it isn't read again. */
const NO_TEXT = '\u0000';
const STORE = 'texts';
/** Bigger files are not worth downloading and parsing just for the search. */
const MAX_FILE_SIZE = 30 * 1024 * 1024;
const MAX_TEXT = 2_000_000;
const MAX_PDF_PAGES = 400;
/** Online on a phone's data (or with « save data » on): only the files up to this size are read, the others on wifi. */
const SAVE_DATA_SIZE = 5 * 1024 * 1024;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      OLD_DBS.forEach(n => indexedDB.deleteDatabase(n));
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
  [DB_NAME, ...OLD_DBS].forEach(n => indexedDB.deleteDatabase(n));
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
/** Files are being read right now (a search may find more in a moment): the background pass, or a file just imported. */
export const isIndexing = () => busy || inFlight.size > 0;

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

/** Online on a phone's data, or « save data » on: the big files wait for wifi (the first search downloaded them all). */
function savingData() {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }).connection;
  return cloudEnabled && !!(c?.saveData || c?.type === 'cellular');
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

const collapse = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/** What is stored: the text, and for a PDF where each page starts in it. */
interface Stored {
  text: string;
  pages?: number[];
}

/** Plain text of a file, whitespace collapsed (snippets read better on one line). */
async function extract(kind: Kind, blob: Blob): Promise<Stored> {
  if (kind === 'pdf') {
    const pages: number[] = [];
    let text = '';
    for (const p of (await pdfPages(blob, MAX_TEXT, MAX_PDF_PAGES)).pages) {
      if (text.length >= MAX_TEXT) break;
      const c = collapse(p);
      if (text && c) text += ' ';
      pages.push(text.length);
      text += c;
    }
    return { text: text.slice(0, MAX_TEXT), pages };
  }
  const raw = kind === 'docx' ? await docxText(blob) : kind === 'pptx' ? await pptxText(blob) : await blob.slice(0, MAX_TEXT * 2).text();
  return { text: collapse(raw).slice(0, MAX_TEXT) };
}

// ── In-memory copy of the current user's index ─────────────────────────────

interface Indexed extends Stored {
  folded: string;
  /** folding()'s: null when the folded text is at the same places as the text. */
  map: Int32Array | null;
  /** glue(folded), made the first time a search is not found as typed, then kept (not made again at every key). */
  glued?: Glued;
}

const indexed = ({ text, pages }: Stored): Indexed => ({ text, pages, ...folding(text) });

let cache: { user: string; map: Map<string, Indexed> } | null = null;
let loading: Promise<Map<string, Indexed>> | null = null;

async function load(): Promise<Map<string, Indexed>> {
  const user = getStorageUser();
  if (!user) return new Map();
  if (cache?.user === user) return cache.map;
  if (!loading) {
    loading = (async () => {
      const range = IDBKeyRange.bound(`${user}:`, `${user}:￿`);
      const [keys, values] = await Promise.all([run('readonly', s => s.getAllKeys(range)), run<(Stored | string)[]>('readonly', s => s.getAll(range))]);
      const map = new Map<string, Indexed>();
      keys.forEach((k, i) => {
        const id = String(k).slice(user.length + 1);
        const v = values[i];
        map.set(id, indexed(typeof v === 'string' ? { text: v === NO_TEXT ? '' : v } : v));
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
  // From now on the search says « je lis encore » (a file just imported is read outside the background pass).
  if (inFlight.size === 1 && !busy) changed();
  try {
    const map = await load();
    if (map.has(item.id)) return;
    const data = blob ?? (await blobStore.get(blobKey(item.id)));
    if (!data) return void failed.add(item.id);
    let got: Stored;
    try {
      got = await extract(kind, data);
    } catch {
      // Damaged or protected file, or pdf.js not loaded (connection lost): not stored, read again next session.
      return void failed.add(item.id);
    }
    await run('readwrite', s => s.put(got.text ? got : NO_TEXT, `${user}:${item.id}`));
    if (cache?.user === user) cache.map.set(item.id, indexed(got));
  } catch {
    // IndexedDB unavailable (private browsing…): the search falls back to names only.
    failed.add(item.id);
  } finally {
    inFlight.delete(item.id);
    changed();
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
        const small = savingData();
        const todo = useDrive.getState().items.filter(i => kindOf(i) && !map.has(i.id) && !inFlight.has(i.id) && !failed.has(i.id) && (!small || (i.size ?? 0) <= SAVE_DATA_SIZE));
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
  // On wifi again: the big files left aside are read.
  const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
  connection?.addEventListener?.('change', schedule);
  return () => {
    stopped = true;
    clearTimeout(timer);
    unsub();
    connection?.removeEventListener?.('change', schedule);
  };
}

export interface ContentMatch {
  id: string;
  /** About 160 characters around the first match. */
  snippet: string;
  /** A PDF: the page of the first match (from 1). */
  page?: number;
}

function snippetAround(text: string, at: number, len: number) {
  let start = Math.max(0, at - 60);
  let end = Math.min(text.length, at + len + 100);
  // Don't cut words in half.
  const sp = text.indexOf(' ', start);
  if (start > 0 && sp >= 0 && sp < at) start = sp + 1;
  const ep = text.lastIndexOf(' ', end);
  if (end < text.length && ep > at + len) end = ep;
  return `${start > 0 ? '…' : ''}${unhyphen(text.slice(start, end))}${end < text.length ? '…' : ''}`;
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
    let found = { at: entry.folded.indexOf(q), len: q.length };
    if (found.at < 0) found = findIn(entry.folded, q, (entry.glued ??= glue(entry.folded)));
    if (found.at < 0) continue;
    let count = 0;
    for (let i = entry.folded.indexOf(q); i >= 0 && count < 50; i = entry.folded.indexOf(q, i + q.length)) count++;
    const { at, len } = original(entry.map, found.at, found.len);
    hits.push({ id: item.id, snippet: snippetAround(entry.text, at, len), page: entry.pages && pageAt(entry.pages, at), count: Math.max(count, 1) });
  }
  return hits
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ id, snippet, page }) => ({ id, snippet, page }));
}
