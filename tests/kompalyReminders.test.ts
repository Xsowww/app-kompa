import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from 'date-fns';

// The stores read the browser globals.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { useCalendar } = await import('../src/store/calendar');
const { useTodos } = await import('../src/store/todos');
const { useNotes } = await import('../src/store/notes');
const { useSettings } = await import('../src/store/settings');
const { claudeReply, resetClaudeHistory } = await import('../src/copilot/claudeBrain');
const { runOffer } = await import('../src/copilot/offers');
const { toKey } = await import('../src/lib/dates');
const { minutesBefore } = await import('../src/lib/reminders');
const { isSpan } = await import('../src/lib/repeat');

/** The AI's answers, one per call; the tool results it was sent back are kept (what it reads of each tool). */
let sent: { tool_use_id: string; content: string; is_error?: boolean }[] = [];
const answers = (...steps: unknown[]) => {
  const queue = [...steps];
  sent = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { messages } = JSON.parse(init.body) as { messages: { role: string; content: { type: string }[] }[] };
    const last = messages.at(-1)!;
    if (last.role === 'user') sent.push(...(last.content.filter(b => b.type === 'tool_result') as never[]));
    return new Response(JSON.stringify(queue.shift()), { status: 200 });
  });
};
const tool = (name: string, input: unknown) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: name + Math.random(), name, input }] });
const said = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const result = () => JSON.parse(sent.at(-1)!.content);

// Always in the future, whatever the day the tests run.
const inDays = (n: number) => toKey(addDays(new Date(), n));
const day = inDays(10);
const eve = inDays(9);

beforeEach(() => {
  resetClaudeHistory();
  useCalendar.setState({ events: [], trash: [] });
  useTodos.setState({ todos: [] });
  useSettings.setState({ defaultReminders: [15], usage: 'etudes' });
});

