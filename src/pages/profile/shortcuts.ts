// Profil › Raccourcis: every keyboard shortcut of the app and the touch gestures (pages/profile/ProfilePage).
import { t } from '../../i18n';

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Every shortcut of the app (layout/AppShell for « Partout », each page for its own). Keys are written in French:
 * « Ctrl+K · / » = either of them, « G, A » = G then A, « Maj » = Shift; keyChips() translates them, and on a Mac
 * shows ⌘ ⌥ ⇧ ↩ and ⌘⌫ for Suppr (the Mac keyboard has no forward delete), ⌫ for Retour arrière.
 */
export const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: t('Partout'),
    keys: [
      ['Ctrl+K · /', t('Rechercher (pages, réglages, fichiers, notes…)')],
      ['↑ ↓, Entrée', t('Choisir un résultat')],
      ['?', t('Afficher ces raccourcis')],
      ['N', t('Créer (comme le bouton +)')],
      ['G, A', t('Aller à l’accueil')],
      ['G, C', t('Aller au calendrier')],
      ['G, T', t('Aller aux tâches')],
      ['G, N', t('Aller aux notes')],
      ['G, D', t('Aller à Fichiers')],
      ['G, E', t('Aller à Enregistrer')],
      ['G, P', t('Aller au profil')],
      ['Ctrl+J', t('Ouvrir ou fermer Kompaly')],
      ['Ctrl+Z', t('Annuler la dernière action (avec « Annuler »)')],
      ['Échap', t('Fermer, désélectionner')],
      ['Maj+F10', t('Menu contextuel')],
    ],
  },
  {
    group: t('Fenêtres'),
    keys: [
      ['Ctrl+Entrée', t('Valider (enregistrer l’événement, la tâche…)')],
      ['Échap', t('Fermer sans enregistrer')],
    ],
  },
  {
    group: t('Kompaly'),
    keys: [
      ['Entrée', t('Envoyer')],
      ['Maj+Entrée', t('Aller à la ligne')],
      ['↑', t('Reprendre ton dernier message (champ vide)')],
      ['Échap', t('Fermer la conversation')],
    ],
  },
  {
    group: t('Calendrier'),
    keys: [
      ['T', t('Aujourd’hui')],
      ['J · S · M', t('Vue jour, semaine, mois')],
      ['← →', t('Jour précédent, suivant')],
      ['↑ ↓', t('Semaine précédente, suivante')],
      ['Échap', t('Annuler un déplacement')],
    ],
  },
  {
    group: t('Tâches'),
    keys: [
      ['↑ ↓', t('Tâche précédente, suivante')],
      ['Espace', t('Cocher, décocher')],
      ['Entrée', t('Ouvrir la tâche')],
      ['F2', t('Renommer')],
      ['Suppr', t('Supprimer')],
      ['Maj+F10', t('Menu de la tâche')],
    ],
  },
  {
    group: t('Notes'),
    keys: [
      ['Ctrl+B · Ctrl+I · Ctrl+U', t('Gras, italique, souligné')],
      ['Ctrl+Maj+S', t('Barré')],
      ['Ctrl+Maj+H', t('Surligné')],
      ['Ctrl+Maj+7 · Ctrl+Maj+8 · Ctrl+Maj+9', t('Liste numérotée, à puces, cases à cocher')],
      ['Ctrl+K', t('Ajouter ou modifier un lien')],
      ['Ctrl+clic', t('Ouvrir un lien')],
      ['Ctrl+S', t('Rien à faire : tout est enregistré tout seul')],
      ['Ctrl+Z · Ctrl+Maj+Z', t('Annuler, rétablir la frappe')],
      ['Entrée', t('Du titre au texte')],
      ['↑ ↓', t('Note précédente, suivante (liste)')],
      ['F2', t('Renommer')],
      ['Suppr', t('Mettre à la corbeille')],
    ],
  },
  {
    group: t('Fichiers'),
    keys: [
      ['Entrée', t('Ouvrir')],
      ['Espace', t('Sélectionner')],
      ['Ctrl+A', t('Tout sélectionner')],
      ['Ctrl+C · Ctrl+X · Ctrl+V', t('Copier, couper, coller')],
      ['Ctrl+D', t('Dupliquer')],
      ['F2', t('Renommer')],
      ['Suppr', t('Mettre à la corbeille')],
      ['Retour arrière', t('Dossier parent')],
      ['← →', t('Fichier précédent, suivant (aperçu)')],
    ],
  },
  {
    group: t('Enregistrer'),
    keys: [['M', t('Marquer un moment important')]],
  },
  {
    group: t('Corbeille'),
    keys: [
      ['Entrée', t('Aperçu||d’un fichier')],
      ['↑ ↓', t('Élément précédent, suivant')],
      ['Ctrl+A', t('Tout sélectionner')],
      ['Suppr', t('Supprimer définitivement')],
    ],
  },
  {
    group: t('Souris'),
    keys: [
      ['Double-clic', t('Ouvrir un fichier ou un dossier')],
      ['Clic droit', t('Plus d’options')],
      ['Ctrl+clic', t('Sélectionner plusieurs éléments')],
      ['Maj+clic', t('Sélectionner une suite d’éléments')],
      ['Glisser', t('Ranger dans un dossier, déplacer un événement')],
      ['Alt+glisser', t('Copier au lieu de déplacer (Fichiers)')],
    ],
  },
];

