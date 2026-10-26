import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid, nowIso } from '../lib/utils';
import { userStorage } from '../lib/userStorage';
import { TRASH_DAYS } from './drive';
import { getSettings, useSettings } from './settings';
import type { Usage } from '../lib/usage';
import { eventReminders } from '../lib/reminders';
import { dayShift, shiftKey } from '../lib/repeat';
import { t } from '../i18n';

export type BuiltinCategory = 'cours' | 'examen' | 'devoir' | 'perso' | 'sport';
/** A built-in category, or one the student created (`c-…`, its name and colour live in the settings). */
export type EventCategory = BuiltinCategory | `c-${string}`;

export interface CategoryInfo {
  label: string;
  color: string;
  soft: string;
  text: string;
}

export interface CustomCategory {
  id: `c-${string}`;
  label: string;
  color: string;
}

/** Colours offered for a new category. */
export const CATEGORY_COLORS = ['#3b6fd8', '#d9483b', '#d48a17', '#2f9e6b', '#7a5ad6', '#1f8a8a', '#d6457f', '#6b7280'];

/** Colours: `color` is a plain hex; `soft`/`text` are CSS variables (light and dark values in index.css). */
export const CATEGORIES: Record<BuiltinCategory, CategoryInfo> = {
  cours: { label: t('Cours'), color: '#3b6fd8', soft: 'var(--cat-cours-soft)', text: 'var(--cat-cours-text)' },
  examen: { label: t('Examen'), color: '#d9483b', soft: 'var(--cat-examen-soft)', text: 'var(--cat-examen-text)' },
  devoir: { label: t('Devoir'), color: '#d48a17', soft: 'var(--cat-devoir-soft)', text: 'var(--cat-devoir-text)' },
  perso: { label: t('Perso'), color: '#2f9e6b', soft: 'var(--cat-perso-soft)', text: 'var(--cat-perso-text)' },
  sport: { label: t('Sport'), color: '#7a5ad6', soft: 'var(--cat-sport-soft)', text: 'var(--cat-sport-text)' },
};

/** Names of the five built-in categories for each usage of the account (applied by applyUsage below). */
export const CATEGORY_LABELS: Record<Usage, Record<BuiltinCategory, string>> = {
  etudes: { cours: t('Cours'), examen: t('Examen'), devoir: t('Devoir'), perso: t('Perso'), sport: t('Sport') },
  travail: { cours: t('Réunion'), examen: t('Échéance'), devoir: t('Livrable'), perso: t('Perso'), sport: t('Sport') },
  perso: { cours: t('Rendez-vous'), examen: t('Grand jour'), devoir: t('À faire'), perso: t('Perso'), sport: t('Sport') },
};

/**
 * shortcut: the category labels are swapped in place on the shared CATEGORIES object instead of a hook in every
 * component. Fine because the usage is set before the app shows any page (load / welcome) and rarely changes after.
 */
export function applyUsage(usage: Usage) {
  for (const [key, label] of Object.entries(CATEGORY_LABELS[usage] ?? CATEGORY_LABELS.etudes)) CATEGORIES[key as BuiltinCategory].label = label;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  start?: string; // HH:mm
  end?: string;
  category: EventCategory;
  done: boolean;
  details?: string;
  /** Marked important by the person (flag): the home page counts it among the big days to come. */
  important?: boolean;
  /** Reminders, in minutes before the start (or before 9:00 for an event without a time): lib/reminders. */
  reminders?: number[];
  /** UID of the event in an imported .ics file, so a second import doesn't duplicate it. */
  externalId?: string;
  createdAt: string;
  /** Set while the event is in the trash. */
  deletedAt?: string;
  /** Shared calendar: the members it is about (user ids); none: everyone. */
  people?: string[];
  /** Same id on every occurrence of an event that repeats (lib/repeat). */
  series?: string;
}

export type NewEvent = Omit<CalendarEvent, 'id' | 'done' | 'createdAt'>;

/** A big day: an exam (deadline, « grand jour » outside studies) or an event marked important. */
export const isBigEvent = (e: Pick<CalendarEvent, 'category' | 'important'>) => e.category === 'examen' || !!e.important;

