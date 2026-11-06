// Test n°3 (Majeur n°4): « Déplacer vers… » an event to a shared calendar or a team — written there first, taken
// out of my calendar only once the server said yes; a refusal changes nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});

const created: unknown[][] = [];
const deleted: string[][] = [];
let refuse = false;
vi.mock('../src/lib/groups', async orig => ({
  ...(await orig<typeof import('../src/lib/groups')>()),
  createEvents: vi.fn(async (_g: string, rows: unknown[]) => {
    if (refuse) throw new Error('permission denied');
    created.push(rows);
  }),
  deleteEvents: vi.fn(async (ids: string[]) => void deleted.push(ids)),
}));

const { useCalendar } = await import('../src/store/calendar');
const { useGroups } = await import('../src/store/groups');
const { moveEventToAgenda } = await import('../src/store/moveEvent');

const famille = { id: 'g-fam', name: 'Famille', kind: 'agenda', ownerId: 'me', categories: [], color: null, photo: null, createdAt: 'x' };

beforeEach(() => {
  created.length = 0;
  deleted.length = 0;
  refuse = false;
  useCalendar.setState({ events: [], trash: [] });
  useGroups.setState({ groups: [famille] as never, myRoles: {}, events: {}, refresh: async () => undefined } as never);
});

describe('Déplacer vers…', () => {
  it('my event goes to « Famille »: there, and no longer in my calendar', async () => {
    const ev = useCalendar.getState().add({ title: 'Dentiste Léo', date: '2027-03-10', start: '14:00', category: 'perso', place: 'Cabinet', reminders: [60] });
    const r = await moveEventToAgenda(ev.id, null, 'g-fam');
    expect(r).toMatchObject({ ok: true, moved: 1, to: 'Famille', title: 'Dentiste Léo' });
    expect(created[0]).toEqual([expect.objectContaining({ title: 'Dentiste Léo', date: '2027-03-10', start: '14:00', place: 'Cabinet', reminders: [60] })]);
    expect(useCalendar.getState().events).toEqual([]);
    expect(useCalendar.getState().trash).toEqual([]);
  });
  it('refused by the server: nothing moves, the reason is given', async () => {
    refuse = true;
    const ev = useCalendar.getState().add({ title: 'Dentiste', date: '2027-03-10', category: 'perso' });
    const r = await moveEventToAgenda(ev.id, null, 'g-fam');
    expect(r.ok).toBe(false);
    expect(useCalendar.getState().events.map(e => e.id)).toEqual([ev.id]);
  });
  it('with its next ones: the whole series, one new series id there', async () => {
    useCalendar.getState().addMany(['2027-03-01', '2027-03-08', '2027-03-15'].map(date => ({ title: 'Judo', date, category: 'sport' as const, series: 'old' })));
    const first = useCalendar.getState().events[0];
    const r = await moveEventToAgenda(first.id, null, 'g-fam', true);
    expect(r).toMatchObject({ ok: true, moved: 3 });
    const rows = created[0] as { series: string }[];
    expect(new Set(rows.map(x => x.series)).size).toBe(1);
    expect(rows[0].series).not.toBe('old');
    expect(rows[0].series.length).toBeLessThanOrEqual(40);
  });
  it('from « Famille » back to my calendar', async () => {
    useGroups.setState({ events: { 'g-fam': [{ id: 'x1', groupId: 'g-fam', title: 'Piscine', date: '2027-03-10', start: '10:00', end: null, place: null, category: 'sport', details: null, createdBy: 'me', createdAt: 'x', people: [], reminders: [], series: null, updatedBy: null, updatedAt: null }] } } as never);
    const r = await moveEventToAgenda('x1', 'g-fam', null);
    expect(r).toMatchObject({ ok: true, to: 'Mon agenda' });
    expect(useCalendar.getState().events).toEqual([expect.objectContaining({ title: 'Piscine', date: '2027-03-10', start: '10:00', category: 'sport' })]);
    expect(deleted).toEqual([['x1']]);
  });
});
