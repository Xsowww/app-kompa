import { beforeEach, describe, expect, it, vi } from 'vitest';

// Light refresh (what changed on the other devices): one request (sync_changes, migration 2026-11-07b) instead of 8;
// a server without it is asked table by table, as before.
const memory = new Map<string, string>();
const noop = () => undefined;
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
  window: globalThis,
  document: { hidden: false, visibilityState: 'visible', addEventListener: noop, removeEventListener: noop },
  addEventListener: noop,
  removeEventListener: noop,
});

const calls: string[] = [];
let hasRpc = true;
const row = { id: 'e1', title: 'Garde de nuit', date: '2026-11-20', start_time: '22:00', end_time: '23:59', category: 'perso', done: false, series: 'span-abc', created_at: '2026-11-06T10:00:00Z', deleted_at: null, synced_at: '2026-11-06T21:00:00.123+00:00' };
const query = (table: string) => {
  const q = {
    select: () => q,
    gt: () => q,
    eq: () => q,
    order: () => q,
    limit: async () => (calls.push(`select ${table}`), { data: table === 'events' ? [row] : [], error: null }),
    maybeSingle: async () => (calls.push(`select ${table}`), { data: { name: 'Léa', onboarded: true }, error: null }),
  };
  return q;
};
const fake = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  from: (table: string) => query(table),
  rpc: async (name: string) => {
    calls.push(`rpc ${name}`);
    if (!hasRpc) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.sync_changes' } };
    return { data: { events: [row], note_folders: [], notes: [], drive_items: [], todos: [], focus_sessions: [], gone: [], profile: { name: 'Léa', onboarded: true } }, error: null };
  },
};
vi.mock('../src/lib/supabase', () => ({ supabase: fake, cloudEnabled: true }));
const { setStorageUser, userStorage, SYNC_CURSOR } = await import('../src/lib/userStorage');
const { useCalendar } = await import('../src/store/calendar');
const { pullAll } = await import('../src/lib/cloudSync');

beforeEach(() => {
  calls.length = 0;
  setStorageUser('u1');
  userStorage.setItem(SYNC_CURSOR, { state: { at: Date.now() - 60_000, full: Date.now() - 60_000 }, version: 0 });
  useCalendar.setState({ events: [], trash: [] });
});

describe('rafraîchissement léger groupé', () => {
  it('une seule requête quand le serveur a sync_changes', async () => {
    expect(await pullAll('u1')).toEqual({ name: 'Léa', onboarded: true });
    expect(calls).toEqual(['rpc sync_changes']);
    expect(useCalendar.getState().events.map(e => [e.title, e.series])).toEqual([['Garde de nuit', 'span-abc']]);
  });

  it('sans la fonction : table par table, comme avant', async () => {
    hasRpc = false;
    await pullAll('u1');
    expect(calls[0]).toBe('rpc sync_changes');
    expect(calls.slice(1).sort()).toEqual(['select drive_items', 'select events', 'select focus_sessions', 'select note_folders', 'select notes', 'select profiles', 'select sync_deletions', 'select todos']);
    expect(useCalendar.getState().events).toHaveLength(1);
    calls.length = 0;
    userStorage.setItem(SYNC_CURSOR, { state: { at: Date.now() - 60_000, full: Date.now() - 60_000 }, version: 0 });
    await pullAll('u1');
    expect(calls).not.toContain('rpc sync_changes'); // asked once only
  });
});
