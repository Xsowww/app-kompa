import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { userStorage } from '../lib/userStorage';
import type { Usage } from '../lib/usage';
import type { SpaceKey } from '../lib/navOrder';
import type { CustomCategory } from './calendar';
import type { Period } from '../lib/periods';
import type { IcsFeed } from '../lib/icsFeeds';
import { DEFAULT_KEYWORDS, type Keyword } from '../lib/keywords';
import { t, type Lang } from '../i18n';

export type AccentKey = 'orange' | 'bleu' | 'vert' | 'violet' | 'rose' | 'encre';
export type Chattiness = 'calme' | 'normal' | 'bavard';
export type ThemeMode = 'clair' | 'sombre' | 'auto';
/** The look of the cards and buttons (index.css, data-style on <html>): bento, frosted glass, Liquid Glass, soft relief. */
export type UiStyle = 'classique' | 'verre' | 'liquide' | 'relief';
export const UI_STYLES: UiStyle[] = ['classique', 'verre', 'liquide', 'relief'];
/** The wallpapers of the « Affichage Pro » (themes.css › data-pro): two painted landscapes, three colour fields. */
export type ProWall = 'montagne' | 'nuit' | 'aurore' | 'maree' | 'braise';
export const PRO_WALLS: ProWall[] = ['montagne', 'nuit', 'aurore', 'maree', 'braise'];
export type Language = Lang;
/** Kompaly's personality presets (the server turns them into instructions). */
export type PersonaKey = 'neutre' | 'pote' | 'coach' | 'prof' | 'zen' | 'taquin';

export const ACCENTS: Record<AccentKey, { label: string; shades: Record<'50' | '100' | '200' | '500' | '600' | '700', string> }> = {
  orange: { label: t('Orange'), shades: { 50: '#fdf3ef', 100: '#fbe4da', 200: '#f6c6b2', 500: '#e8613c', 600: '#c94a26', 700: '#ad3e20' } },
  bleu: { label: t('Bleu Kompaly'), shades: { 50: '#eef2fd', 100: '#dbe3fb', 200: '#b8c8f6', 500: '#3d63dd', 600: '#2f4fc0', 700: '#26409c' } },
  vert: { label: t('Vert'), shades: { 50: '#ecf8f2', 100: '#d3efe1', 200: '#a6dec3', 500: '#2f9e6b', 600: '#238556', 700: '#1c6a45' } },
  violet: { label: t('Violet'), shades: { 50: '#f4f1fd', 100: '#e7e0fb', 200: '#cfc1f6', 500: '#7a5ad6', 600: '#6545bf', 700: '#51379b' } },
  rose: { label: t('Framboise'), shades: { 50: '#fdf0f4', 100: '#fbdde7', 200: '#f5b6cb', 500: '#d6457a', 600: '#bc3166', 700: '#962752' } },
  encre: { label: t('Encre'), shades: { 50: '#f5f5f4', 100: '#e7e5e4', 200: '#d6d3d1', 500: '#44403c', 600: '#292524', 700: '#1c1917' } },
};

export const AVATAR_COLORS = ['#3d63dd', '#e8613c', '#2f9e6b', '#7a5ad6', '#d6457a', '#d48a17', '#1f8fa8', '#44403c'];

