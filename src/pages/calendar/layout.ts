// Where things go on the calendar's screens (no React here, so the rules are tested on their own):
// the blocks of the hourly grid, the bars of an event over several days, the « À venir » list.

import type { CalendarEvent } from '../../store/calendar';
import type { Todo } from '../../store/todos';
import { toMinutes } from '../../lib/dates';
import { firstOfSeries, isSpan } from '../../lib/repeat';

/** Events without an end time are drawn one hour long. */
export const DEFAULT_LENGTH = 60;

export interface Placed {
  ev: CalendarEvent;
  start: number;
  end: number;
  col: number;
  cols: number;
}

export const spanOf = (ev: Pick<CalendarEvent, 'start' | 'end'>) => {
  const start = toMinutes(ev.start!);
  const end = ev.end ? toMinutes(ev.end) : start + DEFAULT_LENGTH;
  return { start, end: Math.max(end, start + 15) };
};

/** Overlapping events share the width side by side (classic agenda layout). */
export function layout(events: CalendarEvent[]): Placed[] {
  const items = events
    .map(ev => ({ ev, ...spanOf(ev), col: 0, cols: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const p of cluster) p.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const it of items) {
    if (it.start >= clusterEnd) flush();
    let col = colEnds.findIndex(end => end <= it.start);
    if (col < 0) col = colEnds.push(0) - 1;
    colEnds[col] = it.end;
    it.col = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

/** A new event swept on the grid from an empty slot: from the slot pressed to the one let go, an hour when it stayed on one. */
export function sweptRange(anchor: number, to: number) {
  const from = Math.min(anchor, to);
  return { from, to: anchor === to ? anchor + DEFAULT_LENGTH : Math.max(anchor, to) + 15 };
}

export interface SpanBar<T> {
  /** The piece of the event on the bar's first day (the one opened). */
  ev: T;
  /** Columns of the row (0 = its first day), both included. */
  from: number;
  to: number;
  lane: number;
  /** It started before this row / goes on after it: the bar's end is drawn open. */
  before: boolean;
  after: boolean;
}

/**
 * An event over several days (« span- » series, lib/repeat) as one bar across the days of a row of the month or
 * of the week, on the first lane free, like the periods. `keys`: the row's days in order.
 */
export function spanBars<T extends Pick<CalendarEvent, 'date' | 'series'>>(events: T[], keys: string[]): SpanBar<T>[] {
  const col = new Map(keys.map((k, i) => [k, i]));
  const bySeries = new Map<string, T[]>();
  for (const e of events) if (isSpan(e.series)) bySeries.set(e.series!, [...(bySeries.get(e.series!) ?? []), e]);
  const bars: Omit<SpanBar<T>, 'lane'>[] = [];
  for (const pieces of bySeries.values()) {
    const sorted = [...pieces].sort((a, b) => a.date.localeCompare(b.date));
    const here = sorted.filter(e => col.has(e.date));
    if (!here.length) continue;
    bars.push({
      ev: here[0],
      from: col.get(here[0].date)!,
      to: col.get(here[here.length - 1].date)!,
      before: sorted[0].date < keys[0],
      after: sorted[sorted.length - 1].date > keys[keys.length - 1],
    });
  }
  // Longest first on the top lanes (a week-long trip above a weekend), then by start.
  bars.sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  const ends: number[] = [];
  return bars.map(b => {
    let lane = ends.findIndex(end => end < b.from);
    if (lane < 0) lane = ends.length;
    ends[lane] = b.to;
    return { ...b, lane };
  });
}

type Dated = Pick<CalendarEvent, 'date' | 'start' | 'series'>;
const byTime = (a: Dated, b: Dated) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? '');

/** « À venir » collapsed: the next important ones, homework to hand in, and the next other things (a few a day). */
const SHOWN = { big: 4, homework: 6, others: 5, perDay: 2 };

/**
 * « À venir » as one list in date order, the important ones marked by the caller. `pool`: what is coming (sorted by
 * date, an event over several days already once); `kind`: what each item is. An important event that repeats counts
 * once: its next occurrence. Collapsed (`shown`): the next 4 important ones, the next homework, and the next other
 * events, 2 a day at most (a day of six classes doesn't push the rest away); `more`: what « Voir N autres » adds, in
 * its place in the dates.
 */
export function upcomingList<T extends Dated>(pool: T[], kind: (e: T) => 'big' | 'homework' | 'other'): { shown: T[]; more: T[] } {
  const big = firstOfSeries(pool.filter(e => kind(e) === 'big'));
  const homework = pool.filter(e => kind(e) === 'homework');
  const others = pool.filter(e => kind(e) === 'other');
  const perDay = new Map<string, number>();
  const othersShown = others
    .filter(e => {
      const n = perDay.get(e.date) ?? 0;
      if (n >= SHOWN.perDay) return false;
      perDay.set(e.date, n + 1);
      return true;
    })
    .slice(0, SHOWN.others);
  const shown = [...big.slice(0, SHOWN.big), ...homework.slice(0, SHOWN.homework), ...othersShown];
  const listed = new Set(shown);
  const last = othersShown.length ? others.indexOf(othersShown[othersShown.length - 1]) : -1;
  return {
    shown: shown.sort(byTime),
    more: [...big.slice(SHOWN.big), ...homework.slice(SHOWN.homework), ...others.slice(0, last + 1 + 10).filter(e => !listed.has(e))].sort(byTime),
  };
}

/** « Pour qui » on a shared calendar: an event for everyone concerns each member; nobody chosen: all of them. */
export const isFor = (e: Pick<CalendarEvent, 'people'>, who: string | null) => !who || !e.people?.length || e.people.includes(who);

/** The tasks due on a day (Tâches), as the calendar shows them: without a time first, then by time (as events). */
export const tasksOn = (todos: Todo[], day: string) =>
  todos.filter(x => x.due === day && !(x as { deletedAt?: string }).deletedAt).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title));

