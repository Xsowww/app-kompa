import { Briefcase, CalendarClock, ListOrdered, Plane, Presentation, ShoppingCart, Sprout, TrendingUp, Users, Wallet, type LucideIcon } from 'lucide-react';
import { getSettings } from '../../store/settings';
import type { Usage } from '../../lib/usage';
import { t, locale } from '../../i18n';

/** Ready-made note structures (in the site's language). `html()` is called at creation so dates are current. */
export interface NoteTemplate {
  id: string;
  label: string;
  /** One line shown in the « Nouvelle note » menu. */
  hint: string;
  /** Default note title. */
  title: string;
  html: () => string;
  /** Icon in the « Nouvelle note » menu (the study ones are chosen in NotesPage). */
  icon?: LucideIcon;
}

const today = () => new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const tasks = (items: string[]) =>
  `<ul data-type="taskList">${items.map(x => `<li data-type="taskItem" data-checked="false"><p>${x}</p></li>`).join('')}</ul>`;
const list = (items: string[]) => `<ul>${items.map(x => `<li><p>${x}</p></li>`).join('')}</ul>`;
const olist = (items: string[]) => `<ol>${items.map(x => `<li><p>${x}</p></li>`).join('')}</ol>`;

/** Studies. */
export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'vide',
    label: t('Note vide'),
    hint: t('Une page blanche'),
    title: t('Sans titre'),
    html: () => '',
  },
  {
    id: 'fiche',
    label: t('Fiche de révision'),
    hint: t('Notions, définitions, formules, auto-test'),
    title: t('Fiche de révision'),
    html: () =>
      [
        `<p><strong>${t('Matière :')}</strong> </p>`,
        `<p><strong>${t('Chapitre :')}</strong> </p>`,
        `<h2>${t('L’essentiel en 3 phrases')}</h2>`,
        olist(['', '', '']),
        `<h2>${t('Définitions')}</h2>`,
        list([`<strong>${t('Terme')}</strong> : `]),
        `<h2>${t('Formules et règles')}</h2>`,
        list(['']),
        `<h2>${t('Exemple type')}</h2>`,
        '<p></p>',
        `<h2>${t('Pièges à éviter')}</h2>`,
        list(['']),
        `<h2>${t('Je sais…')}</h2>`,
        tasks([t('Réciter les définitions sans regarder'), t('Refaire l’exemple type seul'), t('Expliquer le chapitre à quelqu’un en 2 minutes')]),
      ].join(''),
  },
  {
    id: 'tp',
    label: t('Compte rendu de TP'),
    hint: t('Objectif, protocole, résultats, analyse'),
    title: t('Compte rendu de TP'),
    html: () =>
      [
        `<p><strong>${t('Date :')}</strong> ${today()}</p>`,
        `<p><strong>${t('Binôme :')}</strong> </p>`,
        `<h2>${t('Objectif')}</h2>`,
        `<p>${t('Ce que le TP cherche à mesurer ou à montrer.')}</p>`,
        `<h2>${t('Matériel')}</h2>`,
        list(['']),
        `<h2>${t('Protocole')}</h2>`,
        olist(['']),
        `<h2>${t('Résultats')}</h2>`,
        `<p>${t('Mesures, tableaux, observations (avec unités et incertitudes).')}</p>`,
        `<h2>${t('Analyse')}</h2>`,
        `<p>${t('Interprétation, comparaison avec la théorie, sources d’erreur.')}</p>`,
        `<h2>${t('Conclusion')}</h2>`,
        '<p></p>',
        `<h2>${t('Avant de rendre')}</h2>`,
        tasks([t('Unités et chiffres significatifs vérifiés'), t('Schémas et graphiques légendés'), t('Noms du binôme sur la première page')]),
      ].join(''),
  },
  {
    id: 'dissertation',
    label: t('Plan de dissertation'),
    hint: t('Problématique et plan en deux ou trois parties'),
    title: t('Plan de dissertation'),
    html: () =>
      [
        `<p><strong>${t('Sujet :')}</strong> </p>`,
        `<h2>${t('Introduction')}</h2>`,
        list([`<strong>${t('Accroche')}</strong> : `, `<strong>${t('Définition des termes')}</strong> : `, `<strong>${t('Problématique')}</strong> : `, `<strong>${t('Annonce du plan')}</strong> : `]),
        '<h2>I. </h2>',
        list([`<strong>A.</strong> ${t('Argument — exemple')}`, `<strong>B.</strong> ${t('Argument — exemple')}`]),
        `<p><em>${t('Transition :')}</em> </p>`,
        '<h2>II. </h2>',
        list([`<strong>A.</strong> ${t('Argument — exemple')}`, `<strong>B.</strong> ${t('Argument — exemple')}`]),
        `<p><em>${t('Transition :')}</em> </p>`,
        '<h2>III. </h2>',
        list([`<strong>A.</strong> ${t('Argument — exemple')}`, `<strong>B.</strong> ${t('Argument — exemple')}`]),
        `<h2>${t('Conclusion')}</h2>`,
        list([`<strong>${t('Bilan')}</strong> : ${t('réponse à la problématique')}`, `<strong>${t('Ouverture')}</strong> : `]),
        `<h2>${t('Références à placer')}</h2>`,
        list(['']),
      ].join(''),
  },
  {
    id: 'cours',
    label: t('Cours magistral'),
    hint: t('Prise de notes structurée, questions, à retenir'),
    title: t('Cours'),
    html: () =>
      [
        `<p><strong>${t('Date :')}</strong> ${today()}</p>`,
        `<p><strong>${t('Enseignant :')}</strong> </p>`,
        `<h2>${t('Plan du cours')}</h2>`,
        olist(['']),
        `<h2>${t('Notes')}</h2>`,
        '<p></p>',
        `<h2>${t('À retenir')}</h2>`,
        `<blockquote><p>${t('Les 3 idées à savoir pour l’examen.')}</p></blockquote>`,
        `<h2>${t('Questions à poser')}</h2>`,
        list(['']),
        `<h2>${t('Après le cours')}</h2>`,
        tasks([t('Relire et compléter les notes le soir même'), t('Faire une fiche de révision'), t('Chercher les points non compris')]),
      ].join(''),
  },
  {
    id: 'expose',
    label: t('Exposé / oral'),
    hint: t('Déroulé minuté, répartition, répétitions'),
    title: t('Exposé'),
    html: () =>
      [
        `<p><strong>${t('Sujet :')}</strong> </p>`,
        `<p><strong>${t('Date de passage :')}</strong> </p>`,
        `<p><strong>${t('Durée :')}</strong> ${t('10 min + questions')}</p>`,
        `<h2>${t('Message principal')}</h2>`,
        `<p>${t('Ce que le public doit retenir en une phrase.')}</p>`,
        `<h2>${t('Déroulé')}</h2>`,
        olist([`<strong>${t('Introduction')}</strong> (1 min) — `, `<strong>${t('Partie 1')}</strong> (4 min) — `, `<strong>${t('Partie 2')}</strong> (4 min) — `, `<strong>${t('Conclusion')}</strong> (1 min) — `]),
        `<h2>${t('Qui fait quoi')}</h2>`,
        list(['']),
        `<h2>${t('Questions probables')}</h2>`,
        list(['']),
        `<h2>${t('Préparation')}</h2>`,
        tasks([t('Diapositives terminées'), t('Répétition chronométrée'), t('Répétition devant quelqu’un'), t('Support testé sur l’ordinateur de la salle')]),
      ].join(''),
  },
];

