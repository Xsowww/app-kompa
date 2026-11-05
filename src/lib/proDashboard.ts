// The « Affichage Pro » home page (pages/DashboardPro): the day in numbers (rings, chips), the week in bars, and which
// space or subject a task belongs to. Pure functions, no store: the page gives them its data.

import { addDays } from 'date-fns';
import type { Todo } from '../store/todos';
import type { FocusSession } from '../store/focusLog';
import type { CalendarEvent } from '../store/calendar';
import type { Usage } from './usage';
import { fromKey, toKey } from './dates';
import { normalize } from './utils';

/** The local day a task was ticked (YYYY-MM-DD). */
export const doneDay = (x: Pick<Todo, 'doneAt'>) => (x.doneAt ? toKey(new Date(x.doneAt)) : undefined);

const byDue = (a: Todo, b: Todo) =>
  (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.time ?? '99').localeCompare(b.time ?? '99') || a.createdAt.localeCompare(b.createdAt);

/**
 * Today's tasks: those still open that are late or due today, and those ticked today. `total` is what the day asked
 * (« faites aujourd’hui 2 / 5 »): a task ticked today counts even if it was due another day.
 */
export function dayTasks(todos: Todo[], today: string) {
  const late = todos.filter(x => !x.done && !!x.due && x.due < today).sort(byDue);
  const due = todos.filter(x => !x.done && x.due === today).sort(byDue);
  const done = todos.filter(x => x.done && doneDay(x) === today).sort((a, b) => (a.doneAt ?? '').localeCompare(b.doneAt ?? ''));
  // When nothing is asked today: what comes next (soonest first, then those without a day).
  const next = todos.filter(x => !x.done && (!x.due || x.due > today)).sort(byDue);
  return { late, due, done, next, total: late.length + due.length + done.length };
}

/** Minutes of concentration logged on a local day. */
export const focusOn = (sessions: FocusSession[], day: string) =>
  sessions.reduce((n, s) => (toKey(new Date(s.startedAt)) === day ? n + s.minutes : n), 0);

export interface WeekDay {
  day: string;
  /** Tasks ticked that day. */
  tasks: number;
  /** Minutes of concentration that day. */
  focus: number;
  when: 'past' | 'today' | 'future';
}

/** Monday to Sunday of the week starting `monday`: tasks ticked and minutes of concentration per day. */
export function weekDays(todos: Todo[], sessions: FocusSession[], monday: string, today: string): WeekDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = toKey(addDays(fromKey(monday), i));
    return {
      day,
      tasks: todos.filter(x => x.done && doneDay(x) === day).length,
      focus: focusOn(sessions, day),
      when: day < today ? 'past' : day === today ? 'today' : 'future',
    };
  });
}

/**
 * This week against the same days of last week (Monday up to today's week day), in %: null when last week had
 * nothing to compare with.
 */
export function weekDelta(todos: Todo[], sessions: FocusSession[], monday: string, today: string, kind: 'tasks' | 'focus') {
  const span = Math.round((fromKey(today).getTime() - fromKey(monday).getTime()) / 864e5) + 1;
  const sum = (from: string) =>
    weekDays(todos, sessions, from, today)
      .slice(0, span)
      .reduce((n, d) => n + d[kind], 0);
  const before = sum(toKey(addDays(fromKey(monday), -7)));
  if (!before) return null;
  return Math.round(((sum(monday) - before) / before) * 100);
}

/**
 * The marks of the week chart's axis, highest first, ending at 0: whole tasks, or minutes in whole hours (half hours
 * for a small week). Never fewer than 2 steps, so an empty week still has a scale.
 */
export function axisMarks(max: number, kind: 'tasks' | 'focus'): number[] {
  const step = kind === 'tasks' ? Math.max(1, Math.ceil(max / 3)) : max <= 90 ? 30 : Math.max(1, Math.ceil(max / 180)) * 60;
  const top = Math.max(step * 2, Math.ceil(max / step) * step);
  const out: number[] = [];
  for (let v = top; v >= 0; v -= step) out.push(v);
  return out;
}

