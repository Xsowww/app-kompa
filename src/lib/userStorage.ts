import type { PersistStorage } from 'zustand/middleware';
import { useUi } from '../store/ui';
import { cloudEnabled } from './supabase';
import { t } from '../i18n';

// Every data store is persisted under a key prefixed by the signed-in user's id,
// so each account on this browser has its own Drive, calendar and notes.

let currentUserId: string | null = null;

export function setStorageUser(id: string | null) {
  if (id !== currentUserId) flushStorage(); // what the previous account changed goes under its own keys
  currentUserId = id;
}

export function getStorageUser() {
  return currentUserId;
}

// Saves are grouped: a store changes many times in a row (each key typed in a note, a sync bringing
// hundreds of rows), and writing it whole each time (the notes can weigh megabytes) made the page lag.
// The latest state is kept here and written a moment later, or at once when the page is left.
const pending = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | undefined;
const keyOf = (name: string) => `cop:${currentUserId}:${name}`;

/** Writes the saves still waiting (the page is being left, the account changes…). */
export function flushStorage() {
  clearTimeout(timer);
  timer = undefined;
  for (const [key, value] of pending) {
    const name = key.slice(key.indexOf(':', 4) + 1);
    try {
      localStorage.setItem(key, JSON.stringify(value));
      failing.delete(name);
    } catch {
      // Browser storage full (usually many images pasted in notes). Without this, the error
      // would surface in whatever action changed the store and break it halfway.
      failing.add(name);
      warnFull();
    }
  }
  pending.clear();
}

/** An account's data removed from this device: its saves still waiting must not bring it back. */
export function dropPendingStorage(userId: string) {
  for (const key of [...pending.keys()]) if (key.startsWith(`cop:${userId}:`)) pending.delete(key);
}

if (typeof window !== 'undefined') {
  addEventListener('pagehide', flushStorage);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushStorage());
}

export const userStorage: PersistStorage<unknown> = {
  getItem: name => {
    if (!currentUserId) return null;
    const key = keyOf(name);
    if (pending.has(key)) return pending.get(key) as ReturnType<PersistStorage<unknown>['getItem']>;
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (!currentUserId) return;
    pending.set(keyOf(name), value);
    timer ??= setTimeout(flushStorage, 400);
  },
  removeItem: name => {
    if (!currentUserId) return;
    pending.delete(keyOf(name));
    localStorage.removeItem(keyOf(name));
  },
};

// Stores whose last save failed (a small store saved fine meanwhile doesn't mean the notes are).
const failing = new Set<string>();
let warnedAt = 0;
/** Local mode: a store could not be saved (browser storage full), so what changes now is lost at the next visit. */
export const localSavesFailing = () => failing.size > 0 && !cloudEnabled;

function warnFull() {
  // Online nothing is lost: once is enough. Local mode: again while saves keep failing (each key typed
  // fails, hence at most every 20 s), or the changes made after the first message are lost silently.
  if (warnedAt && (cloudEnabled || Date.now() - warnedAt < 20_000)) return;
  warnedAt = Date.now();
  useUi.getState().toast(
    cloudEnabled
      ? t('Mémoire du navigateur pleine : tout reste enregistré en ligne, mais plus hors ligne sur cet appareil. Allège les images de tes notes.')
      : t('Mémoire du navigateur pleine : tes dernières modifications ne sont pas enregistrées. Retire des images de tes notes ou exporte une sauvegarde.'),
    'error',
  );
}

export function blobKey(itemId: string) {
  return `${currentUserId}:${itemId}`;
}

/** Where a Drive file's content goes while the file is in the trash (cloud mode). */
export function trashBlobKey(itemId: string) {
  return `${currentUserId}:trash/${itemId}`;
}
