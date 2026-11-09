// Test n°3 (Majeur n°7): a series « sans fin » goes on (made ahead as time goes), its end can be changed later.
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../src/store/calendar';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { occurrenceId, planEndless, planNewEnd, readRuleCode, saveRuleCode } = await import('../src/lib/repeatSeries');
const { ruleDays } = await import('../src/lib/repeat');

const ev = (date: string, series = 's1', extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: `${series}-${date}`, title: 'Yoga', date, start: '18:00', category: 'sport', done: false, createdAt: 'x', series, reminders: [15], ...extra });

describe('série sans fin', () => {
  it('a birthday every year: its next years are made before they are needed (it showed one or two years, then nothing)', () => {
    const year = { unit: 'year' as const, interval: 1 };
    const { add } = planEndless({ s2: saveRuleCode(year, '2026-12-12') }, [ev('2026-12-12', 's2'), ev('2027-12-12', 's2')], [], '2027-01-10');
    expect(add.map(e => e.date)).toEqual(['2028-12-12', '2029-12-12', '2030-12-12', '2031-12-12', '2032-12-12', '2033-12-12', '2034-12-12', '2035-12-12', '2036-12-12']);
  });
  const rule = { unit: 'week' as const, interval: 1, days: [1, 4] };
  const code = saveRuleCode(rule, '2026-11-02');
  it('the rule is saved and read back with its first day', () => {
    expect(readRuleCode(code)).toEqual({ rule, from: '2026-11-02' });
    expect(readRuleCode('w1')).toBeNull();
  });
  it('nothing to do while there is enough ahead', () => {
    const made = ruleDays('2026-11-02', rule, '2027-11-02').days.map(d => ev(d));
    expect(planEndless({ s1: code }, made, [], '2026-11-06').add).toEqual([]);
  });
  it('months later, the next ones are made, as the last one, the same ids on every device', () => {
    const made = ruleDays('2026-11-02', rule, '2027-11-02').days.map(d => ev(d));
    const { add } = planEndless({ s1: code }, made, [], '2027-03-01');
    expect(add.length).toBeGreaterThan(30);
    expect(add[0].date > '2027-11-02').toBe(true);
    expect(add.every(e => e.title === 'Yoga' && e.start === '18:00' && e.series === 's1' && e.reminders?.[0] === 15)).toBe(true);
    expect(new Set(add.map(e => new Date(`${e.date}T12:00`).getDay()))).toEqual(new Set([1, 4]));
    expect(add[0].id).toBe(occurrenceId('s1', add[0].date));
    expect(planEndless({ s1: code }, made, [], '2027-03-01').add[0].id).toBe(add[0].id);
    expect(add[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('a series deleted: its rule is forgotten; one with an end is never made further', () => {
    expect(planEndless({ s1: code }, [], [], '2027-03-01').gone).toEqual(['s1']);
    const ended = saveRuleCode({ ...rule, until: '2026-12-31' }, '2026-11-02');
    expect(planEndless({ s1: ended }, [ev('2026-12-31')], [], '2027-06-01').add).toEqual([]);
  });
});

describe('fin modifiable', () => {
  const weekly = ruleDays('2026-11-02', { unit: 'week', interval: 1 }, '2027-02-01').days.map(d => ev(d));
  it('an earlier end: the days after it go', () => {
    const p = planNewEnd(weekly, '2026-11-30', null, '2026-11-06');
    expect(p.remove).toHaveLength(weekly.filter(e => e.date > '2026-11-30').length);
    expect(p.add).toEqual([]);
    expect(p.rule).toEqual({ unit: 'week', interval: 1, until: '2026-11-30' });
  });
  it('a later end (the old forced February one): the days up to it are made, read from the series', () => {
    const p = planNewEnd(weekly, '2027-06-28', null, '2026-11-06');
    expect(p.add.at(-1)!.date).toBe('2027-06-28');
    expect(p.add[0].date).toBe('2027-02-08');
  });
  it('« sans fin »: a year ahead', () => {
    const p = planNewEnd(weekly, null, null, '2026-11-06');
    expect(p.add.at(-1)!.date >= '2027-10-30').toBe(true);
    expect(p.rule!.until).toBeUndefined();
  });
});
