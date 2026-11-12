// Reminders of events and tasks: when they fire and what they say. Pure functions (tested in tests/reminders.test.ts);
// the scheduling lives in lib/reminderScheduler.ts and the sending in server/push.mjs.
//
// A reminder is a number of minutes before the item's moment: its start time, or 9:00 that day for an
// event without a time or a task without a time (« la veille, 18 h » = 15 h before 9:00).

import { t, tn } from '../i18n';

/** « Plus tard » on a reminder: reminded again this many minutes later (lib/reminderActions). */
export const SNOOZE_MINUTES = 10;

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

/**
 * A big day (exam, important) is also reminded a week before and the day before at 18:00 (and that day at 9:00 without a time).
 * With `now` (an event being made): not the ones already past (« 1 semaine avant » for an exam tomorrow), they
 * would never ring. Without it (the scheduler), all of them: one just passed may still be due.
 */
export function earlyReminders(date: string, time?: string, now?: Date): number[] {
  const [y, m, d] = date.split('-').map(Number);
  const eve = new Date(y, m - 1, d - 1);
  const all = time ? [10080, minutesBefore(date, time, `${eve.getFullYear()}-${pad(eve.getMonth() + 1)}-${pad(eve.getDate())}`, '18:00')] : [10080, 900, 0];
  return now ? all.filter(min => reminderMoment(date, time, min) > now) : all;
}

/**
 * An event's reminders: its own, else, when it was made here, the usual ones (Réglages › Notifications) if it has a time,
 * plus the early ones of a big day (category « examen » or marked important: isBigEvent in store/calendar).
 */
export function eventReminders(e: { reminders?: number[]; date?: string; start?: string; externalId?: string; category?: string; important?: boolean }, defaults: number[], now?: Date): number[] {
  if (e.reminders) return e.reminders;
  if (e.externalId) return [];
  // A usual reminder whose moment has already passed (« 1 jour avant » on an event made for today) is left out.
  const base = e.start ? (now && e.date ? defaults.filter(min => reminderMoment(e.date!, e.start, min) > now) : defaults) : [];
  return e.date && (e.category === 'examen' || e.important) ? (cleanReminders([...base, ...earlyReminders(e.date, e.start, now)]) ?? base) : base;
}

/**
 * The one answer to « which reminders will ring for this event »: what the event sheet, the lists, Kompaly and the
 * scheduler (notifications) all show. A shared calendar's: the ones chosen on it (no usual reminder of mine there).
 * The usual ones of an event never given any are those of Réglages › Notifications — the same ones the scheduler sends.
 */
export function shownReminders(e: { reminders?: number[]; date?: string; start?: string; externalId?: string; category?: string; important?: boolean }, defaults: number[], shared = false): number[] {
  return shared ? (e.reminders ?? []) : eventReminders(e, defaults);
}

/** The reminders in words, in the order of the event's form (« 15 min avant, 1 h avant, La veille à 18:00 »): the same text everywhere. */
export function remindersText(list: number[], date: string, time?: string): string {
  return [...list].sort((a, b) => a - b).map(m => reminderLabel(m, !!time, date, time)).join(', ');
}

/**
 * The reminders in a few words, for a list's small chip: the one reminder (« 1 h avant », « La veille à 18:00 »), else
 * how many (« 2 rappels »). The whole list is remindersText (the chip's tooltip, the event's form).
 */
export function remindersShort(list: number[], date: string, time?: string): string {
  if (list.length === 1) return reminderLabel(list[0], !!time, date, time);
  return tn(list.length, '{n} rappel', '{n} rappels');
}

/**
 * A new dated task's reminders: those chosen in Réglages › Notifications (the day before at 18:00 and/or that day at 9:00),
 * or an hour before a task with a time (none when « Aucun » is chosen); those already past are left out (a task for
 * today, made in the afternoon, gets none rather than one in the past).
 */
export function taskReminders(due: string, time?: string, now = new Date(), chosen: number[] = [900, 0]): number[] {
  const all = time ? (chosen.length ? [60] : []) : chosen;
  return all.filter(min => reminderMoment(due, time, min) > now);
}

/** « Rappel par défaut des tâches » (Réglages › Notifications): its four choices. */
export const TASK_DEFAULTS: { value: string; minutes: number[]; label: string }[] = [
  { value: 'aucun', minutes: [], label: t('Aucun') },
  { value: 'veille', minutes: [900], label: t('La veille à 18:00') },
  { value: 'jour', minutes: [0], label: t('Le jour même à 09:00') },
  { value: 'les-deux', minutes: [900, 0], label: t('La veille à 18:00 et le jour même à 09:00') },
];

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
  /** Put off by « Plus tard »: when to remind again (ISO). */
  snoozes?: string[];
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

