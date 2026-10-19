// The site in French (the source) or translated. A text is written in French where it is used,
// wrapped in t(): t('Nouvelle tâche'), t('Bonjour {name}', { name }), t('En cours||ce qui avance') (context after ||). Its translations live in
// src/i18n/{en,es,de,it}.json, keyed by that French text (`npm run i18n` lists what is missing).
// The language is chosen before the app loads (main.tsx), so texts written at module level are translated too.

export type Lang = 'fr' | 'en' | 'es' | 'de' | 'it';

export const LANGS: { code: Lang; name: string }[] = [
  { code: 'fr', name: 'Français' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
];

/** Name of the language for the AI (« Write in … »). */
export const LANG_NAMES: Record<Lang, string> = { fr: 'français', en: 'English', es: 'español', de: 'Deutsch', it: 'italiano' };

const LOCALES: Record<Lang, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', de: 'de-DE', it: 'it-IT' };

const LOADERS: Record<Exclude<Lang, 'fr'>, () => Promise<{ default: Record<string, string> }>> = {
  en: () => import('./en.json'),
  es: () => import('./es.json'),
  de: () => import('./de.json'),
  it: () => import('./it.json'),
};

const KEY = 'cop-lang';
const isLang = (l: unknown): l is Lang => LANGS.some(x => x.code === l);

/** The language chosen on this device, else the browser's when it is one of ours, else French. */
function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  for (const l of typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])) {
    const code = l?.slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return 'fr';
}

export let lang: Lang = 'fr';
let dict: Record<string, string> = {};

/** Before the app loads: the language, and its dictionary. */
export async function loadLang() {
  lang = detect();
  document.documentElement.lang = lang;
  if (lang === 'fr') return;
  try {
    dict = (await LOADERS[lang]()).default;
  } catch {
    dict = {}; // offline with an old cache: French rather than nothing
  }
}

/** Saves the choice on this device and reloads the page in that language. */
export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* storage blocked: only for this page */
  }
  location.reload();
}

/** « fr-FR », « en-GB »… for toLocaleDateString, Intl, speech recognition. */
export const locale = () => LOCALES[lang];

const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/**
 * The text in the chosen language. `vars` fill its {placeholders}.
 * The same French word with two meanings gets a context after « || », never shown: t('En cours||ce qui avance').
 */
export function t(fr: string, vars?: Record<string, string | number>): string {
  const at = fr.indexOf('||');
  return fill(dict[fr] || (at < 0 ? fr : fr.slice(0, at)), vars);
}

/** Singular or plural, by `n` and the language's rules: tn(n, '{n} tâche', '{n} tâches'). {n} is filled in. */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  // French: 0 and 1 take the singular; English and the others: only 1.
  const single = lang === 'fr' ? Math.abs(n) < 2 : Math.abs(n) === 1;
  return t(single ? one : many, { n, ...vars });
}

/** For tests: use a dictionary without loading anything. */
export function setDictForTests(l: Lang, d: Record<string, string>) {
  lang = l;
  dict = d;
}
