// The home page's « try it » (LandingPage › HeroDemo): a sentence becomes an event or a task in a little week.
// Plain date work, no date-fns: this file is in the home page's own code, which stays small (the sentence itself is
// read by lib/dates › parseQuickAdd, loaded only when the visitor tries). Nothing is saved nor sent anywhere.
// Pure: tested in tests/landingDemo.test.ts.

import type { ParsedQuickAdd } from '../lib/dates';

export interface DemoItem {
  id: number;
  /** An event has an hour; a task (« Relancer M. Dupont vendredi ») a day at most. */
  kind: 'event' | 'task';
  title: string;
  /** yyyy-MM-dd; null for a task without a day. */
  date: string | null;
  start: string | null;
  color: string;
  /** One of the page's own examples (they make room for the visitor's). */
  example?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dateOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const plusDays = (key: string, n: number) => {
  const d = dateOf(key);
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};

/** The Monday of a day's week. */
export const mondayOf = (key: string) => plusDays(key, -((dateOf(key).getDay() + 6) % 7));

/** The 7 days (Monday to Sunday) of the week starting on `monday`. */
export const weekOf = (monday: string) => Array.from({ length: 7 }, (_, i) => plusDays(monday, i));

/** How many weeks after `now`'s week the week of `monday` is (0: this week, 1: next week…). */
export const weeksAhead = (monday: string, now: Date) => Math.round((dateOf(monday).getTime() - dateOf(mondayOf(keyOf(now))).getTime()) / (7 * 864e5));

/**
 * The week the page shows first: this one while its Tuesday is still ahead, else the next one, so the examples
 * (Wednesday, Thursday, Friday) never land in the past.
 */
export const demoMonday = (now: Date) => plusDays(mondayOf(keyOf(now)), (now.getDay() + 6) % 7 > 1 ? 7 : 0);

/** What the examples are read from: the shown week's start when it is to come (« jeudi » is then that week's). */
export const exampleBase = (now: Date) => {
  const monday = demoMonday(now);
  return monday > keyOf(now) ? dateOf(monday) : now;
};

/**
 * What the demo does with a read sentence: an event when it has an hour, else a task (for its day, or without one).
 * An hour without a day: today. Nothing to add without a title, or for a date that doesn't exist.
 */
export function demoPlace(p: ParsedQuickAdd, today: string): Pick<DemoItem, 'kind' | 'title' | 'date' | 'start'> | { error: 'empty' | 'impossible' } {
  if (p.impossible) return { error: 'impossible' };
  if (!p.title.trim()) return { error: 'empty' };
  if (p.start) return { kind: 'event', title: p.title, date: p.date ?? today, start: p.start };
  return { kind: 'task', title: p.title, date: p.date, start: null };
}

/**
 * The rows under the week: its items and the tasks without a day, at most `max`. The visitor's newest first, the
 * page's examples in the room left; then in the order of the week.
 */
export function rowsFor(items: DemoItem[], monday: string, max = 4): DemoItem[] {
  const end = plusDays(monday, 6);
  const shown = items.filter(i => (i.date ? i.date >= monday && i.date <= end : i.kind === 'task'));
  const kept = [...shown.filter(i => !i.example).sort((a, b) => b.id - a.id), ...shown.filter(i => i.example)].slice(0, max);
  return kept.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.start ?? '24:00').localeCompare(b.start ?? '24:00') || a.id - b.id);
}
