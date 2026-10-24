import { describe, expect, it } from 'vitest';
import { repeatDays, MAX_OCCURRENCES, shiftKey, dayShift } from '../src/lib/repeat';

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
