import { t } from '../i18n';

/** What the account is for, chosen in the welcome questionnaire. It only changes words and starter content. */
export type Usage = 'etudes' | 'travail' | 'perso';

export const USAGES: { key: Usage; label: string; hint: string }[] = [
  { key: 'etudes', label: t('Mes études'), hint: t('Cours, partiels, révisions, exposés de groupe') },
  { key: 'travail', label: t('Mon travail'), hint: t('Réunions, devis, échéances, projets d’équipe') },
  { key: 'perso', label: t('Ma vie perso'), hint: t('Rendez-vous, papiers, projets, à-faire du quotidien') },
];

/** The few words that differ from one usage to the other. */
export const WORDS: Record<Usage, {
  nextBig: string; noBig: string; plan: string; planned: string;
  school: string; schoolHint: string; program: string; programHint: string; level: string; levels: string[];
  groups: string; profileTab: string;
  /** Calendar: example in the quick add, empty « À venir », the box that ticks a deliverable, timetable slots. */
  quickExample: string; markDone: string; slot: string; slots: string;
  /** Calendar: the .ics import (a timetable from the school's ENT, or any agenda), examples of the event form and of a category. */
  timetable: string; titleExample: string; notesExample: string; categoryExample: string; categoryHint: string;
  /** Kompaly's message when a big event (exam, deadline…) is added. */
  bigNoted: string; prepare: string;
  /** Profile stats and Kompaly's lists: big events past (one / many) and coming up. */
  pastOne: string; pastMany: string; upcoming: string; bigOne: string; bigMany: string;
  /** Agreement with bigOne (« aucun examen… ajoute-le », « aucune échéance… ajoute-la »). */
  none: string; it: string;
  /** What a focus session is about (« Par matière », « Sans sujet »). */
  subject: string;
  /** Shared files of a group (empty list) and an example of a Drive tag. */
  sharedFiles: string; tagExample: string;
  /** « Enregistrer » (/enregistrer): what is recorded, and the documents the AI writes from it (see server/cours.mjs › SYSTEMS). */
  recording: { a: string; what: string; doc: string; sheet: string; exam: string };
}> = {
  etudes: {
    nextBig: t('Prochain examen'), noBig: t('Aucun examen à venir.'), plan: t('Planifier les révisions'), planned: t('Révisions planifiées'),
    school: t('Établissement'), schoolHint: t('Université, école…'), program: t('Filière'), programHint: t('Droit, info, médecine…'),
    level: t('Année'), levels: ['', t('Lycée'), t('L1'), t('L2'), t('L3'), t('M1'), t('M2'), t('BTS / BUT'), t('Prépa'), t('École'), t('Doctorat'), t('Autre')],
    groups: t('Groupes'), profileTab: t('Études'),
    quickExample: t('Partiel de maths vendredi 14h'), markDone: t('rendu'), slot: t('cours'), slots: t('cours||pluriel'),
    timetable: t('emploi du temps'), titleExample: t('Partiel de maths'), notesExample: t('salle, chapitres à réviser…'),
    categoryExample: t('Stage, Asso, Job…'), categoryHint: t('Stage chez Airbus'),
    bigNoted: t('Examen noté'), prepare: t('des révisions'),
    pastOne: t('examen passé'), pastMany: t('examens passés'), upcoming: t('Tes prochains examens'), bigOne: t('examen'), bigMany: t('examens'),
    none: t('aucun'), it: t('le'), subject: t('matière'),
    sharedFiles: t('Cours, sujets, corrigés…'), tagExample: t('Partiels'),
    recording: { a: t('un cours'), what: t('cours'), doc: t('le cours rédigé'), sheet: t('la fiche de révision'), exam: t('l’examen d’entraînement') },
  },
  travail: {
    nextBig: t('Prochaine échéance'), noBig: t('Aucune échéance à venir.'), plan: t('Bloquer du temps pour préparer'), planned: t('Préparation planifiée'),
    school: t('Entreprise'), schoolHint: t('Nom de l’entreprise'), program: t('Métier'), programHint: t('Graphiste, commercial…'),
    level: t('Statut'), levels: ['', t('Indépendant·e / freelance'), t('Salarié·e'), t('Dirigeant·e'), t('Association'), t('Autre')],
    groups: t('Équipes'), profileTab: t('Travail'),
    quickExample: t('Réunion client jeudi 10h'), markDone: t('fait'), slot: t('créneau'), slots: t('créneaux'),
    timetable: t('agenda'), titleExample: t('Réunion client'), notesExample: t('lieu, ordre du jour…'),
    categoryExample: t('Projet, Formation, Salon…'), categoryHint: t('Formation Excel'),
    bigNoted: t('Échéance notée'), prepare: t('du temps pour préparer'),
    pastOne: t('échéance passée'), pastMany: t('échéances passées'), upcoming: t('Tes prochaines échéances'), bigOne: t('échéance'), bigMany: t('échéances'),
    none: t('aucune'), it: t('la'), subject: t('sujet'),
    sharedFiles: t('Devis, présentations, comptes rendus…'), tagExample: t('Clients'),
    recording: { a: t('une réunion'), what: t('réunion'), doc: t('le compte rendu'), sheet: t('le résumé'), exam: t('les questions de compréhension') },
  },
  perso: {
    nextBig: t('Prochain grand jour'), noBig: t('Rien d’important à venir.'), plan: t('Bloquer du temps pour préparer'), planned: t('Préparation planifiée'),
    school: t('Ville'), schoolHint: t('Lyon, Lille…'), program: t('Centres d’intérêt'), programHint: t('Cuisine, sport, voyages…'),
    level: t('Situation'), levels: ['', t('Étudiant·e'), t('En activité'), t('En recherche'), t('Parent'), t('Retraité·e'), t('Autre')],
    groups: t('Groupes'), profileTab: t('Organisation||onglet du profil, court'),
    quickExample: t('Dentiste mardi 17h30'), markDone: t('fait'), slot: t('rendez-vous'), slots: t('rendez-vous||pluriel'),
    timetable: t('agenda'), titleExample: t('Dentiste'), notesExample: t('adresse, choses à apporter…'),
    categoryExample: t('Famille, Vacances, Asso…'), categoryHint: t('Vacances à Biarritz'),
    bigNoted: t('C’est noté'), prepare: t('du temps pour préparer'),
    pastOne: t('grand jour passé'), pastMany: t('grands jours passés'), upcoming: t('Tes prochains grands jours'), bigOne: t('grand jour'), bigMany: t('grands jours'),
    none: t('aucun'), it: t('le'), subject: t('sujet'),
    sharedFiles: t('Photos, papiers, billets…'), tagExample: t('Papiers'),
    recording: { a: t('une conférence, un podcast ou une vidéo'), what: t('enregistrement'), doc: t('le texte rédigé'), sheet: t('le résumé'), exam: t('le quiz') },
  },
};

