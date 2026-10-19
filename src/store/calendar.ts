import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid, nowIso } from '../lib/utils';
import { userStorage } from '../lib/userStorage';
import { TRASH_DAYS } from './drive';
import { getSettings, useSettings } from './settings';
import type { Usage } from '../lib/usage';
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

/** Names of the five built-in categories for each usage of the account (applied by lib/usage). */
export const CATEGORY_LABELS: Record<Usage, Record<BuiltinCategory, string>> = {
  etudes: { cours: t('Cours'), examen: t('Examen'), devoir: t('Devoir'), perso: t('Perso'), sport: t('Sport') },
  travail: { cours: t('Réunion'), examen: t('Échéance'), devoir: t('Devis'), perso: t('Perso'), sport: t('Sport') },
  perso: { cours: t('Rendez-vous'), examen: t('Grand jour'), devoir: t('À faire'), perso: t('Perso'), sport: t('Sport') },
};

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
  /** Moves the event to the trash. */
  remove: (id: string) => void;
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

/** Name and colours of a category (one deleted in the meantime shows as Perso). */
export function catOf(key: EventCategory): CategoryInfo {
  if (key in CATEGORIES) return CATEGORIES[key as BuiltinCategory];
  const c = getSettings().customCategories?.find(x => x.id === key);
  return c ? customInfo(c) : CATEGORIES.perso;
}

/** Every category the student can pick: the built-in ones, then their own. */
export const allCategories = (custom: CustomCategory[] = getSettings().customCategories ?? []): EventCategory[] => [
  ...(Object.keys(CATEGORIES) as BuiltinCategory[]),
  ...custom.map(c => c.id),
];

