import { describe, expect, it } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { cleanPeriod, cleanPeriods, periodsOn, periodsBetween, repeatPeriod, periodLabel, periodsFill, weekLanes, dayLanes, MAX_REPEATS } = await import('../src/lib/periods');

const p = (id: string, start: string, end: string, title = id) => ({ id, title, start, end, color: 'bleu' });

describe('cleanPeriod', () => {
  it('keeps a good period and fixes an unknown colour', () => {
    expect(cleanPeriod({ id: 'a', title: '  En entreprise ', start: '2026-10-12', end: '2026-10-23', color: 'fuchsia' })).toEqual({ id: 'a', title: 'En entreprise', start: '2026-10-12', end: '2026-10-23', color: 'bleu' });
  });
  it('drops what does not hold up', () => {
    for (const bad of [null, 'x', { title: '', start: '2026-10-12', end: '2026-10-13' }, { title: 'A', start: '2026-10-13', end: '2026-10-12' }, { title: 'A', start: '2026-02-30', end: '2026-03-02' }, { title: 'A', start: '2026-01-01', end: '2062-01-01' }])
      expect(cleanPeriod(bad)).toBeNull();
    expect(cleanPeriods([p('a', '2026-10-12', '2026-10-18'), { nope: 1 }]).map(x => x.id)).toEqual(['a']);
    expect(cleanPeriods('not a list')).toEqual([]);
  });
});

describe('periodsOn / periodsBetween', () => {
  const list = [p('b', '2026-10-19', '2026-10-25'), p('a', '2026-10-12', '2026-10-18')];
  it('first and last days are included', () => {
    expect(periodsOn(list, '2026-10-12').map(x => x.id)).toEqual(['a']);
    expect(periodsOn(list, '2026-10-18').map(x => x.id)).toEqual(['a']);
    expect(periodsOn(list, '2026-10-19').map(x => x.id)).toEqual(['b']);
    expect(periodsOn(list, '2026-10-26')).toEqual([]);
  });
  it('a week touching two periods gets both, in order', () => {
    expect(periodsBetween(list, '2026-10-15', '2026-10-21').map(x => x.id)).toEqual(['a', 'b']);
  });
});

describe('repeatPeriod (alternance)', () => {
  const first = { title: 'En cours', start: '2026-09-07', end: '2026-09-20', color: 'bleu' };
  it('two weeks every four weeks, same length each time', () => {
    const r = repeatPeriod(first, 4, '2026-11-30');
    expect(r.map(x => [x.start, x.end])).toEqual([
      ['2026-09-07', '2026-09-20'],
      ['2026-10-05', '2026-10-18'],
      ['2026-11-02', '2026-11-15'],
      ['2026-11-30', '2026-12-13'],
    ]);
  });
  it('crosses the change of time without shifting a day', () => {
    expect(repeatPeriod(first, 7, '2026-10-26').map(x => x.start)).toEqual(['2026-09-07', '2026-10-26']);
  });
  it('stops at MAX_REPEATS, and an end before the start gives the first only', () => {
    expect(repeatPeriod(first, 1, '2030-01-01')).toHaveLength(MAX_REPEATS);
    expect(repeatPeriod(first, 4, '2026-09-01')).toHaveLength(1);
  });
});

describe('pour qui (agendas partagés)', () => {
  const lea = '11111111-1111-4111-8111-111111111111', tom = '22222222-2222-4222-8222-222222222222';
  it('keeps member ids, once, and drops anything else', () => {
    const c = cleanPeriod({ id: 'a', title: 'En entreprise', start: '2026-10-19', end: '2026-10-30', color: 'orange', people: [lea, lea, 'pas un id', 42, tom] });
    expect(c?.people).toEqual([lea, tom]);
    expect(cleanPeriod({ id: 'b', title: 'Vacances', start: '2026-10-19', end: '2026-10-30', people: [] })).not.toHaveProperty('people');
  });
  it('names who it is about', () => {
    const names: Record<string, string> = { [lea]: 'Léa', [tom]: 'Tom' };
    const nameOf = (id: string) => names[id] ?? 'Quelqu’un';
    expect(periodLabel({ title: 'Vacances' }, nameOf)).toBe('Vacances');
    expect(periodLabel({ title: 'En entreprise', people: [lea] }, nameOf)).toBe('Léa · En entreprise');
    expect(periodLabel({ title: 'Stage', people: [lea, tom] }, nameOf)).toBe('Léa et Tom · Stage');
    expect(periodLabel({ title: 'Stage', people: [lea, tom, '33333333-3333-4333-8333-333333333333'] }, nameOf)).toBe('Léa, Tom +1 · Stage');
  });
});

describe('periods that overlap', () => {
  const week = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
  it('the second one starts on its own day, on a second row', () => {
    const lanes = weekLanes([p('cours', '2026-10-05', '2026-10-16'), p('stage', '2026-10-14', '2026-10-30')], week);
    expect(lanes.map(b => [b.period.id, b.from, b.to, b.lane])).toEqual([
      ['cours', 0, 4, 0],
      ['stage', 2, 6, 1],
    ]);
  });
  it('back-to-back periods share a row', () => {
    const lanes = weekLanes([p('a', '2026-10-12', '2026-10-14'), p('b', '2026-10-15', '2026-10-18')], week);
    expect(lanes.map(b => b.lane)).toEqual([0, 0]);
  });
  it('a day in both shows both colours, each over the whole day', () => {
    expect(periodsFill([])).toBeUndefined();
    const fill = periodsFill([{ color: 'bleu' }, { color: 'orange' }])!;
    expect(fill.match(/linear-gradient\(/g)).toHaveLength(2);
    expect(fill).not.toContain('50%');
    expect(fill).toContain('#3b6fd8');
    expect(fill).toContain('#e8613c');
  });
  it('periods that don’t overlap share the top row, whatever their order', () => {
    // « Cours » began long before and is back on Thursday (days skipped); « Entreprise » is Monday to Wednesday.
    const cours = { ...p('cours', '2026-09-01', '2026-10-18'), skip: ['2026-10-12', '2026-10-13', '2026-10-14'] };
    const lanes = weekLanes([cours, p('entreprise', '2026-10-12', '2026-10-14')], week);
    expect(lanes.map(b => [b.period.id, b.lane])).toEqual([
      ['entreprise', 0],
      ['cours', 0],
    ]);
  });
  it('each day knows its periods’ rows', () => {
    const { byDay, lanes } = dayLanes([p('a', '2026-10-12', '2026-10-16'), p('b', '2026-10-14', '2026-10-15'), p('c', '2026-10-17', '2026-10-18')], week);
    expect(lanes).toBe(2);
    expect(byDay.get('2026-10-12')!.map(d => [d.period.id, d.lane, d.first])).toEqual([['a', 0, true]]);
    expect(byDay.get('2026-10-14')!.map(d => [d.period.id, d.lane])).toEqual([['a', 0], ['b', 1]]);
    expect(byDay.get('2026-10-17')!.map(d => [d.period.id, d.lane, d.first, d.last])).toEqual([['c', 0, true, false]]);
    expect(byDay.get('2026-10-16')!.map(d => d.last)).toEqual([true]);
  });
});
