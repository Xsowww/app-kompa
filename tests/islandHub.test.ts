import { describe, expect, it } from 'vitest';
import { approach, minutesUntil, pushEntry, share, upcoming, type IslandEntry } from '../src/components/islandHub';
import type { CalendarEvent } from '../src/store/calendar';

const ev = (id: string, date: string, start?: string, end?: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: id,
  date,
  start,
  end,
  category: 'perso',
  done: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...extra,
});

describe('the island’s history', () => {
  const e = (id: string, at: number): IslandEntry => ({ id, kind: 'toast', text: id, at });
  it('the latest first, each once', () => {
    let list: IslandEntry[] = [];
    list = pushEntry(list, e('a', 1));
    list = pushEntry(list, e('b', 2));
    list = pushEntry(list, { ...e('a', 3), text: 'a again' });
    expect(list.map(x => x.id)).toEqual(['a', 'b']);
    expect(list[0].text).toBe('a again');
  });
  it('keeps at most `max`', () => {
    let list: IslandEntry[] = [];
    for (let i = 0; i < 40; i++) list = pushEntry(list, e(String(i), i), 30);
    expect(list).toHaveLength(30);
    expect(list[0].id).toBe('39');
  });
});

describe('what comes next', () => {
  const today = '2026-11-06';
  const events = [
    ev('passé', today, '08:00', '09:00'),
    ev('en cours', today, '13:00', '15:00'),
    ev('tantôt', today, '17:30'),
    ev('journée', today),
    ev('demain', '2026-11-07', '11:00'),
    ev('corbeille', '2026-11-07', '09:00', undefined, { deletedAt: '2026-11-05T00:00:00.000Z' }),
    ev('séjour J1', '2026-11-09', undefined, undefined, { series: 'span-1' }),
    ev('séjour J2', '2026-11-10', undefined, undefined, { series: 'span-1' }),
  ];
  it('today’s not over yet (timed, then the whole day), then the next days', () => {
    expect(upcoming(events, today, '14:00', 10).map(x => x.id)).toEqual(['en cours', 'tantôt', 'journée', 'demain', 'séjour J1']);
  });
  it('n of them', () => {
    expect(upcoming(events, today, '16:00', 2).map(x => x.id)).toEqual(['tantôt', 'journée']);
  });
  it('minutes until an event of today with a time', () => {
    const now = new Date(2026, 10, 6, 16, 50);
    expect(minutesUntil(ev('x', today, '17:30'), today, now)).toBe(40);
    expect(minutesUntil(ev('x', today, '16:00'), today, now)).toBeNull();
    expect(minutesUntil(ev('x', today), today, now)).toBeNull();
    expect(minutesUntil(ev('x', '2026-11-07', '09:00'), today, now)).toBeNull();
  });
  it('the ring empties as it comes', () => {
    expect(approach(null)).toBe(1);
    expect(approach(240)).toBe(1);
    expect(approach(60)).toBe(0.5);
    expect(approach(0)).toBe(0);
  });
  it('a share, safe with nothing', () => {
    expect(share(0, 0)).toBe(0);
    expect(share(3, 4)).toBe(0.75);
    expect(share(5, 4)).toBe(1);
  });
});
