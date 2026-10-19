import { create } from 'zustand';
import { useTodos } from './todos';
import { t } from '../i18n';

/** Title of the starter task that launches the tour (TodoList shows a « Lancer » button on it), in the account's language.
 *  No-break space in « 1 min »: « (1 » and « min) » never end up on two lines. */
export const TOUR_TODO = t('Faire le tour de Kompaly (1\u00a0min)');
/** Older accounts still have the task with a plain space, or under the name the app had before Kompaly. */
export const isTourTodo = (title: string) => {
  const x = title.replace(/\u00a0/g, ' ');
  return x === 'Faire le tour de Kompaly (1 min)' || x === 'Faire le tour de Kompa (1 min)' || x === TOUR_TODO.replace(/\u00a0/g, ' ');
};

/** Current step of the guided tour (components/Tour), null when it isn't running. */
export const useTour = create<{ step: number | null }>(() => ({ step: null }));

export function startTour() {
  useTour.setState({ step: 0 });
}

/** End of the tour, finished or skipped: the starter task is ticked off. */
export function endTour() {
  useTour.setState({ step: null });
  const todos = useTodos.getState();
  const t = todos.todos.find(x => isTourTodo(x.title) && !x.done);
  if (t) todos.toggle(t.id);
}
