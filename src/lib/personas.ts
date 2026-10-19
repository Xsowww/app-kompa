import type { PersonaKey } from '../store/settings';
import type { Usage } from './usage';
import { t } from '../i18n';

/** How Kompaly can talk: the same names in the welcome questionnaire and in the profile. */
export const PERSONAS: { key: PersonaKey; label: string; description: string }[] = [
  { key: 'pote', label: t('Meilleur pote'), description: t('Drôle et détendu, sérieux quand il le faut.') },
  { key: 'coach', label: t('Coach motivant'), description: t('Te pousse à passer à l’action, fête chaque progrès.') },
  { key: 'prof', label: t('Prof patient'), description: t('Explique pas à pas et vérifie que c’est compris.') },
  { key: 'zen', label: t('Zen'), description: t('Calme, aide à prendre du recul quand ça déborde.') },
  { key: 'taquin', label: t('Taquin'), description: t('Te charrie gentiment, jamais méchant.') },
];

/** « Prof patient » speaks to a student: at work and at home, the same personality is a « Pédagogue patient ». */
const OTHER_LABELS: Partial<Record<PersonaKey, string>> = { prof: t('Pédagogue patient') };

/** Name of a personality in the account's usage (the setting key stays the same). */
export const personaLabel = (p: { key: PersonaKey; label: string }, usage: Usage | undefined) =>
  (usage ?? 'etudes') === 'etudes' ? p.label : (OTHER_LABELS[p.key] ?? p.label);