// \u00a0: French spacing that never breaks a line (« Date : », « Qui ? »).
const field = (label: string, value = '') => `<p><strong>${t('{label}\u00a0:', { label })}</strong> ${value}</p>`;

const BLANK = NOTE_TEMPLATES[0];

/** Work: meetings, projects, follow-up. */
const WORK_TEMPLATES: NoteTemplate[] = [
  BLANK,
  {
    id: 'compte-rendu',
    label: t('Compte rendu de réunion'),
    hint: t('Participants, décisions, actions à mener'),
    title: t('Compte rendu de réunion'),
    icon: Users,
    html: () =>
      [
        field(t('Date'), today()),
        field(t('Participants')),
        field(t('Objet')),
        `<h2>${t('Points abordés')}</h2>`,
        list(['']),
        `<h2>${t('Décisions')}</h2>`,
        list(['']),
        `<h2>${t('Actions')}</h2>`,
        tasks([t('Action — qui — pour quand')]),
        `<h2>${t('Prochaine réunion')}</h2>`,
        '<p></p>',
      ].join(''),
  },
  {
    id: 'ordre-du-jour',
    label: t('Ordre du jour'),
    hint: t('Points à traiter, durée, ce qu’il faut préparer'),
    title: t('Ordre du jour'),
    icon: ListOrdered,
    html: () =>
      [
        field(t('Réunion')),
        field(t('Date et heure')),
        field(t('Lieu ou lien')),
        field(t('Participants')),
        `<h2>${t('Objectif')}</h2>`,
        `<p>${t('Ce qu’on doit avoir décidé à la fin.')}</p>`,
        `<h2>${t('Points à traiter')}</h2>`,
        olist([`<strong>${t('Tour de table')}</strong> (5 min) — `, `<strong>${t('Point 1')}</strong> (15 min) — `, `<strong>${t('Point 2')}</strong> (15 min) — `, `<strong>${t('Prochaines étapes')}</strong> (5 min) — `]),
        `<h2>${t('À préparer avant')}</h2>`,
        tasks([t('Envoyer l’ordre du jour aux participants'), t('Documents à partager'), t('Salle ou lien de visio réservé')]),
      ].join(''),
  },
  {
    id: 'brief-projet',
    label: t('Brief de projet'),
    hint: t('Contexte, objectifs, livrables, échéances'),
    title: t('Brief de projet'),
    icon: Briefcase,
    html: () =>
      [
        field(t('Projet')),
        field(t('Client ou commanditaire')),
        field(t('Responsable')),
        `<h2>${t('Contexte')}</h2>`,
        `<p>${t('D’où vient le besoin, ce qui existe déjà.')}</p>`,
        `<h2>${t('Objectifs')}</h2>`,
        list(['']),
        `<h2>${t('Livrables')}</h2>`,
        list(['']),
        `<h2>${t('Échéances')}</h2>`,
        list([`<strong>${t('Lancement')}</strong>\u00a0: `, `<strong>${t('Point d’étape')}</strong>\u00a0: `, `<strong>${t('Livraison')}</strong>\u00a0: `]),
        `<h2>${t('Budget et moyens')}</h2>`,
        '<p></p>',
        `<h2>${t('Risques et questions ouvertes')}</h2>`,
        list(['']),
      ].join(''),
  },
  {
    id: 'point-hebdo',
    label: t('Point hebdo'),
    hint: t('Fait, en cours, bloquants, semaine prochaine'),
    title: t('Point hebdo'),
    icon: TrendingUp,
    html: () =>
      [
        field(t('Date'), today()),
        `<h2>${t('Fait cette semaine')}</h2>`,
        list(['']),
        `<h2>${t('En cours||ce qui avance, dans un point de la semaine')}</h2>`,
        list(['']),
        `<h2>${t('Bloquants')}</h2>`,
        list(['']),
        `<h2>${t('Semaine prochaine')}</h2>`,
        tasks(['']),
      ].join(''),
  },
  {
    id: 'presentation',
    label: t('Présentation'),
    hint: t('Message clé, déroulé minuté, questions probables'),
    title: t('Présentation'),
    icon: Presentation,
    html: () =>
      [
        field(t('Sujet')),
        field(t('Public')),
        field(t('Date')),
        field(t('Durée'), t('20 min + questions')),
        `<h2>${t('Message clé')}</h2>`,
        `<p>${t('Ce que le public doit retenir en une phrase.')}</p>`,
        `<h2>${t('Déroulé')}</h2>`,
        olist([`<strong>${t('Introduction')}</strong> (2 min) — `, `<strong>${t('Constat')}</strong> (5 min) — `, `<strong>${t('Proposition')}</strong> (10 min) — `, `<strong>${t('Prochaines étapes')}</strong> (3 min) — `]),
        `<h2>${t('Questions probables')}</h2>`,
        list(['']),
        `<h2>${t('Avant de présenter')}</h2>`,
        tasks([t('Support terminé'), t('Répétition chronométrée'), t('Support envoyé ou partagé')]),
      ].join(''),
  },
];