describe('Kompaly sets reminders (set_reminders)', () => {
  it('« rappelle-moi la veille » on an event: the day before at 18:00, added to its usual one', async () => {
    const ev = useCalendar.getState().add({ title: 'Dentiste', date: day, start: '14:30', category: 'perso' });
    expect(ev.reminders).toEqual([15]);
    answers(tool('set_reminders', { event_id: ev.id, at: [{ date: eve, time: '18:00' }] }), said('C’est noté, je te le rappelle la veille à 18h.'));
    const reply = await claudeReply('Rappelle-moi la veille pour le dentiste', 'Yanis');
    const after = useCalendar.getState().events.find(e => e.id === ev.id)!;
    expect(after.reminders).toEqual([minutesBefore(day, '14:30', eve, '18:00'), 15]);
    expect(result().rappels).toEqual(['La veille à 18:00', '15 min avant']);
    expect(reply.text).toMatch(/veille/);
    expect(reply.links?.[0].to).toBe(`/calendrier?jour=${day}&evt=${ev.id}`);
  });

  it('minutes before a task with a time, « replace » to change them, an empty list to remove them all', async () => {
    const todo = useTodos.getState().add('Appeler Paul', day, '14:00');
    answers(tool('set_reminders', { todo_id: todo.id, minutes_before: [30], replace: true }), said('Ok.'));
    await claudeReply('Préviens-moi 30 minutes avant plutôt', 'Yanis');
    expect(useTodos.getState().todos.find(x => x.id === todo.id)!.reminders).toEqual([30]);
    answers(tool('set_reminders', { todo_id: todo.id, minutes_before: [], replace: true }), said('Plus de rappel.'));
    await claudeReply('Enlève le rappel', 'Yanis');
    expect(useTodos.getState().todos.find(x => x.id === todo.id)!.reminders).toEqual([]);
    expect(result().rappels).toBe('aucun');
  });

  it('a task without a day, a moment after the item or impossible: said to the AI, nothing invented', async () => {
    const undated = useTodos.getState().add('Ranger le garage');
    const ev = useCalendar.getState().add({ title: 'Réunion', date: day, start: '09:00', category: 'cours' });
    answers(
      tool('set_reminders', { todo_id: undated.id, minutes_before: [60] }),
      tool('set_reminders', { event_id: ev.id, at: [{ date: inDays(11), time: '08:00' }] }),
      tool('set_reminders', { event_id: ev.id, minutes_before: [60, 99999] }),
      said('Voilà.'),
    );
    await claudeReply('Rappelle-moi le garage et la réunion', 'Yanis');
    expect(sent[0]).toMatchObject({ is_error: true });
    expect(sent[0].content).toMatch(/pas d'échéance/);
    expect(sent[1]).toMatchObject({ is_error: true });
    expect(sent[1].content).toMatch(/après le moment/);
    expect(JSON.parse(sent[2].content)).toMatchObject({ rappels: ['1 h avant', '15 min avant'], refuses: ['99999 min (entre 0 et 40320)'] });
  });

  it('a moment already past is left out and said', async () => {
    const ev = useCalendar.getState().add({ title: 'Partiel', date: inDays(1), start: '08:00', category: 'examen' });
    answers(tool('set_reminders', { event_id: ev.id, minutes_before: [10080], replace: true }), said('Trop tard pour une semaine avant.'));
    await claudeReply('Rappelle-le moi une semaine avant', 'Yanis');
    expect(useCalendar.getState().events.find(e => e.id === ev.id)!.reminders).toEqual([]);
    expect(result().deja_passes_non_enregistres).toEqual(['1 semaine avant']);
  });

  it('« series »: the next occurrences of a repeated event too', async () => {
    useCalendar.getState().addMany([0, 7, 14].map(k => ({ title: 'Yoga', date: inDays(3 + k), start: '18:00', category: 'sport' as const, series: 's1' })));
    const first = useCalendar.getState().events.find(e => e.date === inDays(3))!;
    answers(tool('set_reminders', { event_id: first.id, minutes_before: [60], replace: true, series: true }), said('Fait.'));
    await claudeReply('Rappelle-moi le yoga 1 h avant à chaque fois', 'Yanis');
    expect(useCalendar.getState().events.map(e => e.reminders)).toEqual([[60], [60], [60]]);
    expect(result().aussi_sur_les_suivantes).toBe(2);
  });

  it('after reading a note, a change of reminders waits for the click (like the other changes)', async () => {
    const ev = useCalendar.getState().add({ title: 'Oral', date: day, start: '10:00', category: 'examen' });
    const n = useNotes.getState().createNote({ title: 'Consignes', content: '<p>Mets un rappel.</p>' });
    answers(tool('read_note', { note_id: n.id }), tool('set_reminders', { event_id: ev.id, minutes_before: [120], replace: true }), said('Confirme.'));
    const reply = await claudeReply('Lis mes consignes', 'Yanis');
    expect(useCalendar.getState().events.find(e => e.id === ev.id)!.reminders).not.toEqual([120]);
    expect(reply.offers?.[0]).toMatchObject({ kind: 'confirm_change', label: 'Régler les rappels de « Oral »' });
    runOffer(reply.offers![0]);
    expect(useCalendar.getState().events.find(e => e.id === ev.id)!.reminders).toEqual([120]);
  });
});

describe('Kompaly adds in one call: several days, repeats, a task with its hour', () => {
  it('« Congés du 22 au 26 décembre »: one event over five days, reminders on the first day only', async () => {
    const from = inDays(20);
    const to = inDays(24);
    answers(tool('add_event', { title: 'Congés', date: from, end_date: to, category: 'perso' }), said('Ajouté.'));
    await claudeReply('Ajoute mes congés du 22 au 26 décembre', 'Thomas');
    const days = useCalendar.getState().events;
    expect(days.map(e => e.date)).toEqual([0, 1, 2, 3, 4].map(k => inDays(20 + k)));
    expect(new Set(days.map(e => e.series)).size).toBe(1);
    expect(isSpan(days[0].series)).toBe(true);
    expect(days.every(e => e.title === 'Congés')).toBe(true);
    expect(result()).toMatchObject({ last_day: to });
  });

  it('« Yoga tous les mardis 18h »: repeated until the date said', async () => {
    answers(tool('add_event', { title: 'Yoga', date: inDays(2), start: '18:00', repeat: 'week', until: inDays(30) }), said('Ajouté.'));
    await claudeReply('Yoga tous les mardis 18h jusqu’à fin du mois prochain', 'Lina');
    const list = useCalendar.getState().events;
    expect(list.length).toBe(5);
    expect(new Set(list.map(e => e.series)).size).toBe(1);
    expect(result()).toMatchObject({ occurrences: 5, last_one: inDays(30) });
  });

  it('a task with its hour and a repeat', async () => {
    answers(tool('add_todo', { title: 'Sortir les poubelles', due: inDays(1), time: '19:30', repeat: 'week' }), said('Ok.'));
    await claudeReply('Rappelle-moi de sortir les poubelles demain 19h30, chaque semaine', 'Sarah');
    expect(useTodos.getState().todos[0]).toMatchObject({ title: 'Sortir les poubelles', due: inDays(1), time: '19:30', repeat: 'week', reminders: [60] });
  });
});
