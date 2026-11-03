// Events that repeat: every occurrence is an ordinary event, linked to the others by a `series` id.
// So the calendar, reminders, sync, search and export need nothing new; « this one and the next ones » acts on the series.

import { addDays, addMonths, addYears, differenceInCalendarDays } from 'date-fns';
import { fromKey, toKey } from './dates';
import { t } from '../i18n';

export type Repeat = 'day' | 'week' | '2weeks' | 'month' | 'year';

export const REPEATS: { key: Repeat; label: string }[] = [
  { key: 'week', label: t('Chaque semaine') },
  { key: '2weeks', label: t('Toutes les 2 semaines') },
  { key: 'day', label: t('Chaque jour') },
  { key: 'month', label: t('Chaque mois') },
  { key: 'year', label: t('Chaque année') },
];

/** Occurrences made at once: a school year of weekly classes fits, a typo in « jusqu’au » doesn't make thousands. */
export const MAX_OCCURRENCES = 120;

/** The i-th day of a series from `first` (date-fns clamps a 31st to the month's last day: checked by the caller). */
const nth = (first: Date, every: Repeat, i: number) =>
  every === 'month' ? addMonths(first, i) : every === 'year' ? addYears(first, i) : addDays(first, i * (every === 'day' ? 1 : every === 'week' ? 7 : 14));

/**
 * The days of a series, from `from` to `until` (both included), without the days `skip` says (holidays).
 * Monthly: the same date each month, and none in a month without it (no 31 in April). Yearly: the same day each
 * year (a birthday on 29 February only in leap years).
 */
export function repeatDays(from: string, every: Repeat, until: string, skip: (key: string) => boolean = () => false): { days: string[]; capped: boolean } {
  const first = fromKey(from);
  const days: string[] = [];
  for (let i = 0; ; i++) {
    const d = nth(first, every, i);
    const key = toKey(d);
    if (key > until) return { days, capped: false };
    if ((every === 'month' || every === 'year') && d.getDate() !== first.getDate()) continue;
    if (skip(key)) continue;
    if (days.length === MAX_OCCURRENCES) return { days, capped: true };
    days.push(key);
  }
}

/** « Jusqu’au » offered at first: three months later (about a semester); ten years for a birthday. */
export const defaultUntil = (from: string, every?: Repeat) => toKey(every === 'year' ? addYears(fromKey(from), 10) : addMonths(fromKey(from), 3));

/** Days between two dates (a moved occurrence moves the next ones by as much). */
export const dayShift = (from: string, to: string) => differenceInCalendarDays(fromKey(to), fromKey(from));
export const shiftKey = (key: string, days: number) => toKey(addDays(fromKey(key), days));

/** Longest event over several days. */
export const MAX_SPAN_DAYS = 31;
/** From `from` to `to` is more days than an event over several days can last (said, not cut). */
export const spanTooLong = (from: string, to: string) => dayShift(from, to) + 1 > MAX_SPAN_DAYS;
/** An event over several days is one event a day, linked by a series id starting with « span- » (not a repeat). */
export const isSpan = (series?: string) => !!series?.startsWith('span-');

/**
 * The days of an event from `from` to `to` (included), as the .ics reader does it: the first from its start
 * until 23:59, the days between all day, the last from 0:00 until its end. No time: every day all day.
 */
export function spanDays(from: string, to: string, start?: string, end?: string): { date: string; start?: string; end?: string }[] {
  const n = Math.min(MAX_SPAN_DAYS, dayShift(from, to) + 1);
  return Array.from({ length: Math.max(1, n) }, (_, i) => {
    const date = shiftKey(from, i);
    if (i === 0) return start ? { date, start, end: '23:59' } : { date };
    if (i === n - 1 && end) return { date, start: '00:00', end };
    return { date };
  });
}

/** Lists of what is coming: an event over several days once, at its first day still listed (`list` sorted by date). */
export function firstOfSpans<T extends { series?: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter(e => !isSpan(e.series) || (!seen.has(e.series!) && !!seen.add(e.series!)));
}

/** The same for every series: a weekly yoga marked important is one big day, its next one (`list` sorted by date). */
export function firstOfSeries<T extends { series?: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter(e => !e.series || (!seen.has(e.series) && !!seen.add(e.series)));
}
