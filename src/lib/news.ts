// « Nouveautés » : what changed in Kompaly, shown once to each account at the first opening after a release
// (one page per novelty, like a game's update notes), and again from « Nouveautés » in the menu.
// To announce a release: add it at the top of RELEASES (a new id), its pages in the order they should be read.

import { create } from 'zustand';
import { t, tn } from '../i18n';

export type NewsIcon = 'repeat' | 'span' | 'link' | 'bell' | 'photo' | 'zip' | 'drone' | 'pro' | 'island' | 'dash';

export interface NewsItem {
  icon: NewsIcon;
  title: string;
  text: string;
  /** Where « Essayer » leads (?importer=1: the calendar opens its « Ajouter un emploi du temps » window). */
  to?: string;
  /** « pro »: the page ends with « Activer l'Affichage Pro » (when it isn't on yet). */
  action?: 'pro';
}

export interface Release {
  /** Also its date (yyyy-MM-dd): an account created after it has nothing new to read. */
  id: string;
  items: NewsItem[];
  /** Shown by itself once to every account, even one created after the release (a new look to discover). */
  everyone?: boolean;
}

export const RELEASES: Release[] = [
  {
    id: '2026-11-07',
    everyone: true,
    items: [
      { icon: 'pro', title: t('Découvre l’Affichage Pro'), text: t('Un nouveau look pour Kompaly : un fond d’écran, des cartes en verre et des couleurs qui disent d’un coup d’œil ce qui compte.') },
      { icon: 'island', title: t('Tout passe par l’île, en haut'), text: t('Rappels, messages, Kompaly et ta séance de concentration s’affichent dans une petite pastille en haut de l’écran. Touche-la : tes prochains événements, tes tâches et des raccourcis s’ouvrent.') },
      { icon: 'dash', title: t('Un accueil qui montre l’essentiel'), text: t('Ton prochain grand jour, tes tâches (en retard en premier), ce qui arrive, et les anneaux de ta journée, dans cet ordre.') },
      { icon: 'pro', title: t('Essaie-le maintenant'), text: t('Tu peux l’activer ici ou plus tard dans Profil › Apparence, et revenir à l’affichage actuel quand tu veux.'), action: 'pro' },
    ],
  },
  {
    id: '2026-10-25',
    items: [
      { icon: 'link', title: t('Ton emploi du temps, à jour tout seul'), text: t('Colle le lien iCal de ton agenda (ENT, Google Agenda, Outlook…) : les événements arrivent et se mettent à jour toutes les 3 heures.'), to: '/calendrier?importer=1' },
      { icon: 'repeat', title: t('Des événements qui se répètent'), text: t('Chaque semaine, toutes les 2 semaines, chaque jour ou chaque mois, jusqu’à la date de ton choix, sans les vacances. Aussi dans les agendas partagés.'), to: '/calendrier' },
      { icon: 'span', title: t('Des événements sur plusieurs jours'), text: t('Un séminaire, un voyage, un stage : « Finit un autre jour » dans la fenêtre de l’événement.'), to: '/calendrier' },
      { icon: 'bell', title: t('Les grands jours rappelés plus tôt'), text: t('Un grand jour ou un événement important te prévient une semaine avant et la veille à 18:00.') },
      { icon: 'photo', title: t('Une fiche depuis une photo'), text: t('Prends tes notes en photo, même écrites à la main : Kompaly en fait une fiche PDF rangée dans tes fichiers.'), to: '/drive' },
      { icon: 'zip', title: t('Tes fichiers en .zip'), text: t('Un dossier, une sélection ou tous tes fichiers, en un seul fichier à garder.'), to: '/drive' },
      { icon: 'drone', title: t('Kompaly fait peau neuve'), text: t('Ton ami Kompaly est devenu un petit drone, avec ses humeurs sur son écran.') },
    ],
  },
];

export const latestRelease = RELEASES[0];

/** The release shown now (null: closed). */
export const useNews = create<{ open: string | null }>(() => ({ open: null }));
export const openNews = (id = latestRelease.id) => useNews.setState({ open: id });

/** Shown by itself? Only to an account that existed before the release and hasn't seen it. */
export const newsToShow = (seen: string, accountCreated: string | undefined, release: Release = latestRelease) =>
  !!release && seen !== release.id && seen < release.id && (!!release.everyone || (!!accountCreated && accountCreated.slice(0, 10) < release.id));

/** « Nouveautés, 7 à découvrir »: the name of a button that opens them, with how many are unread (Affichage Pro). */
export const newsName = (unread: number) => (unread ? tn(unread, 'Nouveautés, {n} à découvrir', 'Nouveautés, {n} à découvrir') : t('Nouveautés'));
