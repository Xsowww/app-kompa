// Events that repeat: every occurrence is an ordinary event, linked to the others by a `series` id.
// So the calendar, reminders, sync, search and export need nothing new; « this one and the next ones » acts on the series.
// The rule of a series (every N days/weeks/months/years, several weekdays, « le 1er lundi du mois », until a day or
// without end) is a RepeatRule. One without end is kept in the settings (repeatRules) and made further ahead as time
// goes (lib/repeatSeries). Pure functions, tested in tests/repeat.test.ts.

import { addDays, addMonths, addYears, differenceInCalendarDays } from 'date-fns';
import { fromKey, toKey } from './dates';
import { t, tn } from '../i18n';

export type Repeat = 'day' | 'week' | '2weeks' | 'month' | 'year';

export const REPEATS: { key: Repeat; label: string }[] = [
  { key: 'week', label: t('Chaque semaine') },
  { key: '2weeks', label: t('Toutes les 2 semaines') },
  { key: 'day', label: t('Chaque jour') },
  { key: 'month', label: t('Chaque mois') },
  { key: 'year', label: t('Chaque année') },
];

/** Occurrences made at once: a year of daily ones fits, a typo in « jusqu’au » doesn't make thousands. */
export const MAX_OCCURRENCES = 400;

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

/** How a series repeats. */
export interface RepeatRule {
  unit: RepeatUnit;
  /** Every `interval` units (1: each one; 3 months: a quarter). */
  interval: number;
  /** Weekly: the days of the week (0 = Sunday … 6 = Saturday); none: the first day's. */
  days?: number[];
  /** Monthly: « le 1er lundi » (1…4) or « le dernier lundi » (-1) of the month, on the first day's weekday; none: the same date. */
  nth?: number;
  /** The last day it may happen (included); none: without end. */
  until?: string;
}

/** The ready-made choices as rules. */
export const ruleOf = (r: Repeat): RepeatRule => (r === '2weeks' ? { unit: 'week', interval: 2 } : { unit: r, interval: 1 });

const clampInterval = (n: number) => Math.min(99, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));

/** The weekday's place in its month: 1…4, or -1 when it is the last one (a 5th Monday is « le dernier lundi »). */
export function nthOfMonth(key: string): number {
  const d = fromKey(key);
  return addDays(d, 7).getMonth() !== d.getMonth() ? -1 : Math.ceil(d.getDate() / 7);
}

/** The `nth` (1…4; -1: the last) `weekday` of a month; null when there is none (a 5th one). */
function nthWeekday(year: number, month: number, weekday: number, nth: number): Date | null {
  if (nth > 0) {
    const first = new Date(year, month, 1);
    const d = new Date(year, month, 1 + ((weekday - first.getDay() + 7) % 7) + (nth - 1) * 7);
    return d.getMonth() === month ? d : null;
  }
  const last = new Date(year, month + 1, 0);
  return new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
}

/** Monday first: lundi … dimanche. */
const mondayFirst = (w: number) => (w + 6) % 7;

/**
 * The days of a series, from `from` to `until` (both included), without the days `skip` says (holidays), `max` at
 * most. Monthly: the same date each month, and none in a month without it (no 31 in April), or « le 2e mardi ».
 * Yearly: the same day each year (a birthday on 29 February only in leap years). Weekly: each chosen weekday.
 */
export function ruleDays(from: string, rule: RepeatRule, until: string, skip: (key: string) => boolean = () => false, max = MAX_OCCURRENCES): { days: string[]; capped: boolean } {
  const first = fromKey(from);
  const every = clampInterval(rule.interval);
  const days: string[] = [];
  const last = rule.until && rule.until < until ? rule.until : until;
  // A candidate day: true to go on, false past the end, 'full' when `max` are there.
  const take = (d: Date | null): boolean | 'full' => {
    if (!d) return true;
    const key = toKey(d);
    if (key > last) return false;
    if (key < from || skip(key)) return true;
    if (days.length === max) return 'full';
    days.push(key);
    return true;
  };
  // Every month (or year) on the same date: a month without it (no 31 in April) is skipped, not clamped.
  const sameDate = (d: Date) => (d.getDate() === first.getDate() ? take(d) : toKey(d) <= last);
  const weekdays = rule.unit === 'week' ? [...new Set(rule.days?.length ? rule.days : [first.getDay()])].sort((a, b) => mondayFirst(a) - mondayFirst(b)) : [];
  const monday = addDays(first, -mondayFirst(first.getDay()));
  for (let i = 0; i < 100_000; i++) {
    let r: boolean | 'full' = true;
    if (rule.unit === 'day') r = take(addDays(first, i * every));
    else if (rule.unit === 'week') {
      // Week by week from the Monday of the first one.
      const week = addDays(monday, i * 7 * every);
      for (const w of weekdays) if ((r = take(addDays(week, mondayFirst(w)))) !== true) break;
    } else if (rule.unit === 'month') {
      if (rule.nth) {
        const m = new Date(first.getFullYear(), first.getMonth() + i * every, 1);
        r = take(nthWeekday(m.getFullYear(), m.getMonth(), first.getDay(), rule.nth));
        // Past the end without a day this month (a 4th one missing never happens; -1 always exists).
        if (r === true && toKey(m) > last) r = false;
      } else r = sameDate(addMonths(first, i * every));
    } else r = sameDate(addYears(first, i * every));
    if (r === false) return { days, capped: false };
    if (r === 'full') return { days, capped: true };
  }
  return { days, capped: true };
}

/** The ready-made choices (the assistant and the older callers). */
export const repeatDays = (from: string, every: Repeat, until: string, skip?: (key: string) => boolean) => ruleDays(from, ruleOf(every), until, skip);

