// Affichage Pro, the island's hub (components/Island): its history of messages and what it shows of the day.
// Pure functions (tested in tests/islandHub.test.ts) and a small store, no React.

import { create } from 'zustand';
import type { CalendarEvent } from '../store/calendar';
import { firstOfSpans } from '../lib/repeat';

/** Something the island said: a toast, a reminder, Kompaly, a lasting message. */
export interface IslandEntry {
  id: string;
  kind: 'toast' | 'reminder' | 'kompaly' | 'notice';
  tone?: 'success' | 'error' | 'info';
  text: string;
  /** Its second line (a reminder's « 14:00 · Salle B12 »). */
  sub?: string;
  /** Where « Voir » goes (a reminder). */
  url?: string;
  at: number;
}

/** The latest first, each once (the same id again moves to the top with its new words), at most `max`. */
export function pushEntry(list: IslandEntry[], entry: IslandEntry, max = 30): IslandEntry[] {
  return [entry, ...list.filter(x => x.id !== entry.id)].slice(0, max);
}

/** The island's history, for this visit (Notifications in the hub). */
export const useIslandLog = create<{ entries: IslandEntry[]; seen: number; add: (e: IslandEntry) => void; clear: () => void; markSeen: () => void }>(set => ({
  entries: [],
  seen: 0,
  add: e => set(s => ({ entries: pushEntry(s.entries, e) })),
  clear: () => set({ entries: [], seen: Date.now() }),
  markSeen: () => set({ seen: Date.now() }),
}));

/**
 * What comes next, soonest first: today's events not over yet (with a time, then those of the whole day), then the
 * next days' (a stay over several days once). `now`: HH:mm.
 */
export function upcoming<T extends CalendarEvent>(events: T[], today: string, now: string, n = 3): T[] {
  const sort = (a: T, b: T) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? '');
  const todays = events.filter(e => e.date === today && !e.deletedAt).sort(sort);
  const later = todays.filter(e => e.start && (e.end ?? e.start) > now);
  const allDay = todays.filter(e => !e.start);
  const coming = firstOfSpans(events.filter(e => e.date > today && !e.deletedAt).sort(sort));
  return [...later, ...allDay, ...coming].slice(0, n);
}

/** Minutes from `now` (a Date) to an event of today with a time; null otherwise (another day, the whole day, started). */
export function minutesUntil(e: Pick<CalendarEvent, 'date' | 'start'>, today: string, now: Date): number | null {
  if (e.date !== today || !e.start) return null;
  const [h, m] = e.start.split(':').map(Number);
  const left = h * 60 + m - (now.getHours() * 60 + now.getMinutes());
  return left >= 0 ? left : null;
}

/** The ring of « Prochain »: full two hours before, empty when it starts (and full when it is further away). */
export const approach = (minutes: number | null, window = 120) => (minutes === null ? 1 : Math.max(0, Math.min(1, minutes / window)));

/** A share 0..1, safe with nothing to count. */
export const share = (done: number, total: number) => (total > 0 ? Math.max(0, Math.min(1, done / total)) : 0);

/**
 * The tasks the hub lists (five rows): today's and the late ones, then the last ticked today when there is room
 * (five open ones: no ticked one — « slice(-0) » gave them all). Everything ticked: the last ticked stay, to be
 * unticked, before what comes next (they went at once, the next days' tasks shown as if they were today's).
 */
export function hubTasks<T>(day: { late: T[]; due: T[]; done: T[]; next: T[] }): T[] {
  const open = [...day.late, ...day.due];
  const last = (n: number) => (n > 0 ? day.done.slice(-n) : []);
  if (open.length) return [...open.slice(0, 5), ...last(Math.min(2, 5 - open.length))];
  const done = last(2);
  return [...done, ...day.next.slice(0, 4 - done.length)];
}
