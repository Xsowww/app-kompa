// Reminders of events and tasks: when they fire and what they say. Pure functions (tested in tests/reminders.test.ts);
// the scheduling lives in lib/reminderScheduler.ts and the sending in server/push.mjs.
//
// A reminder is a number of minutes before the item's moment: its start time, or 9:00 that day for an
// event without a time or a task without a time (« la veille, 18 h » = 15 h before 9:00).

import { t } from '../i18n';

export interface ReminderOption {
  minutes: number;
  label: string;
}

/** For an item with a time. */
export const TIMED_OPTIONS: ReminderOption[] = [
  { minutes: 0, label: t('À l’heure') },
  { minutes: 5, label: t('5 min avant') },
  { minutes: 15, label: t('15 min avant') },
  { minutes: 30, label: t('30 min avant') },
  { minutes: 60, label: t('1 h avant') },
  { minutes: 120, label: t('2 h avant') },
  { minutes: 1440, label: t('1 jour avant') },
  { minutes: 2880, label: t('2 jours avant') },
  { minutes: 10080, label: t('1 semaine avant') },
];

/** For an item without a time (all day): relative to 9:00 that day. */
export const DAY_OPTIONS: ReminderOption[] = [
  { minutes: 0, label: t('Le jour même à 09:00') },
  { minutes: 900, label: t('La veille à 18:00') },
  { minutes: 2880, label: t('2 jours avant à 09:00') },
  { minutes: 10080, label: t('1 semaine avant à 09:00') },
];

export const DAY_ANCHOR = '09:00';

const pad = (n: number) => String(n).padStart(2, '0');
/** « 09:00 », « 14:30 »: as in the lists. */
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** 4 weeks: the furthest a reminder can be before its item. */
export const MAX_MINUTES = 10080 * 4;

export const reminderOptions = (timed: boolean) => (timed ? TIMED_OPTIONS : DAY_OPTIONS);

/** An event's reminders: its own, else the usual ones (Profil › Notifications) when it has a time and was made here. */
export const eventReminders = (e: { reminders?: number[]; start?: string; externalId?: string }, defaults: number[]) =>
  e.reminders ?? (e.start && !e.externalId ? defaults : []);

/** « 45 min avant », « 3 h 30 avant », « 2 j 4 h avant ». */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return t('À l’heure');
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts = [d && t('{n} j', { n: d }), h && t('{n} h', { n: h }), m && (h ? String(m).padStart(2, '0') : t('{n} min', { n: m }))].filter(Boolean);
  return t('{time} avant', { time: parts.join(' ') });
}

/**
 * The moment a reminder fires, counted on the clock on the wall: « la veille à 18h » stays at 18h on the night
 * the clocks change (a day before is always 1440 minutes, never 23 or 25 hours).
 */
export function reminderMoment(date: string, time: string | undefined, minutes: number): Date {
  const a = anchorOf(date, time);
  return new Date(a.getFullYear(), a.getMonth(), a.getDate(), a.getHours(), a.getMinutes() - minutes);
}

const wallMinutes = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 60_000;
/** The reminder that fires on `day` at `at` (wall-clock minutes before the item, like reminderMoment). */
export const minutesBefore = (date: string, time: string | undefined, day: string, at: string) => wallMinutes(anchorOf(date, time)) - wallMinutes(anchorOf(day, at));

/**
 * The label of a reminder: an option's, else, when the item's date is known, the moment itself
 * (« La veille à 20h30 », « Le jour même à 7h », « Lun. 13 oct. à 18h »), else the time before it.
 */
export function reminderLabel(minutes: number, timed: boolean, date?: string, time?: string): string {
  const o = reminderOptions(timed).find(x => x.minutes === minutes);
  if (o) return o.label;
  if (!date) return offsetLabel(minutes);
  const at = reminderMoment(date, time, minutes);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(anchorOf(date, time)) - day(at)) / 86_400_000);
  const when = days === 0 ? t('Le jour même') : days === 1 ? t('La veille') : t('{weekday} {day} {month}', { weekday: WEEKDAYS[at.getDay()], day: at.getDate(), month: MONTHS[at.getMonth()] });
  return t('{when} à {time}', { when, time: hhmm(at) });
}
const WEEKDAYS = [t('Dim.'), t('Lun.'), t('Mar.'), t('Mer.'), t('Jeu.'), t('Ven.'), t('Sam.')];
const MONTHS = [t('janv.'), t('févr.'), t('mars'), t('avr.'), t('mai'), t('juin'), t('juil.'), t('août'), t('sept.'), t('oct.'), t('nov.'), t('déc.')];

/** Keeps valid, distinct values, sorted (biggest first). [] = « no reminder » chosen; undefined = never chosen. */
export function cleanReminders(list: unknown): number[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return [...new Set(list.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= MAX_MINUTES))].sort((a, b) => b - a).slice(0, 10);
}

