// Badges: small milestones computed from what the student already does in the app.
// Nothing is stored except the ids already announced (settings.badgesSeen).

import { useMemo } from 'react';
import { addDays, differenceInCalendarDays } from 'date-fns';
import {
  Flame,
  Mountain,
  Timer,
  Hourglass,
  Brain,
  Gem,
  Clock,
  NotebookPen,
  Library,
  FileUp,
  Archive,
  CalendarCheck,
  ListChecks,
  CheckCheck,
  GraduationCap,
  CalendarClock,
  Sunrise,
  Moon,
  Sprout,
  type LucideIcon,
} from 'lucide-react';
import { useCalendar, type CalendarEvent } from '../store/calendar';
import { useNotes, type Note } from '../store/notes';
import { useDrive, type DriveItem } from '../store/drive';
import { useTodos, type Todo } from '../store/todos';
import { useFocusLog, type FocusSession } from '../store/focusLog';
import { useSettings, getSettings } from '../store/settings';
import { useCopilot } from '../store/copilot';
import { useAuth } from '../store/auth';
import { useFocus } from '../store/focus';
import { getStorageUser } from './userStorage';
import { toKey, todayKey, fromKey, weekStart } from './dates';
import { normalize } from './utils';
import type { Usage } from './usage';
import { t } from '../i18n';

export type BadgeFamily = 'regularite' | 'focus' | 'organisation' | 'contenu';

export const FAMILIES: Record<BadgeFamily, { label: string; color: string }> = {
  regularite: { label: t('Régularité'), color: '#e8613c' },
  focus: { label: t('Concentration'), color: '#2f9e6b' },
  organisation: { label: t('Organisation'), color: '#d9483b' },
  contenu: { label: t('Contenu'), color: '#3b6fd8' },
};

export interface Badge {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  family: BadgeFamily;
  current: number;
  target: number;
  /** earned according to today's data (or already announced earlier) */
  earned: boolean;
  /** ISO date or YYYY-MM-DD when it can be derived from the data */
  earnedAt?: string;
}

export interface BadgeData {
  events: CalendarEvent[];
  notes: Note[];
  items: DriveItem[];
  todos: Todo[];
  sessions: FocusSession[];
  focusSessions: number; // settings counter (includes sessions older than the log)
  focusTotalMinutes: number;
  /** What the account is for: the « Coup d'avance » badge speaks of revisions or of time to prepare. */
  usage?: Usage;
}

/* ── Helpers ─────────────────────────────────────────────────── */

/** Days with at least one calendar item marked done (same definition as the profile « série »). */
function doneDays(events: CalendarEvent[]) {
  return [...new Set(events.filter(e => e.done).map(e => e.date))].sort();
}

/** Current streak, counted like on the profile page: today if something is done, otherwise up to yesterday. */
export function currentStreak(events: CalendarEvent[]) {
  const days = new Set(doneDays(events));
  let streak = 0;
  let d = days.has(todayKey()) ? new Date() : addDays(new Date(), -1);
  while (days.has(toKey(d))) {
    streak++;
    d = addDays(d, -1);
  }
  return streak;
}

/** Best streak ever, and the day each length was first reached. */
function streakHistory(events: CalendarEvent[]) {
  const days = doneDays(events).filter(d => d <= todayKey());
  const reached = new Map<number, string>();
  let best = 0;
  let run = 0;
  days.forEach((d, i) => {
    run = i > 0 && differenceInCalendarDays(fromKey(d), fromKey(days[i - 1])) === 1 ? run + 1 : 1;
    if (!reached.has(run)) reached.set(run, d);
    best = Math.max(best, run);
  });
  return { best, reached };
}

const nth = <T,>(sorted: T[], n: number) => (sorted.length >= n ? sorted[n - 1] : undefined);
const byDate = (a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt);
/** A session to get ready: « Révision… » (studies, or typed by hand), « Préparation · … » (Kompaly outside studies). */
// Per event object (a changed event is a new object): the badges are counted again after every change.
const revisionTitle = new WeakMap<CalendarEvent, boolean>();
const isRevision = (e: CalendarEvent) => {
  if (e.externalId?.startsWith('revision:')) return true;
  let r = revisionTitle.get(e);
  if (r === undefined) revisionTitle.set(e, (r = /^(?:revision|preparation)/.test(normalize(e.title))));
  return r;
};

