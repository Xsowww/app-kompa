// Which exam (deadline, big day) a request is about, and which sessions and note Kompaly made for it.
// Pure functions over the events and notes, used by actions.ts (tested in tests/revisionPlan.test.ts).

import { normalize } from '../lib/utils';
import { fmt, fromKey, parseQuickAdd } from '../lib/dates';
import { sortEvents, type CalendarEvent } from '../store/calendar';
import type { Note } from '../store/notes';
import { t } from '../i18n';

/** Prefixes of the titles Kompaly gives, in the current language (« Révision · Contrôle de maths »). */
export const sessionPrefix = (studying: boolean) => (studying ? t('Révision · {title}', { title: '' }) : t('Préparation · {title}', { title: '' }));
export const notePrefix = (studying: boolean) => (studying ? t('Fiche · {title}', { title: '' }) : t('À préparer · {title}', { title: '' }));

// Titles are read back: the French ones (made before the translation, or in French) and the current language's.
const SESSION_PREFIXES = [...new Set(['Révision · ', 'Préparation · ', sessionPrefix(true), sessionPrefix(false)])];
const NOTE_PREFIXES = [...new Set(['Fiche · ', 'À préparer · ', notePrefix(true), notePrefix(false)])];

/** A session Kompaly planned, by its title (« Révision · … », « Préparation · … », in French or in the current language). */
export const isSessionTitle = (title: string) => SESSION_PREFIXES.some(p => title.startsWith(p));

/** Mark of the sessions planned for an exam, kept in `externalId` (like the meetings added from a group). */
export const planTag = (examId: string) => `revision:${examId}`;

/** Exams with the same title as this one, earliest first (« Contrôle de maths » twice). */
const twinsOf = (exam: CalendarEvent, events: CalendarEvent[]) => events.filter(e => e.category === 'examen' && e.title === exam.title).sort(sortEvents);

/** A session of an older plan, linked to its exam by the title only. */
const isOldSession = (e: CalendarEvent, examTitle: string) => !e.externalId && SESSION_PREFIXES.some(p => e.title === p + examTitle);

/** Older plans: a session goes with the first same-titled exam on or after its day. */
const oldOwner = (session: CalendarEvent, twins: CalendarEvent[]) => twins.find(x => x.date >= session.date) ?? twins.at(-1);

/** The sessions planned for this exam, earliest first. */
export function sessionsFor(exam: CalendarEvent, events: CalendarEvent[]): CalendarEvent[] {
  const twins = twinsOf(exam, events);
  return events.filter(e => e.externalId === planTag(exam.id) || (isOldSession(e, exam.title) && oldOwner(e, twins)?.id === exam.id)).sort(sortEvents);
}

/** The revision sheet (or « À préparer » note) of this exam: the one linked to it, or an older one named after it. */
export function noteFor(exam: CalendarEvent, notes: Note[], events: CalendarEvent[]): Note | undefined {
  const linked = notes.find(n => NOTE_PREFIXES.some(p => n.title.startsWith(p)) && n.links?.some(l => l.kind === 'event' && l.id === exam.id));
  if (linked) return linked;
  const twins = twinsOf(exam, events);
  const old = notes.find(n => NOTE_PREFIXES.some(p => n.title === p + exam.title) && !n.links?.some(l => l.kind === 'event' && twins.some(x => x.id === l.id)));
  if (!old) return undefined;
  // Two exams with that title: the old note goes with the old sessions' exam, or else the first one.
  const first = events.filter(e => isOldSession(e, exam.title)).sort(sortEvents)[0];
  const owner = first ? oldOwner(first, twins) : twins[0];
  return !owner || owner.id === exam.id ? old : undefined;
}

// ── Days without a session ──────────────────────────────────────────────────

/** Easter Sunday of a year (Meeus/Jones/Butcher), as [month 1-12, day]. */
function easter(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
}

/** A public holiday in France (YYYY-MM-DD): the fixed ones, Easter Monday, Ascension, Whit Monday. */
export function isPublicHoliday(key: string): boolean {
  const [y, m, d] = key.split('-').map(Number);
  if (['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'].includes(key.slice(5))) return true;
  const [em, ed] = easter(y);
  const day = (n: number) => {
    const x = new Date(y, em - 1, ed + n);
    return x.getMonth() + 1 === m && x.getDate() === d;
  };
  return day(1) || day(39) || day(50);
}

/**
 * No session Kompaly chooses on this day: a public holiday, or the evening of the 24th or the 31st of December (test n°3:
 * « il met une séance le soir du réveillon »).
 */
export const restDay = (key: string) => isPublicHoliday(key) || /-12-(?:24|31)$/.test(key);