/** Typed at the start of a line (or around a word) in a note: Kompaly turns it into the formatting. */
export const MARKDOWN: [string, string][] = [
  ['#', t('Titre')],
  ['##', t('Sous-titre')],
  ['-', t('Liste à puces')],
  ['1.', t('Liste numérotée')],
  ['[ ]', t('Case à cocher')],
  ['>', t('Citation')],
  ['`code`', t('Code')],
  ['**texte**', t('Gras')],
  ['==texte==', t('Surligné')],
  ['~~texte~~', t('Barré')],
];

/** Fingers: what a phone or a tablet does without a keyboard. */
export const GESTURES: { group: string; keys: [string, string][] }[] = [
  {
    group: t('Barre du bas'),
    keys: [
      [t('Glisser le doigt sur la barre'), t('Passer d’un espace à l’autre')],
      [t('Glisser jusqu’à « Plus », puis sur un espace'), t('Ouvrir Enregistrer, les groupes, la corbeille…')],
    ],
  },
  {
    group: t('Partout'),
    keys: [
      [t('Appui long'), t('Plus d’options (renommer, déplacer, favori…)')],
      [t('Toucher Kompaly'), t('Discuter avec lui')],
      [t('Faire glisser Kompaly le long du bord'), t('Le déplacer')],
    ],
  },
  {
    group: t('Notes et fichiers'),
    keys: [[t('Appui long, puis toucher les autres'), t('Sélectionner plusieurs éléments')]],
  },
  {
    group: t('Calendrier'),
    keys: [[t('Appui long sur un événement, puis glisser'), t('Le changer de jour ou d’heure')]],
  },
  {
    group: t('Nouveautés'),
    keys: [[t('Balayer vers la gauche ou la droite'), t('Page suivante, précédente')]],
  },
];

// Translated names of the keys; a Mac shows its symbols instead.
const KEY_NAMES: Record<string, [string, string]> = {
  Ctrl: [t('Ctrl'), '⌘'],
  Alt: ['Alt', '⌥'],
  Maj: [t('Maj'), '⇧'],
  Entrée: [t('Entrée'), '↩'],
  Espace: [t('Espace'), t('Espace')],
  Échap: [t('Échap'), t('Échap')],
  Suppr: [t('Suppr'), '⌘⌫'],
  'Retour arrière': [t('Retour arrière'), '⌫'],
  clic: [t('clic'), t('clic')],
  glisser: [t('glisser'), t('glisser')],
  'Double-clic': [t('Double-clic'), t('Double-clic')],
  'Clic droit': [t('Clic droit'), t('Clic droit')],
  Glisser: [t('Glisser'), t('Glisser')],
};

/** « Ctrl+Maj+Z · / » → one chip per way of doing it (« Ctrl + Maj + Z », « ⌘⇧Z » on a Mac), « G, A » → G puis A. */
export function keyChips(spec: string, mac = IS_MAC) {
  return spec.split(' · ').map(way =>
    way.split(', ').map(combo => {
      const keys = combo.split('+').map(k => KEY_NAMES[k]?.[mac ? 1 : 0] ?? k);
      // A Mac writes ⌘⇧Z in one piece, but « ⌘ clic ».
      return mac ? keys.join(keys.length > 1 && keys.at(-1)!.length > 1 ? ' ' : '') : keys.join(' + ');
    }),
  );
}