/** The moment of an item, in local time: its date at its time, or 9:00. */
export function anchorOf(date: string, time?: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = (time && /^\d{2}:\d{2}$/.test(time) ? time : DAY_ANCHOR).split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0);
}

export interface ReminderSource {
  kind: 'event' | 'task';
  id: string;
  title: string;
  date?: string;
  time?: string;
  /** End time of an event (HH:mm), shown in the notification. */
  end?: string;
  done?: boolean;
  reminders?: number[];
}

export interface DueReminder {
  /** Stable for one item, one reminder and one moment: what is already sent or shown is never repeated. */
  key: string;
  fireAt: Date;
  title: string;
  body: string;
  url: string;
}


const WEEKDAY_NAMES = [t('dimanche'), t('lundi'), t('mardi'), t('mercredi'), t('jeudi'), t('vendredi'), t('samedi')];

/**
 * What a notification says under its title, as seen when it fires — line 1: when (« Dans 15 min · 14h – 15h30 »,
 * « Demain · 9h30 », « À faire aujourd’hui »); line 2: where it comes from (« Agenda » ; the phone already names Kompaly).
 */
export function reminderBody(src: ReminderSource, fireAt: Date): string {
  const at = anchorOf(src.date!, src.time);
  const minutes = Math.round((at.getTime() - fireAt.getTime()) / 60_000);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(fireAt)) / 86_400_000);
  const task = src.kind === 'task';
  const dayName =
    days <= 0 ? t('aujourd’hui') : days === 1 ? t('demain') : t('{weekday} {day} {month}', { weekday: WEEKDAY_NAMES[at.getDay()], day: at.getDate(), month: MONTHS[at.getMonth()] });
  let when: string;
  if (src.time) {
    const end = src.end && /^\d{2}:\d{2}$/.test(src.end) && src.end > src.time ? ` – ${hhmm(anchorOf(src.date!, src.end))}` : '';
    const hours = `${hhmm(at)}${end}`;
    const rel = minutes <= 0 ? t('maintenant') : minutes < 60 ? t('dans {n} min', { n: minutes }) : dayName;
    when = `${task ? t('À faire {when}', { when: rel }) : rel} · ${hours}`;
  } else {
    when = task ? t('À faire {when}', { when: dayName }) : dayName;
  }
  const line1 = when.charAt(0).toUpperCase() + when.slice(1);
  return `${line1}\n${task ? t('Tâches') : t('Agenda')}`;
}

/** The reminders still to come, from now up to `horizonDays`, soonest first. */
export function upcomingReminders(items: ReminderSource[], now = new Date(), horizonDays = 35): DueReminder[] {
  const until = now.getTime() + horizonDays * 86_400_000;
  const out: DueReminder[] = [];
  for (const src of items) {
    if (src.done || !src.date || !src.reminders?.length) continue;
    for (const m of src.reminders) {
      const fireAt = reminderMoment(src.date, src.time, m);
      if (fireAt.getTime() <= now.getTime() - 60_000 || fireAt.getTime() > until) continue;
      out.push({
        key: `${src.kind}:${src.id}:${m}:${src.date}T${src.time ?? DAY_ANCHOR}`,
        fireAt,
        title: src.title.trim().slice(0, 200) || (src.kind === 'task' ? t('Tâche') : t('Événement')),
        body: reminderBody(src, fireAt).slice(0, 300),
        url: src.kind === 'task' ? '/taches' : `/calendrier?jour=${src.date}`,
      });
    }
  }
  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}

/**
 * An item moved (another day, another time, or no time any more): « 15 min avant » stays 15 min before, but a
 * reminder at a set moment (« La veille à 9h », a custom one, every reminder of an all-day item) keeps its hour
 * and moves with the day. Reminders that can't follow are dropped; none left of a non-empty list: `fallback`.
 */
export function followMoments(list: number[], from: { date: string; time?: string }, to: { date: string; time?: string }, fallback: number[]): number[] {
  const relative = new Set(from.time ? TIMED_OPTIONS.map(o => o.minutes) : []);
  const shift = Math.round((anchorOf(to.date).getTime() - anchorOf(from.date).getTime()) / 86_400_000);
  const moved = list.flatMap(m => {
    if (relative.has(m)) return to.time ? [m] : [];
    const at = reminderMoment(from.date, from.time, m);
    const day = new Date(at.getFullYear(), at.getMonth(), at.getDate() + shift);
    const key = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    const next = minutesBefore(to.date, to.time, key, `${pad(at.getHours())}:${pad(at.getMinutes())}`);
    return next >= 0 && next <= MAX_MINUTES ? [next] : [];
  });
  const kept = cleanReminders(moved) ?? [];
  return kept.length || !list.length ? kept : fallback;
}

