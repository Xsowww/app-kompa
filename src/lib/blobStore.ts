// File contents of the Drive: IndexedDB in local mode (localStorage is too small for files),
// Supabase Storage in cloud mode.

import { supabase } from './supabase';
import { abandonUpload, storageUpload } from './storageUpload';
import { formatBytes } from './utils';
import { t } from '../i18n';

const DB_NAME = 'cop-pilot';
const STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        // Closed by the browser (site data cleared…): opened again at the next call.
        req.result.onclose = () => (dbPromise = null);
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    }).catch(e => {
      dbPromise = null; // a refusal (private browsing, a moment of trouble) is not kept forever
      throw e;
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
        // Done once written for good: a full disk often refuses the file only then (the transaction aborts).
        tx.oncomplete = () => resolve(req.result);
        tx.onabort = tx.onerror = () => reject(tx.error ?? req.error);
      }),
  );
}

/**
 * What to tell the student when this browser could not store a file: only a full storage says « plein »;
 * storage refused (private browsing, blocked site data) or another trouble get their own words.
 */
export function localSaveError(e: unknown): StorageError {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (name === 'QuotaExceededError') return Object.assign(new StorageError(t('Le stockage du navigateur est plein : supprime des fichiers ou vide la corbeille.')), { reason: t('Plus de place') });
  if (name === 'SecurityError' || name === 'InvalidAccessError')
    return Object.assign(new StorageError(t('Ce navigateur refuse d’enregistrer des fichiers (navigation privée ou données de site bloquées).')), { reason: t('Stockage refusé') });
  return Object.assign(new StorageError(t('Le fichier n’a pas pu être enregistré dans ce navigateur. Réessaie ; si ça continue, recharge la page.')), { reason: t('Échec de l’enregistrement') });
}

/** Limits also enforced by Supabase (bucket size limit and storage policy, see supabase/schema.sql). */
export const MAX_FILE = 50 * 1000 * 1000; // « 50 Mo » as shown (decimal, formatBytes); Supabase allows a little more
/**
 * Space per account (Drive and its trash + files sent to groups), or null for no limit: 500 Mo, half of the 1 GB the
 * owner counts per user. Keep in step with storage_quota() in SQL (supabase/migrations/2026-11-12_stockage_500_mo.sql).
 */
export const QUOTA: number | null = 500 * 1000 * 1000;
/**
 * Space shown in the Drive gauge: the per-account quota when there is one, otherwise the 1 GB of files that
 * Supabase's free plan gives the whole project. Decimal, like every size shown (formatBytes):
 * « 25 Mo utilisés sur 500 Mo · 475 Mo libres ».
 */
export const SPACE = QUOTA ?? 1000 * 1000 * 1000;
export const quotaLabel = () => (QUOTA ? t('{size} Mo', { size: Math.round(QUOTA / 1e6) }) : '');

/** A failure the student can act on: its message is meant to be shown as is. */
export class StorageError extends Error {}

/** What would not fit in the account's space: how much is used, the limit, and what frees room (the trash counts). */
export const quotaError = (used: number) =>
  Object.assign(new StorageError(t('Plus assez de place : tu utilises {used} sur {total}. Supprime des fichiers puis vide la corbeille.', { used: formatBytes(used), total: formatBytes(QUOTA ?? 0) })), { reason: t('Plus de place') });

/** Turns Supabase Storage's technical errors into something the student understands (`reason`: in a few words, for the upload card). */
export function storageError(e: { message?: string; statusCode?: string | number } | null): StorageError {
  const m = `${e?.statusCode ?? ''} ${e?.message ?? ''}`;
  if (/413|maximum allowed size|too large/i.test(m)) return Object.assign(new StorageError(t('Fichier trop lourd : 50 Mo au maximum.')), { reason: t('Plus de 50 Mo') });
  if (/403|row-level security|unauthorized/i.test(m))
    return Object.assign(new StorageError(QUOTA ? t('Plus de place : ton espace en ligne ({quota}) est plein. Vide la corbeille ou supprime des fichiers.', { quota: quotaLabel() }) : t('Plus de place : ton espace en ligne est plein. Vide la corbeille ou supprime des fichiers.')), { reason: t('Plus de place') });
  return new StorageError(t('L’envoi a échoué. Vérifie ta connexion et réessaie.'));
}

/** Same error as an aborted upload (storageUpload): read by isUploadAbort() (store/uploads). */
const abortError = () => Object.assign(new Error('Upload aborted'), { name: 'AbortError' });

const local = {
  // Stored at once: a pause or a cancellation only stops the files not written yet.
  put: (key: string, blob: Blob, _onProgress?: (loaded: number) => void, signal?: AbortSignal) =>
    signal?.aborted
      ? Promise.reject(abortError())
      : run('readwrite', s => s.put(blob, key)).catch(e => {
          throw localSaveError(e);
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
  /**
   * Cloud: every object under a folder of the bucket (data wiped, account deleted). False when the list or a removal
   * failed (network): files are still there. Before, it stopped without a word: « Données effacées » or the account
   * deleted, with files left online for good.
   */
  async removeFolder(folder: string): Promise<boolean> {
    if (!supabase) return true;
    for (const dir of [folder, `${folder}/trash`]) {
      for (;;) {
        const { data, error: unread } = await supabase.storage.from(BUCKET).list(dir, { limit: 1000 });
        if (unread) return false;
        const files = (data ?? []).filter(o => o.id); // entries without id are sub-folders
        if (!files.length) break;
        const { error } = await supabase.storage.from(BUCKET).remove(files.map(o => `${dir}/${o.name}`));
        if (error) return false;
      }
    }
    return true;
  },
};
