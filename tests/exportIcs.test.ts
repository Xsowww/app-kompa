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
