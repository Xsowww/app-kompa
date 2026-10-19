import { addDays } from 'date-fns';
import type { FocusSession } from '../../store/focusLog';
import type { CalendarEvent } from '../../store/calendar';
import { normalize } from '../../lib/utils';
import { toKey, weekStart } from '../../lib/dates';
import type { Usage } from '../../lib/usage';
import { locale, t } from '../../i18n';

export const NO_SUBJECT = t('Sans matière');

/** « Sans matière » for studies, « Sans sujet » for work and personal life. */
export const noSubjectLabel = (usage?: Usage) => (usage && usage !== 'etudes' ? t('Sans sujet') : NO_SUBJECT);

/** « Cours de maths » → « Maths », « Amphi d'histoire » → « Histoire ». */
export function subjectFromCourse(title: string) {
  const s = title.replace(/^\s*(cours|amphi|cm|td|tp)\b\s*(de la |de l'|de l’|de |d'|d’|du |des )?/i, '').trim() || title.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Subjects to suggest before a focus session: recent ones first, then courses around today. */
export function subjectSuggestions(sessions: FocusSession[], events: CalendarEvent[], limit = 6) {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const k = normalize(s);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).forEach(s => push(s.subject));
  const today = toKey(new Date());
  const from = toKey(addDays(new Date(), -14));
  const to = toKey(addDays(new Date(), 14));
  events
    .filter(e => e.category === 'cours' && e.date >= from && e.date <= to)
    .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(today)) - Math.abs(Date.parse(b.date) - Date.parse(today)))
    .forEach(e => push(subjectFromCourse(e.title)));
  return out.slice(0, limit);
}

/** Minutes per subject since `from` (YYYY-MM-DD, or null for all time), biggest first. */
export function minutesBySubject(sessions: FocusSession[], from: string | null, noSubject = NO_SUBJECT) {
  const map = new Map<string, { subject: string; minutes: number; sessions: number }>();
  for (const s of sessions) {
    if (from && toKey(new Date(s.startedAt)) < from) continue;
    const name = s.subject || noSubject;
    const k = normalize(name);
    const row = map.get(k) ?? { subject: name, minutes: 0, sessions: 0 };
    row.minutes += s.minutes;
    row.sessions++;
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes || a.subject.localeCompare(b.subject, locale()));
}

/** Focus minutes for each of the last `days` days (oldest first). */
export function dailyMinutes(sessions: FocusSession[], days = 30) {
  const keys = Array.from({ length: days }, (_, i) => toKey(addDays(new Date(), i - days + 1)));
  const map = new Map(keys.map(k => [k, 0]));
  for (const s of sessions) {
    const k = toKey(new Date(s.startedAt));
    if (map.has(k)) map.set(k, map.get(k)! + s.minutes);
  }
  return keys.map(day => ({ day, minutes: map.get(day)! }));
}

export function weekMinutes(sessions: FocusSession[]) {
  const ws = toKey(weekStart(new Date()));
  return sessions.filter(s => toKey(new Date(s.startedAt)) >= ws).reduce((a, s) => a + s.minutes, 0);
}

/** « 1 h 25 », « 40 min », « 12 h » */
export function formatMinutes(min: number) {
  if (min < 60) return t('{n} min', { n: min });
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? t('{h} h {m}', { h, m: String(m).padStart(2, '0') }) : t('{n} h', { n: h });
}
