import type { Usage } from '../../lib/usage';
import type { Make } from '../../store/recorder';
import { useSettings } from '../../store/settings';

/** The words of the « Enregistrer » page that follow the account's usage: a class, a work meeting, anything else. */
export interface RecWords {
  /** Name field (also its placeholder) and the title used when it is left empty. */
  name: string; fallback: string;
  /** The written document: « Le cours », « Le compte rendu »… and « du cours » in « 2 parties du cours déjà rédigées ». */
  doc: string; ofDoc: string; docDone: string; where: string; finish: string;
  history: string; keywordHint: string;
  /** A keyword and its plural, to show that one catches the other. */
  plural: [string, string];
  /** The two extra documents: short (chips, compact buttons), long (Done view), and the « Créer… » buttons. */
  short: Record<Make, string>; long: Record<Make, string>; create: Record<Make, string>; createLong: Record<Make, string>;
  /** The Drive's right-click on a document. */
  menu: Record<Make, string>;
}

const PRO = {
  short: { fiche: 'Résumé', examen: 'Questions' },
  long: { fiche: 'Résumé', examen: 'Questions de compréhension' },
  create: { fiche: 'Créer le résumé', examen: 'Créer les questions' },
  createLong: { fiche: 'Créer le résumé', examen: 'Créer les questions de compréhension' },
  menu: { fiche: 'Faire un résumé', examen: 'Faire des questions de compréhension' },
};

export const REC_WORDS: Record<Usage, RecWords> = {
  etudes: {
    name: 'Nom du cours', fallback: 'Cours',
    doc: 'Le cours', ofDoc: 'du cours', docDone: 'Le cours rédigé', where: 'Où ranger le cours ?', finish: 'Le cours sera rédigé et rangé dans ton Drive.',
    history: 'Cours enregistrés', keywordHint: 'Ex. ton prénom, « exposé »', plural: ['examen', 'examens'],
    short: { fiche: 'Fiche de révision', examen: 'Examen' },
    long: { fiche: 'Fiche de révision', examen: 'Examen d’entraînement' },
    create: { fiche: 'Créer la fiche', examen: 'Créer l’examen' },
    createLong: { fiche: 'Créer la fiche', examen: 'Créer l’examen d’entraînement' },
    menu: { fiche: 'Faire une fiche de révision', examen: 'Faire un examen d’entraînement' },
  },
  travail: {
    name: 'Nom de la réunion', fallback: 'Réunion',
    doc: 'Le compte rendu', ofDoc: 'du compte rendu', docDone: 'Le compte rendu rédigé', where: 'Où ranger le compte rendu ?',
    finish: 'Le compte rendu sera rédigé et rangé dans ton Drive.',
    history: 'Réunions enregistrées', keywordHint: 'Ex. ton prénom, « budget »', plural: ['réunion', 'réunions'],
    ...PRO,
  },
  perso: {
    name: 'Titre de l’enregistrement', fallback: 'Enregistrement',
    doc: 'Le document', ofDoc: 'du document', docDone: 'Le document rédigé', where: 'Où ranger le document ?', finish: 'Le document sera rédigé et rangé dans ton Drive.',
    history: 'Enregistrements passés', keywordHint: 'Ex. ton prénom, « billet »', plural: ['billet', 'billets'],
    ...PRO,
  },
};

export const recWords = (usage: Usage | undefined) => REC_WORDS[usage ?? 'etudes'] ?? REC_WORDS.etudes;

/** The words for the signed-in account. */
export const useRecWords = () => recWords(useSettings(s => s.usage));
