import { CATEGORIES, CATEGORY_LABELS, type BuiltinCategory } from '../store/calendar';

/** What the account is for, chosen in the welcome questionnaire. It only changes words and starter content. */
export type Usage = 'etudes' | 'travail' | 'perso';

export const USAGES: { key: Usage; label: string; hint: string }[] = [
  { key: 'etudes', label: 'Mes études', hint: 'Cours, partiels, révisions, exposés de groupe' },
  { key: 'travail', label: 'Mon travail', hint: 'Réunions, devis, échéances, projets d’équipe' },
  { key: 'perso', label: 'Ma vie perso', hint: 'Rendez-vous, papiers, projets, à-faire du quotidien' },
];

/** The few words that differ from one usage to the other. */
export const WORDS: Record<Usage, {
  nextBig: string; noBig: string; plan: string; planned: string;
  school: string; schoolHint: string; program: string; programHint: string; level: string; levels: string[];
  groups: string; profileTab: string;
  /** Calendar: example in the quick add, empty « À venir », the box that ticks a deliverable, timetable slots. */
  quickExample: string; markDone: string; slot: string; slots: string;
  /** Calendar: the .ics import (a timetable from the school's ENT, or any agenda), examples of the event form and of a category. */
  timetable: string; icsFrom: string; titleExample: string; notesExample: string; categoryExample: string; categoryHint: string;
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
    nextBig: 'Prochain examen', noBig: 'Aucun examen à venir.', plan: 'Planifier les révisions', planned: 'Révisions planifiées',
    school: 'Établissement', schoolHint: 'Université, école…', program: 'Filière', programHint: 'Droit, info, médecine…',
    level: 'Année', levels: ['', 'Lycée', 'L1', 'L2', 'L3', 'M1', 'M2', 'BTS / BUT', 'Prépa', 'École', 'Doctorat', 'Autre'],
    groups: 'Groupes', profileTab: 'Études',
    quickExample: 'Partiel de maths vendredi 14h', markDone: 'rendu', slot: 'cours', slots: 'cours',
    timetable: 'emploi du temps', icsFrom: 'ton ENT ou Google Agenda', titleExample: 'Partiel de maths', notesExample: 'salle, chapitres à réviser…',
    categoryExample: 'Stage, Asso, Job…', categoryHint: 'Stage chez Airbus',
    bigNoted: 'Examen noté', prepare: 'des révisions',
    pastOne: 'examen passé', pastMany: 'examens passés', upcoming: 'Tes prochains examens', bigOne: 'examen', bigMany: 'examens',
    none: 'aucun', it: 'le', subject: 'matière',
    sharedFiles: 'Cours, sujets, corrigés…', tagExample: 'Partiels',
    recording: { a: 'un cours', what: 'cours', doc: 'le cours rédigé', sheet: 'la fiche de révision', exam: 'l’examen d’entraînement' },
  },
  travail: {
    nextBig: 'Prochaine échéance', noBig: 'Aucune échéance à venir.', plan: 'Bloquer du temps pour préparer', planned: 'Préparation planifiée',
    school: 'Entreprise', schoolHint: 'Nom de l’entreprise', program: 'Métier', programHint: 'Graphiste, commercial…',
    level: 'Statut', levels: ['', 'Indépendant·e / freelance', 'Salarié·e', 'Dirigeant·e', 'Association', 'Autre'],
    groups: 'Équipes', profileTab: 'Travail',
    quickExample: 'Réunion client jeudi 10h', markDone: 'fait', slot: 'créneau', slots: 'créneaux',
    timetable: 'agenda', icsFrom: 'Outlook, Google Agenda ou Apple Calendrier', titleExample: 'Réunion client', notesExample: 'lieu, ordre du jour…',
    categoryExample: 'Projet, Formation, Salon…', categoryHint: 'Formation Excel',
    bigNoted: 'Échéance notée', prepare: 'du temps pour préparer',
    pastOne: 'échéance passée', pastMany: 'échéances passées', upcoming: 'Tes prochaines échéances', bigOne: 'échéance', bigMany: 'échéances',
    none: 'aucune', it: 'la', subject: 'sujet',
    sharedFiles: 'Devis, présentations, comptes rendus…', tagExample: 'Clients',
    recording: { a: 'une réunion', what: 'réunion', doc: 'le compte rendu', sheet: 'le résumé', exam: 'les questions de compréhension' },
  },
  perso: {
    nextBig: 'Prochain grand jour', noBig: 'Rien d’important à venir.', plan: 'Bloquer du temps pour préparer', planned: 'Préparation planifiée',
    school: 'Ville', schoolHint: 'Lyon, Lille…', program: 'Centres d’intérêt', programHint: 'Cuisine, sport, voyages…',
    level: 'Situation', levels: ['', 'Étudiant·e', 'En activité', 'En recherche', 'Parent', 'Retraité·e', 'Autre'],
    groups: 'Groupes', profileTab: 'Organisation',
    quickExample: 'Dentiste mardi 17h30', markDone: 'fait', slot: 'rendez-vous', slots: 'rendez-vous',
    timetable: 'agenda', icsFrom: 'Google Agenda, Outlook ou Apple Calendrier', titleExample: 'Dentiste', notesExample: 'adresse, choses à apporter…',
    categoryExample: 'Famille, Vacances, Asso…', categoryHint: 'Vacances à Biarritz',
    bigNoted: 'C’est noté', prepare: 'du temps pour préparer',
    pastOne: 'grand jour passé', pastMany: 'grands jours passés', upcoming: 'Tes prochains grands jours', bigOne: 'grand jour', bigMany: 'grands jours',
    none: 'aucun', it: 'le', subject: 'sujet',
    sharedFiles: 'Photos, papiers, billets…', tagExample: 'Papiers',
    recording: { a: 'une conférence, un podcast ou une vidéo', what: 'enregistrement', doc: 'le texte rédigé', sheet: 'le résumé', exam: 'le quiz' },
  },
};

