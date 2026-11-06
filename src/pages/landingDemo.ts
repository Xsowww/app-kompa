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
  /** « de 9h à 11h », « 21h-7h »: the end (the next morning when `nextDay`). */
  end?: string | null;
  /** A night (« Garde de nuit lundi 21h-7h »): it ends the next day, shown on both. */
  nextDay?: boolean;
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
 * The sign-in and sign-up pages' little week (pages/AuthPage › Showcase): Monday to Friday of this week, today
 * marked; on a weekend, the next week (from its Monday). `today`: its index (0 Monday … 4 Friday), -1 on a weekend.
 */
export function workWeek(now: Date): { days: string[]; today: number } {
  const key = keyOf(now);
  const weekend = (now.getDay() + 6) % 7 > 4;
  const monday = weekend ? plusDays(mondayOf(key), 7) : mondayOf(key);
  const days = weekOf(monday).slice(0, 5);
  return { days, today: days.indexOf(key) };
}

/** The day after a yyyy-MM-dd. */
export const dayAfter = (key: string) => plusDays(key, 1);

// An hour in a sentence: « 9h », « 9 h 30 », « 14:15 », « 10 heures »; a range is one: « 9h-11h », « de 21h à 7h ».
const HOUR = '(\\d{1,2})\\s?(?:heures?|h|:)\\s?(\\d{2})?';
const HOURS = new RegExp(`(?:\\bde\\s)?${HOUR}(?:\\s?(?:-|–|—|à|a|jusqu'à|jusqu’à)\\s?${HOUR})?(?![\\p{L}\\d])`, 'giu');
const hhmm = (h: string, m?: string) => (Number(h) < 24 && Number(m ?? 0) < 60 ? `${h.padStart(2, '0')}:${m ?? '00'}` : null);

/**
 * A sentence with several hours that aren't one range (« Conduite 9h, repos 11h », « Dentiste 9h puis kiné 11h »):
 * one part per hour, each ending with its hour (the words after the last one go with it). A range (« de 9h à 11h »,
 * « 21h-7h ») is one hour. At most `max` parts; the sentence whole when it has one hour or none.
 */
export function splitSentence(text: string, max = 3): string[] {
  // A length is not an hour: « Réunion 10h pendant 2h », « Footing 18h (1h) ».
  const ends = [...text.matchAll(HOURS)].filter(m => !/(?:pendant|durant|\()\s*$/i.test(text.slice(0, m.index))).map(m => m.index + m[0].length);
  if (ends.length < 2) return [text.trim()];
  const parts: string[] = [];
  let from = 0;
  for (const end of ends.slice(0, -1)) {
    parts.push(text.slice(from, end));
    from = end;
  }
  parts.push(text.slice(from));
  return parts
    .map(p => p.replace(/^[\s,;.:–—-]+|[\s,;.:–—-]+$/g, '').replace(/^(?:puis|et|ensuite|après|apres)\s+/i, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

/** « Garde de nuit 21h-7h », « de 22h à 6h »: the end of a night (the quick add drops it, as it is before the start). */
export function nightEnd(text: string): string | null {
  for (const m of text.matchAll(HOURS)) {
    if (!m[3]) continue;
    const start = hhmm(m[1], m[2]);
    const end = hhmm(m[3], m[4]);
    if (start && end && end < start) return end;
  }
  return null;
}

/**
 * What the demo does with a read sentence: an event when it has an hour (with its end; the next morning for a night),
 * a task when it has only a day. An hour without a day: today. Nothing for a sentence with neither a day nor an hour,
 * or a question (not an appointment: the demo suggests an example instead), nor without a title, nor for a date that
 * doesn't exist.
 */
export function demoPlace(
  p: ParsedQuickAdd,
  today: string,
  sentence = '',
): Pick<DemoItem, 'kind' | 'title' | 'date' | 'start' | 'end' | 'nextDay'> | { error: 'empty' | 'impossible' | 'notEvent' } {
  if (p.impossible) return { error: 'impossible' };
  if (/\?\s*$/.test(sentence) || (!p.date && !p.start)) return { error: 'notEvent' };
  if (!p.title.trim()) return { error: 'empty' };
  if (p.start) {
    const night = p.end ? null : nightEnd(sentence);
    return { kind: 'event', title: p.title, date: p.date ?? today, start: p.start, end: p.end ?? night, ...(night && { nextDay: true }) };
  }
  return { kind: 'task', title: p.title, date: p.date, start: null };
}

/** The visitor's last sentence, recreated in their new account (store/welcome): `{ text, at }` (ISO), kept 24 h. */
export const DEMO_KEY = 'kompaly-demo';
export const demoKept = (text: string, now: Date) => JSON.stringify({ text: text.trim().slice(0, 120), at: now.toISOString() });

/**
 * The rows under the week: its items and the tasks without a day, at most `max`. The visitor's newest first, the
 * page's examples in the room left; then in the order of the week.
 */
export function rowsFor(items: DemoItem[], monday: string, max = 4): DemoItem[] {
  const end = plusDays(monday, 6);
  const inWeek = (k: string) => k >= monday && k <= end;
  const shown = items.filter(i => (i.date ? inWeek(i.date) || (!!i.nextDay && inWeek(dayAfter(i.date))) : i.kind === 'task'));
  const kept = [...shown.filter(i => !i.example).sort((a, b) => b.id - a.id), ...shown.filter(i => i.example)].slice(0, max);
  return kept.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.start ?? '24:00').localeCompare(b.start ?? '24:00') || a.id - b.id);
}
