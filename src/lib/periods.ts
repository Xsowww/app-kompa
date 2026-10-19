// Periods: whole weeks or days that have a meaning (« En entreprise », « Vacances », « Partiels »).
// Shown as a tint on the days and a band with the name, under the events, never instead of them.

import { addDays, differenceInCalendarDays } from 'date-fns';
import { FOLDER_COLORS, folderColorKey } from '../store/drive';
import type { Usage } from './usage';
import { fmtDay, fromKey, toKey, validKey } from './dates';
import { uid } from './utils';
import { t } from '../i18n';

export interface Period {
  id: string;
  title: string;
  /** First and last day, both included (yyyy-MM-dd). */
  start: string;
  end: string;
  /** Key of FOLDER_COLORS. */
  color: string;
  /** Shared calendar: the members it is about (user ids); none: everyone. */
  people?: string[];
  /** Days between `start` and `end` that aren't part of it: one period in pieces (two weeks of class, a week off…). */
  skip?: string[];
}

/** Is `key` one of the period's days (inside its dates and not skipped)? */
export const covers = (p: Pick<Period, 'start' | 'end' | 'skip'>, key: string) => p.start <= key && key <= p.end && !p.skip?.includes(key);

/** Longest period (a school year and a bit): a typo like 2062 doesn't paint forty years. */
export const MAX_DAYS = 400;
/** Repeats made at once (« every 4 weeks until June »): a year of alternance fits easily. */
export const MAX_REPEATS = 60;

/** Names offered in the form, by what the account is for. */
export const PERIOD_IDEAS: Record<Usage, { title: string; color: string }[]> = {
  etudes: [
    { title: t('En cours'), color: 'bleu' },
    { title: t('En entreprise'), color: 'orange' },
    { title: t('Stage'), color: 'violet' },
    { title: t('Partiels'), color: 'rouge' },
    { title: t('Vacances'), color: 'vert' },
  ],
  travail: [
    { title: t('Congés'), color: 'vert' },
    { title: t('Télétravail'), color: 'bleu' },
    { title: t('Déplacement'), color: 'orange' },
    { title: t('Formation'), color: 'violet' },
    { title: t('Coup de feu'), color: 'rouge' },
  ],
  perso: [
    { title: t('Vacances'), color: 'vert' },
    { title: t('Déplacement'), color: 'orange' },
    { title: t('Garde des enfants'), color: 'violet' },
    { title: t('Travaux'), color: 'jaune' },
  ],
};

export const periodColor = (p: Pick<Period, 'color'>) => FOLDER_COLORS[p.color]?.color ?? FOLDER_COLORS.bleu.color;
/** Soft fill for the days (readable under the events, light and dark). */
export const periodTint = (p: Pick<Period, 'color'>, strength = 14) => `color-mix(in srgb, ${periodColor(p)} ${strength}%, transparent)`;
/** Text in the period's colour, dark enough to read on its tint. */
export const periodText = (p: Pick<Period, 'color'>) => `color-mix(in srgb, ${periodColor(p)} 55%, var(--color-ink))`;

export const sortPeriods = (list: Period[]) => [...list].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.title.localeCompare(b.title));

/** The periods covering a day, oldest start first. */
export const periodsOn = (list: Period[], key: string) => sortPeriods(list.filter(p => covers(p, key)));

/** The periods touching [from, to] (a week, a month). */
export const periodsBetween = (list: Period[], from: string, to: string) => sortPeriods(list.filter(p => p.start <= to && p.end >= from));

