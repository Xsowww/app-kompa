// File contents of the Drive: IndexedDB in local mode (localStorage is too small for files),
// Supabase Storage in cloud mode.

import { supabase } from './supabase';
import { abandonUpload, storageUpload } from './storageUpload';
import { t } from '../i18n';

const DB_NAME = 'cop-pilot';
const STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Limits also enforced by Supabase (bucket size limit and storage policy, see supabase/schema.sql). */
export const MAX_FILE = 50 * 1024 * 1024;
/** Space per account (Drive + group files), or null for no limit. Keep in step with storage_quota() in SQL. */
export const QUOTA: number | null = null; // personal use for now: to set before opening to the public (e.g. 50 Mo)
/**
 * Space shown in the Drive gauge: the per-account quota when there is one, otherwise the 1 GB of files that
 * Supabase's free plan gives the whole project (with one account today, that is the real ceiling).
 */
export const SPACE = QUOTA ?? 1024 * 1024 * 1024;
export const quotaLabel = () => (QUOTA ? t('{size} Mo', { size: Math.round(QUOTA / 1048576) }) : '');

/** A failure the student can act on: its message is meant to be shown as is. */
export class StorageError extends Error {}

/** Turns Supabase Storage's technical errors into something the student understands. */
export function storageError(e: { message?: string; statusCode?: string | number } | null): StorageError {
  const m = `${e?.statusCode ?? ''} ${e?.message ?? ''}`;
  if (/413|maximum allowed size|too large/i.test(m)) return new StorageError(t('Fichier trop lourd : 50 Mo maximum.'));
  if (/403|row-level security|unauthorized/i.test(m)) return new StorageError(QUOTA ? t('Plus de place : ton espace en ligne ({quota}) est plein. Vide la corbeille ou supprime des fichiers.', { quota: quotaLabel() }) : t('Plus de place : ton espace en ligne est plein. Vide la corbeille ou supprime des fichiers.'));
  return new StorageError(t('L’envoi a échoué. Vérifie ta connexion et réessaie.'));
}

/** Same error as an aborted upload (storageUpload): read by isUploadAbort() (store/uploads). */
const abortError = () => Object.assign(new Error('Upload aborted'), { name: 'AbortError' });

const local = {
  // Stored at once: a pause or a cancellation only stops the files not written yet.
  put: (key: string, blob: Blob, _onProgress?: (loaded: number) => void, signal?: AbortSignal) =>
    signal?.aborted
      ? Promise.reject(abortError())
      : run('readwrite', s => s.put(blob, key)).catch(() => {
          throw new StorageError(t('Le stockage du navigateur est plein : supprime des fichiers ou vide la corbeille.'));
        }),
  get: (key: string) => run<Blob | undefined>('readonly', s => s.get(key)),
  delete: (key: string) => run('readwrite', s => s.delete(key)),
  abandon: async (_key: string) => undefined,
};

// Cloud mode: files go to the private Supabase Storage bucket "drive", under "<userId>/<itemId>".
const BUCKET = 'drive';
const path = (key: string) => key.replace(':', '/');

const cloud = {
  async put(key: string, blob: Blob, onProgress?: (loaded: number) => void, signal?: AbortSignal) {
    const { error } = await storageUpload(BUCKET, path(key), blob, {
      upsert: true,
      // Share links are served through a cache: one minute instead of one hour, so a file put in
      // the trash stops being reachable through its links within a minute.
      cacheControl: '60',
    }, onProgress, signal);
    if (error) throw error.name === 'AbortError' ? error : storageError(error);
  },
  async get(key: string) {
    const { data, error } = await supabase!.storage.from(BUCKET).download(path(key));
    return error ? undefined : data;
  },
  async delete(key: string) {
    await supabase!.storage.from(BUCKET).remove([path(key)]);
  },
  abandon: (key: string) => abandonUpload(BUCKET, path(key)),
};

const backend = supabase ? cloud : local;

export const blobStore = {
  /**
   * `onProgress`: bytes sent so far (online only; in this browser it is stored at once). `signal`: stops it, with an
   * AbortError (nothing is left stored). Online, a file over 6 Mo stopped this way goes on from where it was at the
   * next put() of the same key and file (storageUpload).
   */
  put: (key: string, blob: Blob, onProgress?: (loaded: number) => void, signal?: AbortSignal) => backend.put(key, blob, onProgress, signal),
  /** A put() stopped for good (import cancelled): what the server kept of it is dropped. */
  abandon: (key: string) => backend.abandon(key),
  get: (key: string): Promise<Blob | undefined> => backend.get(key),
  delete: (key: string) => backend.delete(key),
  async copy(from: string, to: string) {
    if (supabase) {
      const { error } = await supabase.storage.from(BUCKET).copy(path(from), path(to));
      if (error) throw storageError(error);
      return;
    }
    const blob = await local.get(from);
    if (blob) await local.put(to, blob);
  },
  /**
   * Cloud: a file put in the trash moves to another place, so the share links made for it stop
   * working at once. Never fails (an old file may not be where expected).
   */
  async move(from: string, to: string) {
    if (supabase) await supabase.storage.from(BUCKET).move(path(from), path(to)).catch(() => undefined);
  },
  /** Cloud: every object under a folder of the bucket (account deletion). */
  async removeFolder(folder: string) {
    if (!supabase) return;
    for (const dir of [folder, `${folder}/trash`]) {
      for (;;) {
        const { data } = await supabase.storage.from(BUCKET).list(dir, { limit: 1000 });
        const files = (data ?? []).filter(o => o.id); // entries without id are sub-folders
        if (!files.length) break;
        const { error } = await supabase.storage.from(BUCKET).remove(files.map(o => `${dir}/${o.name}`));
        if (error) break;
      }
    }
  },
};
