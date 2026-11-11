// The series of my calendar that repeat, over time: the rule each one was made with (settings › repeatRules, on
// every device), the next occurrences of one without end made before they are needed, and a new end chosen later
// (« jusqu’au », « sans fin ») in the event's window. Pure planning (planEndless, planNewEnd) is tested in
// tests/repeatSeries.test.ts; the rest applies it to the stores.

import { dayShift, decodeRule, encodeRule, endlessRefill, endlessUntil, guessRule, nthOfMonth, ruleDays, shiftKey, type RepeatRule } from './repeat';
import { todayKey } from './dates';
import { useCalendar, type CalendarEvent, type NewEvent } from '../store/calendar';
import { getSettings, useSettings } from '../store/settings';

/** A saved rule: the rule, then « @ » and the series' first day (the weeks of « toutes les 2 semaines » count from it). */
export const saveRuleCode = (rule: RepeatRule, from: string) => `${encodeRule(rule)}@${from}`;
export function readRuleCode(code: unknown): { rule: RepeatRule; from: string } | null {
  if (typeof code !== 'string') return null;
  const at = code.lastIndexOf('@');
  const rule = decodeRule(at > 0 ? code.slice(0, at) : code);
  const from = at > 0 ? code.slice(at + 1) : '';
  return rule && /^\d{4}-\d{2}-\d{2}$/.test(from) ? { rule, from } : null;
}

/**
 * An id that is the same on every device for one occurrence of a series (its series and day): two devices making
 * the next ones of a series without end at once make the same events, and the sync keeps one of each.
 */
export function occurrenceId(series: string, date: string): string {
  const text = `${series}|${date}`;
  // Four FNV-1a hashes with other seeds: 128 bits, written as a UUID (version 4 marks, as the database expects a uuid).
  const hex = [0x811c9dc5, 0x01000193, 0x6b43a9b5, 0x9e3779b9]
    .map(seed => {
      let h = seed >>> 0;
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
      return h.toString(16).padStart(8, '0');
    })
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) & 3]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** What an occurrence copies from the one before it (the rest: its own day, id, « fait »). */
export function nextOccurrence(model: CalendarEvent, date: string): NewEvent & { id: string } {
  const { id: _id, done: _done, createdAt: _c, deletedAt: _d, date: _date, externalId: _x, ...rest } = model;
  return { ...rest, date, id: occurrenceId(model.series!, date) };
}

/** The series without end whose next occurrences are due (less than endlessRefill ahead): what to add. */
export function planEndless(rules: Record<string, string>, events: CalendarEvent[], trash: CalendarEvent[], today = todayKey()): { add: (NewEvent & { id: string })[]; gone: string[] } {
  const bySeries = new Map<string, CalendarEvent[]>();
  for (const e of events) if (e.series && rules[e.series]) bySeries.set(e.series, [...(bySeries.get(e.series) ?? []), e]);
  const trashed = new Map<string, string>();
  for (const e of trash) if (e.series && rules[e.series] && e.date > (trashed.get(e.series) ?? '')) trashed.set(e.series, e.date);
  const add: (NewEvent & { id: string })[] = [];
  const gone: string[] = [];
  for (const [series, code] of Object.entries(rules)) {
    const saved = readRuleCode(code);
    const list = bySeries.get(series);
    // A series deleted (all its occurrences gone, the trash too): its rule goes.
    if (!saved || !list?.length) {
      if (!trashed.has(series)) gone.push(series);
      continue;
    }
    if (saved.rule.until) continue;
    const last = list.reduce((a, b) => (b.date > a.date ? b : a));
    // A deleted last one counts as made (« celui-ci » deleted is not made again).
    const lastDay = [last.date, trashed.get(series) ?? ''].sort().at(-1)!;
    if (lastDay >= endlessRefill(saved.rule, today)) continue;
    const days = ruleDays(saved.from, saved.rule, endlessUntil(saved.rule, today)).days.filter(d => d > lastDay);
    add.push(...days.map(d => nextOccurrence(last, d)));
  }
  return { add, gone };
}

