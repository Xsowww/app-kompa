import type { Usage } from './usage';

/** A shortcut of the home page (pages/HomeShortcuts). */
export type ShortcutKey = 'import' | 'record' | 'focus' | 'agenda' | 'group' | 'files';

/**
 * What each answer of « Ce que tu veux faire » (settings › needs, pages/WelcomePage) brings to the home page, the most
 * useful first. « notes » and « ia » have none (their space is in the navigation, Kompaly in the top bar).
 */
const FROM_NEEDS: Record<string, ShortcutKey[]> = {
  agenda: ['import'],
  reviser: ['focus', 'record'],
  enregistrer: ['record'],
  'agenda-partage': ['agenda'],
  equipe: ['group'],
  fichiers: ['files'],
  taches: ['focus'],
  focus: ['focus'],
};

/** Without answers, by usage: the features people did not find on their own (visitors' test n°2). */
const BY_USAGE: Record<Usage, ShortcutKey[]> = {
  etudes: ['import', 'record', 'focus', 'group'],
  travail: ['import', 'record', 'group', 'focus'],
  perso: ['agenda', 'import', 'focus', 'record'],
};

/** The shortcuts of an account: those its answers point to, then its usage's, four at most. */
export function shortcutKeys(usage: Usage | undefined, needs: readonly string[] | undefined): ShortcutKey[] {
  const out = new Set<ShortcutKey>((needs ?? []).flatMap(n => FROM_NEEDS[n] ?? []));
  for (const k of BY_USAGE[usage ?? 'etudes'] ?? BY_USAGE.etudes) out.add(k);
  return [...out].slice(0, 4);
}
