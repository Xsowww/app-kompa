import { describe, expect, it } from 'vitest';

// The stores reach for the browser when they load: give them the globals they read.
const memory = new Map<string, string>();
const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) };
Object.assign(globalThis, { location: new URL('http://localhost/'), localStorage: storage, sessionStorage: storage });
const { isLateEvent, lateDaysOf, listLate } = await import('../src/lib/late');
type Ev = Parameters<typeof isLateEvent>[0];

const now = new Date(2026, 10, 3, 11, 5); // mardi 3 novembre 2026, 11:05
const ev = (id: string, date: string, more: Partial<Ev> = {}): Ev => ({ id, title: id, date, category: 'perso', done: false, createdAt: '2026-10-01T00:00:00Z', ...more });

describe('en retard', () => {
  it('un événement n’est en retard que le lendemain, comme une tâche', () => {
    expect(isLateEvent(ev('banque', '2026-11-03', { start: '10:00', end: '11:00' }), now)).toBe(false);
    expect(isLateEvent(ev('hier', '2026-11-02', { start: '10:00' }), now)).toBe(true);
    expect(isLateEvent(ev('fait', '2026-11-02', { done: true }), now)).toBe(false);
    expect(isLateEvent(ev('cours', '2026-11-02', { category: 'cours' }), now)).toBe(false);
    expect(isLateEvent(ev('vieux', '2026-10-19'), now)).toBe(false); // plus de deux semaines
  });

  it('un voyage de 3 jours compte une fois, et seulement une fois fini', () => {
    const trip = (dates: string[]) => dates.map((d, i) => ev(`v${i}`, d, { title: 'Voyage', series: 'span-1' }));
    const ended = trip(['2026-10-30', '2026-10-31', '2026-11-01']);
    const late = listLate([...ended, ev('rdv', '2026-11-02')], now);
    expect(late.map(e => e.id)).toEqual(['rdv', 'v0']); // le plus récent d’abord, le voyage à son premier jour
    expect(lateDaysOf(late[1], ended, now).map(e => e.id)).toEqual(['v0', 'v1', 'v2']);
    // Encore en cours aujourd’hui : pas en retard.
    expect(listLate(trip(['2026-11-02', '2026-11-03', '2026-11-04']), now)).toEqual([]);
    // Une répétition (pas un événement sur plusieurs jours) : chaque occurrence compte.
    const weekly = [ev('a', '2026-10-27', { series: 'r-1' }), ev('b', '2026-11-02', { series: 'r-1' })];
    expect(listLate(weekly, now).map(e => e.id)).toEqual(['b', 'a']);
    expect(lateDaysOf(weekly[0], weekly, now).map(e => e.id)).toEqual(['a']);
  });
});