/** A week (Monday→Sunday) in which every calendar item and every dated to-do is done, with at least 3 of them. */
function weekAllDone(events: CalendarEvent[], todos: Todo[]) {
  const weeks = new Map<string, { total: number; done: number }>();
  const add = (date: string, done: boolean) => {
    const k = toKey(weekStart(fromKey(date)));
    const w = weeks.get(k) ?? { total: 0, done: 0 };
    w.total++;
    if (done) w.done++;
    weeks.set(k, w);
  };
  events.forEach(e => add(e.date, e.done));
  todos.filter(t => t.due).forEach(t => add(t.due!, t.done));
  const thisWeek = toKey(weekStart(new Date()));
  const complete = [...weeks.entries()].filter(([k, w]) => k <= thisWeek && w.total >= 3 && w.done === w.total).map(([k]) => k).sort();
  const current = weeks.get(thisWeek) ?? { total: 0, done: 0 };
  const first = complete[0];
  return {
    earned: !!first,
    // a finished week is dated by its Sunday; the current one by today
    at: first ? (first === thisWeek ? todayKey() : toKey(addDays(fromKey(first), 6))) : undefined,
    current: current.done,
    target: Math.max(3, current.total),
  };
}

/** An exam (deadline, big day) with at least one « Révision… » or « Préparation… » session planned in the 30 days before it. */
function examPrepared(events: CalendarEvent[]) {
  const revisions = events.filter(isRevision);
  let at: string | undefined;
  for (const exam of events.filter(e => e.category === 'examen')) {
    const from = toKey(addDays(fromKey(exam.date), -30));
    const prep = revisions.filter(r => r.date < exam.date && r.date >= from).sort(byDate)[0];
    if (prep && (!at || prep.createdAt < at)) at = prep.createdAt;
  }
  return at;
}

/* ── Definitions ─────────────────────────────────────────────── */

const PREPARED: Record<Usage, string> = {
  etudes: t('Des révisions planifiées avant un examen.'),
  travail: t('Du temps bloqué pour préparer une échéance.'),
  perso: t('Du temps bloqué pour préparer un grand jour.'),
};

