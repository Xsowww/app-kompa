// Where the Calendar page reads and writes its events: my own calendar (the store), or a shared calendar
// (pages/groups/SharedCalendar), with the same screens — day, week, month, quick add, drag.

import { createContext, useContext, useMemo } from 'react';
import { useCalendar, nextInSeries, MY_CATEGORIES, type CalendarEvent, type CategoryScope, type CustomCategory, type NewEvent } from '../../store/calendar';
import { trashEvent, trashEvents } from '../../lib/trash';
import type { Group } from '../../lib/groups';
import { useSettings } from '../../store/settings';
import { PERIOD_IDEAS, sortPeriods, type Period } from '../../lib/periods';
import type { Usage } from '../../lib/usage';
import { askChoice, confirmAction } from '../../store/ui';
import { useGroups } from '../../store/groups';
import { t, tn } from '../../i18n';
import { isSpan } from '../../lib/repeat';

/** Examples of periods that fit the account (« en cours, en entreprise » is for students): « congés, télétravail, déplacement ». */
export const periodIdeas = (usage?: Usage) => (PERIOD_IDEAS[usage ?? 'etudes'] ?? PERIOD_IDEAS.etudes).slice(0, 3).map(i => i.title.toLowerCase()).join(', ');

export interface CalendarSource {
  /** null: my calendar. A shared calendar has no « fait », import or « important »; its reminders go to each member it is for. */
  shared: {
    group: Group;
    author: (eventId: string) => string;
    canEdit: boolean;
    /** Members, for « pour qui » on periods (me first, named « Moi »). */
    people: { id: string; name: string }[];
    /** A member's name for labels (« Toi » for me). */
    nameOf: (userId: string) => string;
    /** The same after « pour » (« für dich », « per te »: another word than « toi » in some languages). */
    nameFor: (userId: string) => string;
    /** Its events not read yet (the lists show their shape), or not read at all (said above the calendar): never « Rien de prévu ». */
    unread?: 'loading' | 'failed';
  } | null;
  events: CalendarEvent[];
  /** Own categories: mine (settings), or the shared calendar's, for all its members. */
  categories: CustomCategory[];
  categoryScope: CategoryScope;
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
  const categories = useSettings(s => s.customCategories);
  const mine = useMemo<CalendarSource>(() => {
    const { add, update, toggleDone } = useCalendar.getState();
    const settings = useSettings.getState();
    return {
      shared: null,
      events,
      categories,
      categoryScope: MY_CATEGORIES,
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
  }, [events, periods, categories]);
  return shared ?? mine;
}

/** « Léa · Dentiste » on a shared calendar when the event is for some members (« pour qui »), else its title. */
export function eventTitle(ev: Pick<CalendarEvent, 'title' | 'people'>, shared: CalendarSource['shared']): string {
  if (!shared || !ev.people?.length) return ev.title;
  const names = ev.people.map(shared.nameOf);
  const who = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.length === 2 ? t('{a} et {b}', { a: names[0], b: names[1] }) : names.join('');
  return `${who} · ${ev.title}`;
}

/**
 * Asked before an event goes on a shared calendar (it goes for every member, without « Annuler »).
 * Mine goes to the trash with « Annuler » in its message: no question first.
 */
export function confirmRemoveEvent(ev: Pick<CalendarEvent, 'title'>, shared: CalendarSource['shared']): Promise<boolean> {
  if (!shared) return Promise.resolve(true);
  return confirmAction(t('Supprimer « {title} » ?', { title: ev.title }), t('L’événement disparaît pour tous les membres de « {name} ».', { name: shared.group.name }), t('Supprimer'));
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
export async function askSeriesScope(ev: Pick<CalendarEvent, 'id' | 'series' | 'date' | 'title'>, action: 'delete' | 'edit'): Promise<'one' | 'next' | null> {
  const next = nextInSeries(ev, useCalendar.getState().events).length;
  if (!next) return 'one';
  const span = isSpan(ev.series);
  const answer = await askChoice(
    action === 'delete' ? t('Supprimer « {title} » ?', { title: ev.title }) : t('Modifier « {title} »', { title: ev.title }),
    span ? tn(next, 'Cet événement dure plusieurs jours ({n} jour après celui-ci).', 'Cet événement dure plusieurs jours ({n} jours après celui-ci).') : t('Cet événement se répète ({n} fois après celui-ci).', { n: next }),
    span ? t('Seulement ce jour') : t('Seulement celui-ci'),
    span ? t('Ce jour et les suivants') : t('Celui-ci et les suivants'),
    action === 'delete',
  );
  return answer === 'confirm' ? 'one' : answer === 'other' ? 'next' : null;
}

/** My calendar: deletes the event, or with its next ones (« Annuler » in the toast brings them all back). */
export async function removeMine(ev: CalendarEvent): Promise<boolean> {
  const scope = await askSeriesScope(ev, 'delete');
  if (!scope) return false;
  if (scope === 'one') trashEvent(ev.id);
  else trashEvents([ev.id, ...nextInSeries(ev, useCalendar.getState().events).map(e => e.id)]);
  return true;
}
