// Tasks that repeat: one task at a time. Ticked, the next one is made with the next due day (store/todos › toggle).
// Pure functions, tested in tests/taskRepeat.test.ts.

import { addDays, addMonths, addYears } from 'date-fns';
import { fromKey, toKey } from './dates';
import { lang, t, type Lang } from '../i18n';

export type TaskRepeat = 'day' | 'week' | 'month' | 'year';

export const TASK_REPEATS: { key: TaskRepeat; label: string }[] = [
  { key: 'day', label: t('Chaque jour') },
  { key: 'week', label: t('Chaque semaine') },
  { key: 'month', label: t('Chaque mois') },
  { key: 'year', label: t('Chaque année') },
];

export const isTaskRepeat = (v: unknown): v is TaskRepeat => TASK_REPEATS.some(r => r.key === v);

const step = (due: string, every: TaskRepeat, k: number) => {
  const d = fromKey(due);
  // Counted from the ticked one's day each time: after a short month, « le 31 » stays on that month's last day
  // (Jan. 31, Feb. 28, then Mar. 28). The task's dialog says so (pages/tasks/TaskDialog).
  return toKey(every === 'day' ? addDays(d, k) : every === 'week' ? addDays(d, 7 * k) : every === 'month' ? addMonths(d, k) : addYears(d, k));
};

/**
 * The next due day after `due`: the following one of the series, or — ticked late — the first one from today
 * (« sport, chaque jour » ticked three days late: today's comes, not three more already late).
 */
export function nextDue(due: string, every: TaskRepeat, today: string): string {
  for (let k = 1; k < 4000; k++) {
    const d = step(due, every, k);
    if (d >= today) return d;
  }
  return today;
}

// « tous les jours », « every week »…: in the quick add, the words are taken out of the title.
const WORDS: Record<Lang, Record<TaskRepeat, string>> = {
  fr: { day: 'tous les jours|chaque jour', week: 'toutes les semaines|chaque semaine', month: 'tous les mois|chaque mois', year: 'tous les ans|toutes les ann[ée]es|chaque ann[ée]e' },
  en: { day: 'every day', week: 'every week', month: 'every month', year: 'every year' },
  es: { day: 'todos los d[ií]as|cada d[ií]a', week: 'todas las semanas|cada semana', month: 'todos los meses|cada mes', year: 'todos los a[ñn]os|cada a[ñn]o' },
  de: { day: 'jeden tag|t[äa]glich', week: 'jede woche|w[öo]chentlich', month: 'jeden monat|monatlich', year: 'jedes jahr|j[äa]hrlich' },
  it: { day: 'ogni giorno|tutti i giorni', week: 'ogni settimana|tutte le settimane', month: 'ogni mese|tutti i mesi', year: 'ogni anno|tutti gli anni' },
};

/** « Arroser les plantes tous les jours » → the title without the words, and 'day'. Nothing found: the text as it was. */
export function repeatIn(text: string, language: Lang = lang): { text: string; repeat?: TaskRepeat } {
  for (const [key, words] of Object.entries(WORDS[language] ?? WORDS.fr) as [TaskRepeat, string][]) {
    const m = new RegExp(`(^|\\s)(?:${words})(?=$|[\\s,.!])`, 'i').exec(text);
    if (m) return { text: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(), repeat: key };
  }
  return { text };
}