/** The words of an account's usage (studies when unknown). */
export const usageWords = (usage: Usage | undefined) => WORDS[usage ?? 'etudes'] ?? WORDS.etudes;

/** Shared spaces (« Groupes »): what the space and its meetings are called, with French agreement baked in. */
export interface GroupWords {
  Groups: string; groups: string; a: string; the: string; The: string; of: string; this: string; all: string; none: string; yours: string;
  created: string; deleted: string; namePlaceholder: string; introTitle: string; introText: string;
  /** The meetings planned together (study sessions, work meetings, get-togethers). */
  meet: {
    Tab: string; One: string; one: string; many: string; a: string; the: string; The: string; proposed: string; proposedMany: string; none: string; placeholder: string;
  };
}

export const GROUP_WORDS: Record<Usage, GroupWords> = {
  etudes: {
    Groups: t('Groupes'), groups: t('groupes'), a: t('un groupe'), the: t('le groupe'), The: t('Le groupe'), of: t('du groupe'), this: t('ce groupe'), all: t('tout le groupe'),
    none: t('Aucun groupe'), yours: t('un de tes groupes'), created: t('Groupe créé'), deleted: t('Groupe supprimé'),
    namePlaceholder: t('Ex. L2 Bio — TD 3'),
    introTitle: t('Travaille avec ta promo'), introText: t('Notes partagées et séances de révision en commun, avec ceux qui ont le code du groupe.'),
    meet: {
      Tab: t('Révisions'), One: t('Révision'), one: t('révision'), many: t('révisions'), a: t('une révision'), the: t('la révision'), The: t('La révision'), proposed: t('Révision proposée'), proposedMany: t('proposées'),
      none: t('Aucune révision prévue'), placeholder: t('Ex. Révision partiel d’anatomie'),
    },
  },
  travail: {
    Groups: t('Équipes'), groups: t('équipes'), a: t('une équipe'), the: t('l’équipe'), The: t('L’équipe'), of: t('de l’équipe'), this: t('cette équipe'), all: t('toute l’équipe'),
    none: t('Aucune équipe'), yours: t('une de tes équipes'), created: t('Équipe créée'), deleted: t('Équipe supprimée'),
    namePlaceholder: t('Ex. Équipe marketing, Projet Dupont'),
    introTitle: t('Travaille avec ton équipe'), introText: t('Notes, fichiers et réunions partagés, avec ceux qui ont le code de l’équipe.'),
    meet: {
      Tab: t('Réunions'), One: t('Réunion'), one: t('réunion'), many: t('réunions'), a: t('une réunion'), the: t('la réunion'), The: t('La réunion'), proposed: t('Réunion proposée'), proposedMany: t('proposées'),
      none: t('Aucune réunion prévue'), placeholder: t('Ex. Point hebdo projet'),
    },
  },
  perso: {
    Groups: t('Groupes'), groups: t('groupes'), a: t('un groupe'), the: t('le groupe'), The: t('Le groupe'), of: t('du groupe'), this: t('ce groupe'), all: t('tout le groupe'),
    none: t('Aucun groupe'), yours: t('un de tes groupes'), created: t('Groupe créé'), deleted: t('Groupe supprimé'),
    namePlaceholder: t('Ex. Famille, Coloc, Asso du quartier'),
    introTitle: t('Organise-toi à plusieurs'), introText: t('Notes, fichiers et rendez-vous partagés, avec ceux qui ont le code du groupe.'),
    meet: {
      Tab: t('Rendez-vous'), One: t('Rendez-vous||un seul'), one: t('rendez-vous'), many: t('rendez-vous||pluriel'), a: t('un rendez-vous'), the: t('le rendez-vous'), The: t('Le rendez-vous'), proposed: t('Rendez-vous proposé'), proposedMany: t('proposés'),
      none: t('Aucun rendez-vous prévu'), placeholder: t('Ex. Repas de famille'),
    },
  },
};

