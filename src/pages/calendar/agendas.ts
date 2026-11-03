// My shared calendars over my own calendar and the home page: their events, in each one's colour, read-only
// there (opening one goes to its agenda). Online only: without the cloud there is nothing to read.

import { useEffect, useMemo } from 'react';
import { CATEGORIES, guessCategory, knowSharedCategories, useCalendar, type CalendarEvent, type EventCategory } from '../../store/calendar';
import { toast } from '../../store/ui';
import { t } from '../../i18n';
import { GROUP_COLORS, type Group, type GroupEvent } from '../../lib/groups';
import { useGroups } from '../../store/groups';
import { useSettings } from '../../store/settings';
import { supabase } from '../../lib/supabase';

/** An event of one of my shared calendars, shown in mine. */
export interface AgendaEvent extends CalendarEvent {
  agenda: { id: string; name: string };
}

export const fromAgenda = (e: CalendarEvent): e is AgendaEvent => 'agenda' in e;

/** Its day in its agenda, the event glowing there. */
export const agendaLink = (e: Pick<AgendaEvent, 'agenda' | 'date' | 'id'>) => `/agendas?g=${e.agenda.id}&jour=${e.date}&evt=${e.id}`;

/**
 * The agenda as a category of its own (its name, its colour): every screen of the calendar already draws a
 * category's colour and name, so an agenda's events need nothing else there.
 */
export function agendaCategory(g: Pick<Group, 'id' | 'name' | 'color'>): EventCategory {
  const id = `c-ag-${g.id}` as const;
  knowSharedCategories([{ id, label: g.name, color: g.color ?? GROUP_COLORS[0] }]);
  return id;
}

/** The events of the shared calendars shown (`hidden`: left out by the person), as calendar events. */
export function agendaEvents(agendas: Group[], events: Record<string, GroupEvent[] | undefined>, hidden: string[]): AgendaEvent[] {
  return agendas
    .filter(g => g.kind === 'agenda' && !hidden.includes(g.id))
    .flatMap(g => {
      const category = agendaCategory(g);
      return (events[g.id] ?? []).map(e => ({
        id: e.id,
        title: e.title,
        date: e.date,
        ...(e.start && { start: e.start }),
        ...(e.end && { end: e.end }),
        ...(e.place && { place: e.place }),
        ...(e.details && { details: e.details }),
        ...(e.series && { series: e.series }),
        ...(e.people.length && { people: e.people }),
        category,
        done: false,
        createdAt: e.createdAt,
        agenda: { id: g.id, name: g.name },
      }));
    });
}

/**
 * « Copier dans mon agenda »: a shared calendar's event becomes one of mine (my usual reminders; its own category
 * when it is a built-in one, else the one its title suggests). « Annuler » takes the copy back.
 */
export function copyToMyCalendar(ev: CalendarEvent) {
  const { add, removeMany, purge } = useCalendar.getState();
  const category = ev.category in CATEGORIES ? ev.category : guessCategory(ev.title, !!ev.start);
  const copy = add({ title: ev.title, date: ev.date, start: ev.start, end: ev.end, category, details: ev.details, place: ev.place });
  toast(t('Copié dans ton agenda : {title}', { title: ev.title }), 'success', {
    label: t('Annuler||l’action'),
    run: () => {
      removeMany([copy.id]);
      purge([copy.id]);
    },
  });
}

/** When each agenda's events were last read here: read again after a minute, not at each visit. */
const readAt = new Map<string, number>();
const FRESH_MS = 60_000;
const NONE: string[] = [];

/**
 * My shared calendars and the events of those shown, read when needed (the calendar and the home page).
 * Nothing without the cloud (local mode), nor when not `enabled` (a shared calendar open): no request.
 */
export function useAgendaOverlay(enabled = true): { agendas: Group[]; events: AgendaEvent[] } {
  const groups = useGroups(s => s.groups);
  const loaded = useGroups(s => s.loaded);
  const raw = useGroups(s => s.events);
  const hidden = useSettings(s => s.hiddenAgendas) ?? NONE;
  const agendas = useMemo(() => (supabase && enabled ? groups.filter(g => g.kind === 'agenda') : []), [groups, enabled]);
  const wanted = agendas.filter(g => !hidden.includes(g.id)).map(g => g.id).join(',');

  useEffect(() => {
    if (supabase && enabled && !loaded) void useGroups.getState().loadGroups();
  }, [loaded, enabled]);

  useEffect(() => {
    if (!supabase || !wanted) return;
    const read = () => {
      for (const id of wanted.split(',')) {
        if (Date.now() - (readAt.get(id) ?? 0) < FRESH_MS) continue;
        readAt.set(id, Date.now());
        void useGroups.getState().refresh(id, ['events']);
      }
    };
    read();
    const onVisible = () => document.visibilityState === 'visible' && read();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [wanted]);

  const events = useMemo(() => agendaEvents(agendas, raw, hidden), [agendas, raw, hidden]);
  return { agendas, events };
}
