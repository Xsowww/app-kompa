import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../src/store/calendar';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { planFeed, stableId, feedName, feedMark } = await import('../src/lib/icsFeeds');

const ev = (id: string, date: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, title: 'Maths', date, start: '08:00', category: 'cours', done: false, createdAt: 'x', externalId: feedMark('f1') + id, ...extra });
const it_ = (id: string, date: string, title = 'Maths', start = '08:00') => ({ id, externalId: id, title, date, start });

describe('abonnement à un emploi du temps', () => {
  it('adds what is new from today, updates what moved, removes what the link dropped', () => {
    const events = [ev('a', '2026-11-02'), ev('b', '2026-11-03'), ev('old', '2026-10-01'), ev('c', '2026-11-04', { done: true, category: 'examen' })];
    const plan = planFeed('f1', [it_('a', '2026-11-02'), it_('c', '2026-11-05', 'Maths (salle B)'), it_('n', '2026-11-06'), it_('p', '2026-10-02')], events, [], '2026-10-25');
    expect(plan.add.map(e => e.id)).toEqual(['n']);
    expect(plan.add[0].externalId).toBe('feed:f1:n');
    expect(plan.updates).toEqual([{ id: 'c', patch: { title: 'Maths (salle B)', date: '2026-11-05', start: '08:00', end: undefined, details: undefined } }]);
    expect(plan.remove).toEqual(['b']); // « old » is past: kept
  });
  it('one deleted by the student stays deleted; another feed is not touched', () => {
    const other = ev('z', '2026-11-02', { externalId: 'feed:f2:z' });
    const plan = planFeed('f1', [it_('t', '2026-11-02')], [other], [ev('t', '2026-11-02')], '2026-10-25');
    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual([]);
  });
  it('a link with only the past, when asked: its past is added', () => {
    expect(planFeed('f1', [it_('p', '2026-07-03')], [], [], '2026-10-25').add).toEqual([]);
    expect(planFeed('f1', [it_('p', '2026-07-03')], [], [], '2026-10-25', 'x', true).add.map(e => e.date)).toEqual(['2026-07-03']);
  });
  it('same text, same id (two devices make the same event)', async () => {
    const a = await stableId('feed:f1:UID-1');
    expect(a).toBe(await stableId('feed:f1:UID-1'));
    expect(a).not.toBe(await stableId('feed:f1:UID-2'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('its name', () => {
    expect(feedName('BEGIN:VCALENDAR\nX-WR-CALNAME:L2 Droit\\, groupe 3\n', 'https://x.fr')).toBe('L2 Droit, groupe 3');
    expect(feedName('BEGIN:VCALENDAR\n', 'webcal://www.hyperplanning.fr/x')).toBe('hyperplanning.fr');
    expect(feedName('BEGIN:VCALENDAR\r\nX-WR-CALNAME;LANGUAGE=fr:HYP - DUPONT Lina (Aix-en-Prove\r\n nce | M1) - du 01 septembre 2025 au 11 octobre 2026\r\n', 'https://x.fr')).toBe('HYP - DUPONT Lina (Aix-en-Provence | M1)');
  });
});
