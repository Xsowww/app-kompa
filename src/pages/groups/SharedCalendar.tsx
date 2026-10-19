import { useEffect, useMemo, useState } from 'react';
import CalendarPage from '../calendar/CalendarPage';
import { CalendarSourceContext, type CalendarSource } from '../calendar/source';
import { CATEGORIES, type CalendarEvent, type CategoryScope, type CustomCategory, type EventCategory } from '../../store/calendar';
import { useGroups } from '../../store/groups';
import { toast } from '../../store/ui';
import { createEvent, deleteEvent, deletePeriod, groupError, savePeriods, setAgendaCategories, updateEvent, type Group, type GroupEvent, type NewGroupEvent } from '../../lib/groups';
import { useMemberName, useRights } from './util';
import { useAuth } from '../../store/auth';
import { sortPeriods } from '../../lib/periods';
import { t } from '../../i18n';

/** A built-in category or one of the calendar's own; anything else (deleted since, mine) shows as Perso. */
const categoryIn = (custom: CustomCategory[]) => (c: string | null | undefined): EventCategory =>
  c && (c in CATEGORIES || custom.some(x => x.id === c)) ? (c as EventCategory) : 'perso';

/** A shared calendar's event as the Calendar page shows it (its place, from the former list, joins the notes). */
const toCalendar = (e: GroupEvent, category: ReturnType<typeof categoryIn>): CalendarEvent => ({
  id: e.id,
  title: e.title,
  date: e.date,
  start: e.start ?? undefined,
  end: e.end ?? undefined,
  category: category(e.category),
  details: [e.place, e.details].filter(Boolean).join('\n') || undefined,
  done: false,
  createdAt: e.createdAt,
  ...(e.people.length && { people: e.people }),
  ...(e.reminders.length && { reminders: e.reminders }),
});

const toRow = (p: Partial<CalendarEvent>, category: ReturnType<typeof categoryIn>): Partial<NewGroupEvent> => ({
  ...(p.title !== undefined && { title: p.title }),
  ...(p.date !== undefined && { date: p.date }),
  ...('start' in p && { start: p.start ?? null }),
  ...('end' in p && { end: p.end ?? null }),
  ...(p.category !== undefined && { category: category(p.category) }),
  // The notes now hold the place too: it isn't kept twice.
  ...('details' in p && { details: p.details ?? null, place: null }),
  ...('people' in p && { people: p.people ?? [] }),
  ...('reminders' in p && { reminders: p.reminders ?? [] }),
});

// Removed events wait for the end of the « Annuler » toast before leaving the server: undoing gives back
// the very same event (its author, no « Ajouté » sent to the others). Leaving the page sends them at once.
const UNDO_MS = 6000;
const pending = new Map<string, () => void>();
const flushPending = () => [...pending.values()].forEach(send => send());

/** The Calendar page (day, week, month…) on a shared calendar: every member sees the changes live. */
export default function SharedCalendar({ group }: { group: Group }) {
  const raw = useGroups(s => s.events[group.id]);
  const periods = useGroups(s => s.periods[group.id]);
  const members = useGroups(s => s.members[group.id]);
  const me = useAuth(s => s.user?.id);
  const nameOf = useMemberName(group.id);
  const { canEdit } = useRights(group);
  const [, redraw] = useState(0);
  useEffect(() => {
    addEventListener('pagehide', flushPending);
    return () => {
      removeEventListener('pagehide', flushPending);
      flushPending();
    };
  }, []);

  // A category another member just created: the calendar's list is read again (the groups table isn't live).
  const unknown = (raw ?? []).some(e => e.category?.startsWith('c-') && !group.categories.some(c => c.id === e.category));
  useEffect(() => {
    if (unknown) void useGroups.getState().loadGroups();
  }, [unknown]);

  const source = useMemo<CalendarSource>(() => {
    const list = (raw ?? []).filter(e => !pending.has(e.id));
    const category = categoryIn(group.categories);
    const reload = () => useGroups.getState().refresh(group.id, ['events']);
    // Shown at once; the server's answer (and the other members' changes) follow by Realtime.
    const patchLocal = (fn: (l: GroupEvent[]) => GroupEvent[]) => useGroups.setState(s => ({ events: { ...s.events, [group.id]: fn(s.events[group.id] ?? []) } }));
    const fail = (e: unknown) => {
      toast(groupError(e), 'error');
      void reload();
    };
    // Shown at once, saved for every member; the server's list (cleaned) replaces it.
    const setCategories = (categories: CustomCategory[]) =>
      useGroups.setState(s => ({ groups: s.groups.map(g => (g.id === group.id ? { ...g, categories } : g)) }));
    const categoryScope: CategoryScope = {
      list: () => useGroups.getState().groups.find(g => g.id === group.id)?.categories ?? group.categories,
      save: next => {
        const before = categoryScope.list();
        setCategories(next);
        void setAgendaCategories(group.id, next)
          .then(setCategories)
          .catch(e => {
            setCategories(before);
            fail(e);
          });
      },
    };
    return {
      shared: {
        group,
        canEdit,
        author: id => nameOf(list.find(e => e.id === id)?.createdBy ?? null),
        people: [...(members ?? [])].sort((a, b) => Number(b.userId === me) - Number(a.userId === me) || a.name.localeCompare(b.name)).map(m => ({ id: m.userId, name: m.userId === me ? t('Moi') : m.name })),
        nameOf: id => nameOf(id, t('Toi')).replace(/^./, c => c.toUpperCase()),
      },
      events: list.map(e => toCalendar(e, category)),
      categories: group.categories,
      categoryScope,
      add: e => {
        void createEvent(group.id, { title: e.title, date: e.date, start: e.start ?? null, end: e.end ?? null, place: null, category: category(e.category), details: e.details ?? null, people: e.people ?? [], reminders: e.reminders ?? [] })
          .then(reload)
          .catch(fail);
      },
      update: (id, patch) => {
        const row = toRow(patch, category);
        patchLocal(l => l.map(e => (e.id === id ? { ...e, ...row } : e)));
        void updateEvent(id, row).catch(fail);
      },
      toggleDone: () => undefined, // no « fait » in a shared calendar
      remove: id => {
        const send = () => {
          clearTimeout(timer);
          pending.delete(id);
          void deleteEvent(id).catch(fail);
        };
        const timer = setTimeout(send, UNDO_MS);
        pending.set(id, send);
        redraw(n => n + 1);
        toast(t('Supprimé de l’agenda'), 'info', {
          label: t('Annuler'),
          run: () => {
            clearTimeout(timer);
            pending.delete(id);
            redraw(n => n + 1);
          },
        });
      },
      periods: periods ?? [],
      savePeriods: list => {
        const ids = new Set(list.map(p => p.id));
        useGroups.setState(s => ({ periods: { ...s.periods, [group.id]: sortPeriods([...(s.periods[group.id] ?? []).filter(p => !ids.has(p.id)), ...list]) } }));
        void savePeriods(group.id, list).then(reload).catch(fail);
      },
      removePeriod: id => {
        useGroups.setState(s => ({ periods: { ...s.periods, [group.id]: (s.periods[group.id] ?? []).filter(p => p.id !== id) } }));
        void deletePeriod(id).then(reload).catch(fail);
      },
    };
  }, [raw, periods, members, me, group, nameOf, canEdit]);

  return (
    <CalendarSourceContext.Provider value={source}>
      <CalendarPage />
    </CalendarSourceContext.Provider>
  );
}
