import { create } from 'zustand';
import { toast } from './ui';
import { tn } from '../i18n';

// Files being sent (Drive, groups…): one card shows them wherever the student is. Not persisted.

/**
 * `paused`: stopped by the student; once resumed, goes on from what the server kept (online, over 6 Mo: see
 * lib/storageUpload) or from its first byte. A cancelled file leaves the list.
 */
export type UploadStatus = 'active' | 'paused' | 'done' | 'error';

export interface Upload {
  id: string;
  name: string;
  /** Bytes (0 while unknown). */
  size: number;
  loaded: number;
  status: UploadStatus;
  /** Where it goes: `drive:<folderId|root>` or `group:<groupId>`. */
  where?: string;
  /** Why it failed, in a few words (« Plus de 50 Mo »): shown on its line instead of « Échec ». */
  reason?: string;
  /** Not started yet: its batch sends one file at a time (and waits while one before it is paused). */
  waiting?: boolean;
}

export interface UploadHandle {
  id: string;
  /** Bytes sent so far; `total` when the size was not known at the start. */
  progress(loaded: number, total?: number): void;
  done(): void;
  /** `reason`: a few words, see Upload. */
  fail(reason?: string): void;
  /** Aborted when this file is paused or cancelled: give it to the request. A fresh one for each attempt. */
  readonly signal: AbortSignal;
  /** Resolves at once, or when the file is resumed (or cancelled) if it is paused. */
  whenResumed(): Promise<void>;
  /** Cancelled by the student: nothing of it should be kept. */
  readonly cancelled: boolean;
}

/** Not over yet: on its way, waiting its turn, or paused. */
export const notOver = (u: Upload) => u.status === 'active' || u.status === 'paused';

/**
 * `shownAt`: the place whose own list already shows its files coming in (the Drive folder open): the card leaves them out.
 * `offline`: no network; the files on their way wait for it (lib/storageUpload goes on by itself once it is back).
 */
export const useUploads = create<{ items: Upload[]; shownAt: string | null; offline: boolean }>(() => ({ items: [], shownAt: null, offline: globalThis.navigator?.onLine === false }));
globalThis.addEventListener?.('online', () => useUploads.setState({ offline: false }));
globalThis.addEventListener?.('offline', () => useUploads.setState({ offline: true }));

/** What the card shows: everything, except what the open page already shows in place (its failures stay). */
export const cardItems = (items: Upload[], shownAt: string | null) => (shownAt ? items.filter(u => u.where !== shownAt || u.status === 'error') : items);

/** A card that went well disappears by itself after this long. */
export const HIDE_AFTER = 4000;

let seq = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let warning = false;
// Closing the tab mid-upload loses the files not stored yet (paused ones too): the browser asks first.
const warnUnload = (e: BeforeUnloadEvent) => e.preventDefault();

/** What the sending loop needs and the card's buttons act on, per file. */
interface Control {
  ctrl: AbortController;
  cancelled: boolean;
  waiters: (() => void)[];
}
const controls = new Map<string, Control>();

export const driveWhere = (folderId: string | null) => `drive:${folderId ?? 'root'}`;

function settle() {
  const { items } = useUploads.getState();
  const busy = items.some(notOver);
  if (busy !== warning) {
    warning = busy;
    globalThis[busy ? 'addEventListener' : 'removeEventListener']?.('beforeunload', warnUnload);
  }
  clearTimeout(hideTimer);
  if (!busy && items.length && items.every(u => u.status === 'done')) hideTimer = setTimeout(dismissUploads, HIDE_AFTER);
}

function patch(id: string, when: (u: Upload) => boolean, fn: (u: Upload) => Partial<Upload>) {
  useUploads.setState(s => ({ items: s.items.map(u => (u.id === id && when(u) ? { ...u, ...fn(u) } : u)) }));
  settle();
}

const release = (c: Control | undefined) => {
  c?.waiters.splice(0).forEach(go => go());
};

/** Shows a file on the card; call done() or fail() when it is over (later calls are ignored). */
export function trackUpload(name: string, size: number, where?: string): UploadHandle {
  const { items } = useUploads.getState();
  // A new import once the previous one is over: the card starts afresh.
  const keep = items.some(notOver) ? items : [];
  const id = `u${++seq}`;
  const c: Control = { ctrl: new AbortController(), cancelled: false, waiters: [] };
  controls.set(id, c);
  useUploads.setState({ items: [...keep, { id, name, size, loaded: 0, status: 'active', where, waiting: true }] });
  settle();
  const end = (status: 'done' | 'error', reason?: string) => {
    controls.delete(id);
    patch(id, notOver, u => ({ status, reason, loaded: status === 'done' ? u.size : u.loaded }));
  };
  return {
    id,
    progress: (loaded, total) => patch(id, u => u.status === 'active', u => ({ size: total ?? u.size, loaded: Math.min(loaded, total ?? u.size) })),
    done: () => end('done'),
    fail: reason => end('error', reason),
    get signal() {
      return c.ctrl.signal;
    },
    whenResumed: () => (c.cancelled || useUploads.getState().items.find(u => u.id === id)?.status !== 'paused' ? Promise.resolve() : new Promise(go => c.waiters.push(go))),
    get cancelled() {
      return c.cancelled;
    },
  };
}