export function computeBadges(d: BadgeData, seen: string[] = []): Badge[] {
  const streak = streakHistory(d.events);
  const sessions = [...d.sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const sessionCount = Math.max(sessions.length, d.focusSessions);
  const loggedMinutes = sessions.reduce((s, x) => s + x.minutes, 0);
  const totalMinutes = Math.max(loggedMinutes, d.focusTotalMinutes);
  const minutesAt = (target: number) => {
    let acc = 0;
    for (const s of sessions) if ((acc += s.minutes) >= target) return s.startedAt;
    return undefined;
  };
  const notes = [...d.notes].sort(byDate);
  const files = d.items.filter(i => i.kind === 'file').sort(byDate);
  const doneEvents = d.events.filter(e => e.done).length;
  const doneTodos = d.todos.filter(t => t.done).sort((a, b) => (a.doneAt ?? '').localeCompare(b.doneAt ?? ''));
  const week = weekAllDone(d.events, d.todos);
  const prepared = examPrepared(d.events);
  const hourOf = (s: FocusSession) => new Date(s.startedAt).getHours();
  const early = sessions.find(s => hourOf(s) >= 4 && hourOf(s) < 8);
  const late = sessions.find(s => hourOf(s) >= 22 || hourOf(s) < 4);

  const streakBadge = (n: number, title: string, description: string, icon: LucideIcon) => ({
    id: `serie-${n}`, title, description, icon, family: 'regularite' as const,
    current: streak.best, target: n, earnedAt: streak.reached.get(n),
  });
  const focusBadge = (n: number, title: string, description: string, icon: LucideIcon) => ({
    id: `focus-${n}`, title, description, icon, family: 'focus' as const,
    current: sessionCount, target: n, earnedAt: nth(sessions, n)?.startedAt,
  });

  const list: Omit<Badge, 'earned'>[] = [
    streakBadge(3, t('Lancé'), t('Une série de 3 jours avec au moins un élément du calendrier fait.'), Sprout),
    streakBadge(7, t('Semaine pleine'), t('Une série de 7 jours d’affilée.'), Flame),
    streakBadge(30, t('Inarrêtable'), t('Une série de 30 jours. Rien que ça.'), Mountain),
    focusBadge(1, t('Première session'), t('Terminer une première session focus.'), Timer),
    focusBadge(10, t('Dans le rythme'), t('10 sessions focus terminées.'), Hourglass),
    focusBadge(50, t('Concentré'), t('50 sessions focus terminées.'), Brain),
    focusBadge(100, t('Moine copiste'), t('100 sessions focus terminées.'), Gem),
    {
      id: 'heures-10', title: t('10 heures'), description: t('10 heures de travail cumulées en sessions focus.'), icon: Clock, family: 'focus',
      current: Math.floor(totalMinutes / 60), target: 10, earnedAt: minutesAt(600),
    },
    {
      id: 'matinal', title: t('Lève-tôt'), description: t('Une session focus commencée avant 8 h.'), icon: Sunrise, family: 'focus',
      current: early ? 1 : 0, target: 1, earnedAt: early?.startedAt,
    },
    {
      id: 'nocturne', title: t('Oiseau de nuit'), description: t('Une session focus commencée après 22 h.'), icon: Moon, family: 'focus',
      current: late ? 1 : 0, target: 1, earnedAt: late?.startedAt,
    },
    {
      id: 'evenements-10', title: t('Bien tenu'), description: t('10 éléments du calendrier marqués comme faits.'), icon: CalendarCheck, family: 'organisation',
      current: doneEvents, target: 10,
    },
    {
      id: 'taches-10', title: t('Liste rayée'), description: t('10 tâches cochées dans ta liste.'), icon: ListChecks, family: 'organisation',
      current: doneTodos.length, target: 10, earnedAt: nth(doneTodos, 10)?.doneAt,
    },
    {
      id: 'semaine-complete', title: t('Semaine bouclée'), description: t('Tout ce qui était prévu dans une semaine est fait (au moins 3 éléments).'), icon: CheckCheck, family: 'organisation',
      current: week.current, target: week.target, earnedAt: week.at,
    },
    {
      id: 'examen-prepare', title: t('Coup d’avance'), description: PREPARED[d.usage ?? 'etudes'] ?? PREPARED.etudes, icon: (d.usage ?? 'etudes') === 'etudes' ? GraduationCap : CalendarClock, family: 'organisation',
      current: prepared ? 1 : 0, target: 1, earnedAt: prepared,
    },
    {
      id: 'note-1', title: t('Première note'), description: t('Écrire une première note.'), icon: NotebookPen, family: 'contenu',
      current: notes.length, target: 1, earnedAt: nth(notes, 1)?.createdAt,
    },
    {
      id: 'notes-25', title: t('Bibliothèque'), description: t('25 notes rédigées.'), icon: Library, family: 'contenu',
      current: notes.length, target: 25, earnedAt: nth(notes, 25)?.createdAt,
    },
    {
      id: 'fichier-1', title: t('Premier fichier'), description: t('Importer un premier fichier dans le Drive.'), icon: FileUp, family: 'contenu',
      current: files.length, target: 1, earnedAt: nth(files, 1)?.createdAt,
    },
    {
      id: 'fichiers-50', title: t('Archiviste'), description: t('50 fichiers dans ton Drive.'), icon: Archive, family: 'contenu',
      current: files.length, target: 50, earnedAt: nth(files, 50)?.createdAt,
    },
  ];

  const seenSet = new Set(seen);
  return list.map(b => {
    const earnedNow = b.id === 'semaine-complete' ? week.earned : b.current >= b.target;
    return {
      ...b,
      earned: earnedNow || seenSet.has(b.id),
      earnedAt: earnedNow || seenSet.has(b.id) ? b.earnedAt : undefined,
      current: Math.min(b.current, b.target),
    };
  });
}

/* ── React hook ──────────────────────────────────────────────── */

export function useBadges() {
  const events = useCalendar(s => s.events);
  const notes = useNotes(s => s.notes);
  const items = useDrive(s => s.items);
  const todos = useTodos(s => s.todos);
  const sessions = useFocusLog(s => s.sessions);
  const focusSessions = useSettings(s => s.focusSessions);
  const focusTotalMinutes = useSettings(s => s.focusTotalMinutes);
  const seen = useSettings(s => s.badgesSeen);
  const usage = useSettings(s => s.usage);
  return useMemo(
    () => computeBadges({ events, notes, items, todos, sessions, focusSessions, focusTotalMinutes, usage }, seen),
    [events, notes, items, todos, sessions, focusSessions, focusTotalMinutes, usage, seen],
  );
}

/* ── Announcements ───────────────────────────────────────────── */

/** Marker stored in badgesSeen once the account has been looked at, so history is never announced. */
const INIT = '_init';
let stopWatcher: (() => void) | null = null;

function snapshot(): BadgeData {
  const s = getSettings();
  return {
    events: useCalendar.getState().events,
    notes: useNotes.getState().notes,
    items: useDrive.getState().items,
    todos: useTodos.getState().todos,
    sessions: useFocusLog.getState().sessions,
    focusSessions: s.focusSessions,
    focusTotalMinutes: s.focusTotalMinutes,
    usage: s.usage,
  };
}

function evaluate() {
  const user = useAuth.getState().user;
  if (!user || getStorageUser() !== user.id || !useSettings.persist.hasHydrated()) return;
  const settings = getSettings();
  const seen = settings.badgesSeen;
  const earned = computeBadges(snapshot()).filter(b => b.earned);
  if (!seen.includes(INIT)) {
    // First run on this account: whatever is already earned is history, mark it silently.
    settings.set({ badgesSeen: [INIT, ...new Set([...seen, ...earned.map(b => b.id)])] });
    return;
  }
  const fresh = earned.filter(b => !seen.includes(b.id));
  if (!fresh.length) return;
  // Announcements are opt-in: otherwise the badges are just marked as seen, silently.
  if (!settings.badgeAnnouncements) return void settings.set({ badgesSeen: [...seen, ...fresh.map(b => b.id)] });
  // Never interrupt a focus session: celebrate once it is over.
  if (useFocus.getState().phase === 'focus') return void setTimeout(evaluate, 30_000);
  // Let Kompaly finish what he is saying (e.g. « session terminée ») before celebrating.
  if (useCopilot.getState().bubble) return void setTimeout(evaluate, 5000);
  settings.set({ badgesSeen: [...seen, ...fresh.map(b => b.id)] });
  const text =
    fresh.length === 1
      ? t('Nouveau badge : « {title} ». {description}', { title: fresh[0].title, description: fresh[0].description })
      : t('{n} nouveaux badges : {list}.', { n: fresh.length, list: fresh.map(b => t('« {title} »', { title: b.title })).join(', ') });
  useCopilot.getState().say({ text, mood: 'happy', links: [{ label: t('Voir mes badges'), to: '/profil#badges' }] });
}

/** Watches the data stores and announces newly earned badges (debounced). Safe to call several times. */
export function startBadgeWatcher() {
  if (stopWatcher) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(evaluate, 2000);
  };
  const unsubs = [
    useCalendar.subscribe(check),
    useNotes.subscribe(check),
    useDrive.subscribe(check),
    useTodos.subscribe(check),
    useFocusLog.subscribe(check),
    useSettings.subscribe((s, p) => {
      if (s.badgesSeen !== p.badgesSeen || s.focusSessions !== p.focusSessions) check();
    }),
    useAuth.subscribe(check),
  ];
  check();
  stopWatcher = () => {
    clearTimeout(timer);
    unsubs.forEach(u => u());
    stopWatcher = null;
  };
  return stopWatcher;
}
