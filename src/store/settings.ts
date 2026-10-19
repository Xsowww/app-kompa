import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { userStorage } from '../lib/userStorage';
import type { Usage } from '../lib/usage';
import type { CustomCategory } from './calendar';
import type { Period } from '../lib/periods';
import { DEFAULT_KEYWORDS, type Keyword } from '../lib/keywords';
import { t } from '../i18n';

export type AccentKey = 'orange' | 'bleu' | 'vert' | 'violet' | 'rose' | 'encre';
export type Chattiness = 'calme' | 'normal' | 'bavard';
export type ThemeMode = 'clair' | 'sombre' | 'auto';
export type Language = 'fr' | 'en';
/** Kompaly's personality presets (the server turns them into instructions). */
export type PersonaKey = 'pote' | 'coach' | 'prof' | 'zen' | 'taquin';

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
  avatarColor: string;
  avatarImage: string | null; // small data URL
  school: string;
  program: string;
  year: string;
  // appearance
  accent: AccentKey;
  reduceMotion: boolean;
  theme: ThemeMode;
  language: Language;
  // Kompaly
  copilotVisible: boolean;
  proactive: boolean;
  chattiness: Chattiness;
  revisionSessions: number;
  revisionTime: string; // HH:mm
  persona: PersonaKey;
  personaNotes: string; // free instructions written by the student (max 600 chars)
  morningBrief: boolean; // « ta journée en 3 lignes »
  weeklyReview: boolean; // Sunday evening review
  // studies
  focusMinutes: number;
  breakMinutes: number;
  focusSessions: number; // completed, all time
  focusTotalMinutes: number;
  // notifications
  // (« notifications on this device » is per device: lib/push)
  /** Reminders given to a new event that has a time (minutes before); [] = none. */
  defaultReminders: number[];
  focusSound: boolean;
  // motivation
  badgesSeen: string[]; // badges already announced
  badgeAnnouncements: boolean; // Kompaly announces newly earned badges
  groupsSeen: Record<string, string>; // « groupId:tab » → last time the student looked (synced across devices)
  customCategories: CustomCategory[]; // calendar categories created by the student
  periods: Period[]; // « En entreprise », « Vacances »… shown as a tint over the calendar days
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
  avatarColor: AVATAR_COLORS[0],
  avatarImage: null,
  school: '',
  program: '',
  year: '',
  accent: 'bleu',
  reduceMotion: false,
  theme: 'auto', // follows the device until the student picks one
  language: 'fr',
  copilotVisible: true,
  proactive: true,
  chattiness: 'calme',
  revisionSessions: 3,
  revisionTime: '18:00',
  persona: 'pote',
  personaNotes: '',
  morningBrief: true,
  weeklyReview: true,
  focusMinutes: 25,
  breakMinutes: 5,
  focusSessions: 0,
  focusTotalMinutes: 0,
  defaultReminders: [15],
  focusSound: true,
  badgesSeen: [],
  badgeAnnouncements: false,
  groupsSeen: {},
  customCategories: [],
  periods: [],
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

/** Theme last used on this device, or null (logged-out pages then follow the system). */
export function storedTheme(): ThemeMode | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'clair' || t === 'sombre' || t === 'auto' ? t : null;
  } catch {
    return null;
  }
}

type Appearance = Pick<Settings, 'accent' | 'reduceMotion' | 'theme'>;
const darkQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let lastAppearance: Appearance | null = null;
darkQuery?.addEventListener('change', () => {
  if (lastAppearance?.theme === 'auto') applyAppearance(lastAppearance, false);
});

export const resolveDark = (theme: ThemeMode) => theme === 'sombre' || (theme === 'auto' && !!darkQuery?.matches);

/** Push the theme, accent colour and motion preference into CSS. */
export function applyAppearance(s: Appearance, remember = true) {
  lastAppearance = { accent: s.accent, reduceMotion: s.reduceMotion, theme: s.theme };
  const root = document.documentElement;
  const dark = resolveDark(s.theme);
  if (dark) root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c0d12' : '#eceef3');
  if (remember) {
    try {
      localStorage.setItem(THEME_KEY, s.theme);
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