export interface Settings {
  // profile
  usage: Usage; // what the account is for (welcome questionnaire): changes words and starter content
  needs: string[]; // what the person said they need most (welcome questionnaire), given to the AI
  /** Everything « Kompaly, c'est pour… » got (welcome questionnaire); `usage` is the first of them. */
  usages: Usage[];
  /** The welcome questionnaire answered (or skipped) on any device: with the profile's « onboarded », it never comes back. */
  welcomeDone: boolean;
  /** The questionnaire left half-way (question shown, answers so far): picked up there on any device. */
  welcomeDraft: { step: number; answers: Record<string, unknown> } | null;
  /** « Face ID ou empreinte ? » already offered to this account (once, whatever the device). */
  passkeyOffered: boolean;
  avatarColor: string;
  avatarImage: string | null; // small data URL
  school: string;
  program: string;
  year: string;
  // appearance
  accent: AccentKey;
  reduceMotion: boolean;
  theme: ThemeMode;
  style: UiStyle;
  /** « Affichage Pro » (Profil › Apparence): a dark world on a wallpaper, the floating icon bar, the dashboard of
   *  coloured tiles, the focus timer in the notch. Over the theme and style, which come back when it is turned off. */
  pro: boolean;
  proWall: ProWall;
  language: Language;
  /** The spaces of the navigation in the order chosen (Profil › Apparence) or given by the questionnaire (lib/navOrder);
   *  null: derived from `usage` and `needs`. */
  navOrder?: SpaceKey[] | null;
  // Kompaly
  copilotVisible: boolean;
  /** Kompaly said who he is and where to find him, on the first opening of the app (copilot/proactive). */
  kompalyIntroduced?: boolean;
  proactive: boolean;
  chattiness: Chattiness;
  revisionSessions: number;
  revisionTime: string; // HH:mm
  persona: PersonaKey;
  personaNotes: string; // free instructions written by the student (max 600 chars)
  morningBrief: boolean; // « ta journée en 3 lignes »
  weeklyReview: boolean; // Sunday evening review
  /** « Mode simple uniquement » (Profil › Kompaly): nothing goes to an AI, Kompaly answers on the device only. */
  simpleOnly: boolean;
  // studies
  focusMinutes: number;
  breakMinutes: number;
  focusSessions: number; // completed, all time
  focusTotalMinutes: number;
  // notifications
  // (« notifications on this device » is per device: lib/push)
  /** Reminders given to a new event that has a time (minutes before); [] = none. */
  defaultReminders: number[];
  /** Reminders given to a new dated task without a time ([900, 0]: the day before at 18:00 and that day at 9:00); [] = none. */
  defaultTaskReminders: number[];
  /** Reminders put off by « Plus tard » (lib/reminderScheduler), on every device: « task:<id> » or « event:<id> » and when. */
  reminderSnoozes: { item: string; at: string }[];
  focusSound: boolean; // end of a focus session
  reminderSound: boolean; // a small sound with a reminder shown in the app
  groupNews: boolean; // what the others do in my groups (also read by server/push.mjs)
  /** The same for shared calendars; null: never set, follows groupNews (the single switch it once shared). */
  calendarNews: boolean | null;
  mutedGroups: string[]; // groups and shared calendars whose news stay quiet (also read by server/push.mjs)
  copilotNotify: boolean; // Kompaly's suggestions as a notification while the app is in the background
  // motivation
  badgesSeen: string[]; // badges already announced
  badgeAnnouncements: boolean; // Kompaly announces newly earned badges
  groupsSeen: Record<string, string>; // « groupId:tab » → last time the student looked (synced across devices)
  customCategories: CustomCategory[]; // calendar categories created by the student
  periods: Period[]; // « En entreprise », « Vacances »… shown as a tint over the calendar days
  hiddenAgendas: string[]; // shared calendars left out of my calendar and the home page (all shown by default)
  icsFeeds: IcsFeed[]; // timetables followed by link (lib/icsFeeds), read again every few hours
  newsSeen: string; // last « Nouveautés » release read (lib/news), so it is shown once per account
  emailTips: boolean; // the tips e-mail a few days after signing up (server/emails.mjs)
  renamedToKompa: boolean; // old « COP-PILOT » texts in this account already renamed (see lib/renameToKompa)
  // « Enregistrer un cours »
  courseKeywords: Keyword[]; // words watched during a recording (marked, and a notification if wanted)
  courseMake: { fiche: boolean; examen: boolean }; // documents made at the end, besides the course itself
  coursePhone: boolean; // keyword alerts also on the other devices (phone) where notifications are on
  courseSilenceMinutes: number; // « personne ne parle depuis… » after this long
}

export const DEFAULT_SETTINGS: Settings = {
  usage: 'etudes',
  needs: [],
  usages: [],
  welcomeDone: false,
  welcomeDraft: null,
  passkeyOffered: false,
  avatarColor: AVATAR_COLORS[0],
  avatarImage: null,
  school: '',
  program: '',
  year: '',
  accent: 'bleu',
  reduceMotion: false,
  theme: 'auto', // follows the device until the student picks one
  style: 'classique',
  pro: false,
  proWall: 'montagne',
  language: 'fr',
  navOrder: null,
  copilotVisible: true,
  proactive: true,
  chattiness: 'calme',
  revisionSessions: 3,
  revisionTime: '18:00',
  persona: 'neutre',
  personaNotes: '',
  morningBrief: true,
  weeklyReview: true,
  simpleOnly: false,
  focusMinutes: 25,
  breakMinutes: 5,
  focusSessions: 0,
  focusTotalMinutes: 0,
  defaultReminders: [15],
  defaultTaskReminders: [900, 0],
  reminderSnoozes: [],
  focusSound: true,
  reminderSound: true,
  groupNews: true,
  calendarNews: null,
  mutedGroups: [],
  copilotNotify: true,
  badgesSeen: [],
  badgeAnnouncements: false,
  groupsSeen: {},
  customCategories: [],
  periods: [],
  hiddenAgendas: [],
  icsFeeds: [],
  newsSeen: '',
  emailTips: true,
  renamedToKompa: false,
  courseKeywords: DEFAULT_KEYWORDS,
  courseMake: { fiche: true, examen: false },
  coursePhone: true,
  courseSilenceMinutes: 3,
};

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    set => ({
      ...DEFAULT_SETTINGS,
      set: patch => set(patch),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    { name: 'settings', storage: userStorage, skipHydration: true },
  ),
);

