import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../src/store/calendar';
// @ts-expect-error -- server module in plain JavaScript
import { feedStatus } from '../server/icsFeed.mjs';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
  document: { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } }, querySelector: () => null },
});
const { calendarIcs, BACKUP_APPS } = await import('../src/lib/backup');
const { feedErrorText, feedMark } = await import('../src/lib/icsFeeds');
const { parseIcs } = await import('../src/lib/ics');

const ev = (id: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, title: id, date: '2026-11-09', start: '09:30', category: 'perso', done: false, createdAt: '', ...extra });

describe('export .ics', () => {
  it('my events only, not the ones of a calendar followed by link (they would come twice in Google)', () => {
    const text = calendarIcs([ev('dentiste'), ev('ferie', { externalId: `${feedMark('f1')}uid-1`, start: undefined }), ev('importe', { externalId: 'uid-import' })], new Date(Date.UTC(2026, 10, 6)));
    expect(text).toContain('SUMMARY:dentiste');
    expect(text).toContain('SUMMARY:importe');
    expect(text).not.toContain('SUMMARY:ferie');
  });
  it('says Kompaly, never the old name', () => {
    const text = calendarIcs([ev('a')]);
    expect(text).toContain('UID:a@kompaly');
    expect(text.toLowerCase()).not.toContain('cop-pilot');
  });
  it('reminders are written as alarms (VALARM), relative to the start, and the app reads its own file back', () => {
    const events = [
      ev('Examen, « maths »', { reminders: [15, 60, 1440, 1530, 0], details: 'Salle B12' }),
      ev('Toute la journée', { start: undefined, reminders: [0, 900, 540] }), // at 9:00 that day, the day before at 18:00, at midnight
      ev('Sans rappel', { reminders: [] }),
      ev('Jamais choisi'),
    ];
    const text = calendarIcs(events, new Date(Date.UTC(2026, 10, 6)));
    const blocks = text.split('BEGIN:VEVENT').slice(1);
    const triggers = (b: string) => [...b.matchAll(/^TRIGGER:(.*)$/gm)].map(m => m[1].trim());
    expect(triggers(blocks[0])).toEqual(['PT0M', '-PT15M', '-PT1H', '-P1D', '-P1DT1H30M']);
    expect(triggers(blocks[1])).toEqual(['PT9H', 'PT0M', '-PT6H']);
    expect(triggers(blocks[2])).toEqual([]);
    expect(triggers(blocks[3])).toEqual([]);
    // Each alarm is whole and inside its event (RFC 5545 §3.6.6: ACTION, DESCRIPTION and TRIGGER for a DISPLAY alarm).
    expect(blocks[0].match(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Examen\\, « maths »\r\nTRIGGER:[^\r]+\r\nEND:VALARM\r\n/g)).toHaveLength(5);
    expect(blocks[0].trimEnd().endsWith('END:VALARM\r\nEND:VEVENT')).toBe(true);
    // The usual reminders (Réglages › Notifications) of an event never given any: the caller's choice.
    expect(triggers(calendarIcs([ev('Jamais choisi')], new Date(), () => [30]))).toEqual(['-PT30M']);
    // The app's own import: the same four events, their notes not replaced by an alarm's text.
    const back = parseIcs(text, { now: new Date(2026, 10, 6) });
    expect(back.map(e => e.title)).toEqual(['Toute la journée', 'Examen, « maths »', 'Sans rappel', 'Jamais choisi']);
    expect(back[1]).toMatchObject({ date: '2026-11-09', start: '09:30', details: 'Salle B12' });
    expect(back[0].start).toBeUndefined();
    // …and their reminders come back as they were (most distant first).
    expect(back[1].reminders).toEqual([1530, 1440, 60, 15, 0]);
    expect(back[0].reminders).toEqual([900, 540, 0]);
    expect(back[2].reminders).toBeUndefined();
  });
  it('the backups saved under the old name still open', () => {
    expect(BACKUP_APPS).toEqual(['kompaly', 'cop-pilot']);
  });
});

describe('un lien .ics faux', () => {
  it('« ce lien ne donne pas un agenda », not « the calendar doesn’t answer » (and no 502 for a wrong link)', () => {
    for (const code of ['not_ics', 'web_page', 'http_400', 'http_405']) {
      expect(feedErrorText(code), code).toContain('Ce lien ne donne pas un agenda');
      expect(feedStatus(code), code).toBe(422);
    }
    expect(feedStatus('bad_url')).toBe(400);
    expect(feedStatus('unreachable')).toBe(502);
    expect(feedStatus('http_503')).toBe(502);
    expect(feedErrorText('unreachable')).toContain('ne répond pas');
  });
});
