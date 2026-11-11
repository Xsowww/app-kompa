// An account's copy on this device, wiped as the privacy policy says (« Retirer de cet appareil », signing out without
// « Rester connecté », account deleted): its saved stores (localStorage `cop:<id>:*`, this tab's too), the files kept in
// this browser (IndexedDB), the pictures and the text read from its files, and what was shared to Kompaly and not
// opened yet, its name in the notifications' memory. Before, only the localStorage keys went, and « Retirer de cet appareil » left everything (test n°3).

import { dropPendingStorage } from './userStorage';

/** Every key of a Storage (localStorage, sessionStorage), safely. */
const keysOf = (s: Storage) => {
  try {
    return Object.keys(s);
  } catch {
    return [];
  }
};

/** Runs `fn` on an object store of an IndexedDB database that already exists (never creates one). */
function inStore(db: string, store: string, fn: (s: IDBObjectStore) => void): Promise<void> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve();
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(db);
    } catch {
      return resolve();
    }
    req.onupgradeneeded = () => req.transaction?.abort(); // didn't exist: nothing to wipe, nothing created
    req.onerror = () => resolve();
    req.onsuccess = () => {
      const d = req.result;
      try {
        const tx = d.transaction(store, 'readwrite');
        fn(tx.objectStore(store));
        tx.oncomplete = tx.onerror = tx.onabort = () => (d.close(), resolve());
      } catch {
        d.close();
        resolve();
      }
    };
  });
}

/**
 * What the service worker keeps about this device's accounts for the notifications (public/sw.js: their first name
 * for « Compte Léa », the reminders already shown): this account taken out. Before, the first name and the id of a
 * deleted or removed account stayed there.
 */
export async function forgetInWorkerCache(userId: string, store: CacheStorage | undefined = globalThis.caches) {
  if (!store || !(await store.has('kompaly-meta'))) return;
  const cache = await store.open('kompaly-meta');
  for (const [path, of] of [
    ['/__kompaly/comptes', (x: { id?: string }) => x?.id],
    ['/__kompaly/vus', (x: { user?: string }) => x?.user],
  ] as const) {
    const list: unknown = await (await cache.match(path))?.json().catch(() => null);
    if (!Array.isArray(list) || !list.some(x => of(x) === userId)) continue;
    await cache.put(path, new Response(JSON.stringify(list.filter(x => of(x) !== userId)), { headers: { 'Content-Type': 'application/json' } }));
  }
}

/** The keys this account owns on this device (`keepUnsent`: not its changes still to send). */
export function accountKeys(keys: string[], userId: string, keepUnsent = false) {
  const prefix = `cop:${userId}:`;
  return keys.filter(k => k.startsWith(prefix) && !(keepUnsent && k.startsWith(`${prefix}sync-queue`)));
}

/**
 * Wipes the account's copy on this device. `keepUnsent`: its changes not sent yet stay (they leave at the next sign-in
 * here), nothing else. Never throws: what can't be reached (private browsing) is simply not there.
 */
export async function wipeAccountCopy(userId: string, { keepUnsent = false } = {}) {
  dropPendingStorage(userId);
  for (const s of [globalThis.localStorage, globalThis.sessionStorage]) {
    if (!s) continue;
    for (const k of accountKeys(keysOf(s), userId, keepUnsent)) s.removeItem(k);
  }
  await Promise.all([
    // Files kept in this browser (local mode, and files waiting to be sent): the account's ones.
    inStore('cop-pilot', 'blobs', s => s.delete(IDBKeyRange.bound(`${userId}:`, `${userId}:￿`))),
    // Small pictures of the files (keyed by file, not by account): all of them, made again when needed.
    inStore('kompaly-thumbs', 'thumbs', s => s.clear()),
    import('./textIndex').then(m => m.forgetTextIndex()),
    // Shared to Kompaly from another app and not opened yet.
    typeof caches !== 'undefined' ? caches.delete('kompaly-share') : undefined,
    // Its first name and the reminders shown, kept by the service worker for the notifications.
    forgetInWorkerCache(userId),
  ].map(p => Promise.resolve(p).catch(() => undefined)));
}