/** How far ahead a series without end is made: a year (half a year for one every day or two: fewer events to keep). */
export const endlessUntil = (rule: Pick<RepeatRule, 'unit' | 'interval'>, today: string) => toKey(addMonths(fromKey(today), rule.unit === 'day' && rule.interval < 7 ? 6 : 12));

/** Once a series without end has less than this ahead, its next ones are made (lib/repeatSeries). */
export const endlessRefill = (rule: Pick<RepeatRule, 'unit' | 'interval'>, today: string) => toKey(addMonths(fromKey(today), rule.unit === 'day' && rule.interval < 7 ? 4 : 9));

// ── Kept in the settings as a short text: « w2:1,4 », « m1:n-1 », « y1 », and « |2027-06-30 » for an end ─────────
const UNIT_CODE: Record<RepeatUnit, string> = { day: 'd', week: 'w', month: 'm', year: 'y' };
const CODE_UNIT: Record<string, RepeatUnit> = { d: 'day', w: 'week', m: 'month', y: 'year' };

export function encodeRule(rule: RepeatRule): string {
  const extra = rule.unit === 'week' && rule.days?.length ? `:${rule.days.join(',')}` : rule.unit === 'month' && rule.nth ? `:n${rule.nth}` : '';
  return `${UNIT_CODE[rule.unit]}${clampInterval(rule.interval)}${extra}${rule.until ? `|${rule.until}` : ''}`;
}

export function decodeRule(code: unknown): RepeatRule | null {
  const m = typeof code === 'string' ? /^([dwmy])(\d{1,2})(?::(n-?[1-4]|[0-6](?:,[0-6]){0,6}))?(?:\|(\d{4}-\d{2}-\d{2}))?$/.exec(code) : null;
  if (!m) return null;
  const unit = CODE_UNIT[m[1]];
  const rule: RepeatRule = { unit, interval: clampInterval(Number(m[2])) };
  if (m[3]?.startsWith('n')) {
    if (unit === 'month') rule.nth = Number(m[3].slice(1));
  } else if (m[3] && unit === 'week') rule.days = [...new Set(m[3].split(',').map(Number))];
  if (m[4]) rule.until = m[4];
  return rule;
}

/**
 * The rule of a series made before rules were kept (or by someone else), read from its days: the gap between the
 * first two (days, weeks), or the same date each month or year. null when it can't be told (a single day left).
 */
export function guessRule(days: string[]): RepeatRule | null {
  const sorted = [...new Set(days)].sort();
  if (sorted.length < 2) return null;
  const [a, b] = sorted;
  const gap = differenceInCalendarDays(fromKey(b), fromKey(a));
  const da = fromKey(a);
  const db = fromKey(b);
  if (da.getDate() === db.getDate() && gap >= 28) {
    const months = (db.getFullYear() - da.getFullYear()) * 12 + db.getMonth() - da.getMonth();
    return months % 12 === 0 ? { unit: 'year', interval: months / 12 } : { unit: 'month', interval: months };
  }
  return gap % 7 === 0 ? { unit: 'week', interval: gap / 7 } : { unit: 'day', interval: gap };
}

const WEEKDAY_SHORT = [t('dim.'), t('lun.'), t('mar.'), t('mer.'), t('jeu.'), t('ven.'), t('sam.')];
const WEEKDAY_LONG = [t('dimanche'), t('lundi'), t('mardi'), t('mercredi'), t('jeudi'), t('vendredi'), t('samedi')];
const NTH: Record<number, string> = { 1: t('1er||rang'), 2: t('2e'), 3: t('3e'), 4: t('4e') };

/** « le 1er lundi », « le dernier vendredi » (of the month), for the weekday of `from`. */
export const nthLabel = (nth: number, from: string) => {
  const weekday = WEEKDAY_LONG[fromKey(from).getDay()];
  return nth === -1 ? t('le dernier {weekday}', { weekday }) : t('le {nth} {weekday}', { nth: NTH[nth] ?? NTH[1], weekday });
};

/** « Chaque semaine, lun. et jeu. », « Chaque mois, le 1er lundi », « Tous les 3 mois, le 15 », « Tous les 2 ans ». */
export function ruleLabel(rule: RepeatRule, from: string): string {
  const n = clampInterval(rule.interval);
  if (rule.unit === 'day') return n === 1 ? t('Chaque jour') : t('Tous les {n} jours', { n });
  if (rule.unit === 'week') {
    const days = rule.days?.length ? rule.days : [fromKey(from).getDay()];
    const names = [...days].sort((a, b) => mondayFirst(a) - mondayFirst(b)).map(w => WEEKDAY_SHORT[w]);
    const list = names.length > 1 ? t('{list} et {last}', { list: names.slice(0, -1).join(', '), last: names.at(-1)! }) : names[0];
    return n === 1 ? t('Chaque semaine, {days}', { days: list }) : t('Toutes les {n} semaines, {days}', { n, days: list });
  }
  if (rule.unit === 'month') {
    const which = rule.nth ? nthLabel(rule.nth, from) : t('le {day}', { day: fromKey(from).getDate() });
    return n === 1 ? t('Chaque mois, {which}', { which }) : t('Tous les {n} mois, {which}', { n, which });
  }
  return n === 1 ? t('Chaque année') : t('Tous les {n} ans', { n });
}

/** The unit after « Tous les [N] »: « jours », « semaines », « mois », « ans ». */
export const unitWord = (unit: RepeatUnit, n: number) =>
  unit === 'day' ? tn(n, 'jour', 'jours') : unit === 'week' ? tn(n, 'semaine', 'semaines') : unit === 'month' ? t('mois') : tn(n, 'an', 'ans');

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
