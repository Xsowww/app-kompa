// Where the Calendar page reads and writes its events: my own calendar (the store), or a shared calendar
// (pages/groups/SharedCalendar), with the same screens — day, week, month, quick add, drag.

import { createContext, useContext, useMemo } from 'react';
import { useCalendar, nextInSeries, MY_CATEGORIES, type CalendarEvent, type CategoryScope, type CustomCategory, type NewEvent } from '../../store/calendar';
import { trashEvent, trashEvents } from '../../lib/trash';
import type { Group } from '../../lib/groups';
import { useSettings } from '../../store/settings';
import { PERIOD_IDEAS, sortPeriods, type Period } from '../../lib/periods';
import type { Usage } from '../../lib/usage';
import { askChoice, toast } from '../../store/ui';
import { endSeriesBefore } from '../../lib/repeatSeries';
import { useGroups } from '../../store/groups';
import { t, tn } from '../../i18n';
import { isSpan } from '../../lib/repeat';
import { fmtDay, fromKey } from '../../lib/dates';

/** Examples of periods that fit the account (« en cours, en entreprise » is for students): « congés, télétravail, déplacement ». */
export const periodIdeas = (usage?: Usage) => (PERIOD_IDEAS[usage ?? 'etudes'] ?? PERIOD_IDEAS.etudes).slice(0, 3).map(i => i.title.toLowerCase()).join(', ');

export interface CalendarSource {
  /** null: my calendar. A shared calendar has no « fait », import or « important »; its reminders go to each member it is for. */
  shared: {
    group: Group;
    author: (eventId: string) => string;
    /** Added by me (someone else's can be reported). */
    byMe: (eventId: string) => boolean;
    canEdit: boolean;
    /** Members, for « pour qui » on periods (me first, named « Moi »). */
    people: { id: string; name: string }[];
    /** A member's name for labels (« Toi » for me). */
    nameOf: (userId: string) => string;
    /** The same after « pour » (« für dich », « per te »: another word than « toi » in some languages). */
    nameFor: (userId: string) => string;
    /** « Modifié par Léa · hier » when someone changed it after it was added (null: never changed). */
    changed: (eventId: string) => string | null;
    /** Its events not read yet (the lists show their shape), or not read at all (said above the calendar): never « Rien de prévu ». */
    unread?: 'loading' | 'failed';
  } | null;
  events: CalendarEvent[];
  /** Own categories: mine (settings), or the shared calendar's, for all its members. */
  categories: CustomCategory[];
  categoryScope: CategoryScope;
  add: (e: NewEvent) => void;
  /** Several at once: the occurrences of a repeat, the days of an event over several days (linked by `series`). */
  addMany: (list: NewEvent[]) => void;
  update: (id: string, patch: Partial<CalendarEvent>) => void;
  /** This occurrence and the next ones of its series (a new day moves them by as many days). */
  updateSeries: (id: string, patch: Partial<CalendarEvent>) => void;
  toggleDone: (id: string) => void;
  remove: (id: string) => void;
  removeMany: (ids: string[]) => void;
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
  const categories = useSettings(s => s.customCategories);
  const mine = useMemo<CalendarSource>(() => {
    const { add, addMany, update, updateSeries, toggleDone } = useCalendar.getState();
    const settings = useSettings.getState();
    return {
      shared: null,
      events,
      categories,
      categoryScope: MY_CATEGORIES,
      add: e => void add(e),
      addMany,
      update,
      updateSeries,
      toggleDone,
      remove: trashEvent,
      removeMany: trashEvents,
      periods,
      savePeriods: list => {
        const ids = new Set(list.map(p => p.id));
        settings.set({ periods: sortPeriods([...useSettings.getState().periods.filter(p => !ids.has(p.id)), ...list]) });
      },
      removePeriod: id => settings.set({ periods: useSettings.getState().periods.filter(p => p.id !== id) }),
    };
  }, [events, periods, categories]);
  return shared ?? mine;
}

/** « Léa · Dentiste » on a shared calendar when the event is for some members (« pour qui »), else its title. */
export function eventTitle(ev: Pick<CalendarEvent, 'title' | 'people'>, shared: CalendarSource['shared']): string {
  if (!shared || !ev.people?.length) return ev.title;
  const names = ev.people.map(shared.nameOf);
  const who = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.length === 2 ? t('{a} et {b}', { a: names[0], b: names[1] }) : names.join('');
  // At the start of the label: « Toi · Ménage », as « Léa · Courses ».
  return `${who.charAt(0).toUpperCase()}${who.slice(1)} · ${ev.title}`;
}