/** The words of an account's usage (studies when unknown). */
export const usageWords = (usage: Usage | undefined) => WORDS[usage ?? 'etudes'] ?? WORDS.etudes;

/**
 * shortcut: the category labels are swapped in place on the shared CATEGORIES object instead of a hook in every
 * component. Fine because the usage is set before the app shows any page (load / welcome) and rarely changes after.
 */
export function applyUsage(usage: Usage) {
  for (const [key, label] of Object.entries(CATEGORY_LABELS[usage] ?? CATEGORY_LABELS.etudes)) CATEGORIES[key as BuiltinCategory].label = label;
}

/** Shared spaces (« Groupes »): what the space and its meetings are called, with French agreement baked in. */
export interface GroupWords {
  Groups: string; groups: string; a: string; the: string; The: string; of: string; this: string; all: string; none: string; yours: string;
  created: string; deleted: string; namePlaceholder: string; mates: string; others: string; introTitle: string; introText: string; notesHint: string;
  /** The meetings planned together (study sessions, work meetings, get-togethers). */
  meet: {
    Tab: string; One: string; many: string; a: string; the: string; The: string; proposed: string; proposedMany: string; none: string; placeholder: string; hint: string;
  };
}

export const GROUP_WORDS: Record<Usage, GroupWords> = {
  etudes: {
    Groups: 'Groupes', groups: 'groupes', a: 'un groupe', the: 'le groupe', The: 'Le groupe', of: 'du groupe', this: 'ce groupe', all: 'tout le groupe',
    none: 'Aucun groupe', yours: 'un de tes groupes', created: 'Groupe créé', deleted: 'Groupe supprimé',
    namePlaceholder: 'Ex. L2 Bio — TD 3', mates: 'tes camarades', others: 'd’autres étudiants',
    introTitle: 'Travaille avec ta promo', introText: 'Notes partagées et séances de révision en commun, avec ceux qui ont le code du groupe.',
    notesHint: 'Commence une fiche de révision que tout le monde peut compléter, ou partage une note que tu as déjà écrite.',
    meet: {
      Tab: 'Révisions', One: 'Révision', many: 'révisions', a: 'une révision', the: 'la révision', The: 'La révision', proposed: 'Révision proposée', proposedMany: 'proposées',
      none: 'Aucune révision prévue', placeholder: 'Ex. Révision partiel d’anatomie',
      hint: 'Propose une séance à la BU ou en visio : chaque membre indique s’il vient et peut l’ajouter à son calendrier.',
    },
  },
  travail: {
    Groups: 'Équipes', groups: 'équipes', a: 'une équipe', the: 'l’équipe', The: 'L’équipe', of: 'de l’équipe', this: 'cette équipe', all: 'toute l’équipe',
    none: 'Aucune équipe', yours: 'une de tes équipes', created: 'Équipe créée', deleted: 'Équipe supprimée',
    namePlaceholder: 'Ex. Équipe marketing, Projet Dupont', mates: 'tes collègues', others: 'tes collègues',
    introTitle: 'Travaille avec ton équipe', introText: 'Notes, fichiers et réunions partagés, avec ceux qui ont le code de l’équipe.',
    notesHint: 'Commence une note que toute l’équipe peut compléter (compte rendu, procédure…), ou partage une note que tu as déjà écrite.',
    meet: {
      Tab: 'Réunions', One: 'Réunion', many: 'réunions', a: 'une réunion', the: 'la réunion', The: 'La réunion', proposed: 'Réunion proposée', proposedMany: 'proposées',
      none: 'Aucune réunion prévue', placeholder: 'Ex. Point hebdo projet',
      hint: 'Propose une réunion en salle ou en visio : chaque membre indique s’il vient et peut l’ajouter à son calendrier.',
    },
  },
  perso: {
    Groups: 'Groupes', groups: 'groupes', a: 'un groupe', the: 'le groupe', The: 'Le groupe', of: 'du groupe', this: 'ce groupe', all: 'tout le groupe',
    none: 'Aucun groupe', yours: 'un de tes groupes', created: 'Groupe créé', deleted: 'Groupe supprimé',
    namePlaceholder: 'Ex. Famille, Coloc, Asso du quartier', mates: 'tes proches', others: 'tes proches',
    introTitle: 'Organise-toi à plusieurs', introText: 'Notes, fichiers et rendez-vous partagés, avec ceux qui ont le code du groupe.',
    notesHint: 'Commence une note que tout le monde peut compléter (courses, organisation d’un week-end…), ou partage une note que tu as déjà écrite.',
    meet: {
      Tab: 'Rendez-vous', One: 'Rendez-vous', many: 'rendez-vous', a: 'un rendez-vous', the: 'le rendez-vous', The: 'Le rendez-vous', proposed: 'Rendez-vous proposé', proposedMany: 'proposés',
      none: 'Aucun rendez-vous prévu', placeholder: 'Ex. Repas de famille',
      hint: 'Propose un rendez-vous : chaque membre indique s’il vient et peut l’ajouter à son calendrier.',
    },
  },
};

