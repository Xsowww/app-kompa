// Did what Kompaly just wrote really reach the server? The stores save on the device at once and send in the
// background (lib/cloudSync): a row the database refused (test n°3: nights refused by events_series_check) stayed on
// this device only while Kompaly said « ajouté ». Before the AI is told « done », the changes are sent now and the
// sync says what became of them (cloudSync › whenSaved). Local mode (no account): the device is where it is kept.

import { supabase } from '../lib/supabase';
import { useAuth } from '../store/auth';

export type SavedTable = 'events' | 'todos' | 'notes';

export interface SaveCheck {
  /** Everything asked is on the server (or kept on the device in local mode). */
  ok: boolean;
  /** No network: kept on this device, sent when it comes back (not refused). */
  offline?: boolean;
  /** Ids the server refused, and why (in the person's words). */
  missing?: string[];
  why?: string;
}

/** Sends what waits, then says what became of these rows. Never throws. */
export async function confirmSaved(table: SavedTable, ids: string[], ms = 8000): Promise<SaveCheck> {
  // Nobody signed in: nothing is sent anywhere, the device is where it is kept.
  if (!supabase || !ids.length || !useAuth.getState().user?.id) return { ok: true };
  try {
    const { whenSaved } = await import('../lib/cloudSync');
    const r = await whenSaved(table, ids, ms);
    if (r.state === 'saved' || r.state === 'local') return { ok: true };
    if (r.state === 'waiting') return { ok: false, offline: true };
    return { ok: false, missing: ids, why: r.why };
  } catch {
    return { ok: false, offline: true };
  }
}

/** « Réessayer l'enregistrement »: what the server refused is sent again (cloudSync keeps it). */
export async function retrySaving() {
  if (!supabase) return;
  const { retryRefused } = await import('../lib/cloudSync');
  await retryRefused();
}
