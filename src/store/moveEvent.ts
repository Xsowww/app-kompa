// « Déplacer vers… » an event (and its next ones): from my calendar to a shared calendar or a team, back, or from one
// to another. The one function for it: the event's window (calendar/EventForm) and Kompaly's tool use it.
// Written in the target first; only once the server said yes is it taken out of where it was — never lost,
// never in two places without saying so. The result says exactly what happened (for Kompaly to repeat, not invent).

import { useCalendar, nextInSeries, CATEGORIES, type CalendarEvent, type NewEvent } from './calendar';
import { useGroups } from './groups';
import { useAuth } from './auth';
import { createEvents, deleteEvents, groupError, type Group, type GroupEvent } from '../lib/groups';
import { agendaTargets, toAgendaRows } from '../pages/groups/agendaTarget';
import { newSeries } from '../lib/seriesId';
import { t } from '../i18n';

/** Where an event can go: my calendar (`null`), a shared calendar I can add to, or one of my teams. */
export function moveTargets(groups = useGroups.getState().groups, myRoles = useGroups.getState().myRoles, me = useAuth.getState().user?.id): Group[] {
  return [...agendaTargets(groups, myRoles, me), ...groups.filter(g => g.kind !== 'agenda')];
}

export type MoveResult = { ok: true; moved: number; to: string; title: string; date: string } | { ok: false; error: string };

/** A shared calendar's or a team's event as one of mine (its built-in category kept, my usual reminders only when it had none chosen). */
const asMine = (e: GroupEvent, series?: string): NewEvent => ({
  title: e.title,
  date: e.date,
  ...(e.start && { start: e.start }),
  ...(e.end && { end: e.end }),
  ...(e.place && { place: e.place }),
  ...(e.details && { details: e.details }),
  ...(e.reminders.length && { reminders: e.reminders }),
  ...(series && { series }),
  category: e.category && e.category in CATEGORIES ? (e.category as NewEvent['category']) : 'perso',
});

/**
 * Moves an event (`from`: the group it is in; none: my calendar) to `to` (a group's id; null: my calendar).
 * `withNext`: its next occurrences too (a series). Nothing changes when the target refuses.
 */
export async function moveEventToAgenda(eventId: string, from: string | null, to: string | null, withNext = false): Promise<MoveResult> {
  if (from === to) return { ok: false, error: t('C’est déjà dans cet agenda.') };
  const target = to ? (useGroups.getState().groups.find(g => g.id === to) ?? null) : null;
  if (to && !target) return { ok: false, error: t('Agenda introuvable.') };
  const toName = target?.name ?? t('Mon agenda');
  try {
    if (!from) {
      // From my calendar.
      const all = useCalendar.getState().events;
      const ev = all.find(e => e.id === eventId);
      if (!ev) return { ok: false, error: t('Événement introuvable.') };
      const list: CalendarEvent[] = [ev, ...(withNext ? nextInSeries(ev, all) : [])];
      // A new series id there (≤ 40 characters), the same for all the pieces moved.
      const series = ev.series ? newSeries(ev.series.startsWith('span-')) : undefined;
      await createEvents(to!, toAgendaRows(list.map(e => ({ ...e, ...(series && { series }) })), target!));
      const ids = list.map(e => e.id);
      useCalendar.getState().removeMany(ids);
      useCalendar.getState().purge(ids);
      void useGroups.getState().refresh(to!, ['events']);
      return { ok: true, moved: list.length, to: toName, title: ev.title, date: ev.date };
    }
    // From a shared calendar or a team.
    const all = useGroups.getState().events[from] ?? [];
    const ev = all.find(e => e.id === eventId);
    if (!ev) return { ok: false, error: t('Événement introuvable.') };
    const list = [ev, ...(withNext && ev.series ? all.filter(e => e.series === ev.series && e.date > ev.date) : [])];
    const series = ev.series && list.length > 1 ? newSeries(ev.series.startsWith('span-')) : undefined;
    if (to) await createEvents(to, toAgendaRows(list.map(e => asMine(e, series)), target!));
    else useCalendar.getState().addMany(list.map(e => asMine(e, series)));
    try {
      await deleteEvents(list.map(e => e.id));
    } catch (e) {
      // Copied but not taken out of the old one (no right to delete there): said as it is.
      return { ok: false, error: t('Copié dans « {to} », mais pas retiré de l’ancien agenda : {why}', { to: toName, why: groupError(e) }) };
    }
    void useGroups.getState().refresh(from, ['events']);
    if (to) void useGroups.getState().refresh(to, ['events']);
    return { ok: true, moved: list.length, to: toName, title: ev.title, date: ev.date };
  } catch (e) {
    return { ok: false, error: groupError(e) };
  }
}
