import type { Usage } from './usage';

/**
 * The spaces of the navigation, in the order the person uses them (settings › navOrder). « Accueil » is always first
 * and is not part of it; Corbeille and Administration stay at the end of « Plus ».
 * Phones: Accueil + the first PHONE_TABS of the order in the bar, the others under « Plus ». Computers: the sidebar
 * lists them all in this order.
 */
export type SpaceKey = 'calendrier' | 'taches' | 'notes' | 'drive' | 'enregistrer' | 'groupes' | 'agendas';

/** Today's order (before the questionnaire chose one): what an account without answers keeps. */
export const SPACE_KEYS: SpaceKey[] = ['calendrier', 'taches', 'notes', 'drive', 'enregistrer', 'groupes', 'agendas'];

/** Spaces in the phone's bar, after « Accueil » (and before « Plus »). */
export const PHONE_TABS = 4;

/** Per usage: the order when no need was ticked (the first four are the same for all: the everyday spaces). */
const BASE: Record<Usage, SpaceKey[]> = {
  etudes: SPACE_KEYS,
  travail: ['calendrier', 'taches', 'notes', 'drive', 'groupes', 'enregistrer', 'agendas'],
  perso: ['calendrier', 'taches', 'notes', 'drive', 'agendas', 'groupes', 'enregistrer'],
};

/**
 * What each answer of « Ce que tu veux faire » (settings › needs) brings forward, the most useful space first.
 * Older and newer keys of the questionnaire alike; an unknown key (« ia »…) changes nothing.
 */
const NEED_SPACES: Record<string, SpaceKey[]> = {
  agenda: ['calendrier', 'taches'],
  oublier: ['calendrier', 'taches'],
  rappels: ['calendrier', 'taches'],
  taches: ['taches'],
  notes: ['notes'],
  reviser: ['notes', 'taches', 'enregistrer'],
  revisions: ['notes', 'taches', 'enregistrer'],
  focus: ['taches'],
  concentrer: ['taches'],
  fichiers: ['drive'],
  ranger: ['drive'],
  enregistrer: ['enregistrer'],
  equipe: ['groupes'],
  plusieurs: ['groupes'],
  groupes: ['groupes'],
  partager: ['agendas'],
  partage: ['agendas'],
  agendas: ['agendas'],
  'agenda-partage': ['agendas'],
  agendaPartage: ['agendas'],
};

const isSpace = (k: unknown): k is SpaceKey => typeof k === 'string' && (SPACE_KEYS as string[]).includes(k);

/**
 * The navigation order from the welcome questionnaire: the spaces the answers point to first (in the usage's order),
 * then the others. The calendar stays among the phone's tabs (the reminders and the home page lead to it).
 * `usage`: the primary one, or all those chosen (the first is the primary). Always the 7 keys, each once.
 */
export function navFromAnswers(usage: Usage | Usage[] | null | undefined, needs: readonly string[] | null | undefined): SpaceKey[] {
  const primary = (Array.isArray(usage) ? usage[0] : usage) ?? 'etudes';
  const base = BASE[primary] ?? SPACE_KEYS;
  const wanted = new Set((needs ?? []).flatMap(n => NEED_SPACES[n] ?? []));
  if (!wanted.size) return [...base];
  const order = [...base.filter(k => wanted.has(k)), ...base.filter(k => !wanted.has(k))];
  const cal = order.indexOf('calendrier');
  if (cal >= PHONE_TABS) {
    order.splice(cal, 1);
    order.splice(PHONE_TABS - 1, 0, 'calendrier');
  }
  return order;
}

/** A saved order made whole: unknown keys and repeats dropped, the missing spaces added at the end (in today's order). */
export function cleanNavOrder(order: readonly unknown[]): SpaceKey[] {
  const kept = [...new Set(order.filter(isSpace))];
  return [...kept, ...SPACE_KEYS.filter(k => !kept.includes(k))];
}

/** The order to show: the one the person chose, else the one their answers give (old accounts: from their saved answers). */
export function resolveNavOrder(saved: readonly unknown[] | null | undefined, usage: Usage | Usage[] | null | undefined, needs: readonly string[] | null | undefined): SpaceKey[] {
  return saved?.length ? cleanNavOrder(saved) : navFromAnswers(usage, needs);
}

/** `key` moved one place up (-1) or down (+1); the same order at the ends. */
export function moveSpace(order: readonly SpaceKey[], key: SpaceKey, by: -1 | 1): SpaceKey[] {
  const i = order.indexOf(key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
