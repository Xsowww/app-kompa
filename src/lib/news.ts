// « Nouveautés » : what changed in Kompaly, shown once to each account at the first opening after a release
// (one page per novelty, like a game's update notes), and again from « Nouveautés » in the menu.
// To announce a release: add it at the top of RELEASES (a new id), its pages in the order they should be read.

import { create } from 'zustand';
import { t } from '../i18n';

export type NewsIcon = 'repeat' | 'span' | 'link' | 'bell' | 'photo' | 'zip' | 'drone';

export interface NewsItem {
  icon: NewsIcon;
  title: string;
  text: string;
  /** Where « Essayer » leads. */
  to?: string;
}

export interface Release {
  /** Also its date (yyyy-MM-dd): an account created after it has nothing new to read. */
  id: string;
  items: NewsItem[];
}

export const RELEASES: Release[] = [
  {
    id: '2026-10-25',
    items: [
      { icon: 'link', title: t('Ton emploi du temps, à jour tout seul'), text: t('Colle le lien iCal de ton ENT ou de Google Agenda : les cours arrivent et se mettent à jour toutes les 3 heures.'), to: '/calendrier' },
      { icon: 'repeat', title: t('Des événements qui se répètent'), text: t('Chaque semaine, toutes les 2 semaines, chaque jour ou chaque mois, jusqu’à la date de ton choix, sans les vacances. Aussi dans les agendas partagés.'), to: '/calendrier' },
      { icon: 'span', title: t('Des événements sur plusieurs jours'), text: t('Un séminaire, un voyage, un stage : « Finit un autre jour » dans la fenêtre de l’événement.'), to: '/calendrier' },
      { icon: 'bell', title: t('Les grands jours rappelés plus tôt'), text: t('Un examen ou un événement important te prévient une semaine avant et la veille à 18 h.') },
      { icon: 'photo', title: t('Une fiche depuis une photo'), text: t('Prends tes notes en photo, même écrites à la main : Kompaly en fait une fiche PDF rangée dans ton Drive.'), to: '/drive' },
      { icon: 'zip', title: t('Ton Drive en .zip'), text: t('Un dossier, une sélection ou tout le Drive, en un seul fichier à garder.'), to: '/drive' },
      { icon: 'drone', title: t('Kompaly fait peau neuve'), text: t('Ton ami Kompaly est devenu un petit drone, avec ses humeurs sur son écran.') },
    ],
  },
];

export const latestRelease = RELEASES[0];

/** The release shown now (null: closed). */
export const useNews = create<{ open: string | null }>(() => ({ open: null }));
export const openNews = (id = latestRelease.id) => useNews.setState({ open: id });

/** Shown by itself? Only to an account that existed before the release and hasn't seen it. */
export const newsToShow = (seen: string, accountCreated: string | undefined) =>
  !!latestRelease && seen !== latestRelease.id && seen < latestRelease.id && !!accountCreated && accountCreated.slice(0, 10) < latestRelease.id;