/** Where periods can be imported from: my own calendar (« perso »), my other shared calendars. */
export const PERSO = 'perso';
export function useImportSources(): { id: string; name: string }[] {
  const here = useContext(CalendarSourceContext)?.shared?.group.id ?? PERSO;
  const groups = useGroups(s => s.groups);
  return useMemo(
    () => [...(here === PERSO ? [] : [{ id: PERSO, name: t('Mon agenda perso') }]), ...groups.filter(g => g.kind === 'agenda' && g.id !== here).map(g => ({ id: g.id, name: g.name }))],
    [here, groups],
  );
}

/**
 * Deleting or changing an event that repeats: only this one, or this one and the next ones ('next').
 * One that doesn't repeat (or the last of its series): 'one' without asking.
 */
export async function askSeriesScope(ev: Pick<CalendarEvent, 'id' | 'series' | 'date' | 'title'>, action: 'delete' | 'edit', events: CalendarEvent[]): Promise<'one' | 'next' | null> {
  const next = nextInSeries(ev, events).length;
  if (!next) return 'one';
  const span = isSpan(ev.series);
  const answer = await askChoice(
    action === 'delete' ? t('Supprimer « {title} » ?', { title: ev.title }) : t('Modifier « {title} »', { title: ev.title }),
    span ? tn(next, 'Cet événement dure plusieurs jours ({n} jour après celui-ci).', 'Cet événement dure plusieurs jours ({n} jours après celui-ci).') : t('Cet événement se répète.'),
    span ? t('Seulement ce jour') : t('Seulement celui-ci'),
    span ? t('Ce jour et les suivants') : t('Celui-ci et les suivants'),
    action === 'delete',
  );
  return answer === 'confirm' ? 'one' : answer === 'other' ? 'next' : null;
}

/**
 * Deletes an event, or with its next ones when it is part of a series. No question for a single one: « Annuler » in
 * the toast brings it back (a shared calendar's waits for it before leaving the server, pages/groups/SharedCalendar).
 */
export async function removeEvent(ev: CalendarEvent, source: CalendarSource): Promise<boolean> {
  // Over several days: the whole event (as its sheet edits it), or only the day it was opened on.
  if (isSpan(ev.series)) {
    const all = source.events.filter(e => e.series === ev.series).sort((a, b) => a.date.localeCompare(b.date));
    if (all.length > 1) {
      const answer = await askChoice(
        t('Supprimer « {title} » ?', { title: ev.title }),
        t('Il dure plusieurs jours : du {from} au {to}.', { from: fmtDay(fromKey(all[0].date), 'EEEE d MMMM'), to: fmtDay(fromKey(all.at(-1)!.date), 'EEEE d MMMM') }),
        t('Tout l’événement'),
        t('Seulement ce jour'),
        true,
      );
      if (!answer) return false;
      if (answer === 'confirm') source.removeMany(all.map(e => e.id));
      else source.remove(ev.id);
      return true;
    }
  }
  const scope = await askSeriesScope(ev, 'delete', source.events);
  if (!scope) return false;
  if (scope === 'next') {
    const ids = [ev.id, ...nextInSeries(ev, source.events).map(e => e.id)];
    // My series without end: it stops there (else its next ones were made again months later); « Annuler » undoes both.
    const undoEnd = !source.shared && ev.series ? endSeriesBefore(ev.series, ev.date) : null;
    if (undoEnd) {
      useCalendar.getState().removeMany(ids);
      toast(t('{n} événements mis à la corbeille', { n: ids.length }), 'info', { label: t('Annuler||l’action'), run: () => (useCalendar.getState().restore(ids), undoEnd()) });
    } else source.removeMany(ids);
  }
  else source.remove(ev.id);
  return true;
}

/** The fields of `data` that differ from the event as it was (empty, none and [] are the same). */
export function changedFields<T extends object>(data: T, before: object): Partial<T> {
  const norm = (v: unknown) => JSON.stringify(v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? null : v);
  return Object.fromEntries(Object.entries(data).filter(([k, v]) => norm(v) !== norm((before as Record<string, unknown>)[k]))) as Partial<T>;
}
