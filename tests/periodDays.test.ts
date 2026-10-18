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
