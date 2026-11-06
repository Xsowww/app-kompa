// Test n°3 (Majeur n°6): one truth for the reminders, whatever moves the event (drag, Kompaly, a series).
import { beforeEach, describe, expect, it } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { useCalendar } = await import('../src/store/calendar');
const { useTodos } = await import('../src/store/todos');
const { reminderMoment, remindersText, minutesBefore, shownReminders } = await import('../src/lib/reminders');

const at = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

beforeEach(() => useCalendar.setState({ events: [], trash: [] }));

describe('« la veille à 18h » reste à 18h quand l’événement bouge', () => {
  it('moved by an update without reminders (Kompaly, another screen): the fixed moment keeps its hour', () => {
    const eve = minutesBefore('2027-03-10', '14:00', '2027-03-09', '18:00');
    const ev = useCalendar.getState().add({ title: 'Kiné', date: '2027-03-10', start: '14:00', category: 'perso', reminders: [eve, 60] });
    useCalendar.getState().update(ev.id, { date: '2027-03-12', start: '04:30' });
    const moved = useCalendar.getState().events[0];
    // Camille's slid to 22:30; it stays the day before at 18:00, and « 1 h avant » stays one hour before.
    expect(moved.reminders!.map(m => at(reminderMoment(moved.date, moved.start, m))).sort()).toEqual(['2027-03-11 18:00', '2027-03-12 03:30']);
  });
  it('the next ones of a series follow too', () => {
    const eve = minutesBefore('2027-03-10', '14:00', '2027-03-09', '18:00');
    useCalendar.getState().addMany([
      { title: 'Cours', date: '2027-03-10', start: '14:00', category: 'cours', reminders: [eve], series: 's1' },
      { title: 'Cours', date: '2027-03-17', start: '14:00', category: 'cours', reminders: [eve], series: 's1' },
    ]);
    const first = useCalendar.getState().events.find(e => e.date === '2027-03-10')!;
    useCalendar.getState().updateSeries(first.id, { start: '09:00' });
    for (const e of useCalendar.getState().events) expect(at(reminderMoment(e.date, e.start, e.reminders![0])).slice(11)).toBe('18:00');
  });
  it('reminders given with the change are kept as given', () => {
    const ev = useCalendar.getState().add({ title: 'A', date: '2027-03-10', start: '14:00', category: 'perso', reminders: [60] });
    useCalendar.getState().update(ev.id, { start: '16:00', reminders: [] });
    expect(useCalendar.getState().events[0].reminders).toEqual([]);
  });
  it('a task moved keeps its fixed reminder at its hour', () => {
    useTodos.setState({ todos: [], trash: [] } as never);
    const todo = useTodos.getState().add('Appeler', '2027-03-10');
    useTodos.getState().update(todo.id, { reminders: [900] });
    useTodos.getState().update(todo.id, { due: '2027-03-15', time: '11:00' });
    const x = useTodos.getState().todos[0];
    expect(at(reminderMoment(x.due!, x.time, x.reminders![0]))).toBe('2027-03-14 18:00');
  });
});

describe('rappel test', () => {
  it('says word for word what its first real reminder will say', async () => {
    const { testMessage } = await import('../src/lib/reminderTest');
    const { upcomingReminders } = await import('../src/lib/reminders');
    const src = { kind: 'event' as const, id: 'e1', title: 'Kiné', date: '2099-03-10', time: '14:00', end: '15:00' };
    const real = upcomingReminders([{ ...src, reminders: [60, 1440] }], new Date(2099, 2, 1), 30)[0];
    const test = testMessage(src, [60, 1440]);
    expect(test.body).toBe(real.body);
    expect(test.url).toBe(real.url);
    expect(test.title).toBe('Essai : Kiné');
  });
});

describe('les mêmes rappels partout', () => {
  it('« Aucun » chosen stays none, the usual ones only when never chosen', () => {
    expect(shownReminders({ reminders: [], date: '2027-03-10', start: '14:00' }, [15])).toEqual([]);
    expect(shownReminders({ date: '2027-03-10', start: '14:00' }, [15])).toEqual([15]);
    expect(shownReminders({ date: '2027-03-10', start: '14:00' }, [15], true)).toEqual([]);
  });
  it('every reminder said, not only the soonest (« 15 min avant +1 » hid the « 1 h avant »)', () => {
    expect(remindersText([15, 60], '2027-03-10', '14:00')).toBe('15 min avant, 1 h avant');
    expect(remindersText([minutesBefore('2027-03-10', '14:00', '2027-03-10', '07:00')], '2027-03-10', '14:00')).toBe('Le jour même à 07:00');
  });
});
