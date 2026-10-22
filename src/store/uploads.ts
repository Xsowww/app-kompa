import { create } from 'zustand';

// Files being sent (Drive, groups…): one card shows them wherever the student is. Not persisted.

export type UploadStatus = 'active' | 'done' | 'error';

export interface Upload {
  id: string;
  name: string;
  /** Bytes (0 while unknown). */
  size: number;
  loaded: number;
  status: UploadStatus;
  /** Where it goes: `drive:<folderId|root>` or `group:<groupId>`. */
  where?: string;
}

export interface UploadHandle {
  /** Bytes sent so far; `total` when the size was not known at the start. */
  progress(loaded: number, total?: number): void;
  done(): void;
  fail(): void;
}

export const useUploads = create<{ items: Upload[] }>(() => ({ items: [] }));

/** A card that went well disappears by itself after this long. */
export const HIDE_AFTER = 4000;

let seq = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let warning = false;
// Closing the tab mid-upload loses the files not stored yet: the browser asks first.
const warnUnload = (e: BeforeUnloadEvent) => e.preventDefault();

export const driveWhere = (folderId: string | null) => `drive:${folderId ?? 'root'}`;

function settle() {
  const { items } = useUploads.getState();
  const active = items.some(u => u.status === 'active');
  if (active !== warning) {
    warning = active;
    globalThis[active ? 'addEventListener' : 'removeEventListener']?.('beforeunload', warnUnload);
  }
  clearTimeout(hideTimer);
  if (!active && items.length && items.every(u => u.status === 'done')) hideTimer = setTimeout(dismissUploads, HIDE_AFTER);
}

function patch(id: string, fn: (u: Upload) => Partial<Upload>) {
  useUploads.setState(s => ({ items: s.items.map(u => (u.id === id && u.status === 'active' ? { ...u, ...fn(u) } : u)) }));
  settle();
}

/** Shows a file on the card; call done() or fail() when it is over (later calls are ignored). */
export function trackUpload(name: string, size: number, where?: string): UploadHandle {
  const { items } = useUploads.getState();
  // A new import once the previous one is over: the card starts afresh.
  const keep = items.some(u => u.status === 'active') ? items : [];
  const id = `u${++seq}`;
  useUploads.setState({ items: [...keep, { id, name, size, loaded: 0, status: 'active', where }] });
  settle();
  return {
    progress: (loaded, total) => patch(id, u => ({ size: total ?? u.size, loaded: Math.min(loaded, total ?? u.size) })),
    done: () => patch(id, u => ({ status: 'done', loaded: u.size })),
    fail: () => patch(id, () => ({ status: 'error' })),
  };
}

export function dismissUploads() {
  clearTimeout(hideTimer);
  // Files still on their way stay (their card comes back with them).
  useUploads.setState(s => ({ items: s.items.filter(u => u.status === 'active') }));
  settle();
}

/** What the card's header shows. `percent`: by bytes, by file count when no size is known. */
export function uploadSummary(items: Upload[]) {
  const failed = items.filter(u => u.status === 'error').length;
  const done = items.filter(u => u.status === 'done').length;
  const active = items.length - failed - done;
  const counted = items.filter(u => u.status !== 'error');
  const size = counted.reduce((s, u) => s + u.size, 0);
  const ratio = size ? counted.reduce((s, u) => s + u.loaded, 0) / size : counted.length ? done / counted.length : 1;
  return { total: items.length, done, failed, active, percent: Math.floor(ratio * 100) };
}
