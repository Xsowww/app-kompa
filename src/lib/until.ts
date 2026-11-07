import { tn, t } from '../i18n';

/** How far a day is, in words (« J-13 » wasn't understood): « aujourd’hui », « demain », « dans 13 jours ». */
export function untilLabel(days: number): string {
  if (days <= 0) return t('aujourd’hui');
  if (days === 1) return t('demain');
  return tn(days, 'dans {n} jour', 'dans {n} jours');
}