/**
 * Stops the file where it is. Its share stays as it was until it goes again: the sender then says where it starts
 * from (what the server kept, over 6 Mo; 0 for a smaller file, sent again whole). The files after it in its batch wait.
 */
export function pauseUpload(id: string) {
  const c = controls.get(id);
  if (!c || useUploads.getState().items.find(u => u.id === id)?.status !== 'active') return;
  patch(id, u => u.status === 'active', () => ({ status: 'paused' }));
  c.ctrl.abort();
  c.ctrl = new AbortController();
}

export function resumeUpload(id: string) {
  patch(id, u => u.status === 'paused', () => ({ status: 'active' }));
  release(controls.get(id));
}

/** Stops the file and forgets it (it leaves the card); the next files of its batch go on. False when it was over already. */
export function cancelUpload(id: string) {
  const c = controls.get(id);
  if (!c) return false;
  controls.delete(id);
  c.cancelled = true;
  c.ctrl.abort();
  release(c);
  useUploads.setState(s => ({ items: s.items.filter(u => u.id !== id) }));
  settle();
  return true;
}

const ids = (only?: string[]) => only ?? useUploads.getState().items.map(u => u.id);
/** Every file, or those given (the card's). */
export const pauseAll = (only?: string[]) => ids(only).forEach(pauseUpload);
export const resumeAll = (only?: string[]) => ids(only).forEach(resumeUpload);
/** How many were cancelled. */
export const cancelAll = (only?: string[]) => ids(only).filter(cancelUpload).length;

/** The card's and the folder's ✕: cancelling cannot be undone, so no question first; a toast says it was done. */
export function cancelImports(only: string[]) {
  const n = only.filter(cancelUpload).length;
  if (n) toast(tn(n, 'Import annulé', '{n} imports annulés'));
}

/** A pause or a cancellation stopped the request: not a failure to show. */
export const isUploadAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

/**
 * One file of a sending loop: waits while it is paused, sends it with `send` (given the attempt's signal), calls it
 * again after a pause (it goes on from where it can). Cancelled (before, during, or just as it ended): `undo` takes
 * back what `send` stored (null: nothing complete, but an unfinished upload may be left to drop), and the result
 * is null. Other errors are thrown; the caller calls done() / fail().
 */
export async function sendUpload<T>(h: UploadHandle, send: (signal: AbortSignal) => Promise<T>, undo?: (result: T | null) => Promise<unknown>): Promise<T | null> {
  for (;;) {
    await h.whenResumed();
    patch(h.id, u => !!u.waiting, () => ({ waiting: false }));
    if (h.cancelled) {
      // Cancelled while paused: a resumable upload stopped earlier may be waiting on the server.
      await undo?.(null)?.catch(() => undefined);
      return null;
    }
    let result: T;
    try {
      result = await send(h.signal);
    } catch (e) {
      if (!isUploadAbort(e)) throw e;
      if (h.cancelled) {
        await undo?.(null)?.catch(() => undefined);
        return null;
      }
      continue; // paused: on again once resumed
    }
    if (h.cancelled) {
      await undo?.(result)?.catch(() => undefined);
      return null;
    }
    return result;
  }
}

export function dismissUploads() {
  clearTimeout(hideTimer);
  // Files still on their way (or paused) stay (their card comes back with them).
  useUploads.setState(s => ({ items: s.items.filter(notOver) }));
  settle();
}

/** What the card's header shows. `percent`: by bytes, by file count when no size is known. */
export function uploadSummary(items: Upload[]) {
  const failed = items.filter(u => u.status === 'error').length;
  const done = items.filter(u => u.status === 'done').length;
  const paused = items.filter(u => u.status === 'paused').length;
  const active = items.length - failed - done - paused;
  const counted = items.filter(u => u.status !== 'error');
  const size = counted.reduce((s, u) => s + u.size, 0);
  const ratio = size ? counted.reduce((s, u) => s + u.loaded, 0) / size : counted.length ? done / counted.length : 1;
  return { total: items.length, done, failed, active, paused, percent: Math.floor(ratio * 100) };
}
