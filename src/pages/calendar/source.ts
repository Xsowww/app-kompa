// Where the Calendar page reads and writes its events: my own calendar (the store), or a shared calendar
// (pages/groups/SharedCalendar), with the same screens — day, week, month, quick add, drag.

import { createContext, useContext, useMemo } from 'react';
import { useCalendar, type CalendarEvent, type NewEvent } from '../../store/calendar';
import { trashEvent } from '../../lib/trash';
import type { Group } from '../../lib/groups';
import { useSettings } from '../../store/settings';
import { sortPeriods, type Period } from '../../lib/periods';

export interface CalendarSource {
  /** null: my calendar. A shared calendar has no « fait », reminders, import or custom categories. */
  shared: {
    group: Group;
    author: (eventId: string) => string;
    canEdit: boolean;
    /** Members, for « pour qui » on periods (me first, named « Moi »). */
    people: { id: string; name: string }[];
    /** A member's name for labels (« Toi » for me). */
    nameOf: (userId: string) => string;
  } | null;
  events: CalendarEvent[];
  add: (e: NewEvent) => void;
  update: (id: string, patch: Partial<CalendarEvent>) => void;
  toggleDone: (id: string) => void;
  remove: (id: string) => void;
  /** « En entreprise », « Vacances »… (my settings, or the shared calendar's own). */
  periods: Period[];
  /** Adds or changes periods (several: a repeated one). */
  savePeriods: (list: Period[]) => void;
  removePeriod: (id: string) => void;
}

export const CalendarSourceContext = createContext<CalendarSource | null>(null);

export function useCalendarSource(): CalendarSource {
  const shared = useContext(CalendarSourceContext);
  const events = useCalendar(s => s.events);
  const periods = useSettings(s => s.periods);
  const mine = useMemo<CalendarSource>(() => {
    const { add, update, toggleDone } = useCalendar.getState();
    const settings = useSettings.getState();
    return {
      shared: null,
      events,
      add: e => void add(e),
      update,
      toggleDone,
      remove: trashEvent,
      periods,
      savePeriods: list => {
        const ids = new Set(list.map(p => p.id));
        settings.set({ periods: sortPeriods([...useSettings.getState().periods.filter(p => !ids.has(p.id)), ...list]) });
      },
      removePeriod: id => settings.set({ periods: useSettings.getState().periods.filter(p => p.id !== id) }),
    };
  }, [events, periods]);
  return shared ?? mine;
}

/** « Léa · Dentiste » on a shared calendar when the event is for some members (« pour qui »), else its title. */
export function eventTitle(ev: Pick<CalendarEvent, 'title' | 'people'>, shared: CalendarSource['shared']): string {
  if (!shared || !ev.people?.length) return ev.title;
  const names = ev.people.map(shared.nameOf);
  return `${names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(' et ')} · ${ev.title}`;
}