/** « Agendas partagés » : a shared calendar is a group of another kind (lib/groups › GroupKind), same screens. */
/** A shared calendar (coloc, famille…) is not about classes or work: its own examples in the event form and the quick add. */
export const AGENDA_EXAMPLES = { titleExample: 'Dîner chez Léa', notesExample: 'adresse, choses à apporter…', quickExample: 'Dîner chez Léa samedi 20h' };

export const AGENDA_WORDS: GroupWords = {
  Groups: 'Agendas partagés', groups: 'agendas partagés', a: 'un agenda partagé', the: 'l’agenda', The: 'L’agenda', of: 'de l’agenda', this: 'cet agenda', all: 'tout l’agenda',
  none: 'Aucun agenda partagé', yours: 'un de tes agendas', created: 'Agenda créé', deleted: 'Agenda supprimé',
  namePlaceholder: 'Ex. Coloc, Famille, Nous deux', mates: 'ceux avec qui tu le partages', others: 'tes proches',
  introTitle: 'Un agenda à plusieurs', introText: 'Un calendrier commun, séparé du tien : chacun y ajoute ses événements, les autres les voient et reçoivent une notification.',
  notesHint: '',
  meet: {
    Tab: 'Agenda', One: 'Événement', many: 'événements', a: 'un événement', the: 'l’événement', The: 'L’événement', proposed: 'Événement ajouté', proposedMany: 'ajoutés',
    none: 'Aucun événement prévu', placeholder: 'Ex. Dîner chez Léa',
    hint: 'Ajoute un événement : les autres membres le voient tout de suite et reçoivent une notification.',
  },
};

export const groupWords = (usage: Usage | undefined) => GROUP_WORDS[usage ?? 'etudes'] ?? GROUP_WORDS.etudes;
