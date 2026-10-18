// « Ma semaine » on the home page: what is planned this week and how much of it is done.

import type { Todo } from '../store/todos';
import { toKey } from './dates';

/**
 * What counts for « ma semaine », among the tasks (Tâches): everything still to do by the end of the week
 * (due this week, late, or with no due day at all) and what was ticked this week. Tasks due later wait for
 * their week. Calendar events, homework included, stay in the calendar (« À venir », « Prochaine échéance »).
 */
export function weekItems(todos: Todo[], from: string, to: string) {
  const inWeek = (key?: string) => !!key && key >= from && key <= to;
  const tasks = todos.filter(t => (t.done ? inWeek(t.doneAt && toKey(new Date(t.doneAt))) /* the local day it was ticked */ || inWeek(t.due) : !t.due || t.due <= to));
  const total = tasks.length;
  const done = tasks.filter(t => t.done).length;
  // What is left, soonest first: where « Ma semaine » sends you to tick the next one.
  const left = tasks.filter(t => !t.done).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.time ?? '').localeCompare(b.time ?? ''));
  return { total, done, left };
}

/** A sentence that pulls toward the next tick. */
export function cheer(done: number, total: number): string {
  if (!total) return 'Rien à faire d’ici dimanche. Ajoute une tâche pour la suivre ici.';
  const left = total - done;
  if (!left) return 'Toutes tes tâches de la semaine sont faites, bravo !';
  if (!done) return `C’est parti : ${total === 1 ? 'une tâche' : `${total} tâches`} à faire cette semaine.`;
  const toHalf = Math.ceil(total / 2) - done;
  if (toHalf > 0 && left > 1) return `Plus que ${toHalf} pour passer la moitié.`;
  return left === 1 ? 'Plus qu’une, tu y es presque !' : `Plus que ${left}, tu y es presque.`;
}