interface CalendarState {
  events: CalendarEvent[];
  add: (e: NewEvent) => CalendarEvent;
  /** Adds many events in one update (.ics import). */
  addMany: (list: NewEvent[]) => void;
  update: (id: string, patch: Partial<CalendarEvent>) => void;
  /** Changes this occurrence and the next ones of its series (a new day moves them by as many days). */
  updateSeries: (id: string, patch: Partial<CalendarEvent>) => void;
  /** Moves the event to the trash. */
  remove: (id: string) => void;
  removeMany: (ids: string[]) => void;
  /** Deleted events, kept TRASH_DAYS days (separate list: nothing else has to filter them). */
  trash: CalendarEvent[];
  restore: (ids: string[]) => void;
  purge: (ids: string[]) => void;
  emptyTrash: () => void;
  purgeExpired: () => void;
  toggleDone: (id: string) => void;
}

const customInfo = (c: CustomCategory): CategoryInfo => ({
  label: c.label,
  color: c.color,
  soft: `color-mix(in oklab, ${c.color} 16%, var(--color-surface))`,
  text: `color-mix(in oklab, ${c.color} 72%, var(--color-ink))`,
});

/** The shared calendars' own categories (lib/groups registers them as it reads the calendars). */
const sharedCategories = new Map<string, CustomCategory>();
export const knowSharedCategories = (list: CustomCategory[]) => list.forEach(c => sharedCategories.set(c.id, c));

/** Name and colours of a category (one deleted in the meantime shows as Perso). */
export function catOf(key: EventCategory): CategoryInfo {
  if (key in CATEGORIES) return CATEGORIES[key as BuiltinCategory];
  const c = getSettings().customCategories?.find(x => x.id === key) ?? sharedCategories.get(key);
  return c ? customInfo(c) : CATEGORIES.perso;
}

/** Every category the student can pick: the built-in ones, then their own. */
export const allCategories = (custom: CustomCategory[] = getSettings().customCategories ?? []): EventCategory[] => [
  ...(Object.keys(CATEGORIES) as BuiltinCategory[]),
  ...custom.map(c => c.id),
];

