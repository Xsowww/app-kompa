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

describe('spanTooLong', () => {
  it('31 days at most: said, not cut (21 November → 31 December is 41 days)', async () => {
    const { spanTooLong } = await import('../src/lib/repeat');
    expect(spanTooLong('2026-11-21', '2026-12-31')).toBe(true);
    expect(spanTooLong('2026-12-01', '2026-12-31')).toBe(false);
    expect(spanTooLong('2026-12-01', '2027-01-01')).toBe(true);
  });
});

describe('chaque année', () => {
  it('the same day each year; a 29 February only in leap years; ten years offered at first', async () => {
    const { repeatDays, defaultUntil } = await import('../src/lib/repeat');
    expect(repeatDays('2026-03-12', 'year', '2029-03-12').days).toEqual(['2026-03-12', '2027-03-12', '2028-03-12', '2029-03-12']);
    expect(repeatDays('2028-02-29', 'year', '2033-03-01').days).toEqual(['2028-02-29', '2032-02-29']);
    expect(defaultUntil('2026-03-12', 'year')).toBe('2036-03-12');
    expect(defaultUntil('2026-03-12', 'week')).toBe('2026-06-12');
  });
});

describe('Prochain grand jour : un événement qui se répète une seule fois', () => {
  it('keeps the next occurrence of each series', async () => {
    const { firstOfSeries } = await import('../src/lib/repeat');
    const list = [{ id: 'y1', series: 'yoga' }, { id: 'x' }, { id: 'y2', series: 'yoga' }, { id: 's1', series: 'span-1' }, { id: 's2', series: 'span-1' }];
    expect(firstOfSeries(list).map(e => e.id)).toEqual(['y1', 'x', 's1']);
  });
});

describe('un jour d’un événement sur plusieurs jours glissé ailleurs', () => {
  it('tout l’événement suit, du même nombre de jours (le jour glissé partait seul)', async () => {
    const { spanMove } = await import('../src/lib/repeat');
    const days = ['2026-11-18', '2026-11-19', '2026-11-20'].map(date => ({ id: date, date, series: 'span-1' }));
    const other = { id: 'x', date: '2026-11-19', series: 'span-2' };
    expect(spanMove([...days, other], days[1], '2026-11-21')).toEqual([
      { id: '2026-11-18', from: '2026-11-18', to: '2026-11-20' },
      { id: '2026-11-19', from: '2026-11-19', to: '2026-11-21' },
      { id: '2026-11-20', from: '2026-11-20', to: '2026-11-22' },
    ]);
    // Vers le mois d'avant, et sans bouger.
    expect(spanMove(days, days[0], '2026-10-31').map(m => m.to)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(spanMove(days, days[2], '2026-11-20')).toEqual([]);
  });
});
