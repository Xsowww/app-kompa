import { isDeliverable, type CalendarEvent } from '../store/calendar';
import { daysUntil, isOver } from './dates';

/**
 * « En retard » (calendar and home page): an own event of the last two weeks, over and not ticked. Classes from a
 * timetable are left out (too many), so is homework, which the calendar already lists with « Retard ».
 */
export const isLateEvent = (e: CalendarEvent, now = new Date()) =>
  !e.done && !e.deletedAt && !e.externalId && e.category !== 'cours' && !isDeliverable(e) && isOver(e, now) && daysUntil(e.date) >= -14;
