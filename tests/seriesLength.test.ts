import { beforeEach, describe, expect, it } from 'vitest';

// Test n°3, bloquant n°1: a night (22:00 → 07:00) or the school holidays (.ics) refused by the server with
// 23514 events_series_check: « span- » + a UUID is 41 characters, the server takes 40.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { useCalendar } = await import('../src/store/calendar');
const { parseIcs } = await import('../src/lib/ics');
const { fitSeries, newSeries, SERIES_MAX } = await import('../src/lib/seriesId');
const { isSpan, spanDays } = await import('../src/lib/repeat');

const UUID = '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e3f';

beforeEach(() => useCalendar.setState({ events: [], trash: [] }));

describe('identifiant de série accepté par le serveur (≤ 40 caractères)', () => {
  it('une nuit faite comme avant (« span- » + UUID) est enregistrée avec une série courte, la même pour ses deux jours', () => {
    const series = `span-${UUID}`;
    expect(series.length).toBe(41);
    useCalendar.getState().addMany(spanDays('2026-11-20', '2026-11-21', '22:00', '07:00').map(d => ({ title: 'Garde de nuit', category: 'perso' as const, ...d, series })));
    const got = useCalendar.getState().events.map(e => e.series!);
    expect(got).toHaveLength(2);
    expect(got[0]).toBe(got[1]);
    expect(got[0].length).toBeLessThanOrEqual(SERIES_MAX);
    expect(isSpan(got[0])).toBe(true);
  });

  it('changer la série d’un événement la raccourcit aussi', () => {
    const ev = useCalendar.getState().add({ title: 'Nuit', category: 'perso', date: '2026-11-20' });
    useCalendar.getState().update(ev.id, { series: `span-${UUID}` });
    expect(useCalendar.getState().events[0].series!.length).toBeLessThanOrEqual(SERIES_MAX);
  });

  it('les vacances scolaires (.ics, UID long) gardent leurs jours reliés, sous la limite', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:vacances-toussaint-2026-zone-a-academie-de-lyon@education.gouv.fr',
      'DTSTART;VALUE=DATE:20261017',
      'DTEND;VALUE=DATE:20261102',
      'SUMMARY:Vacances de la Toussaint',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const list = parseIcs(text, { now: new Date(2026, 9, 1) });
    expect(list.length).toBeGreaterThan(1);
    const all = new Set(list.map(e => e.series));
    expect(all.size).toBe(1);
    const [s] = all;
    expect(s!.length).toBeLessThanOrEqual(SERIES_MAX);
    expect(isSpan(s)).toBe(true);
  });

  it('fitSeries : court inchangé, long raccourci toujours de la même façon', () => {
    expect(fitSeries('span-rome_20261029')).toBe('span-rome_20261029');
    expect(fitSeries(undefined)).toBeUndefined();
    const long = `span-${UUID}`;
    expect(fitSeries(long)).toBe(fitSeries(long));
    expect(fitSeries(long)).not.toBe(fitSeries(`span-${UUID.replace('3f', '4f')}`));
    expect(fitSeries('x'.repeat(80))!.startsWith('span-')).toBe(false);
    expect(newSeries(true).length).toBeLessThanOrEqual(SERIES_MAX);
    expect(isSpan(newSeries(true))).toBe(true);
  });
});