/** One of the student's own categories (or a shared calendar's: `custom`) named in the title (« Stage chez Airbus » → Stage). */
export function customCategoryIn(title: string, custom: CustomCategory[] = myCategories()): EventCategory | undefined {
  const words = (x: string) => ` ${x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const t = words(title);
  return custom.find(c => words(c.label).trim() && t.includes(words(c.label)))?.id;
}

/** Something to hand in (« Marquer comme rendu »): a revision session is homework-coloured but not one. */
export const isDeliverable = (e: Pick<CalendarEvent, 'category' | 'title'>) => e.category === 'devoir' && !/^(r[ée]vis|pr[ée]paration)/i.test(e.title.trim()); // révision(s), réviser

/**
 * Words at the start of a word only (« secours » is not « cours », « prendre » not « rendre »); `$` marks the end
 * of a word too, for short ones that start longer words (« math » in « Mathilde », « bio » in « Biocoop »).
 */
// Compiled at the first guess, not when the site opens (~40 ms of a slow phone's start-up for these lists).
const wordRe = (list: string) => {
  let re: RegExp | undefined;
  return { test: (s: string) => (re ??= new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.replace(/\$/g, '(?![\\p{L}\\p{N}])')})`, 'u')).test(s) };
};
// « Déco du salon » is the living room, « Salon de l'agriculture » a trade show.
const SALON = '(?<!(?:du|le|au|ce|mon|ton|son|notre|votre) )salons?$';
// The other site languages (whole words; German compounds by their end: « Zahnarzt », « Teambesprechung », « Matheprüfung »).
const OTHER_DOCTOR = 'dentist|doctors?$|\\p{L}*arzt|dentista|m[ée]dicos?$';
const OTHER_BIRTHDAY = 'birthdays?$|\\p{L}*geburtstag|compleanno|cumplea[ñn]os';
const OTHER_MEETING = "reuni[oó]n|riunione|\\p{L}*besprechung|cita$|appuntamento|appointment|\\p{L}*(?<!abgabe|liefer)termin$";
const OTHER_HANDIN = '\\p{L}*abgabe|entregas?$|consegna';
const WORK_PERSO = wordRe(`m[ée]decin|dentiste|kin[ée]|ost[ée]o|docteur|pharmacie|anniversaire|mariage|bapt[eê]me|vacances|cong[ée]s?$|${OTHER_DOCTOR}|${OTHER_BIRTHDAY}`);
// « Point avec Marc », « Appel client », « Visio » (not « Point relais », « Appel d'offres »).
const WORK_MEETING = wordRe(`r[ée]union|meeting|call$|visio(?!n)|point$(?! relais)|appels?$(?! d['’]offres?)|entretien|rendez-vous|rdv$|revue$|s[ée]minaire|atelier|comit[ée]|formation|conf[ée]rence|webinaire|${OTHER_MEETING}`);
const WORK_QUOTE = wordRe('devis|facture|relance|proposition|contrat|payer|paiement|imp[oô]ts?$|d[ée]claration|urssaf|tva$');
const WORK_DEADLINE = wordRe(`deadline|[ée]ch[ée]ance|date limite|livraison|lancement|audits?$|${SALON}|d[ée]m[ée]nagement|rendre|rendu|remise|soutenance|pr[ée]sentation|d[ée]mo$|bouclage|cl[ôo]ture|${OTHER_HANDIN}`);
const HOME_MEETING = wordRe(`r[ée]union|meeting|call$|visio(?!n)|point (?:d['’][ée]quipe|client|hebdo)|entretien|rendez-vous|rdv$|m[ée]decin|dentiste|kin[ée]|${OTHER_MEETING}|${OTHER_DOCTOR}`);
const HOME_TODO = wordRe('devis|facture|relance|proposition|contrat|payer|imp[oô]ts?$|d[ée]claration');
const HOME_BIG = wordRe(`deadline|[ée]ch[ée]ance|livraison|lancement|audits?$|${SALON}|anniversaire|mariage|d[ée]m[ée]nagement|${OTHER_BIRTHDAY}`);
const STUDY_EXAM = wordRe('exam|partiel|contr[oô]le|ds$|qcm$|interro|oral(?:e|es|s)?$|soutenance|concours|\\p{L}*pr[üu]fung|\\p{L}*klausur|esam[ei]$|verifica|parcial(?:es)?$|tests?$|quiz|midterms?$|finals$');
const STUDY_HOMEWORK = wordRe(`devoir|tp$|td$|rendre|rendu|dm$|projet|dossier|exos?$|exercice|r[ée]vis|homework|assignments?$|\\p{L}*hausaufgaben?$|deberes$|compiti$|${OTHER_HANDIN}`);
const SPORT = wordRe('sport|foot|basket|gym|muscu|course$|piscine|natation|yoga|tennis|danse|gimnasio|palestra|fitness|training|entrenamiento|allenamento');
// « Courses » (faire les courses) n'est ni du sport ni un cours.
const STUDY_CLASS = wordRe('cours(?!es$)|amphi|cm$|lecture|classes?$|class$|lessons?$|\\p{L}*vorlesung|\\p{L}*kurs(?:e)?$|seminar$|lezion[ei]$|cors[oi]$|clases?$|profs?$|professeur|maths?$|math[ée]matiques|physique|chimie|histoire|anglais|fran[cç]ais|info$|informatique|bio$|biologie|[ée]co$|[ée]conomie|philo$|philosophie');

/** A work title: Réunion (cours), Livrable (devoir), Échéance (examen), or the private life (perso). */
function workCategory(t: string, timed: boolean): EventCategory | undefined {
  // Private life seen from a work calendar: the dentist or a birthday is not a meeting nor a deadline.
  if (WORK_PERSO.test(t)) return 'perso';
  if (WORK_MEETING.test(t)) return 'cours';
  if (WORK_QUOTE.test(t)) return 'devoir';
  if (WORK_DEADLINE.test(t)) return 'examen';
  // « Projet Dupont lundi 10h »: a work session on it; without an hour, a project milestone.
  if (/\bprojet\b/.test(t)) return timed ? 'cours' : 'examen';
  return undefined;
}

