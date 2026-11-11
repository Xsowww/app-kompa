import { describe, expect, it, vi } from 'vitest';

// Without network, a change waits and is tried again every 8 s. Before, while the « Hors ligne » banner showed, it was
// tried again every 0,7 s (and without a pause by whoever waited for it): hundreds of failed requests a minute.
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
let online = false;
let tries = 0;
const sent: Record<string, unknown>[] = [];
const fake = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  from: () => ({
    upsert: async (rows: Record<string, unknown>[]) => {
      tries++;
      if (!online) throw new TypeError('Failed to fetch');
      sent.push(...rows);
      return { error: null };
    },
    delete: () => ({ in: async () => ({ error: null }) }),
  }),
  rpc: async () => ({ error: null }),
};
vi.mock('../src/lib/supabase', () => ({ supabase: fake, cloudEnabled: true }));
// The banner already says it (two requests failed): no « Synchronisation impossible » toast on top.
vi.mock('../src/lib/serviceStatus', () => ({ troubled: () => !online }));
vi.spyOn(console, 'error').mockImplementation(noop);
const { useTodos } = await import('../src/store/todos');
const { startSync, pendingCount, whenSaved } = await import('../src/lib/cloudSync');

describe('hors ligne', () => {
  it('un changement attend : un essai toutes les 8 s, pas une rafale', async () => {
    vi.useFakeTimers();
    startSync('u1');
    const task = useTodos.getState().add('Hors ligne');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tries).toBeGreaterThan(2);
    expect(tries).toBeLessThanOrEqual(9); // 0,7 s then every 8 s
    expect(pendingCount()).toBe(1);

    // Whoever waits for the save (Kompaly, before saying « enregistré ») is told « en attente » after one try.
    tries = 0;
    const waiting = whenSaved('todos', [task.id], 8000);
    await vi.advanceTimersByTimeAsync(8000);
    expect((await waiting).state).toBe('waiting');
    expect(tries).toBeLessThanOrEqual(2);

    // Back online: sent once, on the next try.
    online = true;
    await vi.advanceTimersByTimeAsync(9000);
    expect(sent.filter(r => r.id === task.id)).toHaveLength(1);
    expect(pendingCount()).toBe(0);
    vi.useRealTimers();
  });
});
