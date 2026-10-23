type Row = Record<string, unknown>;

/**
 * Puts the changed rows in place of the old ones and takes out the deleted ones.
 * A row deleted and then saved again (or the other way round) in the same window: the later one wins.
 */
export function mergeRows<T extends { id: string }>(lists: T[][], rows: Row[], gone: Map<string, number>, toApp: (r: Row) => T, trashed: (r: Row) => boolean) {
  const changed = new Map<string, Row>();
  for (const r of rows) {
    const at = gone.get(r.id as string);
    if (at == null || (Date.parse(String(r.synced_at)) || 0) > at) changed.set(r.id as string, r);
  }
  const out = lists.map(l => l.filter(x => !changed.has(x.id) && !gone.has(x.id)));
  for (const r of changed.values()) out[lists.length > 1 && trashed(r) ? 1 : 0].push(toApp(r));
  return out;
}
