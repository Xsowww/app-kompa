import { describe, expect, it, vi } from 'vitest';

// Two tabs changed the same note without network, then both were closed: each left its own queue on the device. The
// next start sends them: the later change must be the one that goes, whatever the order the queues are read in.
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
  document: { hidden: false, visibilityState: 'visible', addEventListener: noop, removeEventListener: noop },
  addEventListener: noop,
  removeEventListener: noop,
});
const sent: Record<string, unknown>[] = [];
const deleted: string[] = [];
const fake = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  from: () => ({ upsert: async (rows: Record<string, unknown>[]) => (sent.push(...rows), { error: null }), delete: () => ({ in: async (_c: string, ids: string[]) => (deleted.push(...ids), { error: null }) }) }),
  rpc: async () => ({ error: null }),
};
vi.mock('../src/lib/supabase', () => ({ supabase: fake, cloudEnabled: true }));
const { pushLeftovers, pendingCount, stopSync } = await import('../src/lib/cloudSync');

const note = (title: string, updated_at: string) => ({ id: 'n1', title, content: `<p>${title}</p>`, folder_id: null, pinned: false, links: [], created_at: '2026-11-10T08:00:00.000Z', updated_at, deleted_at: null });
const queue = (notes: unknown[], deletes: string[] = []) => JSON.stringify({ tables: { notes: { upserts: notes, deletes } }, profileKeys: [] });

describe('deux onglets fermés avant l’envoi', () => {
  for (const order of ['le plus récent lu en premier', 'le plus récent lu en dernier']) {
    it(`le dernier changement part (${order}), une seule fois, et les files sont vidées`, async () => {
      memory.clear();
      sent.length = 0;
      const older = queue([note('Ancien texte', '2026-11-11T10:00:00.000Z')]);
      const newer = queue([note('Nouveau texte', '2026-11-11T10:05:00.000Z')]);
      memory.set('cop:u1:sync-queue:aaaa', order.endsWith('premier') ? newer : older);
      memory.set('cop:u1:sync-queue:bbbb', order.endsWith('premier') ? older : newer);
      memory.set('cop:u2:sync-queue:cccc', queue([{ ...note('Autre compte', '2026-11-11T11:00:00.000Z'), id: 'n2' }]));
      await pushLeftovers('u1');
      expect(sent.map(r => r.title)).toEqual(['Nouveau texte']);
      expect(pendingCount()).toBe(0);
      stopSync();
      expect([...memory.keys()]).toEqual(['cop:u2:sync-queue:cccc']); // another account's changes wait for it
    });
  }
});
