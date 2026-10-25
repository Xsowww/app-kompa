import { describe, expect, it } from 'vitest';
import { repeatDays, MAX_OCCURRENCES, shiftKey, dayShift, spanDays, isSpan } from '../src/lib/repeat';

describe('repeatDays', () => {
  it('weekly, until included', () => {
    expect(repeatDays('2026-11-02', 'week', '2026-11-23').days).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
  });
  it('every two weeks, skipping holidays', () => {
    const holidays = (k: string) => k >= '2026-12-19' && k <= '2027-01-03';
    expect(repeatDays('2026-12-07', '2weeks', '2027-01-20', holidays).days).toEqual(['2026-12-07', '2027-01-04', '2027-01-18']);
  });
  it('monthly keeps the date and skips months without it', () => {
    expect(repeatDays('2027-01-31', 'month', '2027-05-31').days).toEqual(['2027-01-31', '2027-03-31', '2027-05-31']);
  });
  it('daily across the clock change', () => {
    expect(repeatDays('2026-10-24', 'day', '2026-10-27').days).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });
  it('is capped', () => {
    const r = repeatDays('2026-01-01', 'day', '2030-01-01');
    expect(r.days).toHaveLength(MAX_OCCURRENCES);
    expect(r.capped).toBe(true);
  });
  it('until before the start: none', () => {
    expect(repeatDays('2026-11-02', 'week', '2026-11-01').days).toEqual([]);
  });
  it('shifts', () => {
    expect(dayShift('2026-11-02', '2026-11-03')).toBe(1);
    expect(shiftKey('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('événement sur plusieurs jours', () => {
  it('first from its start, last until its end, the days between all day', () => {
    expect(spanDays('2026-11-02', '2026-11-04', '09:00', '17:00')).toEqual([
      { date: '2026-11-02', start: '09:00', end: '23:59' },
      { date: '2026-11-03' },
      { date: '2026-11-04', start: '00:00', end: '17:00' },
    ]);
    expect(spanDays('2026-11-02', '2026-11-03')).toEqual([{ date: '2026-11-02' }, { date: '2026-11-03' }]);
    expect(spanDays('2026-01-01', '2026-12-31')).toHaveLength(31);
    expect(isSpan('span-x') && !isSpan('abc')).toBe(true);
  });
});

describe('À venir : un événement sur plusieurs jours une seule fois', () => {
  it('keeps the first day listed', async () => {
    const { firstOfSpans } = await import('../src/lib/repeat');
    const list = [{ id: 'a', series: 'span-1' }, { id: 'b' }, { id: 'c', series: 'span-1' }, { id: 'd', series: 'rep' }, { id: 'e', series: 'rep' }];
    expect(firstOfSpans(list).map(e => e.id)).toEqual(['a', 'b', 'd', 'e']);
  });
});