const dayMs = 86_400_000;
const shift = (key: string, days: number) => {
  const [y, m, d] = key.split('-').map(Number);
  const x = new Date(y, m - 1, d + days);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/**
 * The days of the sessions before an exam (YYYY-MM-DD, earliest first). The rule, kept simple:
 * - how many: `base` (3) for an exam within a week; with more time, about two a week (33 days → 9), never more
 *   than 10. A number asked for (`asked`) is kept as it is (1 to 10);
 * - which days: within a week, the eve then every other day back (J-1, J-3, J-5, then the days between); with more
 *   time, spread evenly from tomorrow to the eve of the exam (3 sessions in the last 5 days of a month was too thin);
 * - never in the past, never on a rest day (the nearest free day is taken instead), nothing for a past exam;
 * - no day left before the exam: today.
 */
export function revisionDays(examDate: string, today: string, base = 3, asked?: number): string[] {
  const [ey, em, ed] = examDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const until = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(ty, tm - 1, td)) / dayMs);
  if (until < 0) return [];
  const clamp = (v: number, max: number) => Math.min(max, Math.max(1, Math.round(v)));
  const n = asked ? clamp(asked, 10) : until <= 7 ? clamp(base, 6) : Math.min(10, Math.max(clamp(base, 6), Math.round((until * 2) / 7)));
  const free = (d: number) => {
    const key = shift(examDate, -d);
    return (d < until || (d === until && until === 0)) && key >= today && !restDay(key);
  };
  let offsets: number[];
  if (until <= 7 || n === 1) {
    offsets = [1, 3, 5, 2, 4, 6, 7, 9, 11, 13, 8, 10, 12, 14].filter(free);
  } else {
    offsets = [];
    for (let i = 0; i < n; i++) {
      const d = 1 + Math.floor((i * (until - 2)) / (n - 1));
      const near = [d, d + 1, d - 1, d + 2, d - 2].find(x => x >= 1 && free(x) && !offsets.includes(x));
      if (near) offsets.push(near);
    }
  }
  const days = offsets.slice(0, n).map(d => shift(examDate, -d));
  if (!days.length && !restDay(today)) days.push(today);
  return [...new Set(days)].sort();
}

/** Another exam has the same title (« Contrôle de maths » twice): the day tells them apart. */
export const hasTwin = (exam: CalendarEvent, events: CalendarEvent[]) => twinsOf(exam, events).length > 1;

/** Title of a new note: the day is added when another exam has the same title. */
export function noteTitle(prefix: string, exam: CalendarEvent, events: CalendarEvent[]) {
  return `${prefix}${exam.title}${twinsOf(exam, events).length > 1 ? ` (${fmt(fromKey(exam.date), 'd MMMM')})` : ''}`;
}

// ── The exam a request names ────────────────────────────────────────────────

/** Words of the request itself, after which the subject starts (« bloque du temps pour préparer… »). */
const REQUEST = /\b(?:revisions?|reviser|revise|preparer|prepare|preparation|preparations|temps|creneaux?)\b/g;
const LINK = /^\s*(?:(?:pour|de|du|des|le|la|les|mon|ma|mes|un|une|au|aux|a|sur)(?=\s|$)|[ld]['’])/;

/**
 * Where the subject starts in a normalized request: « planifie mes révisions pour le contrôle de maths »
 * → at « contrôle », « bloque du temps pour préparer lancement » → at « lancement ». Length of `q` if none.
 */
export function subjectStart(q: string): number {
  let at = -1;
  for (const m of q.matchAll(REQUEST)) at = m.index + m[0].length;
  if (at < 0) return q.length;
  for (let m = LINK.exec(q.slice(at)); m; m = LINK.exec(q.slice(at))) at += m[0].length;
  return at + (q.slice(at).match(/^\s*/)?.[0].length ?? 0);
}

/** Words that say what kind of event it is, not which one. */
const GENERIC = /^(?:examens?|exams?|partiels?|controles?|echeances?|deadlines?|evenements?)$/;
const STOP = /^(?:pour|de|du|des|d|l|le|la|les|un|une|mon|ma|mes|ton|ta|tes|son|sa|ses|au|aux|a|sur|en|et)$/;

/**
 * The upcoming exam named by `subject` (id, words of its title, a day: « contrôle de maths du 10 novembre »),
 * or the next one when the subject names none. Undefined when nothing matches.
 */
/** `withImportant`: outside studies, an event marked important is prepared for like a deadline. */
export function pickExam(subject: string, events: CalendarEvent[], today: string, withImportant = false): CalendarEvent | undefined {
  const exams = events.filter(e => e.category === 'examen' || (withImportant && e.important));
  const byId = exams.find(e => e.id === subject);
  if (byId) return byId;
  const upcoming = exams.filter(e => e.date >= today).sort(sortEvents);
  const parsed = parseQuickAdd(subject);
  const date = parsed.date;
  const words = normalize(date ? parsed.title : subject).split(/[^a-z0-9]+/).filter(w => w && !STOP.test(w));
  const needed = words.filter(w => !GENERIC.test(w));
  const kinds = words.filter(w => GENERIC.test(w)).map(w => w.replace(/s$/, ''));
  let hits = upcoming.filter(e => needed.every(w => normalize(e.title).includes(w)));
  // A day was given (« … du 12 novembre », « … d'aujourd'hui »): only that day, even when the title matches another one.
  if (date) hits = hits.filter(e => e.date === date);
  // « le partiel » with no other word: the next partiel if there is one, else the next exam.
  return hits.find(e => kinds.some(k => normalize(e.title).includes(k))) ?? hits[0];
}

/**
 * The exam a request describes when the calendar has none like it: a name and a day to come (« partiel d'anatomie du
 * 15 décembre » → « Partiel d'anatomie », 2026-12-15). Null without a day or without a name: nothing is made up.
 */
export function examSaid(subject: string, now = new Date()): { title: string; date: string; start?: string; end?: string } | null {
  const p = parseQuickAdd(subject, now);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (!p.date || p.date < today || p.impossible || p.every || p.endDate) return null;
  const title = p.title.replace(/\s+(?:du|le|pour le|de|d['’])\s*$/i, '').trim();
  if (!normalize(title).split(/[^a-z0-9]+/).some(w => w.length > 1 && !STOP.test(w))) return null;
  return { title: title.charAt(0).toUpperCase() + title.slice(1), date: p.date, ...(p.start && { start: p.start }), ...(p.end && { end: p.end }) };
}
