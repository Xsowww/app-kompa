import type { Usage } from '../../lib/usage';
import type { Make } from '../../store/recorder';
import { useSettings } from '../../store/settings';
import { t } from '../../i18n';

/** The words of the « Enregistrer » page that follow the account's usage: a class, a work meeting, anything else. */
export interface RecWords {
  /** Name field (also its placeholder) and the title used when it is left empty. */
  name: string; fallback: string;
  /** The written document: « Le cours », « Le compte rendu »… and « du cours » in « 2 parties du cours déjà rédigées ». */
  doc: string; ofDoc: string; docDone: string; where: string; finish: string;
  history: string; keywordHint: string;
  /** The two extra documents: short (chips, compact buttons), long (Done view), and the « Créer… » buttons. */
  short: Record<Make, string>; long: Record<Make, string>;
  /** The long names inside a sentence (« Kompaly prépare : fiche de révision… »). */
  inText: Record<Make, string>; create: Record<Make, string>; createLong: Record<Make, string>;
  /** The Drive's right-click on a document. */
  menu: Record<Make, string>;
}

const PRO = {
  short: { fiche: t('Résumé'), examen: t('Questions') },
  long: { fiche: t('Résumé'), examen: t('Questions de compréhension') },
  inText: { fiche: t('résumé'), examen: t('questions de compréhension') },
  create: { fiche: t('Créer le résumé'), examen: t('Créer les questions') },
  createLong: { fiche: t('Créer le résumé'), examen: t('Créer les questions de compréhension') },
  menu: { fiche: t('Faire un résumé'), examen: t('Faire des questions de compréhension') },
};

export const REC_WORDS: Record<Usage, RecWords> = {
  etudes: {
    name: t('Nom du cours'), fallback: t('Cours'),
    doc: t('Le cours'), ofDoc: t('du cours'), docDone: t('Le cours rédigé'), where: t('Où ranger le cours ?'), finish: t('Le cours sera rédigé et rangé dans ton Drive.'),
    history: t('Cours enregistrés'), keywordHint: t('Ex. ton prénom, « exposé »'),
    short: { fiche: t('Fiche de révision'), examen: t('Examen') },
    long: { fiche: t('Fiche de révision'), examen: t('Examen d’entraînement') },
    inText: { fiche: t('fiche de révision'), examen: t('examen d’entraînement') },
    create: { fiche: t('Créer la fiche'), examen: t('Créer l’examen') },
    createLong: { fiche: t('Créer la fiche'), examen: t('Créer l’examen d’entraînement') },
    menu: { fiche: t('Faire une fiche de révision'), examen: t('Faire un examen d’entraînement') },
  },
  travail: {
    name: t('Nom de la réunion'), fallback: t('Réunion'),
    doc: t('Le compte rendu'), ofDoc: t('du compte rendu'), docDone: t('Le compte rendu rédigé'), where: t('Où ranger le compte rendu ?'),
    finish: t('Le compte rendu sera rédigé et rangé dans ton Drive.'),
    history: t('Réunions enregistrées'), keywordHint: t('Ex. ton prénom, « budget »'),
    ...PRO,
  },
  perso: {
    name: t('Titre de l’enregistrement'), fallback: t('Enregistrement'),
    doc: t('Le document'), ofDoc: t('du document'), docDone: t('Le document rédigé'), where: t('Où ranger le document ?'), finish: t('Le document sera rédigé et rangé dans ton Drive.'),
    history: t('Enregistrements passés'), keywordHint: t('Ex. ton prénom, « billet »'),
    ...PRO,
  },
};

export const recWords = (usage: Usage | undefined) => REC_WORDS[usage ?? 'etudes'] ?? REC_WORDS.etudes;

/** The words for the signed-in account. */
export const useRecWords = () => recWords(useSettings(s => s.usage));
