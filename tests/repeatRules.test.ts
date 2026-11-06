// Test n°3 (Majeur n°7): « tous les 3 mois », several weekdays, « le 1er lundi du mois », an end that isn't forced.
import { describe, expect, it } from 'vitest';
import { decodeRule, encodeRule, endlessUntil, guessRule, nthOfMonth, ruleDays, ruleLabel } from '../src/lib/repeat';

describe('règles de répétition', () => {
  it('every 3 months on the same date', () => {
    expect(ruleDays('2026-11-15', { unit: 'month', interval: 3 }, '2027-12-31').days).toEqual(['2026-11-15', '2027-02-15', '2027-05-15', '2027-08-15', '2027-11-15']);
  });
  it('several weekdays a week, every 2 weeks', () => {
    // Wednesday 4 November 2026: Monday and Thursday every other week, from the first one after it.
    expect(ruleDays('2026-11-04', { unit: 'week', interval: 2, days: [1, 4] }, '2026-11-30').days).toEqual(['2026-11-05', '2026-11-16', '2026-11-19', '2026-11-30']);
    expect(ruleDays('2026-11-02', { unit: 'week', interval: 1, days: [1, 3, 5] }, '2026-11-08').days).toEqual(['2026-11-02', '2026-11-04', '2026-11-06']);
  });
  it('the first Monday and the last Friday of the month', () => {
    expect(ruleDays('2026-11-02', { unit: 'month', interval: 1, nth: 1 }, '2027-02-28').days).toEqual(['2026-11-02', '2026-12-07', '2027-01-04', '2027-02-01']);
    expect(nthOfMonth('2026-11-27')).toBe(-1);
    expect(nthOfMonth('2026-11-02')).toBe(1);
    expect(ruleDays('2026-11-27', { unit: 'month', interval: 1, nth: -1 }, '2027-01-31').days).toEqual(['2026-11-27', '2026-12-25', '2027-01-29']);
  });
  it('every N days and years', () => {
    expect(ruleDays('2026-11-01', { unit: 'day', interval: 3 }, '2026-11-10').days).toEqual(['2026-11-01', '2026-11-04', '2026-11-07', '2026-11-10']);
    expect(ruleDays('2028-02-29', { unit: 'year', interval: 1 }, '2033-01-01').days).toEqual(['2028-02-29', '2032-02-29']);
  });
  it('the rule’s own end wins over the horizon', () => {
    expect(ruleDays('2026-11-02', { unit: 'week', interval: 1, until: '2026-11-16' }, '2027-11-02').days).toHaveLength(3);
  });
  it('without end: a year ahead, not stopped in February', () => {
    const r = ruleDays('2026-11-02', { unit: 'week', interval: 1 }, endlessUntil({ unit: 'week', interval: 1 }, '2026-11-02'));
    expect(r.days.at(-1)).toBe('2027-11-01');
    expect(r.days).toHaveLength(53);
  });
  it('saved as a short text and read back', () => {
    for (const rule of [{ unit: 'week', interval: 2, days: [1, 4] }, { unit: 'month', interval: 1, nth: -1 }, { unit: 'month', interval: 3, until: '2027-06-30' }, { unit: 'year', interval: 1 }] as const)
      expect(decodeRule(encodeRule({ ...rule, ...('days' in rule && { days: [...rule.days] }) }))).toEqual(rule);
    expect(decodeRule('nonsense')).toBeNull();
    expect(encodeRule({ unit: 'week', interval: 2, days: [1, 4] }).length).toBeLessThan(20);
  });
  it('an older series: its rule read from its days', () => {
    expect(guessRule(['2026-11-02', '2026-11-16', '2026-11-30'])).toEqual({ unit: 'week', interval: 2 });
    expect(guessRule(['2026-01-31', '2026-03-31'])).toEqual({ unit: 'month', interval: 2 });
    expect(guessRule(['2026-03-12', '2027-03-12'])).toEqual({ unit: 'year', interval: 1 });
    expect(guessRule(['2026-11-02'])).toBeNull();
  });
  it('says it in plain words', () => {
    expect(ruleLabel({ unit: 'week', interval: 1, days: [4, 1] }, '2026-11-02')).toBe('Chaque semaine, lun. et jeu.');
    expect(ruleLabel({ unit: 'month', interval: 1, nth: 1 }, '2026-11-02')).toBe('Chaque mois, le 1er lundi');
    expect(ruleLabel({ unit: 'month', interval: 3 }, '2026-11-15')).toBe('Tous les 3 mois, le 15');
  });
});