export const getSettings = () => useSettings.getState();

/** Accent shades used in dark mode when the light ones would vanish on a dark background. */
const DARK_ACCENT_OVERRIDES: Partial<Record<AccentKey, Record<'50' | '100' | '200' | '500' | '600' | '700', string>>> = {
  encre: { 50: '#2a2926', 100: '#35332f', 200: '#4a4743', 500: '#d6d3d1', 600: '#e7e5e4', 700: '#f5f5f4' },
};

/** Plain localStorage key read by the inline script in index.html (avoids a white flash). */
export const THEME_KEY = 'cop-theme';
export const STYLE_KEY = 'cop-style';
export const PRO_KEY = 'cop-pro';

/** Theme last used on this device, or null (logged-out pages then follow the system). */
export function storedTheme(): ThemeMode | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'clair' || t === 'sombre' || t === 'auto' ? t : null;
  } catch {
    return null;
  }
}

/** Style last used on this device (logged-out pages keep it, like the theme). */
export function storedStyle(): UiStyle | null {
  try {
    const s = localStorage.getItem(STYLE_KEY) as UiStyle | null;
    return s && UI_STYLES.includes(s) ? s : null;
  } catch {
    return null;
  }
}

/** The page colour of each style (light, dark): the phone's status bar takes it. Same values in public/theme.js. */
const PAPER: Record<UiStyle, [string, string]> = {
  classique: ['#eceef3', '#0c0d12'],
  verre: ['#e7eaf6', '#0b0d18'],
  liquide: ['#eceef2', '#111215'],
  relief: ['#e4e9f2', '#1e2126'],
};

type Appearance = Pick<Settings, 'accent' | 'reduceMotion' | 'theme'> & { style?: UiStyle; pro?: boolean; proWall?: ProWall };
const darkQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let lastAppearance: Appearance | null = null;
darkQuery?.addEventListener('change', () => {
  if (lastAppearance?.theme === 'auto') applyAppearance(lastAppearance, false);
});

export const resolveDark = (theme: ThemeMode) => theme === 'sombre' || (theme === 'auto' && !!darkQuery?.matches);

/** Push the theme, accent colour and motion preference into CSS. */
export function applyAppearance(s: Appearance, remember = true) {
  lastAppearance = { accent: s.accent, reduceMotion: s.reduceMotion, theme: s.theme, style: s.style, pro: s.pro, proWall: s.proWall };
  const root = document.documentElement;
  // Pro: always dark, on the glass of Verre (its cards, menus, fields), with its own wallpaper and layout (data-pro).
  const pro = !!s.pro;
  const dark = pro || resolveDark(s.theme);
  if (dark) root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  const own = s.style && UI_STYLES.includes(s.style) ? s.style : 'classique';
  const style = pro ? 'verre' : own;
  if (style === 'classique') delete root.dataset.style;
  else root.dataset.style = style;
  const wall = s.proWall && PRO_WALLS.includes(s.proWall) ? s.proWall : 'montagne';
  if (pro) root.dataset.pro = wall;
  else delete root.dataset.pro;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', pro ? '#0c0d12' : PAPER[style][dark ? 1 : 0]);
  if (remember) {
    try {
      localStorage.setItem(THEME_KEY, s.theme);
      localStorage.setItem(STYLE_KEY, own);
      if (pro) localStorage.setItem(PRO_KEY, wall);
      else localStorage.removeItem(PRO_KEY);
    } catch {
      /* private browsing: the theme just won't be applied before the app starts */
    }
  }
  const darkShades = dark ? DARK_ACCENT_OVERRIDES[s.accent] : undefined;
  const shades = darkShades ?? ACCENTS[s.accent]?.shades ?? ACCENTS.bleu.shades;
  for (const [k, v] of Object.entries(shades)) root.style.setProperty(`--accent-${k}`, v);
  if (darkShades) root.style.setProperty('--color-on-brand', '#1c1b19');
  else root.style.removeProperty('--color-on-brand');
  root.classList.toggle('reduce-motion', s.reduceMotion);
}
