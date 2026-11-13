import { catOf as baseCatOf, type CategoryInfo, type EventCategory } from '../../store/calendar';
import { getSettings } from '../../store/settings';
import type { Usage } from '../../lib/usage';
import './calPro.css';

/**
 * Affichage Pro: the colour of each built-in category, from the Pro tokens (themes.css › data-pro), so one colour means
 * one thing everywhere: courses blue (études), meetings cyan (rendez-vous, the « Réunion » of a work account), exams
 * and big days red, homework amber (travail), the « Travail » category mint green, personal pink, sport violet.
 */
export function proColor(key: EventCategory, usage: Usage): string | null {
  switch (key) {
    case 'cours':
      return usage === 'etudes' ? 'var(--pro-etudes)' : 'var(--pro-meet)';
    case 'examen':
      return 'var(--pro-urgent)';
    case 'devoir':
      return 'var(--pro-travail)';
    case 'travail':
      return 'var(--pro-work-cat, #3ddc97)';
    case 'perso':
      return 'var(--pro-perso)';
    case 'sport':
      return 'var(--pro-sport, #bf5af2)';
    default:
      return null;
  }
}

/** A category's colours, vivid on the dark Pro world: the plain colour, a deep tint behind, a light one for its text. */
export function vividInfo(info: CategoryInfo, color: string): CategoryInfo {
  return {
    label: info.label,
    color,
    soft: `color-mix(in oklab, ${color} 30%, rgb(14 16 24 / 0.92))`,
    text: `color-mix(in oklab, ${color} 62%, white)`,
  };
}

/** The calendar's catOf (store/calendar): the same, with the vivid colours in the Affichage Pro. */
export function catOf(key: EventCategory): CategoryInfo {
  const info = baseCatOf(key);
  const s = getSettings();
  if (!s.pro) return info;
  return vividInfo(info, proColor(key, s.usage) ?? info.color);
}
