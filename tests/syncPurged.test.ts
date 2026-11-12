import { beforeEach, describe, expect, it, vi } from 'vitest';

// A thing deleted for good on one device, then changed on another before it knew (offline): the change was sent as a
// whole row and the server created the thing again, everywhere. Now a change to a row the server deleted is dropped.
const memory = new Map<string, string>();
const noop = () => undefined;
const storage = new Proxy(
  { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) },
  { ownKeys: t => [...Reflect.ownKeys(t), ...memory.keys()], getOwnPropertyDescriptor: (t, k) => (typeof k === 'string' && memory.has(k) ? { enumerable: true, configurable: true, value: memory.get(k) } : Reflect.getOwnPropertyDescriptor(t, k)) },
);
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: storage,
  window: globalThis,
  document: { hidden: false, addEventListener: noop, removeEventListener: noop },
  addEventListener: noop,
  removeEventListener: noop,
});

type Row = Record<string, unknown>;
const sent: Row[] = [];
let tombstones: Row[] = [];
let onServer: string[] = [];
let migrated = true; // false: a server without sync_deletions
const fake = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  from: (table: string) => ({
    upsert: async (rows: Row | Row[]) => {
      sent.push(...(Array.isArray(rows) ? rows : [rows]));
      return { error: null };
    },
    delete: () => ({ in: async () => ({ error: null }) }),
    select: () => ({
      in: async (_col: string, ids: string[]) => {
        if (table !== 'sync_deletions') return { data: onServer.filter(id => ids.includes(id)).map(id => ({ id })), error: null };
        if (!migrated) return { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } };
        return { data: tombstones.filter(g => ids.includes(g.row_id as string)), error: null };
      },
    }),
  }),
  rpc: async () => ({ error: null }),
};
vi.mock('../src/lib/supabase', () => ({ supabase: fake, cloudEnabled: true }));

const { useTodos } = await import('../src/store/todos');
const { useUi } = await import('../src/store/ui');
const { startSync, stopSync, flushNow, pendingCount, pushLeftovers } = await import('../src/lib/cloudSync');

const old = { id: 'a1', title: 'Ancienne', done: false, createdAt: '2026-11-01T08:00:00.000Z' };
const gone = (id: string) => ({ tbl: 'todos', row_id: id, deleted_at: '2026-11-10T08:00:00.000Z' });

beforeEach(() => {
  stopSync();
  memory.clear();
  sent.length = 0;
  tombstones = [];
  onServer = [];
  migrated = true;
  useTodos.setState({ todos: [old], trash: [] }); // this device's copy, as downloaded earlier
  useUi.setState({ toasts: [] });
  startSync('u1');
});

describe('supprimé pour de bon ailleurs, puis modifié ici hors ligne', () => {
  it('ne revient pas : la modification n’est pas envoyée et l’élément quitte cet appareil, avec un mot', async () => {
    tombstones = [gone('a1')];
    useTodos.getState().update('a1', { title: 'Modifiée hors ligne' });
    expect(pendingCount()).toBe(1);
    expect(await flushNow()).toBe(true);
    expect(sent).toHaveLength(0);
    expect(useTodos.getState().todos).toHaveLength(0);
    expect(pendingCount()).toBe(0);
    expect(useUi.getState().toasts.map(x => x.text).join()).toContain('supprimé sur un autre appareil');
  });

  it('la modification attend dans la file d’une visite à l’autre (onglet fermé hors ligne) : toujours pas renvoyée', async () => {
    tombstones = [gone('a1')];
    useTodos.getState().update('a1', { title: 'Modifiée hors ligne' });
    stopSync(); // tab closed: the queue is saved
    await pushLeftovers('u1');
    expect(sent).toHaveLength(0);
    expect(useTodos.getState().todos).toHaveLength(0);
  });

  it('un élément toujours en ligne part comme avant, les autres aussi', async () => {
    useTodos.getState().update('a1', { title: 'Modifiée' });
    const made = useTodos.getState().add('Nouvelle');
    expect(await flushNow()).toBe(true);
    expect(sent.map(r => r.id).sort()).toEqual(['a1', made.id].sort());
    expect(useTodos.getState().todos).toHaveLength(2);
  });

  it('recréé depuis (sauvegarde restaurée ailleurs) : il est en ligne, la modification part', async () => {
    tombstones = [gone('a1')];
    onServer = ['a1'];
    useTodos.getState().update('a1', { title: 'Modifiée' });
    await flushNow();
    expect(sent.map(r => r.title)).toEqual(['Modifiée']);
    expect(useTodos.getState().todos).toHaveLength(1);
  });

  it('ce qui est créé ou restauré ici (sauvegarde importée) part, même si son identifiant a été supprimé avant', async () => {
    tombstones = [gone('a1'), gone('b2')];
    useTodos.setState({ todos: [] }); // deleted for good here…
    useTodos.setState({ todos: [old, { ...old, id: 'b2', title: 'Restaurée' }] }); // …then restored from a backup
    useTodos.getState().update('b2', { title: 'Restaurée, modifiée' }); // changed before it was sent: still a creation
    await flushNow();
    expect(sent.map(r => r.id).sort()).toEqual(['a1', 'b2']);
    expect(useTodos.getState().todos).toHaveLength(2);
  });

  it('serveur sans la table des suppressions : rien n’est vérifié, comme avant', async () => {
    migrated = false;
    useTodos.getState().update('a1', { title: 'Modifiée' });
    expect(await flushNow()).toBe(true);
    expect(sent).toHaveLength(1);
  });
});