/**
 * The day the calendar opens on: today; or, when nothing is left from today to Sunday (events, dated tasks not done),
 * the next day something is planned, within `ahead` days (Lina's calendar opened on an empty week). `weekEnd`: this
 * week's Sunday (YYYY-MM-DD).
 */
export function openingDay(today: string, weekEnd: string, items: { date: string; done?: boolean }[], lastDay: string): { day: string; jumped: boolean } {
  const coming = items.filter(x => !x.done && x.date >= today && x.date <= lastDay).map(x => x.date).sort();
  if (!coming.length || coming[0] <= weekEnd) return { day: today, jumped: false };
  return { day: coming[0], jumped: true };
}

/** A day's events and dated tasks in one list, in the order of the day: what has no time first, then by time. */
export function byStartTime<E extends Pick<CalendarEvent, 'start'>>(events: E[], todos: Todo[]): ({ ev: E } | { todo: Todo })[] {
  const at = (it: { ev: E } | { todo: Todo }) => ('ev' in it ? it.ev.start : it.todo.time) ?? '';
  // A stable sort: the events keep their order (already sorted), each task goes after the events of its time.
  return [...events.map(ev => ({ ev })), ...todos.map(todo => ({ todo }))].sort((a, b) => at(a).localeCompare(at(b)));
}

/**
 * The pieces of nights among a week's events: an event over two days (« span- » series) from an evening to the next
 * morning (« 21:00 → 23:59 », then « 00:00 → 07:00 »). The hourly grid draws them at their hours, not as a bar.
 * `days`: the days shown (a night across their edge has only one piece there).
 */
export function nightPieces(events: Pick<CalendarEvent, 'id' | 'date' | 'start' | 'end' | 'series'>[], days: string[]): Set<string> {
  const evening = (e: Pick<CalendarEvent, 'start' | 'end'>) => !!e.start && e.start >= '12:00' && e.end === '23:59';
  const morning = (e: Pick<CalendarEvent, 'start' | 'end'>) => e.start === '00:00' && !!e.end && e.end <= '12:00';
  const bySeries = new Map<string, typeof events>();
  for (const e of events) if (isSpan(e.series)) bySeries.set(e.series!, [...(bySeries.get(e.series!) ?? []), e]);
  const out = new Set<string>();
  for (const pieces of bySeries.values()) {
    const [a, b] = [...pieces].sort((x, y) => x.date.localeCompare(y.date));
    const whole = pieces.length === 2 && evening(a) && morning(b);
    // Only its morning, on the first day shown; only its evening, on the last one.
    const edge = pieces.length === 1 && ((a.date === days[0] && morning(a)) || (a.date === days[days.length - 1] && evening(a)));
    if (whole || edge) pieces.forEach(e => out.add(e.id));
  }
  return out;
}
