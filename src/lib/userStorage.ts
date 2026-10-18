import { createJSONStorage } from 'zustand/middleware';
import { useUi } from '../store/ui';
import { cloudEnabled } from './supabase';

// Every data store is persisted under a key prefixed by the signed-in user's id,
// so each account on this browser has its own Drive, calendar and notes.

let currentUserId: string | null = null;

export function setStorageUser(id: string | null) {
  currentUserId = id;
}

export function getStorageUser() {
  return currentUserId;
}

export const userStorage = createJSONStorage(() => ({
  getItem: (name: string) => (currentUserId ? localStorage.getItem(`cop:${currentUserId}:${name}`) : null),
  setItem: (name: string, value: string) => {
    if (!currentUserId) return;
    try {
      localStorage.setItem(`cop:${currentUserId}:${name}`, value);
      failing.delete(name);
    } catch {
      // Browser storage full (usually many images pasted in notes). Without this, the error
      // would surface in whatever action changed the store and break it halfway.
      failing.add(name);
      warnFull();
    }
  },
  removeItem: (name: string) => {
    if (currentUserId) localStorage.removeItem(`cop:${currentUserId}:${name}`);
  },
}));

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
      ? 'Mémoire du navigateur pleine : tout reste enregistré en ligne, mais plus hors ligne sur cet appareil. Allège les images de tes notes.'
      : 'Mémoire du navigateur pleine : tes dernières modifications ne sont pas enregistrées. Retire des images de tes notes ou exporte une sauvegarde.',
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