/**
 * A new end for a series (from the window of one of its events): the days after it go, or the days up to it are
 * made (`until` null: without end, a horizon ahead). `rule`: its saved one, else read from its days.
 */
export function planNewEnd(series: CalendarEvent[], until: string | null, saved: { rule: RepeatRule; from: string } | null, today = todayKey()): { remove: string[]; add: (NewEvent & { id: string })[]; rule: RepeatRule | null; from: string } {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const from = saved?.from ?? sorted[0]?.date ?? today;
  const rule = saved?.rule ?? guessRule(sorted.map(e => e.date));
  if (!sorted.length || !rule) return { remove: [], add: [], rule, from };
  const last = sorted.at(-1)!;
  const horizon = until ?? endlessUntil(rule, today);
  const remove = until ? sorted.filter(e => e.date > until).map(e => e.id) : [];
  const add = ruleDays(from, { ...rule, until: undefined }, horizon)
    .days.filter(d => d > last.date)
    .map(d => nextOccurrence(last, d));
  return { remove, add, rule: { ...rule, until: until ?? undefined }, from };
}

/** Keeps the rule of a new series of my calendar (a series without end is made further ahead with it). */
export function rememberRule(series: string, rule: RepeatRule, from: string) {
  useSettings.getState().set({ repeatRules: { ...getSettings().repeatRules, [series]: saveRuleCode(rule, from) } });
}

/**
 * « Celui-ci et les suivants » deleted from a series without end that keeps earlier days: the series ends at the
 * last one kept (its next ones came back by themselves months later, made again by refillEndless). Called before
 * they are removed. Returns how to undo it.
 */
export function endSeriesBefore(series: string, date: string): (() => void) | null {
  const code = getSettings().repeatRules?.[series];
  const saved = readRuleCode(code);
  if (!saved || saved.rule.until || date <= saved.from) return null;
  // « Jusqu’au » its last day kept (the day before, when none is left to read).
  const kept = useCalendar.getState().events.filter(e => e.series === series && e.date < date).map(e => e.date).sort().at(-1);
  rememberRule(series, { ...saved.rule, until: kept ?? shiftKey(date, -1) }, saved.from);
  return () => useSettings.getState().set({ repeatRules: { ...getSettings().repeatRules, [series]: code! } });
}

/** The rule once « celui-ci et les suivants » moved from `from` to `to`: counted from the new day (its weekdays too). */
export function movedRule(rule: RepeatRule, from: string, to: string): RepeatRule {
  const shift = ((dayShift(from, to) % 7) + 7) % 7;
  return {
    ...rule,
    ...(rule.unit === 'week' && rule.days?.length && { days: [...new Set(rule.days.map(d => (d + shift) % 7))].sort((a, b) => a - b) }),
    ...(rule.unit === 'month' && rule.nth && { nth: nthOfMonth(to) }),
    // Its last day moved with the others.
    ...(rule.until && { until: shiftKey(rule.until, dayShift(from, to)) }),
  };
}

/**
 * « Celui-ci et les suivants » moved to another day: the saved rule follows (the next ones of a series without end,
 * made later, and a new end chosen later, were still put on the old day).
 */
export function moveSeriesRule(series: string, from: string, to: string) {
  const saved = savedRule(series);
  if (saved && from !== to) rememberRule(series, movedRule(saved.rule, from, to), to);
}

/** The saved rule of a series of my calendar, if any. */
export const savedRule = (series: string) => readRuleCode(getSettings().repeatRules?.[series]);

/**
 * Makes the next occurrences of my series without end when they are due, and forgets the rules of the series
 * deleted. Called when the calendar opens; cheap when there is nothing to do (one pass over the events).
 */
export function refillEndless(today = todayKey()) {
  const rules = getSettings().repeatRules ?? {};
  if (!Object.keys(rules).length) return 0;
  const { events, trash, addMany } = useCalendar.getState();
  const { add, gone } = planEndless(rules, events, trash, today);
  if (add.length) addMany(add);
  if (gone.length) useSettings.getState().set({ repeatRules: Object.fromEntries(Object.entries(rules).filter(([k]) => !gone.includes(k))) });
  return add.length;
}