/** « Agendas partagés » : a shared calendar is a group of another kind (lib/groups › GroupKind), same screens. */
/** A shared calendar (coloc, famille…) is not about classes or work: its own examples in the event form and the quick add. */
export const AGENDA_EXAMPLES = { titleExample: t('Dîner chez Léa'), notesExample: t('adresse, choses à apporter…'), quickExample: t('Dîner chez Léa samedi 20h'), categoryExample: t('Ménage, Sorties, Courses…'), categoryHint: t('Ménage de la cuisine') };

export const AGENDA_WORDS: GroupWords = {
  Groups: t('Agendas partagés'), groups: t('agendas partagés'), a: t('un agenda partagé'), the: t('l’agenda'), The: t('L’agenda'), of: t('de l’agenda'), this: t('cet agenda'), all: t('tout l’agenda'),
  none: t('Aucun agenda partagé'), yours: t('un de tes agendas'), created: t('Agenda créé'), deleted: t('Agenda supprimé'),
  namePlaceholder: t('Ex. Coloc, Famille, Nous deux'),
  introTitle: t('Un agenda à plusieurs'), introText: t('Un calendrier commun, séparé du tien : chacun y ajoute ses événements, les autres sont prévenus.'),
  meet: {
    Tab: t('Agenda'), One: t('Événement'), one: t('événement'), many: t('événements'), a: t('un événement'), the: t('l’événement'), The: t('L’événement'), proposed: t('Événement ajouté'), proposedMany: t('ajoutés'),
    none: t('Aucun événement prévu'), placeholder: t('Ex. Dîner chez Léa'),
  },
};

export const groupWords = (usage: Usage | undefined) => GROUP_WORDS[usage ?? 'etudes'] ?? GROUP_WORDS.etudes;