/**
 * Guess a category from the title so the student never has to think about it. `timed`: a TD or TP
 * with an hour is a class, not homework. Work and personal accounts use the same five categories under
 * other names (see lib/usage): Réunion / Échéance / Livrable at work, Rendez-vous / Grand jour / À faire at home.
 */
export function guessCategory(title: string, timed = false, custom?: CustomCategory[]): EventCategory {
  const own = customCategoryIn(title, custom);
  if (own) return own;
  const t = title.toLowerCase();
  const usage = getSettings().usage ?? 'etudes';
  if (usage === 'travail') {
    const work = workCategory(t, timed);
    if (work) return work;
    return SPORT.test(t) ? 'sport' : 'perso';
  }
  if (usage === 'perso') {
    if (HOME_MEETING.test(t)) return 'cours';
    if (HOME_TODO.test(t)) return 'devoir';
    if (HOME_BIG.test(t)) return 'examen';
  }
  // A revision session typed by hand (« Révision partiel de droit », « Réviser le contrôle de maths ») is not the exam itself.
  if (STUDY_EXAM.test(t)) return /(^|[^\p{L}])r[ée]vis/u.test(t) ? 'devoir' : 'examen';
  // « Rendre TP le 12/11 à 9h30 » is handing it in, not the class: checked before the timed TD/TP rule.
  if (timed && /\b(td|tp|cm)\b/.test(t) && !/(rendre|rendu)/.test(t)) return 'cours';
  if (STUDY_HOMEWORK.test(t)) return 'devoir';
  if (SPORT.test(t)) return 'sport';
  if (STUDY_CLASS.test(t)) return 'cours';
  return 'perso';
}

/**
 * A new event. Made here (not imported): the usual reminder (Profil › Notifications) if it has a time, and the early
 * ones of a big day, unless it says otherwise. (« Aucun » as the usual one: [] kept, so changing the usual reminder
 * later doesn't add one to it.)
 */
function fresh(e: NewEvent): CalendarEvent {
  const reminders = e.reminders ?? (!e.externalId && (e.start || isBigEvent(e)) ? [...eventReminders(e, getSettings().defaultReminders ?? [])] : undefined);
  return { ...e, ...(reminders && { reminders }), id: uid(), done: false, createdAt: nowIso() };
}

/** The occurrences of an event's series after it (none for an event that doesn't repeat). */
export const nextInSeries = (ev: Pick<CalendarEvent, 'series' | 'date' | 'id'>, events: CalendarEvent[]) =>
  ev.series ? events.filter(e => e.series === ev.series && e.date > ev.date && e.id !== ev.id) : [];

/** An event from a timetable (.ics): a class unless its title says otherwise (exam, homework, sport…). */
export function timetableCategory(title: string, timed: boolean): EventCategory {
  const c = guessCategory(title, timed);
  return c === 'perso' && timed ? 'cours' : c;
}

export const sortEvents = (a: CalendarEvent, b: CalendarEvent) =>
  a.date.localeCompare(b.date) || (a.start ?? '99').localeCompare(b.start ?? '99');

export const useCalendar = create<CalendarState>()(
  persist(
    (set, get) => ({
      events: [],
      trash: [],
      add(e) {
        const ev = fresh(e);
        set(s => ({ events: [...s.events, ev] }));
        return ev;
      },
      addMany: list => set(s => ({ events: [...s.events, ...list.map(fresh)] })),
      updateSeries(id, patch) {
        const ev = get().events.find(e => e.id === id);
        if (!ev?.series) return get().update(id, patch);
        const shift = patch.date ? dayShift(ev.date, patch.date) : 0;
        const { date: _d, ...rest } = patch;
        set(s => ({
          events: s.events.map(e => (e.id === id ? { ...e, ...patch } : e.series === ev.series && e.date > ev.date ? { ...e, ...rest, ...(shift && { date: shiftKey(e.date, shift) }) } : e)),
        }));
      },
      update: (id, patch) => set(s => ({ events: s.events.map(e => (e.id === id ? { ...e, ...patch } : e)) })),
      remove: id => get().removeMany([id]),
      removeMany(ids) {
        const gone = new Set(ids);
        const at = nowIso();
        set(s => ({ events: s.events.filter(e => !gone.has(e.id)), trash: [...s.trash, ...s.events.filter(e => gone.has(e.id)).map(e => ({ ...e, deletedAt: at }))] }));
      },
      restore(ids) {
        const back = new Set(ids);
        set(s => ({
          events: [...s.events, ...s.trash.filter(e => back.has(e.id)).map(({ deletedAt: _d, ...e }) => e)],
          trash: s.trash.filter(e => !back.has(e.id)),
        }));
      },
      purge(ids) {
        const doomed = new Set(ids);
        set(s => ({ trash: s.trash.filter(e => !doomed.has(e.id)) }));
      },
      emptyTrash: () => set({ trash: [] }),
      purgeExpired() {
        const limit = Date.now() - TRASH_DAYS * 864e5;
        const old = get().trash.filter(e => e.deletedAt && new Date(e.deletedAt).getTime() < limit).map(e => e.id);
        if (old.length) get().purge(old);
      },
      toggleDone: id => set(s => ({ events: s.events.map(e => (e.id === id ? { ...e, done: !e.done } : e)) })),
    }),
    { name: 'calendar', storage: userStorage, skipHydration: true },
  ),
);

