import { isDeliverable, sortEvents, type CalendarEvent } from '../store/calendar';
import { daysUntil, toKey } from './dates';
import { firstOfSpans, isSpan } from './repeat';

/**
 * « En retard » (calendar and home page): an own event of the last two weeks, from a day before today and not ticked —
 * like a task, late from the next day (the bank at 11:00 isn't « en retard » at 11:05). Classes from a timetable are
 * left out (too many), so is homework, which the calendar already lists with « Retard ».
 */
export const isLateEvent = (e: CalendarEvent, now = new Date()) =>
  !e.done && !e.deletedAt && !e.externalId && e.category !== 'cours' && !isDeliverable(e) && e.date < toKey(now) && daysUntil(e.date) >= -14;

/**
 * The late events of `list`, newest first. An event over several days counts once (at its first late day), and only
 * when its last day is past: a trip still under way isn't late. `list` holds every day of it (the filter shown).
 */
export function listLate(list: CalendarEvent[], now = new Date()): CalendarEvent[] {
  const today = toKey(now);
  const going = new Set(list.filter(e => isSpan(e.series) && e.date >= today && !e.done).map(e => e.series));
  return firstOfSpans(list.filter(e => isLateEvent(e, now) && !going.has(e.series)).sort(sortEvents)).sort((a, b) => sortEvents(b, a));
}

/** What ticking or moving a late event acts on: every late day of its event over several days, else itself. */
export const lateDaysOf = (e: CalendarEvent, list: CalendarEvent[], now = new Date()) =>
  isSpan(e.series) ? list.filter(x => x.series === e.series && isLateEvent(x, now)) : [e];
