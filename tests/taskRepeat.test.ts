import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The stores reach for the browser when they load: give them the globals they read.
const memory = new Map<string, string>();
const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) };
Object.assign(globalThis, { location: new URL('http://localhost/'), localStorage: storage, sessionStorage: storage });
const { nextDue, repeatIn } = await import('../src/lib/taskRepeat');
const { useTodos } = await import('../src/store/todos');
const { useSettings } = await import('../src/store/settings');
const { useCalendar } = await import('../src/store/calendar');
const { reminderAction } = await import('../src/lib/reminderActions');
const { collectTrash, restoreTrash } = await import('../src/lib/trash');

describe('tâches qui se répètent', () => {
  it('la prochaine échéance : la suivante de la série, ou la première à partir d’aujourd’hui si cochée en retard', () => {
    expect(nextDue('2026-11-03', 'day', '2026-11-03')).toBe('2026-11-04');
    expect(nextDue('2026-11-03', 'week', '2026-11-03')).toBe('2026-11-10');
    expect(nextDue('2026-11-03', 'month', '2026-11-03')).toBe('2026-12-03');
    expect(nextDue('2026-11-03', 'year', '2026-11-03')).toBe('2027-11-03');
    expect(nextDue('2026-10-30', 'day', '2026-11-03')).toBe('2026-11-03'); // trois jours de retard : celle d’aujourd’hui
    expect(nextDue('2026-10-20', 'week', '2026-11-03')).toBe('2026-11-03');
    expect(nextDue('2026-10-21', 'week', '2026-11-03')).toBe('2026-11-04');
    // Le 31 : fin février, puis de nouveau le 31.
    expect(nextDue('2027-01-31', 'month', '2027-01-31')).toBe('2027-02-28');
    expect(nextDue('2027-01-31', 'month', '2027-03-01')).toBe('2027-03-31');
    expect(nextDue('2028-02-29', 'year', '2028-02-29')).toBe('2029-02-28');
  });

  it('l’ajout rapide comprend « tous les jours », « chaque année », « every week »', () => {
    expect(repeatIn('Arroser les plantes tous les jours', 'fr')).toEqual({ text: 'Arroser les plantes', repeat: 'day' });
    expect(repeatIn('Anniversaire de Léa chaque année', 'fr')).toEqual({ text: 'Anniversaire de Léa', repeat: 'year' });
    expect(repeatIn('Payer le loyer tous les mois le 5', 'fr')).toEqual({ text: 'Payer le loyer le 5', repeat: 'month' });
    expect(repeatIn('Toutes les semaines : ménage', 'fr')).toEqual({ text: ': ménage', repeat: 'week' });
    expect(repeatIn('Call mum every week', 'en')).toEqual({ text: 'Call mum', repeat: 'week' });
    expect(repeatIn('Acheter du pain', 'fr')).toEqual({ text: 'Acheter du pain' });
    expect(repeatIn('Les toujours vrais', 'fr').repeat).toBeUndefined();
  });
});

describe('tâches : cocher, corbeille, rappels', () => {
  beforeEach(() => {
    useTodos.setState({ todos: [], trash: [] });
    useCalendar.setState({ events: [], trash: [] });
    useSettings.setState({ reminderSnoozes: [], defaultTaskReminders: [900, 0] });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 3, 10, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('cochée, une tâche qui se répète revient avec sa prochaine échéance ; décochée, cette copie s’en va', () => {
    const s = useTodos.getState();
    const x = s.add('Sport', '2026-11-03');
    s.update(x.id, { repeat: 'day' });
    useTodos.getState().toggle(x.id);
    const after = useTodos.getState().todos;
    expect(after).toHaveLength(2);
    const next = after.find(y => y.id !== x.id)!;
    expect(next).toMatchObject({ title: 'Sport', due: '2026-11-04', repeat: 'day', done: false });
    useTodos.getState().toggle(x.id);
    expect(useTodos.getState().todos.map(y => [y.id, y.done])).toEqual([[x.id, false]]);
  });

  it('supprimée, une tâche va à la corbeille et en revient ; 30 jours après, elle part', () => {
    const x = useTodos.getState().add('Acheter une calculatrice');
    useTodos.getState().remove(x.id);
    expect(useTodos.getState().todos).toEqual([]);
    expect(useTodos.getState().trash[0]).toMatchObject({ id: x.id, deletedAt: new Date(2026, 10, 3, 10, 0).toISOString() });
    useTodos.getState().restore([x.id]);
    expect(useTodos.getState().todos[0].deletedAt).toBeUndefined();
    useTodos.getState().remove(x.id);
    // In the Corbeille, « Tâches »: restored from there too.
    const entry = collectTrash().find(e => e.id === x.id);
    expect(entry).toMatchObject({ type: 'tasks', kind: 'task', name: 'Acheter une calculatrice' });
    expect(restoreTrash([x.id]).href).toBe(`/taches?tache=${x.id}`);
    useTodos.getState().remove(x.id);
    vi.setSystemTime(new Date(2026, 11, 4, 10, 0));
    useTodos.getState().purgeExpired();
    expect(useTodos.getState().trash).toEqual([]);
  });

  it('les rappels par défaut d’une nouvelle tâche suivent le réglage', () => {
    useSettings.setState({ defaultTaskReminders: [0] });
    expect(useTodos.getState().add('Dossier', '2026-11-05').reminders).toEqual([0]);
    useSettings.setState({ defaultTaskReminders: [] });
    expect(useTodos.getState().add('Dossier', '2026-11-05').reminders).toEqual([]);
  });

  it('« Plus tard » garde un report par élément ; « Fait » ne coche qu’une fois', () => {
    const x = useTodos.getState().add('Envoyer le devis', '2026-11-03');
    const key = `task:${x.id}:0:2026-11-03T09:00`;
    reminderAction('later', [key]);
    reminderAction('later', [key]);
    expect(useSettings.getState().reminderSnoozes).toEqual([{ item: `task:${x.id}`, at: new Date(2026, 10, 3, 10, 10).toISOString() }]);
    reminderAction('done', [key]);
    reminderAction('done', [key]); // le même geste reçu deux fois (deux onglets)
    expect(useTodos.getState().todos.find(y => y.id === x.id)?.done).toBe(true);
    reminderAction('done', ['task:matin:2026-11-03', key]); // le résumé du matin : pas un élément
    expect(useTodos.getState().todos.find(y => y.id === x.id)?.done).toBe(true);
  });
});