// ── The student's own categories, or a shared calendar's ─────────────────────

const myCategories = () => getSettings().customCategories ?? [];

/** Where a list of categories lives: my settings, or a shared calendar (lib/groups, for all its members). */
export interface CategoryScope {
  list: () => CustomCategory[];
  save: (list: CustomCategory[]) => void;
}

export const MY_CATEGORIES: CategoryScope = { list: myCategories, save: list => useSettings.getState().set({ customCategories: list }) };

const cleanLabel = (label: string) => label.trim().replace(/\s+/g, ' ').slice(0, 24);

const sameName = (a: string, b: string) => cleanLabel(a).toLowerCase() === cleanLabel(b).toLowerCase();

/**
 * The name of a built-in category: 'current' when it is shown now, 'other' when it is one in another usage
 * (« Cours » created in a work account would appear twice after switching back to studies).
 */
export function builtinLabel(label: string): 'current' | 'other' | null {
  if (Object.values(CATEGORIES).some(c => sameName(c.label, label))) return 'current';
  return Object.values(CATEGORY_LABELS).some(names => Object.values(names).some(n => sameName(n, label))) ? 'other' : null;
}

/** The category with this name in the scope (spaces and case aside). */
export const customNamed = (label: string, exceptId?: string, scope = MY_CATEGORIES) => scope.list().find(c => c.id !== exceptId && sameName(c.label, label));

/** A built-in category, or another of the scope, already has this name (« Cours » twice would be confusing). */
export function labelTaken(label: string, exceptId?: string, scope = MY_CATEGORIES) {
  return !!builtinLabel(label) || !!customNamed(label, exceptId, scope);
}

/** Creates a category, or returns the existing one with that name. */
export function createCategory(label: string, color: string, scope = MY_CATEGORIES): CustomCategory {
  const name = cleanLabel(label);
  const same = customNamed(name, undefined, scope);
  if (same) return same;
  const cat: CustomCategory = { id: `c-${uid().slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, '0')}`, label: name, color };
  scope.save([...scope.list(), cat]);
  return cat;
}

export function updateCategory(id: CustomCategory['id'], patch: Partial<Omit<CustomCategory, 'id'>>, scope = MY_CATEGORIES) {
  if (patch.label !== undefined && labelTaken(patch.label, id, scope)) return;
  scope.save(scope.list().map(c => (c.id === id ? { ...c, ...patch, label: cleanLabel(patch.label ?? c.label) || c.label } : c)));
}

/** Removes a category; its events (trash included) go back to Perso (on a shared calendar they show as Perso). */
export function deleteCategory(id: CustomCategory['id'], scope = MY_CATEGORIES) {
  if (scope === MY_CATEGORIES) {
    const reset = (list: CalendarEvent[]) => (list.some(e => e.category === id) ? list.map(e => (e.category === id ? { ...e, category: 'perso' as const } : e)) : list);
    useCalendar.setState(s => ({ events: reset(s.events), trash: reset(s.trash) }));
  }
  scope.save(scope.list().filter(c => c.id !== id));
}
