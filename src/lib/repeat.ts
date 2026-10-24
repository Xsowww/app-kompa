// Events that repeat: every occurrence is an ordinary event, linked to the others by a `series` id.
// So the calendar, reminders, sync, search and export need nothing new; « this one and the next ones » acts on the series.

import { addDays, addMonths, differenceInCalendarDays } from 'date-fns';
import { fromKey, toKey } from './dates';
import { t } from '../i18n';

export type Repeat = 'day' | 'week' | '2weeks' | 'month';

export const REPEATS: { key: Repeat; label: string }[] = [
  { key: 'week', label: t('Chaque semaine') },
  { key: '2weeks', label: t('Toutes les 2 semaines') },
  { key: 'day', label: t('Chaque jour') },
  { key: 'month', label: t('Chaque mois') },
];

/** Occurrences made at once: a school year of weekly classes fits, a typo in « jusqu’au » doesn't make thousands. */
export const MAX_OCCURRENCES = 120;

/**
 * The days of a series, from `from` to `until` (both included), without the days `skip` says (holidays).
 * Monthly: the same date each month, and none in a month without it (no 31 in April).
 */
export function repeatDays(from: string, every: Repeat, until: string, skip: (key: string) => boolean = () => false): { days: string[]; capped: boolean } {
  const first = fromKey(from);
  const days: string[] = [];
  for (let i = 0; ; i++) {
    const d = every === 'month' ? addMonths(first, i) : addDays(first, i * (every === 'day' ? 1 : every === 'week' ? 7 : 14));
    const key = toKey(d);
    if (key > until) return { days, capped: false };
    if (every === 'month' && d.getDate() !== first.getDate()) continue;
    if (skip(key)) continue;
    if (days.length === MAX_OCCURRENCES) return { days, capped: true };
    days.push(key);
  }
}

/** « Jusqu’au » offered at first: three months later (about a semester). */
export const defaultUntil = (from: string) => toKey(addMonths(fromKey(from), 3));

/** Days between two dates (a moved occurrence moves the next ones by as much). */
export const dayShift = (from: string, to: string) => differenceInCalendarDays(fromKey(to), fromKey(from));
export const shiftKey = (key: string, days: number) => toKey(addDays(fromKey(key), days));
