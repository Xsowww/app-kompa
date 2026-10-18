import { describe, expect, it } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { daysBetween, runsOf } = await import('../src/lib/periods');

describe('jours choisis d’une période', () => {
  it('tous les jours entre deux dates, dans un sens ou dans l’autre', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(daysBetween('2026-11-02', '2026-10-30')).toHaveLength(4);
    expect(daysBetween('2026-10-25', '2026-10-25')).toEqual(['2026-10-25']); // jour du changement d’heure
  });
  it('les jours qui se suivent forment un morceau', () => {
    expect(runsOf(['2026-10-12', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-06'])).toEqual([
      { start: '2026-10-05', end: '2026-10-07' },
      { start: '2026-10-12', end: '2026-10-12' },
    ]);
    expect(runsOf(['2026-10-31', '2026-11-01'])).toEqual([{ start: '2026-10-31', end: '2026-11-01' }]);
    expect(runsOf([])).toEqual([]);
  });
});

const { cleanPeriod, covers, periodsOn, periodDays, repeatPeriod, weekLanes, samePeriod, copyPeriods } = await import('../src/lib/periods');

describe('une période en plusieurs morceaux (jours sautés)', () => {
  const p = cleanPeriod({ id: 'a', title: 'En entreprise', start: '2026-10-05', end: '2026-10-18', color: 'orange', skip: ['2026-10-10', '2026-10-11', '2026-10-05', 'bidon', '2026-10-30', '2026-10-10'] })!;
  it('garde seulement les vrais jours sautés à l’intérieur', () => {
    expect(p.skip).toEqual(['2026-10-10', '2026-10-11']);
    expect(periodDays(p)).toBe(12);
  });
  it('les jours sautés ne sont pas dans la période', () => {
    expect(covers(p, '2026-10-09')).toBe(true);
    expect(covers(p, '2026-10-10')).toBe(false);
    expect(periodsOn([p], '2026-10-11')).toEqual([]);
  });
  it('une bande par morceau dans la semaine', () => {
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
    const q = { ...p, skip: ['2026-10-07'] };
    expect(weekLanes([q], week).map(b => [b.from, b.to])).toEqual([[0, 1], [3, 6]]);
  });
  it('la répétition décale aussi les jours sautés', () => {
    const [, next] = repeatPeriod({ title: 'x', start: '2026-10-05', end: '2026-10-18', color: 'bleu', skip: ['2026-10-10'] }, 4, '2026-12-31');
    expect(next.start).toBe('2026-11-02');
    expect(next.skip).toEqual(['2026-11-07']);
  });
});

describe('importer des périodes', () => {
  const p = { id: 'a', title: 'En entreprise', start: '2026-11-02', end: '2026-11-13', color: 'bleu', skip: ['2026-11-07', '2026-11-08'] };
  it('reconnaît la même période (nom sans casse, mêmes jours)', () => {
    expect(samePeriod(p, { ...p, id: 'b', title: ' en Entreprise ', skip: ['2026-11-08', '2026-11-07'] })).toBe(true);
    expect(samePeriod(p, { ...p, id: 'b', skip: [] })).toBe(false);
    expect(samePeriod(p, { ...p, id: 'b', end: '2026-11-14' })).toBe(false);
  });
  it('copie avec un nouvel id et « pour qui » de l’agenda d’arrivée', () => {
    let n = 0;
    const [c] = copyPeriods([{ ...p, people: ['léa'] }], ['moi'], () => `n${++n}`);
    expect(c).toEqual({ ...p, id: 'n1', people: ['moi'] });
    expect(copyPeriods([{ ...p, people: ['léa'] }], [], () => 'x')[0]).not.toHaveProperty('people');
  });
});