/** Where a reminder leads: the task itself (lit up in Tâches), the event on its day. */
export const reminderUrl = (src: Pick<ReminderSource, 'kind' | 'id' | 'date'>) =>
  src.kind === 'task' ? `/taches?tache=${encodeURIComponent(src.id)}` : `/calendrier?jour=${src.date}&evt=${encodeURIComponent(src.id)}`;

/**
 * The reminders still to come, from now up to `horizonDays`, soonest first, with those put off by « Plus tard ».
 * `digestDays`: the days whose morning summary (taskDigests, 8:00) is sent too — an undated-hour task's reminder of
 * that morning would say it a second time (« la veille à 18 h », then 8:00, then 9:00): left out.
 */
export function upcomingReminders(items: ReminderSource[], now = new Date(), horizonDays = 35, digestDays?: ReadonlySet<string>): DueReminder[] {
  const until = now.getTime() + horizonDays * 86_400_000;
  const out: DueReminder[] = [];
  const due = (fireAt: Date) => fireAt.getTime() > now.getTime() - 60_000 && fireAt.getTime() <= until;
  for (const src of items) {
    if (src.done || !src.date) continue;
    const make = (key: string, fireAt: Date): DueReminder => ({
      key,
      fireAt,
      title: src.title.trim().slice(0, 200) || (src.kind === 'task' ? t('Tâche') : t('Événement')),
      body: reminderBody(src, fireAt).slice(0, 300),
      url: reminderUrl(src),
    });
    for (const m of src.reminders ?? []) {
      const fireAt = reminderMoment(src.date, src.time, m);
      if (!due(fireAt)) continue;
      if (src.kind === 'task' && !src.time && digestDays?.has(src.date) && dayKey(fireAt) === src.date && fireAt.getHours() >= DIGEST_HOUR) continue;
      out.push(make(`${src.kind}:${src.id}:${m}:${src.date}T${src.time ?? DAY_ANCHOR}`, fireAt));
    }
    for (const at of src.snoozes ?? []) {
      const fireAt = new Date(at);
      if (!Number.isNaN(fireAt.getTime()) && due(fireAt)) out.push(make(`${src.kind}:${src.id}:plus-tard:${fireAt.getTime()}`, fireAt));
    }
  }
  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}

const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The id the morning summary of the tasks has in its key (« task:matin:2026-11-03 »: sent by the server as a task's reminder). */
const DIGEST_ID = 'matin';
const DIGEST_HOUR = 8;

/** The task or event a reminder is about (from its key); null for the morning summary and the news of the others. */
export function reminderItem(key: string): { kind: 'task' | 'event'; id: string } | null {
  const m = /^(task|event):([^:]+):/.exec(key);
  return m && m[2] !== DIGEST_ID ? { kind: m[1] as 'task' | 'event', id: m[2] } : null;
}

/** The tasks and events a notification stands for; none when one of its keys isn't such a reminder. */
export function reminderItems(keys: string[]): { kind: 'task' | 'event'; id: string }[] {
  const items = keys.map(reminderItem);
  if (!items.length || items.some(x => !x)) return [];
  return [...new Map(items.map(x => [`${x!.kind}:${x!.id}`, x!])).values()];
}

/**
 * The buttons under a notification (two at most: Chrome shows no more): « Plus tard » (10 min) and « Fait » on a
 * reminder of a task or an event (« Voir » instead of « Fait » for several), else « Voir » and « OK ».
 * Same rule in public/sw.js (notificationOptions), with the words this page gives it.
 */
export function notificationButtons(keys: string[]): { action: string; title: string }[] {
  const items = reminderItems(keys);
  if (!items.length) return [{ action: 'voir', title: t('Voir') }, { action: 'ok', title: t('OK') }];
  return [{ action: 'plus-tard', title: t('Plus tard') }, items.length === 1 ? { action: 'fait', title: t('Fait||coché') } : { action: 'voir', title: t('Voir') }];
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


/**
 * The morning summary of the tasks (one notification instead of one per task): at 8:00 on each of the next days,
 * how many tasks are due that day or late by then, and the first ones. Nothing on a day with none.
 */
export function taskDigests(todos: { id: string; title: string; done: boolean; due?: string }[], now = new Date(), days = 2): DueReminder[] {
  const out: DueReminder[] = [];
  for (let i = 0; i <= days; i++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, DIGEST_HOUR, 0);
    if (at <= now) continue;
    const day = dayKey(at);
    const due = todos.filter(x => !x.done && x.due && x.due <= day);
    if (!due.length) continue;
    const names = due.slice(0, 3).map(x => x.title).join(', ') + (due.length > 3 ? '…' : '');
    // A task's key (« task:… »): the server sends it too, site closed (it takes only the reminders of events and tasks).
    out.push({ key: `task:${DIGEST_ID}:${day}`, fireAt: at, title: tn(due.length, '{n} tâche à faire aujourd’hui', '{n} tâches à faire aujourd’hui'), body: names, url: '/taches' });
  }
  return out;
}
