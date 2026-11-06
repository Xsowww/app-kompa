// Shared calendars, notes and files: a deletion waits for the end of its « Supprimé · Annuler » toast (about 6 s) before
// leaving for the server. Reloading or closing the page during those seconds lost it (test n°3, Julie and Sofia): the
// event came back. Now the deletion is written on this device at once; leaving the page sends it (a request the
// browser finishes after the page is gone), and the next start sends what is left. « Annuler » takes it back.

import { authStorageKey, supabase } from './supabase';
import { getStorageUser } from './userStorage';

export type SharedTable = 'group_events' | 'group_notes' | 'group_files';

export interface WaitingDelete {
  key: string;
  table: SharedTable;
  ids: string[];
  /** Files of the shared storage to remove with the rows (group files). */
  paths?: string[];
}

const KEY = 'deletes-waiting';
const storeKey = (user: string) => `cop:${user}:${KEY}`;

function read(user: string | null): WaitingDelete[] {
  if (!user) return [];
  try {
    const list = JSON.parse(localStorage.getItem(storeKey(user)) ?? '[]');
    return Array.isArray(list) ? list.filter(x => x && typeof x.key === 'string' && Array.isArray(x.ids)) : [];
  } catch {
    return [];
  }
}

function write(user: string, list: WaitingDelete[]) {
  try {
    if (list.length) localStorage.setItem(storeKey(user), JSON.stringify(list));
    else localStorage.removeItem(storeKey(user));
  } catch {
    /* storage full or blocked: the toast's timer and leaving the page still send it */
  }
}

/** A deletion decided, still undoable: kept on this device until sent or undone. Returns its key. */
export function rememberDelete(d: Omit<WaitingDelete, 'key'>): string {
  const user = getStorageUser();
  const key = Math.random().toString(36).slice(2, 10);
  if (user && supabase) write(user, [...read(user), { ...d, key }]);
  return key;
}

/** Sent (or undone): forgotten. */
export function forgetDelete(key: string) {
  const user = getStorageUser();
  if (!user) return;
  const list = read(user);
  if (list.some(x => x.key === key)) write(user, list.filter(x => x.key !== key));
}

/** The access token kept by Supabase (read without waiting: the page is closing). */
function token(): string | null {
  try {
    const raw = localStorage.getItem(authStorageKey) ?? sessionStorage.getItem(authStorageKey);
    return raw ? ((JSON.parse(raw) as { access_token?: string }).access_token ?? null) : null;
  } catch {
    return null;
  }
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * The page is being left: one request per deletion that the browser carries on after the page is gone (`keepalive`).
 * They stay written here: the next start sends them again (deleting twice changes nothing).
 */
export function sendOnLeave(keys: string[]) {
  const user = getStorageUser();
  const access = token();
  if (!user || !url || !anon || !access) return;
  for (const d of read(user).filter(x => keys.includes(x.key))) {
    const ids = d.ids.filter(id => /^[0-9a-f-]{36}$/i.test(id));
    if (!ids.length) continue;
    void fetch(`${url}/rest/v1/${d.table}?id=in.(${ids.join(',')})`, { method: 'DELETE', keepalive: true, headers: { apikey: anon, Authorization: `Bearer ${access}` } }).catch(() => undefined);
  }
}

/** At start: the deletions a closed or reloaded page left behind go to the server now. */
export async function sendLeftDeletes(user: string) {
  if (!supabase) return;
  for (const d of read(user)) {
    const { error } = await supabase.from(d.table).delete().in('id', d.ids);
    if (error && !/^(22|23|42|PGRST)/.test(error.code ?? '')) continue; // network: next start
    if (!error && d.paths?.length) await supabase.storage.from('groups').remove(d.paths);
    if (getStorageUser() === user) write(user, read(user).filter(x => x.key !== d.key));
  }
}