/** Personal life: lists, projects, trips, appointments, money. */
const PERSONAL_TEMPLATES: NoteTemplate[] = [
  BLANK,
  {
    id: 'courses',
    label: t('Liste de courses'),
    hint: t('Par rayon, à cocher au magasin'),
    title: t('Courses'),
    icon: ShoppingCart,
    html: () =>
      [
        `<h2>${t('Frais')}</h2>`,
        tasks(['']),
        `<h2>${t('Épicerie')}</h2>`,
        tasks(['']),
        `<h2>${t('Fruits et légumes')}</h2>`,
        tasks(['']),
        `<h2>${t('Maison')}</h2>`,
        tasks(['']),
      ].join(''),
  },
  {
    id: 'projet-perso',
    label: t('Projet perso'),
    hint: t('Objectif, étapes, budget, idées'),
    title: t('Projet perso'),
    icon: Sprout,
    html: () =>
      [
        field(t('Objectif')),
        field(t('Pour quand')),
        `<h2>${t('Pourquoi')}</h2>`,
        '<p></p>',
        `<h2>${t('Étapes')}</h2>`,
        tasks(['', '', '']),
        `<h2>${t('Budget')}</h2>`,
        list(['']),
        `<h2>${t('Idées et liens')}</h2>`,
        list(['']),
      ].join(''),
  },
  {
    id: 'voyage',
    label: t('Préparer un voyage'),
    hint: t('Trajets, hébergement, valise, programme'),
    title: t('Voyage'),
    icon: Plane,
    html: () =>
      [
        field(t('Destination')),
        field(t('Dates')),
        `<h2>${t('Trajets')}</h2>`,
        list([`<strong>${t('Aller')}</strong>\u00a0: `, `<strong>${t('Retour')}</strong>\u00a0: `]),
        `<h2>${t('Hébergement')}</h2>`,
        '<p></p>',
        `<h2>${t('Programme')}</h2>`,
        list(['']),
        `<h2>${t('Dans la valise')}</h2>`,
        tasks([t('Papiers d’identité'), t('Chargeurs'), t('Trousse de toilette'), t('Médicaments')]),
        `<h2>${t('Avant de partir')}</h2>`,
        tasks([t('Billets imprimés ou dans le téléphone'), t('Plantes arrosées'), t('Poubelles sorties')]),
      ].join(''),
  },
  {
    id: 'rendez-vous',
    label: t('Rendez-vous'),
    hint: t('Questions à poser, documents à apporter'),
    title: t('Rendez-vous'),
    icon: CalendarClock,
    html: () =>
      [
        field(t('Avec')),
        field(t('Date et lieu')),
        `<h2>${t('Questions à poser')}</h2>`,
        list(['']),
        `<h2>${t('À apporter')}</h2>`,
        tasks([t('Pièce d’identité'), '']),
        `<h2>${t('Ce qui a été dit')}</h2>`,
        '<p></p>',
        `<h2>${t('À faire ensuite')}</h2>`,
        tasks(['']),
      ].join(''),
  },
  {
    id: 'budget',
    label: t('Budget du mois'),
    hint: t('Rentrées, dépenses, épargne'),
    title: t('Budget du mois'),
    icon: Wallet,
    html: () =>
      [
        field(t('Mois')),
        `<h2>${t('Rentrées')}</h2>`,
        list([`<strong>${t('Salaire')}</strong>\u00a0: `, `<strong>${t('Autres')}</strong>\u00a0: `]),
        `<h2>${t('Dépenses fixes')}</h2>`,
        list([`<strong>${t('Loyer')}</strong>\u00a0: `, `<strong>${t('Énergie')}</strong>\u00a0: `, `<strong>${t('Abonnements')}</strong>\u00a0: `]),
        `<h2>${t('Dépenses courantes')}</h2>`,
        list([`<strong>${t('Courses')}</strong>\u00a0: `, `<strong>${t('Transports')}</strong>\u00a0: `, `<strong>${t('Loisirs')}</strong>\u00a0: `]),
        `<h2>${t('Épargne')}</h2>`,
        '<p></p>',
        `<h2>${t('À surveiller')}</h2>`,
        tasks(['']),
      ].join(''),
  },
];

const BY_USAGE: Record<Usage, NoteTemplate[]> = { etudes: NOTE_TEMPLATES, travail: WORK_TEMPLATES, perso: PERSONAL_TEMPLATES };

/** The templates of the account's usage (studies: revision sheet, lab report…; work: meeting minutes, agenda…). */
export const noteTemplates = (usage: Usage | undefined = getSettings().usage) => BY_USAGE[usage ?? 'etudes'] ?? NOTE_TEMPLATES;