/** Ratio 0–1 of a ring (nothing asked: an empty ring, not a full one). */
export const ringRatio = (done: number, total: number) => (total > 0 ? Math.min(1, Math.max(0, done / total)) : 0);

/** The space a calendar category belongs to: Perso and Sport are personal life, the others the account's own use. */
export const spaceOf = (category: string, usage: Usage): Usage => (category === 'perso' || category === 'sport' ? 'perso' : usage);

// Words that say what kind of thing it is, not what it is about (« Partiel de maths » is about maths).
const KIND_WORDS = /^\s*(?:cours|amphi|cm|td|tp|partiel|partiels|examen|exam|controle|contrôle|ds|dm|devoir|interro|exposé|expose|oral|révisions?|revisions?|réviser|reviser|fiche)(?:\s+|$)(?:de la |de l'|de l’|de |d'|d’|du |des )?/i;
const STOP = new Set(['avec', 'pour', 'dans', 'chez', 'les', 'des', 'une', 'sur', 'faire', 'rendre', 'chapitre', 'cours', 'partiel', 'examen', 'controle', 'revision', 'revisions', 'reviser', 'fiche', 'devoir', 'exercices', 'exercice', 'projet', 'reunion', 'rendez-vous']);

/** The meaningful words of a text (3 letters or more, no accents, no generic words). */
export function keyWords(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !STOP.has(w));
}

/** « Partiel d’histoire » → « Histoire », « TD d'anglais » → « Anglais »; null when what is left is not a subject (too long). */
export function subjectName(title: string): string | null {
  const s = title.replace(KIND_WORDS, '').trim();
  if (!s || s.split(/\s+/).length > 3 || !keyWords(s).length) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface Subject {
  name: string;
  space: Usage;
}

/**
 * The subjects of the account: those of its focus sessions and of its courses, exams and homework around today
 * (a month either way), each with its space. The nearest first.
 */
export function subjectsOf(events: CalendarEvent[], sessions: FocusSession[], usage: Usage, today: string): Subject[] {
  const from = toKey(addDays(fromKey(today), -30));
  const to = toKey(addDays(fromKey(today), 30));
  const out = new Map<string, Subject>();
  const near = events
    .filter(e => e.date >= from && e.date <= to && ['cours', 'examen', 'devoir'].includes(e.category))
    .sort((a, b) => Math.abs(fromKey(a.date).getTime() - fromKey(today).getTime()) - Math.abs(fromKey(b.date).getTime() - fromKey(today).getTime()));
  for (const e of near) {
    const name = subjectName(e.title);
    const k = name && normalize(name);
    if (k && !out.has(k)) out.set(k, { name: name!, space: spaceOf(e.category, usage) });
  }
  for (const s of [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    const name = s.subject && subjectName(s.subject);
    const k = name && normalize(name);
    if (k && !out.has(k)) out.set(k, { name: name!, space: usage });
  }
  return [...out.values()];
}

/** The subject a task is about: every word of the subject is in its title (« Exercices de maths p. 42 » → Maths). */
export function taskSubject(title: string, subjects: Subject[]): Subject | undefined {
  const words = new Set(keyWords(title));
  return subjects.find(s => {
    const k = keyWords(s.name);
    return k.length > 0 && k.every(w => words.has(w));
  });
}

/**
 * The big day (exam, important event) of the next `days` days a task prepares: they share a meaningful word
 * (« Fiche d’histoire » and « Partiel d’histoire »).
 */
export function taskBigDay<E extends Pick<CalendarEvent, 'title' | 'date'>>(title: string, bigDays: E[], today: string, days = 7): E | undefined {
  const limit = toKey(addDays(fromKey(today), days));
  const words = new Set(keyWords(title));
  return bigDays.find(e => e.date >= today && e.date <= limit && keyWords(e.title).some(w => words.has(w)));
}
