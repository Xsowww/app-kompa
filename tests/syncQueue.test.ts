import { describe, expect, it, vi } from 'vitest';

// The queue of changes to send, mirrored on the device: written once after a burst of changes (not at each one), and
// a copy of the same thing (field by field) is not sent again.
const memory = new Map<string, string>();
const writes: string[] = [];
const noop = () => undefined;
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => (writes.push(k), memory.set(k, v)),
    removeItem: (k: string) => memory.delete(k),
  },
  window: globalThis,
  document: { hidden: false, visibilityState: 'visible', addEventListener: noop, removeEventListener: noop },
  addEventListener: noop,
  removeEventListener: noop,
});
const sent: Record<string, unknown>[] = [];
const fake = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  from: () => ({ upsert: async (rows: Record<string, unknown>[]) => (sent.push(...rows), { error: null }), delete: () => ({ in: async () => ({ error: null }) }), select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  rpc: async () => ({ error: null }),
};
vi.mock('../src/lib/supabase', () => ({ supabase: fake, cloudEnabled: true }));
const { useNotes } = await import('../src/store/notes');
const { startSync, pendingCount } = await import('../src/lib/cloudSync');

describe('file d’envoi', () => {
  it('30 enregistrements d’une grosse note : la file est écrite une fois, la note envoyée une fois', async () => {
    vi.useFakeTimers();
    startSync('u1');
    const big = `<p>${'x'.repeat(200_000)}</p>`;
    const n = useNotes.getState().createNote({ title: 'Grosse', content: big });
    for (let i = 0; i < 30; i++) useNotes.getState().updateNote(n.id, { content: big + i });
    const queueWrites = () => writes.filter(k => k.startsWith('cop:u1:sync-queue')).length;
    expect(queueWrites()).toBe(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(queueWrites()).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent.filter(r => r.id === n.id)).toHaveLength(1);
    expect(pendingCount()).toBe(0);
    vi.useRealTimers();
  });

  it('une copie identique (rechargée) n’est pas renvoyée, un vrai changement l’est', async () => {
    vi.useFakeTimers();
    sent.length = 0;
    const [n] = useNotes.getState().notes;
    useNotes.setState(s => ({ notes: s.notes.map(x => ({ ...x, links: x.links ? [...x.links] : undefined })) }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveLength(0);
    useNotes.getState().updateNote(n.id, { title: 'Autre' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent.map(r => r.title)).toEqual(['Autre']);
    vi.useRealTimers();
  });
});
