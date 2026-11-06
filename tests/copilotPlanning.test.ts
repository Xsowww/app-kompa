import { describe, expect, it, vi } from 'vitest';

// Test n°3, majeurs 12 and 13: « salle dimanche 15 à 11h » made on Sunday the 8th; a revision session on Christmas
// Eve; « partiels du 5 janvier » not found in November.

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { parseQuickAdd } = await import('../src/lib/dates');
const { isPublicHoliday, restDay } = await import('../src/copilot/revisionPlan');
const { useCalendar } = await import('../src/store/calendar');
const { useSettings } = await import('../src/store/settings');
const { planRevisions, analyzeCalendar } = await import('../src/copilot/actions');

describe('« dimanche 15 »: the 15th that is a Sunday, not the next Sunday', () => {
  const base = new Date(2026, 1, 3, 10); // Tuesday 3 February 2026
  it('a day name and its number', () => {
    // Sunday 15 February 2026.
    expect(parseQuickAdd('salle dimanche 15 à 11h', base)).toMatchObject({ title: 'Salle', date: '2026-02-15', start: '11:00' });
    // Wednesday 15 April 2026 (the 15th of February and of March are Sundays).
    expect(parseQuickAdd('dentiste mercredi 15 à 9h', base).date).toBe('2026-04-15');
  });
  it('a name and a number that never meet within a year: the number wins', () => {
    expect(parseQuickAdd('réunion lundi 31 à 9h', base).date).toMatch(/-31$/);
  });
  it('an hour is still an hour (« lundi 21h-7h »), a month still a month', () => {
    expect(parseQuickAdd('garde lundi 21h-7h', base)).toMatchObject({ start: '21:00' });
    expect(parseQuickAdd('oral mardi 3 mars à 14h', base).date).toBe('2026-03-03');
  });
});

describe('revision sessions: never on a public holiday or the evening of the 24th or the 31st of December', () => {
  it('knows the French public holidays (Easter ones too)', () => {
    for (const d of ['2026-01-01', '2026-04-06', '2026-05-14', '2026-05-25', '2026-07-14', '2026-11-11', '2026-12-25']) expect(isPublicHoliday(d)).toBe(true);
    for (const d of ['2026-04-05', '2026-11-12', '2026-12-24']) expect(isPublicHoliday(d)).toBe(false);
    expect(restDay('2026-12-24')).toBe(true);
    expect(restDay('2026-12-31')).toBe(true);
    expect(restDay('2026-12-23')).toBe(false);
  });

  it('plans around them, before « partiels » on 5 January', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 15, 10)); // 15 December
    useSettings.setState({ usage: 'etudes', revisionTime: '18:00' });
    const exam = useCalendar.getState().add({ title: 'Partiels', date: '2027-01-05', start: '09:00', category: 'examen' });
    const res = planRevisions(exam.id, 6)!;
    const days = res.created.map(e => e.date);
    expect(days).toHaveLength(6);
    for (const d of days) expect(restDay(d)).toBe(false);
    vi.useRealTimers();
  });

  it('an exam two months ahead is in the analysis (it was cut at 30 days)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 6, 19));
    useCalendar.setState({ events: [], trash: [] });
    useCalendar.getState().add({ title: 'Partiels', date: '2027-01-05', category: 'examen' });
    expect(analyzeCalendar().exams.map(e => e.title)).toEqual(['Partiels']);
    vi.useRealTimers();
  });
});
