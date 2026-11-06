import { beforeEach, describe, expect, it, vi } from 'vitest';

// Test n°3, bloquant n°1: a row refused by the server (23514) was dropped from the queue with a vague message once, the
// event staying here only: it looked saved and was missing on the other devices. Now: said with « Réessayer », kept.
const memory = new Map<string, string>();
const noop = () => undefined;
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
    removeItem: (k: string) => memory.delete(k),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
  },
  window: globalThis,
  document: { hidden: false, addEventListener: noop, removeEventListener: noop },
  addEventListener: noop,
  removeEventListener: noop,
});

type Row = Record<string, unknown>;
const sent: Row[][] = [];
let refuse = (r: Row) => typeof r.series === 'string' && r.series.length > 40; // the server's events_series_check
const result = (rows: Row[]) => ({ error: rows.some(r => refuse(r)) ? { code: '23514', message: 'new row violates check constraint "events_series_check"' } : null });
const fake = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  from: () => ({
    upsert: async (rows: Row | Row[]) => {
      const list = Array.isArray(rows) ? rows : [rows];
      sent.push(list);
      return result(list);
    },
    delete: () => ({ in: async () => ({ error: null }) }),
  }),
  rpc: async () => ({ error: null }),
};
vi.mock('../src/lib/supabase', () => ({ supabase: fake, cloudEnabled: true }));

const { useCalendar } = await import('../src/store/calendar');
const { useUi } = await import('../src/store/ui');
const { startSync, stopSync, whenSaved, refusedCount } = await import('../src/lib/cloudSync');
const { spanDays } = await import('../src/lib/repeat');

const UUID = '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e3f';

beforeEach(() => {
  stopSync();
  memory.clear();
  sent.length = 0;
  refuse = r => typeof r.series === 'string' && r.series.length > 40;
  useCalendar.setState({ events: [], trash: [] });
  useUi.setState({ toasts: [] });
  startSync('u1');
});

describe('enregistrement en ligne : jamais « enregistré » quand ce n’est pas le cas', () => {
  it('une garde de nuit (série « span- » + UUID) part en entier et le serveur l’accepte', async () => {
    useCalendar.getState().addMany(spanDays('2026-11-20', '2026-11-21', '22:00', '07:00').map(d => ({ title: 'Garde de nuit', category: 'perso' as const, ...d, series: `span-${UUID}` })));
    const ids = useCalendar.getState().events.map(e => e.id);
    expect(await whenSaved('events', ids)).toEqual({ state: 'saved' });
    const rows = sent.flat();
    expect(rows).toHaveLength(2);
    expect(rows.every(r => (r.series as string).length <= 40)).toBe(true);
    expect(refusedCount()).toBe(0);
  });

  it('une ligne refusée est dite (« Pas enregistré … · Réessayer »), gardée ici et dans la file, puis renvoyée', async () => {
    refuse = r => r.title === 'Refusé';
    const ev = useCalendar.getState().add({ title: 'Refusé', category: 'perso', date: '2026-11-20' });
    const res = await whenSaved('events', [ev.id]);
    expect(res.state).toBe('refused');
    expect(useCalendar.getState().events.map(e => e.id)).toEqual([ev.id]);
    const toast = useUi.getState().toasts.find(x => x.tone === 'error');
    expect(toast?.text).toMatch(/Pas enregistré : « Refusé »/);
    expect(toast?.action?.label).toBe('Réessayer');
    expect(toast?.sticky).toBe(true);
    // Something else that worked (« Ajouté ») doesn't hide it.
    useUi.getState().toast('Ajouté', 'success');
    expect(useUi.getState().toasts.some(x => x.id === toast!.id)).toBe(true);
    // Saved for the next visit too.
    const queue = [...memory.entries()].find(([k]) => k.startsWith('cop:u1:sync-queue'));
    expect(queue?.[1]).toContain(ev.id);
    // The server accepts it now: « Réessayer » sends it again.
    refuse = () => false;
    sent.length = 0;
    toast!.action!.run();
    await vi.waitFor(() => expect(sent.flat().map(r => r.id)).toContain(ev.id));
    await vi.waitFor(() => expect(refusedCount()).toBe(0));
  });

  it('pas de compte en ligne : « local », rien n’est annoncé comme envoyé', async () => {
    stopSync();
    expect(await whenSaved('events', ['x'])).toEqual({ state: 'local' });
  });
});
