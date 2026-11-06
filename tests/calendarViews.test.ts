import { describe, expect, it } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { spanBars, upcomingList, sweptRange, isFor, tasksOn, layout, openingDay, nightPieces, byStartTime } = await import('../src/pages/calendar/layout');
const { agendaEvents, fromAgenda, agendaLink } = await import('../src/pages/calendar/agendas');
const { catOf, sortEvents } = await import('../src/store/calendar');

type Ev = { id: string; title: string; date: string; start?: string; end?: string; series?: string; category: 'perso'; done: false; createdAt: string };
const ev = (id: string, date: string, more: Partial<Ev> = {}): Ev => ({ id, title: id, date, category: 'perso', done: false, createdAt: '', ...more });

describe('barres des événements sur plusieurs jours', () => {
  const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
  it('one bar across the days of the row, open where it goes on in the next row', () => {
    const trip = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'].map((d, i) => ev(`t${i}`, d, { series: 'span-trip' }));
    const [bar] = spanBars(trip, week);
    expect(bar).toMatchObject({ from: 4, to: 6, lane: 0, before: false, after: true });
    expect(bar.ev.id).toBe('t0');
    // The next row: from its first day, open on the left.
    expect(spanBars(trip, ['2026-11-09', '2026-11-10'])[0]).toMatchObject({ from: 0, to: 0, before: true, after: false });
  });
  it('a repeat is no bar; two bars that cross get two lanes', () => {
    const a = ['2026-11-02', '2026-11-03', '2026-11-04'].map((d, i) => ev(`a${i}`, d, { series: 'span-a' }));
    const b = ['2026-11-04', '2026-11-05'].map((d, i) => ev(`b${i}`, d, { series: 'span-b' }));
    const yoga = [ev('y', '2026-11-03', { series: 'yoga' })];
    const bars = spanBars([...b, ...a, ...yoga], week);
    expect(bars.map(x => [x.ev.series, x.lane])).toEqual([['span-a', 0], ['span-b', 1]]);
  });
});

describe('« À venir » : une seule liste dans l’ordre des dates', () => {
  const kind = (e: Ev & { big?: boolean; hw?: boolean }) => (e.big ? 'big' : e.hw ? 'homework' : 'other');
  it('the important ones and the next things together in date order, a repeat once', () => {
    const pool = [
      ev('anniv', '2026-11-05'),
      { ...ev('yoga1', '2026-11-05', { start: '18:00', series: 'yoga' }), big: true },
      { ...ev('partiel', '2026-11-09'), big: true },
      { ...ev('yoga2', '2026-11-12', { start: '18:00', series: 'yoga' }), big: true },
      { ...ev('dm', '2026-11-06'), hw: true },
      ev('ciné', '2026-11-20'),
    ];
    const { shown, more } = upcomingList(pool, kind);
    expect(shown.map(e => e.id)).toEqual(['anniv', 'yoga1', 'dm', 'partiel', 'ciné']);
    expect(more).toEqual([]);
  });
  it('a day of six classes shows two of them, the rest in « Voir N autres »; four important ones leave room for others', () => {
    const classes = Array.from({ length: 6 }, (_, i) => ev(`c${i}`, '2026-11-04', { start: `0${i + 8}:00`.slice(-5) }));
    const bigs = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'].map((d, i) => ({ ...ev(`b${i}`, d), big: true }));
    const { shown, more } = upcomingList([...classes, ev('anniv', '2026-11-05'), ...bigs], kind);
    expect(shown.map(e => e.id)).toEqual(['c0', 'c1', 'anniv', 'b0', 'b1', 'b2', 'b3']);
    expect(more.map(e => e.id)).toEqual(['c2', 'c3', 'c4', 'c5', 'b4']);
  });
});

describe('grille horaire', () => {
  it('a swept range: from the slot pressed to the one let go (included), an hour when it stayed on one', () => {
    expect(sweptRange(600, 690)).toEqual({ from: 600, to: 705 });
    expect(sweptRange(690, 600)).toEqual({ from: 600, to: 705 });
    expect(sweptRange(600, 600)).toEqual({ from: 600, to: 660 });
  });
  it('overlapping events share the width', () => {
    const placed = layout([ev('a', '2026-11-03', { start: '08:00', end: '10:00' }), ev('b', '2026-11-03', { start: '09:00', end: '10:00' }), ev('c', '2026-11-03', { start: '10:00' })] as never);
    expect(placed.map(p => [p.ev.id, p.col, p.cols])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 1]]);
  });
});

describe('calendrier', () => {
  it('the day’s events without a time come first', () => {
    const list = [ev('b', '2026-11-03', { start: '08:00' }), ev('a', '2026-11-03'), ev('c', '2026-11-02', { start: '20:00' })];
    expect([...list].sort(sortEvents as never).map(e => e.id)).toEqual(['c', 'a', 'b']);
  });
  it('« pour qui »: an event for everyone is for each member', () => {
    expect(isFor({ people: [] }, 'lea')).toBe(true);
    expect(isFor({ people: ['tom'] }, 'lea')).toBe(false);
    expect(isFor({ people: ['tom', 'lea'] }, 'lea')).toBe(true);
    expect(isFor({ people: ['tom'] }, null)).toBe(true);
  });
  it('the tasks of a day, without a time first', () => {
    const todos = [
      { id: '1', title: 'B', done: false, due: '2026-11-03', time: '14:00', createdAt: '' },
      { id: '2', title: 'A', done: false, due: '2026-11-03', createdAt: '' },
      { id: '3', title: 'C', done: false, due: '2026-11-04', createdAt: '' },
      { id: '4', title: 'D', done: false, due: '2026-11-03', createdAt: '', deletedAt: '2026-11-03T10:00:00Z' },
    ];
    expect(tasksOn(todos, '2026-11-03').map(x => x.id)).toEqual(['2', '1']);
  });
});

