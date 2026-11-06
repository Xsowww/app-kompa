// The « + » form's « Agenda » choice (calendar/EventForm): a new event goes to my calendar (« Perso ») or straight to
// one of my shared calendars, so that nobody has to add it twice. Pure parts tested in tests/agendaTarget.test.ts.

import { CATEGORIES, type NewEvent } from '../../store/calendar';
import type { Group, GroupRole, NewGroupEvent } from '../../lib/groups';

/** The shared calendars I may add to: mine, or where I am an editor (a reader can't). */
export const agendaTargets = (groups: Group[], myRoles: Record<string, GroupRole>, me: string | undefined): Group[] =>
  groups.filter(g => g.kind === 'agenda' && (g.ownerId === me || myRoles[g.id] === 'editeur'));

/**
 * My form's events as a shared calendar's rows: its categories (a built-in one, or one of the calendar's own; mine
 * mean nothing to the others: its everyday one), no « important », no reminder unless chosen (mine aren't imposed on
 * the members), nobody in particular (« pour qui »: everyone).
 */
export function toAgendaRows(list: NewEvent[], agenda: Pick<Group, 'categories'>): NewGroupEvent[] {
  return list.map(e => ({
    title: e.title,
    date: e.date,
    start: e.start ?? null,
    end: e.start && e.end ? e.end : null,
    place: e.place ?? null,
    category: e.category in CATEGORIES || agenda.categories.some(c => c.id === e.category) ? e.category : 'perso',
    details: e.details ?? null,
    people: [],
    reminders: e.reminders ?? [],
    series: e.series ?? null,
  }));
}