/** A period from anywhere (settings, a backup file, the server), or null when it doesn't hold up. */
export function cleanPeriod(x: unknown): Period | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 60) : '';
  const start = validKey(typeof r.start === 'string' ? r.start : null);
  const end = validKey(typeof r.end === 'string' ? r.end : null);
  if (!title || !start || !end || end < start) return null;
  if (differenceInCalendarDays(fromKey(end), fromKey(start)) > MAX_DAYS) return null;
  const people = Array.isArray(r.people) ? [...new Set(r.people.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, 50) : [];
  // Skipped days: only real days strictly inside the period (its first and last days are always in it).
  const skip = Array.isArray(r.skip) ? [...new Set(r.skip.map(k => validKey(typeof k === 'string' ? k : null)).filter((k): k is string => !!k && k > start && k < end))].sort().slice(0, MAX_DAYS) : [];
  return { id: typeof r.id === 'string' && r.id ? r.id : uid(), title, start, end, color: folderColorKey(r.color) ?? 'bleu', ...(people.length && { people }), ...(skip.length && { skip }) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** « Léa · En entreprise » when the period is about some members, else just its name. */
export function periodLabel(p: Pick<Period, 'title' | 'people'>, nameOf?: (userId: string) => string): string {
  if (!p.people?.length || !nameOf) return p.title;
  const names = p.people.map(nameOf);
  const who = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.length === 2 ? t('{a} et {b}', { a: names[0], b: names[1] }) : names.join('');
  return `${who} · ${p.title}`;
}

export const cleanPeriods = (list: unknown): Period[] => (Array.isArray(list) ? list.map(cleanPeriod).filter((p): p is Period => !!p) : []);

/**
 * The same period again every `everyWeeks` weeks until `until` (included): 2 weeks of classes every
 * 4 weeks for a year of alternance. The first one is `first` itself; at most MAX_REPEATS in all.
 */
export function repeatPeriod(first: Omit<Period, 'id'>, everyWeeks: number, until: string): Omit<Period, 'id'>[] {
  const out = [first];
  if (!(everyWeeks >= 1) || until <= first.start) return out;
  const length = differenceInCalendarDays(fromKey(first.end), fromKey(first.start));
  for (let i = 1; out.length < MAX_REPEATS; i++) {
    const shift = i * 7 * everyWeeks;
    const start = toKey(addDays(fromKey(first.start), shift));
    if (start > until) break;
    out.push({ ...first, start, end: toKey(addDays(fromKey(start), length)), ...(first.skip && { skip: first.skip.map(k => toKey(addDays(fromKey(k), shift))) }) });
  }
  return out;
}

/** « du 13 au 24 oct. », « 13 oct. », « du 28 oct. au 8 nov. » */
export function periodRange(p: Pick<Period, 'start' | 'end'>, fmtDay: (d: Date, pattern: string) => string): string {
  if (p.start === p.end) return fmtDay(fromKey(p.start), 'd MMM');
  const sameMonth = p.start.slice(0, 7) === p.end.slice(0, 7);
  // Same month: the day alone (« du 5 au 16 avr. 2027 » ; fmtDay would add the year to a bare day number).
  return t('du {start} au {end}', { start: sameMonth ? fromKey(p.start).getDate() : fmtDay(fromKey(p.start), 'd MMM'), end: fmtDay(fromKey(p.end), 'd MMM') });
}

/**
 * The fill of a day covered by one period or more: one band of each colour, top to bottom
 * (two periods overlapping both show from their own first day, neither waits for the other to end).
 */
export function periodsFill(list: Pick<Period, 'color'>[], strength = 14): string | undefined {
  if (!list.length) return undefined;
  const step = 100 / list.length;
  const stops = list.flatMap((p, i) => [`${periodTint(p, strength)} ${i * step}%`, `${periodTint(p, strength)} ${(i + 1) * step}%`]);
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

/**
 * Bands of a week: each period on the first row where it fits, from its own first day to its last (one band
 * per piece when days are skipped in between).
 */
export function weekLanes(list: Period[], keys: string[]): { period: Period; from: number; to: number; lane: number }[] {
  const ends: number[] = [];
  return sortPeriods(list)
    .flatMap(period => {
      const pieces: { period: Period; from: number; to: number }[] = [];
      keys.forEach((k, i) => {
        if (!covers(period, k)) return;
        const last = pieces[pieces.length - 1];
        if (last && last.to === i - 1) last.to = i;
        else pieces.push({ period, from: i, to: i });
      });
      return pieces;
    })
    .map(b => {
      let lane = ends.findIndex(end => end < b.from);
      if (lane < 0) lane = ends.length;
      ends[lane] = b.to;
      return { ...b, lane };
    });
}

/** How many days the period really has (skipped ones left out). */
export const periodDays = (p: Pick<Period, 'start' | 'end' | 'skip'>) => differenceInCalendarDays(fromKey(p.end), fromKey(p.start)) + 1 - (p.skip?.length ?? 0);

/** Every day from `a` to `b` (either order, both included), at most MAX_DAYS + 1 of them. */
export function daysBetween(a: string, b: string): string[] {
  const [from, to] = a < b ? [a, b] : [b, a];
  const out: string[] = [];
  for (let d = fromKey(from); out.length <= MAX_DAYS; d = addDays(d, 1)) {
    const k = toKey(d);
    if (k > to) break;
    out.push(k);
  }
  return out;
}

/** Chosen days → the runs of days in a row (each one a period): 5, 6, 7, 12 → 5–7 and 12. */
export function runsOf(days: Iterable<string>): { start: string; end: string }[] {
  const runs: { start: string; end: string }[] = [];
  for (const k of [...new Set(days)].sort()) {
    const last = runs[runs.length - 1];
    if (last && toKey(addDays(fromKey(last.end), 1)) === k) last.end = k;
    else runs.push({ start: k, end: k });
  }
  return runs;
}

/** The same period on two calendars: same name (case aside), same days. */
export const samePeriod = (a: Period, b: Period) =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() && a.start === b.start && a.end === b.end && [...(a.skip ?? [])].sort().join() === [...(b.skip ?? [])].sort().join();

/** Copies for another calendar: new ids, and « pour qui » set for that calendar (its members aren't the same). */
export const copyPeriods = (list: Period[], people: string[], newId: () => string): Period[] =>
  list.map(({ people: _p, ...p }) => ({ ...p, id: newId(), ...(people.length && { people }) }));

/**
 * The days in a row of a period around `key` (a day it covers): « jusqu'au » is the last day before
 * the next gap (a weekend, a week off), not the period's very last day; `next` is when it starts again.
 */
export function pieceAround(p: Pick<Period, 'start' | 'end' | 'skip'>, key: string): { end: string; next: string | null } {
  let end = key;
  for (let k = toKey(addDays(fromKey(end), 1)); k <= p.end && covers(p, k); k = toKey(addDays(fromKey(k), 1))) end = k;
  let next: string | null = null;
  for (let k = toKey(addDays(fromKey(end), 1)); k <= p.end; k = toKey(addDays(fromKey(k), 1)))
    if (covers(p, k)) {
      next = k;
      break;
    }
  return { end, next };
}

/** « jusqu’au 24 oct. » on a day of a period (to the next gap), « dernier jour · reprend le 3 nov. » on the day before one. */
export function periodUntil(p: Pick<Period, 'start' | 'end' | 'skip'>, key: string): string | null {
  const { end, next } = pieceAround(p, key);
  if (end !== key) return t('jusqu’au {day}', { day: fmtDay(fromKey(end), 'd MMM') });
  return next ? t('dernier jour · reprend le {day}', { day: fmtDay(fromKey(next), 'd MMM') }) : null;
}