describe('agendas partagés par-dessus le mien', () => {
  const group = (id: string, name: string, color: string | null) => ({ id, name, color, photo: null, ownerId: null, createdAt: '', kind: 'agenda' as const, categories: [] });
  const gev = (id: string, groupId: string) => ({ id, groupId, title: 'Piano', date: '2026-11-04', start: '17:00', end: null, place: 'Conservatoire', category: 'cours', details: null, createdBy: null, createdAt: '', people: [], reminders: [], series: null });
  it('its events in its colour and name, read-only, leading to the agenda; a hidden one left out', () => {
    const list = agendaEvents([group('g1', 'Famille', '#2f9e6b'), group('g2', 'Coloc', null)], { g1: [gev('e1', 'g1')], g2: [gev('e2', 'g2')] }, ['g2']);
    expect(list).toHaveLength(1);
    const [e] = list;
    expect(fromAgenda(e)).toBe(true);
    expect(e).toMatchObject({ title: 'Piano', start: '17:00', place: 'Conservatoire', done: false });
    expect(catOf(e.category)).toMatchObject({ label: 'Famille', color: '#2f9e6b' });
    expect(agendaLink(e)).toBe('/agendas?g=g1&jour=2026-11-04&evt=e1');
  });
  it('a team’s meeting is in my calendar too, and leads to the team', () => {
    const team = { ...group('t1', 'École Test', null), kind: 'groupe' as const };
    const [e] = agendaEvents([team], { t1: [{ ...gev('m1', 't1'), title: 'Conseil des maîtres' }] }, []);
    expect(e).toMatchObject({ title: 'Conseil des maîtres', start: '17:00' });
    expect(agendaLink(e)).toBe('/groupes?g=t1&onglet=revisions');
  });
});

describe('le jour où s’ouvre le calendrier', () => {
  // Vendredi 6 novembre 2026 ; la semaine finit dimanche 8.
  const open = (items: { date: string; done?: boolean }[]) => openingDay('2026-11-06', '2026-11-08', items, '2027-01-05');
  it('today, when something is still planned this week (today included)', () => {
    expect(open([{ date: '2026-11-08' }, { date: '2026-11-20' }])).toEqual({ day: '2026-11-06', jumped: false });
    expect(open([{ date: '2026-11-06' }])).toEqual({ day: '2026-11-06', jumped: false });
  });
  it('the next planned day, when the rest of the week is empty (what is past or done doesn’t count)', () => {
    expect(open([{ date: '2026-11-02' }, { date: '2026-11-07', done: true }, { date: '2026-11-12' }, { date: '2026-11-10' }])).toEqual({ day: '2026-11-10', jumped: true });
  });
  it('today when nothing is planned at all, or only far away', () => {
    expect(open([])).toEqual({ day: '2026-11-06', jumped: false });
    expect(open([{ date: '2027-03-01' }])).toEqual({ day: '2026-11-06', jumped: false });
  });
});

describe('les nuits et l’ordre de la journée', () => {
  const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
  it('a night is drawn at its hours on both days (not as a bar); a trip of several days stays a bar', () => {
    const night = [ev('n1', '2026-11-02', { start: '21:00', end: '23:59', series: 'span-n' }), ev('n2', '2026-11-03', { start: '00:00', end: '07:00', series: 'span-n' })];
    const trip = [ev('t1', '2026-11-04', { start: '09:00', end: '23:59', series: 'span-t' }), ev('t2', '2026-11-05', { series: 'span-t' }), ev('t3', '2026-11-06', { start: '00:00', end: '17:00', series: 'span-t' })];
    const edge = [ev('s1', '2026-11-08', { start: '20:00', end: '23:59', series: 'span-s' })];
    expect([...nightPieces([...night, ...trip, ...edge], week)].sort()).toEqual(['n1', 'n2', 's1']);
    expect(spanBars([...night, ...trip].filter(e => !nightPieces([...night, ...trip], week).has(e.id)), week)).toHaveLength(1);
  });
  it('events and tasks of a day in the order of the day', () => {
    const evs = [ev('e1', '2026-11-03', { start: '09:30' }), ev('e2', '2026-11-03', { start: '21:00' })];
    const todos = [{ id: 'x', title: 'Relancer', done: false, due: '2026-11-03', time: '10:00', createdAt: '' }, { id: 'y', title: 'Sans heure', done: false, due: '2026-11-03', createdAt: '' }];
    expect(byStartTime(evs, todos).map(it => ('ev' in it ? it.ev.id : it.todo.id))).toEqual(['y', 'e1', 'x', 'e2']);
  });
});
