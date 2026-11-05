import type { PersonaKey, Settings } from '../store/settings';
import { USAGES, type Usage } from './usage';
import { t } from '../i18n';

/**
 * The welcome questionnaire (pages/WelcomePage), four short questions: what Kompaly is for, who you are, what you
 * want to do (it orders the navigation, lib/navOrder), and how Kompaly talks (optional). The rest (school, revision
 * time…) is in the profile.
 */
export const WELCOME_STEPS = 4;

export type WelcomeAnswers = Pick<Settings, 'usage' | 'usages' | 'year' | 'needs' | 'persona'>;

/** Nothing chosen (« Passer » everywhere): the everyday wording (no « cours », no « échéances »). */
export const DEFAULT_ANSWERS: WelcomeAnswers = { usage: 'perso', usages: [], year: '', needs: [], persona: 'pote' };

/** « Tu es… »: the answers of each usage, in small groups (`title`) so a long list stays easy to scan. */
export interface StatusGroup {
  usage: Usage;
  title: string;
  options: string[];
}
const LYCEE = [t('Seconde'), t('Première'), t('Terminale')];
const FAC = [t('L1'), t('L2'), t('L3'), t('M1'), t('M2'), t('Doctorat')];
export const STATUS_GROUPS: StatusGroup[] = [
  { usage: 'etudes', title: t('Au lycée'), options: LYCEE },
  { usage: 'etudes', title: t('À la fac'), options: FAC },
  { usage: 'etudes', title: t('Autres études'), options: [t('BTS / BUT'), t('Prépa'), t('Alternance'), t('École')] },
  { usage: 'travail', title: t('Au travail'), options: [t('Salarié·e'), t('Indépendant·e / freelance'), t('Enseignant·e'), t('Alternance'), t('Association')] },
  { usage: 'perso', title: t('Dans la vie'), options: [t('Parent'), t('Retraité·e'), t('Association')] },
];
export const OTHER_STATUS = t('Autre');

/** The groups to show for the usages chosen (all of them when none was), each answer once. */
export function statusGroups(usages: readonly Usage[]): StatusGroup[] {
  const order = usages.length ? usages : USAGES.map(u => u.key);
  const seen = new Set<string>();
  return order.flatMap(u =>
    STATUS_GROUPS.filter(g => g.usage === u)
      .map(g => ({ ...g, options: g.options.filter(o => !seen.has(o) && !!seen.add(o)) }))
      .filter(g => g.options.length),
  );
}

/** A high-school pupil: no « partiels », no « fac » in the examples. */
export const isLycee = (year: string) => LYCEE.includes(year) || year === t('Lycée');

/**
 * « Ce que tu veux faire » (settings › needs, read by the AI and by lib/navOrder): its keys are part of the shared
 * contract with the navigation, keep them.
 */
export function needOptions(a: Pick<WelcomeAnswers, 'usage' | 'usages' | 'year'>): { key: string; label: string }[] {
  const usages = a.usages.length ? a.usages : [a.usage];
  const studies = usages.includes('etudes');
  const work = usages.includes('travail');
  const list = [
    { key: 'agenda', label: t('Ne rien oublier (agenda, rappels)') },
    studies && { key: 'reviser', label: isLycee(a.year) ? t('Réviser mes contrôles et le bac') : t('Réviser mes examens') },
    {
      key: 'enregistrer',
      label: a.usage === 'travail' ? t('Enregistrer mes réunions (compte rendu)') : a.usage === 'perso' ? t('Enregistrer et résumer (conférence, vidéo…)') : t('Enregistrer mes cours (texte et fiche)'),
    },
    { key: 'agenda-partage', label: t('Partager un agenda (famille, coloc…)') },
    { key: 'equipe', label: work ? t('Travailler en équipe') : t('Travailler à plusieurs') },
    { key: 'notes', label: t('Prendre et ranger mes notes') },
    { key: 'fichiers', label: t('Ranger mes fichiers') },
    { key: 'taches', label: t('Suivre mes tâches') },
    { key: 'focus', label: t('Me concentrer (minuteur)') },
    { key: 'ia', label: t('Me faire aider par une IA') },
  ];
  return list.filter((x): x is { key: string; label: string } => !!x);
}

const PERSONA_KEYS: PersonaKey[] = ['pote', 'coach', 'prof', 'zen', 'taquin'];
const isUsage = (u: unknown): u is Usage => USAGES.some(x => x.key === u);

/** The answers of a saved draft (account settings, any device), each checked; null when there is none. */
export function readWelcomeDraft(raw: unknown): { step: number; answers: WelcomeAnswers } | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as { step?: unknown; answers?: Record<string, unknown> };
  const step = Number.isInteger(d.step) ? Math.min(Math.max(d.step as number, 0), WELCOME_STEPS - 1) : 0;
  const x = d.answers && typeof d.answers === 'object' ? d.answers : {};
  const usages = Array.isArray(x.usages) ? [...new Set(x.usages.filter(isUsage))] : [];
  const answers: WelcomeAnswers = {
    usages,
    usage: usages[0] ?? (isUsage(x.usage) ? x.usage : DEFAULT_ANSWERS.usage),
    year: typeof x.year === 'string' ? x.year.slice(0, 60) : '',
    needs: Array.isArray(x.needs) ? x.needs.filter((n): n is string => typeof n === 'string').slice(0, 20) : [],
    persona: PERSONA_KEYS.includes(x.persona as PersonaKey) ? (x.persona as PersonaKey) : DEFAULT_ANSWERS.persona,
  };
  return { step, answers };
}

/**
 * Is the questionnaire still to answer? `onboarded`: the account's profile says so (undefined: not known, offline or
 * not downloaded yet). The account's settings (synced) know it too: done on another device, or left half-way.
 * null: can't tell (a new device, offline): the app opens, with « Termine ton profil ».
 */
export function welcomePending(onboarded: boolean | undefined, s: Pick<Settings, 'welcomeDone' | 'welcomeDraft'>): boolean | null {
  if (s.welcomeDone || onboarded === true) return false;
  if (onboarded === false) return true;
  return s.welcomeDraft ? true : null;
}
