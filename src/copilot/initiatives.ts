// What an event, a task or a note is about, read from its words: Kompaly's initiatives (proactive.ts) build on it.
// Pure functions (no store): tested in tests/initiatives.test.ts.

import type { CalendarEvent } from '../store/calendar';
import { normalize } from '../lib/utils';

export type EventKind = 'anniversaire' | 'reunion' | 'presentation' | 'medical' | 'voyage';

const KINDS: [EventKind, RegExp][] = [
  ['anniversaire', /\b(anniv|anniversaire|birthday|bday)\b/],
  ['presentation', /\b(presentation|oral|soutenance|expose|pitch|grand oral|jury|demo)\b/],
  ['medical', /\b(medecin|dentiste|docteur|dr|kine|kinesitherapeute|ophtalmo|orthodontiste|gyneco|dermato|osteo|osteopathe|psy|psychologue|hopital|clinique|radio|irm|echographie|prise de sang|vaccin|pharmacie|orthophoniste|podologue)\b/],
  ['voyage', /\b(voyage|vacances|train|tgv|avion|vol|aeroport|gare|sejour|week-?end a|road ?trip|depart pour|valise)\b/],
  ['reunion', /\b(reunion|meeting|point|call|visio|entretien|rdv client|rendez-vous client|comite|conseil|sprint|stand-?up|brief|kick-?off|negociation)\b/],
];

/** What the event is, from its title (and its details): the first kind that matches, most specific first. */
export function eventKind(e: Pick<CalendarEvent, 'title' | 'details'>): EventKind | null {
  const text = normalize(`${e.title} ${e.details ?? ''}`);
  return KINDS.find(([, re]) => re.test(text))?.[0] ?? null;
}

/** The person whose birthday it is (« Anniversaire de Léa » → « Léa »), when the title says. */
export function birthdayOf(title: string): string | null {
  const m = title.match(/(?:anniv(?:ersaire)?|birthday)\s+(?:de\s+|d['’]\s*|du\s+|of\s+)?(.+)$/i);
  const who = m?.[1]?.replace(/[!.]+\s*$/, '').trim();
  return who && who.length <= 40 ? who : null;
}

/** A street address in the title or the details (« 12 rue Géliot », « avenue Foch »). */
export function hasAddress(e: Pick<CalendarEvent, 'title' | 'details'>): boolean {
  return /\b(\d{1,4}\s*(bis|ter)?,?\s+)?(rue|avenue|av\.|bd|boulevard|place|chemin|allee|impasse|quai|route|cours|square)\s+\p{L}/iu.test(normalize(`${e.title} ${e.details ?? ''}`));
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The timed events of the same day whose hours cross this one's (an event without an end lasts an hour). */
export function overlapping(e: CalendarEvent, events: CalendarEvent[]): CalendarEvent[] {
  if (!e.start) return [];
  const from = minutesOf(e.start);
  const to = e.end ? minutesOf(e.end) : from + 60;
  return events.filter(o => {
    if (o.id === e.id || o.date !== e.date || !o.start || o.deletedAt || (e.series && o.series === e.series)) return false;
    const oFrom = minutesOf(o.start);
    const oTo = o.end ? minutesOf(o.end) : oFrom + 60;
    return oFrom < to && from < oTo;
  });
}

/** Two or more earlier events with the same title, the same weekday and the same time, and no repetition set: a habit. */
export function looksRecurring(e: CalendarEvent, events: CalendarEvent[]): boolean {
  if (e.series || !e.start) return false;
  const day = new Date(`${e.date}T12:00`).getDay();
  const title = normalize(e.title);
  return events.filter(o => o.id !== e.id && !o.series && o.date < e.date && o.start === e.start && normalize(o.title) === title && new Date(`${o.date}T12:00`).getDay() === day).length >= 2;
}

/** A note that lists things to do (« à faire », « - envoyer… », unchecked boxes): they could become tasks. */
export function hasActionItems(text: string): boolean {
  const plain = normalize(text.replace(/<[^>]+>/g, '\n'));
  return /(a faire|todo|to-?do|actions?\s*:|prochaines? etapes)/.test(plain) || (plain.match(/(^|\n)\s*(-|\*|•|\[ \])?\s*(envoyer|relancer|appeler|preparer|prevoir|reserver|contacter|verifier|rediger|finir|terminer)\b/g)?.length ?? 0) >= 2;
}

/** A group project (« Exposé de groupe », « Projet en équipe »): work to share out. */
export const isGroupProject = (title: string) => /\b(expose|projet|presentation|dossier|rapport)\b.*\b(groupe|equipe|binome|trinome)\b|\b(groupe|equipe)\b.*\b(projet|expose)\b/.test(normalize(title));