/** One of the student's own categories named in the title (« Stage chez Airbus » → Stage). */
export function customCategoryIn(title: string): EventCategory | undefined {
  const words = (x: string) => ` ${x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const t = words(title);
  return (getSettings().customCategories ?? []).find(c => words(c.label).trim() && t.includes(words(c.label)))?.id;
}

/** Something to hand in (« Marquer comme rendu »): a revision session is homework-coloured but not one. */
export const isDeliverable = (e: Pick<CalendarEvent, 'category' | 'title'>) => e.category === 'devoir' && !/^(r[ée]vis|pr[ée]paration)/i.test(e.title.trim()); // révision(s), réviser

/** A work title: Réunion (cours), Devis (devoir), Échéance (examen), or the private life (perso). */
function workCategory(t: string, timed: boolean): EventCategory | undefined {
  // Private life seen from a work calendar: the dentist or a birthday is not a meeting nor a deadline.
  if (/(m[ée]decin|dentiste|kin[ée]|ost[ée]o|docteur|pharmacie|anniversaire|mariage|bapt[eê]me|vacances|cong[ée]s?\b)/.test(t)) return 'perso';
  if (/(r[ée]union|meeting|\bcall\b|visio(?!n)|point (d['’][ée]quipe|client|hebdo)|entretien|rendez-vous|\brdv\b|\brevue\b|s[ée]minaire|atelier|comit[ée]|formation|conf[ée]rence|webinaire)/.test(t)) return 'cours';
  if (/(devis|facture|relance|proposition|contrat|payer|paiement|imp[oô]ts?|d[ée]claration|urssaf|\btva\b)/.test(t)) return 'devoir';
  if (/(deadline|[ée]ch[ée]ance|date limite|livraison|lancement|audit|salon|d[ée]m[ée]nagement|rendre|rendu|remise|soutenance|pr[ée]sentation|d[ée]mo\b|bouclage|cl[ôo]ture)/.test(t)) return 'examen';
  // « Projet Dupont lundi 10h »: a work session on it; without an hour, a project milestone.
  if (/\bprojet\b/.test(t)) return timed ? 'cours' : 'examen';
  return undefined;
}

/**
 * Guess a category from the title so the student never has to think about it. `timed`: a TD or TP
 * with an hour is a class, not homework. Work and personal accounts use the same five categories under
 * other names (see lib/usage): Réunion / Échéance / Devis at work, Rendez-vous / Grand jour / À faire at home.
 */
export function guessCategory(title: string, timed = false): EventCategory {
  const own = customCategoryIn(title);
  if (own) return own;
  const t = title.toLowerCase();
  const usage = getSettings().usage ?? 'etudes';
  if (usage === 'travail') {
    const work = workCategory(t, timed);
    if (work) return work;
    return /(sport|foot|basket|gym|muscu|\bcourse\b|piscine|natation|yoga|tennis|danse)/.test(t) ? 'sport' : 'perso';
  }
  if (usage === 'perso') {
    if (/(r[ée]union|meeting|\bcall\b|visio(?!n)|point (d['’][ée]quipe|client|hebdo)|entretien|rendez-vous|\brdv\b|m[ée]decin|dentiste|kin[ée])/.test(t)) return 'cours';
    if (/(devis|facture|relance|proposition|contrat|payer|imp[oô]ts?|d[ée]claration)/.test(t)) return 'devoir';
    if (/(deadline|[ée]ch[ée]ance|livraison|lancement|audit|salon|anniversaire|mariage|d[ée]m[ée]nagement)/.test(t)) return 'examen';
  }
  // A revision session typed by hand (« Révision partiel de droit », « Réviser le contrôle de maths ») is not the exam itself.
  if (/(exam|partiel|contr[oô]le|\bds\b|\bqcm\b|interro|oral|soutenance|concours)/.test(t)) return /(^|[^\p{L}])r[ée]vis/u.test(t) ? 'devoir' : 'examen';
  // « Rendre TP le 12/11 à 9h30 » is handing it in, not the class: checked before the timed TD/TP rule.
  if (timed && /\b(td|tp|cm)\b/.test(t) && !/(rendre|rendu)/.test(t)) return 'cours';
  if (/(devoir|\btp\b|\btd\b|rendre|rendu|dm\b|projet|dossier|exo|exercice|r[ée]vis)/.test(t)) return 'devoir';
  if (/(sport|foot|basket|gym|muscu|\bcourse\b|piscine|natation|yoga|tennis|danse)/.test(t)) return 'sport';
  // « Courses » (faire les courses) n'est ni du sport ni un cours.
  if (/(cours(?!es\b)|amphi|cm\b|lecture|classe|prof|math|physique|chimie|histoire|anglais|fran[cç]ais|info|bio|[ée]co|philo)/.test(t)) return 'cours';
  return 'perso';
}

export const sortEvents = (a: CalendarEvent, b: CalendarEvent) =>
  a.date.localeCompare(b.date) || (a.start ?? '99').localeCompare(b.start ?? '99');

export const useCalendar = create<CalendarState>()(
  persist(
    (set, get) => ({
      events: [],
      trash: [],
      add(e) {
        // A new event with a time gets the usual reminder (Profil › Notifications), unless it says otherwise
        // or comes from elsewhere (imported agenda, a group).
        // (« Aucun » as the usual one: [] kept, so changing the usual reminder later doesn't add one to it.)
        const reminders = e.reminders ?? (e.start && !e.externalId ? [...(getSettings().defaultReminders ?? [])] : undefined);
        const ev: CalendarEvent = { ...e, ...(reminders && { reminders }), id: uid(), done: false, createdAt: nowIso() };
        set(s => ({ events: [...s.events, ev] }));
        return ev;
      },
      addMany: list => set(s => ({ events: [...s.events, ...list.map(e => ({ ...e, id: uid(), done: false, createdAt: nowIso() }))] })),
      update: (id, patch) => set(s => ({ events: s.events.map(e => (e.id === id ? { ...e, ...patch } : e)) })),
      remove: id =>
        set(s => {
          const ev = s.events.find(e => e.id === id);
          if (!ev) return s;
          return { events: s.events.filter(e => e.id !== id), trash: [...s.trash, { ...ev, deletedAt: nowIso() }] };
        }),
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

// ── The student's own categories ─────────────────────────────────────────────

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

/** The student's own category with this name (spaces and case aside). */
export const customNamed = (label: string, exceptId?: string) => (getSettings().customCategories ?? []).find(c => c.id !== exceptId && sameName(c.label, label));

/** A built-in category, or another of the student's, already has this name (« Cours » twice would be confusing). */
export function labelTaken(label: string, exceptId?: string) {
  return !!builtinLabel(label) || !!customNamed(label, exceptId);
}

/** Creates a category, or returns the existing one with that name. */
export function createCategory(label: string, color: string): CustomCategory {
  const name = cleanLabel(label);
  const list = getSettings().customCategories ?? [];
  const same = customNamed(name);
  if (same) return same;
  const cat: CustomCategory = { id: `c-${uid().slice(0, 8)}`, label: name, color };
  useSettings.getState().set({ customCategories: [...list, cat] });
  return cat;
}

export function updateCategory(id: CustomCategory['id'], patch: Partial<Omit<CustomCategory, 'id'>>) {
  if (patch.label !== undefined && labelTaken(patch.label, id)) return;
  const list = getSettings().customCategories ?? [];
  useSettings.getState().set({ customCategories: list.map(c => (c.id === id ? { ...c, ...patch, label: cleanLabel(patch.label ?? c.label) || c.label } : c)) });
}

/** Removes a category; its events (trash included) go back to Perso. */
export function deleteCategory(id: CustomCategory['id']) {
  const reset = (list: CalendarEvent[]) => (list.some(e => e.category === id) ? list.map(e => (e.category === id ? { ...e, category: 'perso' as const } : e)) : list);
  useCalendar.setState(s => ({ events: reset(s.events), trash: reset(s.trash) }));
  useSettings.getState().set({ customCategories: (getSettings().customCategories ?? []).filter(c => c.id !== id) });
}
