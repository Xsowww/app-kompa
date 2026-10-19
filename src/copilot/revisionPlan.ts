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
