// « Déplacer vers… »: an event (and the rest of its series) from one calendar to another — my own (« perso »), a
// shared calendar or a group. One function for the event sheet and for Kompaly's move_event tool. The copy is made
// in the target first and read back from there; only then is the original removed (if that fails, the copy is taken
// back): an event is never lost on the way, nor left twice.

import { useCalendar, CATEGORIES, type CalendarEvent, type NewEvent } from './calendar';
import { useGroups } from './groups';
import * as api from '../lib/groups';
import type { GroupEvent } from '../lib/groups';
import { toAgendaRows } from '../pages/groups/agendaTarget';
import { isSpan } from '../lib/repeat';
import { uid } from '../lib/utils';
import { t } from '../i18n';

/** Where an event lives: my calendar, or a shared calendar / group by its id. */
export type AgendaRef = { kind: 'perso' } | { kind: 'group'; groupId: string };

export const PERSO: AgendaRef = { kind: 'perso' };

/** The event as the target holds it once moved (its first occurrence) and how many moved. */
export interface MoveResult {
  /** The occurrences now in the target, read back from it, by date. */
  moved: (CalendarEvent | GroupEvent)[];
  to: AgendaRef;
}

const sameRef = (a: AgendaRef, b: AgendaRef) => a.kind === b.kind && (a.kind === 'perso' || a.groupId === (b as { groupId: string }).groupId);

/** A shared calendar's events: as read on its page, else read now (from a year back, like its page). */
async function groupEvents(groupId: string): Promise<GroupEvent[]> {
  const known = useGroups.getState().events[groupId];
  if (known) return known;
  const from = new Date(Date.now() - 366 * 864e5).toISOString().slice(0, 10);
  return (await api.fetchEvents(groupId, from)).events;
}

/** The occurrences to move: this one, and with `series` the next ones (all the days of an event over several days). */
function pick<T extends { id: string; date: string; series?: string | null }>(all: T[], ev: T, series: boolean): T[] {
  if (!ev.series) return [ev];
  if (isSpan(ev.series)) return all.filter(e => e.series === ev.series).sort((a, b) => a.date.localeCompare(b.date));
  return series ? [ev, ...all.filter(e => e.series === ev.series && e.date > ev.date && e.id !== ev.id)].sort((a, b) => a.date.localeCompare(b.date)) : [ev];
}

/** A shared calendar's event as one of mine: its built-in category, else « perso » (its own categories are its own). */
const asMine = (e: GroupEvent, series: string | undefined): NewEvent => ({
  title: e.title,
  date: e.date,
  start: e.start ?? undefined,
  end: e.end ?? undefined,
  place: e.place ?? undefined,
  details: e.details ?? undefined,
  category: e.category && e.category in CATEGORIES ? (e.category as NewEvent['category']) : 'perso',
  reminders: e.reminders,
  ...(series && { series }),
});

/**
 * Moves the event `eventId` from `from` to `to`. `series`: its next occurrences too (an event over several days always
 * moves whole). Throws an Error with a sentence to show when it can't (rights, network…), nothing changed then.
 */
export async function moveEventToAgenda(eventId: string, from: AgendaRef, to: AgendaRef, { series = false } = {}): Promise<MoveResult> {
  if (sameRef(from, to)) throw new Error(t('Il est déjà dans cet agenda.'));
  // What moves.
  let mine: CalendarEvent[] = [];
  let theirs: GroupEvent[] = [];
  if (from.kind === 'perso') {
    const all = useCalendar.getState().events;
    const ev = all.find(e => e.id === eventId);
    if (!ev) throw new Error(t('Je ne retrouve plus cet événement.'));
    mine = pick(all, ev, series);
  } else {
    const all = await groupEvents(from.groupId);
    const ev = all.find(e => e.id === eventId);
    if (!ev) throw new Error(t('Je ne retrouve plus cet événement.'));
    theirs = pick(all, ev, series);
  }
  const count = mine.length || theirs.length;
  // A new series id in the target (the old one belongs to the original's calendar).
  const newSeries = count > 1 ? `${isSpan((mine[0] ?? theirs[0]).series ?? undefined) ? 'span-' : ''}${uid()}` : undefined;

  // 1. The copy, read back from where it is now.
  let moved: (CalendarEvent | GroupEvent)[];
  let takeBack: () => Promise<void>;
  if (to.kind === 'perso') {
    const list = theirs.map(e => asMine(e, newSeries));
    const before = new Set(useCalendar.getState().events.map(e => e.id));
    useCalendar.getState().addMany(list);
    moved = useCalendar.getState().events.filter(e => !before.has(e.id));
    const ids = new Set(moved.map(e => e.id));
    takeBack = async () => void useCalendar.setState(s => ({ events: s.events.filter(e => !ids.has(e.id)) }));
  } else {
    const g = useGroups.getState().groups.find(x => x.id === to.groupId);
    const source: NewEvent[] = mine.length ? mine.map(e => ({ ...e, series: newSeries })) : theirs.map(e => asMine(e, newSeries));
    const rows = toAgendaRows(source, { categories: g?.categories ?? [] });
    try {
      moved = rows.length > 1 ? await api.createEvents(to.groupId, rows) : [await api.createEvent(to.groupId, rows[0])];
    } catch (e) {
      throw new Error(api.groupError(e));
    }
    const ids = moved.map(e => e.id);
    takeBack = async () => void (await api.deleteEvents(ids).catch(() => undefined));
  }
  if (moved.length !== count) {
    await takeBack();
    throw new Error(t('Le déplacement n’a pas pu être fait en entier : rien n’a changé.'));
  }

  // 2. The original goes (not to the trash: it lives on in the other calendar).
  if (from.kind === 'perso') {
    const ids = new Set(mine.map(e => e.id));
    useCalendar.setState(s => ({ events: s.events.filter(e => !ids.has(e.id)) }));
  } else {
    try {
      await api.deleteEvents(theirs.map(e => e.id));
    } catch (e) {
      await takeBack();
      throw new Error(api.groupError(e));
    }
    void useGroups.getState().refresh(from.groupId, ['events']);
  }
  if (to.kind === 'group') void useGroups.getState().refresh(to.groupId, ['events']);
  return { moved: [...moved].sort((a, b) => a.date.localeCompare(b.date)), to };
}
