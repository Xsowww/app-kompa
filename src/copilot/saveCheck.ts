// Did what Kompaly just wrote really reach the server? The stores save on the device at once and send in the
// background (lib/cloudSync): a row the database refuses (test n°3: nights refused by events_series_check) stayed on
// this device only while Kompaly said « ajouté ». Before the AI is told « done », the changes are sent now and read
// back from the server, by id. Local mode (no account): the device is where everything is kept, nothing more to check.

import { supabase } from '../lib/supabase';
import { useAuth } from '../store/auth';

export type SavedTable = 'events' | 'todos' | 'notes';

export interface SaveCheck {
  /** Everything asked is on the server (or kept on the device in local mode). */
  ok: boolean;
  /** No network: kept on this device, sent when it comes back (not refused). */
  offline?: boolean;
  /** Ids the server doesn't have after the send: refused. */
  missing?: string[];
}

const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<'timeout'>(r => setTimeout(() => r('timeout'), ms))]);

/** Sends what waits, then reads these rows back. Never throws. */
export async function confirmSaved(table: SavedTable, ids: string[], ms = 8000): Promise<SaveCheck> {
  // Nobody signed in: nothing is sent anywhere, the device is where it is kept.
  if (!supabase || !ids.length || !useAuth.getState().user?.id) return { ok: true };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, offline: true };
  try {
    const { flushNow } = await import('../lib/cloudSync');
    if ((await timeout(flushNow(), ms)) === 'timeout') return { ok: false, offline: true };
    const found = new Set<string>();
    // By 100: a long repeat makes an address too long for one request.
    for (let i = 0; i < ids.length; i += 100) {
      const res = await timeout(Promise.resolve(supabase.from(table).select('id').in('id', ids.slice(i, i + 100))), ms);
      if (res === 'timeout' || res.error) return { ok: false, offline: true };
      for (const r of (res.data ?? []) as { id: string }[]) found.add(r.id);
    }
    const missing = ids.filter(id => !found.has(id));
    return missing.length ? { ok: false, missing } : { ok: true };
  } catch {
    return { ok: false, offline: true };
  }
}
