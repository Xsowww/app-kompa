import { addDays, format, isValid, parseISO, startOfWeek, differenceInCalendarDays } from 'date-fns';
import { fr } from 'date-fns/locale/fr';
import { dateLocale, lang, t, tn, type Lang } from '../i18n';
import { parseQuickAddIn } from './quickAddOther';
import type { Repeat, RepeatRule } from './repeat';
import { minutesBefore } from './reminders';

// Read once: the app (and this file) loads after loadLang().
const DATE_LOCALE = lang === 'fr' ? fr : (dateLocale ?? fr);

// Called thousands of times per render (calendar, badges, reminders): plain string work, not date-fns.
const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
export const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const fromKey = (k: string) => {
  const m = KEY.exec(k);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : parseISO(k);
};
export const todayKey = () => toKey(new Date());
/** A real yyyy-MM-dd day (« abc » or « 2026-02-30 » from a damaged link give null). */
export const validKey = (k: string | null | undefined): string | null => {
  if (!k || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return null;
  const d = parseISO(k);
  return isValid(d) && toKey(d) === k ? k : null;
};
export const weekStart = (d: Date) => startOfWeek(d, { weekStartsOn: 1 });
/** German and Spanish write a date their own way: « Freitag, 23. Oktober », « viernes, 23 de octubre de 2026 ». */
const PATTERNS: Partial<Record<Lang, (p: string) => string>> = {
  de: p => p.replace(/(E+)\s+(?=d)/, '$1, ').replace(/(^|[^d'])d(?=\s+M)/, '$1d.'),
  es: p => p.replace(/(E+)\s+(?=d\s+M)/, '$1, ').replace(/(^|[^d'])d\s+(?=MMMM)/, "$1d 'de' ").replace(/MMMM\s+(?=y)/, "MMMM 'de' "),
};
/** The date-fns pattern written the way of a language (French: as it is). */
export const datePattern = (pattern: string, language: Lang = lang) => PATTERNS[language]?.(pattern) ?? pattern;
/** date-fns in the site's language; in French « 1er novembre », not « 1 novembre » (the day token right before a month name). */
export const fmt = (d: Date, pattern: string) =>
  format(d, lang === 'fr' ? (d.getDate() === 1 ? pattern.replace(/(^|[^d'])d(?=\s+M)/, "$1d'er'") : pattern) : datePattern(pattern), { locale: DATE_LOCALE });
/** Like fmt, with the year when it isn't this one (a deadline next year doesn't look close), and then the month too
 *  (« lundi 7 janv. 2027 », never « lundi 7 2027 »). */
export const fmtDay = (d: Date, pattern: string) =>
  fmt(d, d.getFullYear() === new Date().getFullYear() ? pattern : /M/.test(pattern) ? `${pattern} yyyy` : `${pattern} MMM yyyy`);
export const daysUntil = (key: string) => differenceInCalendarDays(fromKey(key), new Date());

export function countdownLabel(key: string): string {
  const n = daysUntil(key);
  if (n === 0) return t('Aujourd’hui');
  if (n === 1) return t('Demain');
  if (n === -1) return t('Hier');
  if (n < 0) return tn(-n, 'Il y a {n} jour', 'Il y a {n} jours');
  return tn(n, 'Dans {n} jour', 'Dans {n} jours'); // in words: « J-13 » wasn't understood
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
// Full names and the usual short forms (« 3 nov », « 12 sept. »), longest first so the regex takes the whole word.
const MONTH_WORDS = [...MONTHS, 'janv', 'fevr', 'fev', 'avr', 'juil', 'sept', 'oct', 'nov', 'dec'].sort((a, b) => b.length - a.length);
const monthIndex = (word: string) => MONTHS.findIndex(m => m.startsWith(word));
const DAY = `(?:${WEEKDAYS.join('|')})`;
// « vendredi soir », « demain matin »: the moment of the day is not part of the title.
const PERIOD = `(?:\\s(?:soir|matin|aprem|apres-midi))?`;
// « Rendre DM avant vendredi », « pour le 12/11 »: the deadline word goes with the date, not in the title.
const BEFORE = `(?:(?:avant|pour|d'ici)\\s)?`;

export interface ParsedQuickAdd {
  title: string;
  date: string | null;
  start: string | null;
  end: string | null;
  /** « Congés du 22 au 26 décembre »: the last day of an event over several days (`date` is the first). */
  endDate?: string;
  /** « tous les mardis », « toutes les semaines », « tous les jours »…: the repeat the event form offers (lib/repeat). */
  every?: Repeat;
  /** « tous les mardis », « chaque lundi », « toutes les semaines » (every === 'week'). */
  weekly?: boolean;
  /** « tous les ans », « chaque année » (a birthday; every === 'year'). */
  yearly?: boolean;
  /** « important », « urgent » or « ! » in the sentence: the event is flagged important. */
  important?: boolean;
  /** A date that doesn't exist (« le 31/11 », « 30 février »): left in the title, to be corrected. */
  impossible?: boolean;
  /** « rappel 1h avant », « sans rappel », « rappelle-moi la veille à 18h »: the reminder asked (remindMinutes). */
  remind?: RemindSpec;
  /** « à la mairie », « chez le kiné »: where it happens (the Lieu field). */
  place?: string;
  /** « tous les 3 mois », « tous les lundis et jeudis », « le 1er lundi du mois » (with `extras`): the repeat's rule. */
  rule?: RepeatRule;
}

// The verb before « à la … » / « au … » that speaks of a thing or a person, not of a place.
const NOT_PLACE = /^(?:penser|pense|repenser|reflechir|repondre|reponse|dire|parler|ecrire|telephoner|demander|jouer|participer|inscrire|inscription|renoncer|merci|grace|suite|attention|rappeler|rappel)$/;

const hm = (h: string | number, m?: string) => (Number(h) < 24 && Number(m ?? 0) < 60 ? `${String(h).padStart(2, '0')}:${m ?? '00'}` : null);

/** The date, or null when it doesn't exist (31/02, month 16…). */
function realDate(y: number, month: number, day: number) {
  const d = new Date(y, month, day);
  return month >= 0 && month < 12 && d.getMonth() === month && d.getDate() === day ? d : null;
}

/**
 * Understands simple French sentences such as
 * "Exam de maths vendredi 14h", "Rendre TP le 12/11 à 9h30", "Sport demain 18h-19h".
 */
/** `extras`: also the reminder (« rappel 1h avant ») and the place (« à la mairie ») — the calendar's bar and form, which save them. */
export function parseQuickAdd(input: string, base = new Date(), language = lang, extras = false): ParsedQuickAdd {
  // Punctuation glued to a word hid the day or the hour (« Rdv demain, 14h », « Dentiste demain 14h. »): commas and
  // « ! » are set apart (and put back in the title), a last « . » or « ? » is dropped when the sentence then says more.
  const read = (s: string) => tidyTitle(spentTime(s.replace(/([,;!])(?=\s|$)/g, ' $1'), t => readQuickAdd(t, base, language, extras)));
  const typed = read(input);
  const bare = input.replace(/([^\s.?])[.?](?=\s*$)/, '$1');
  if (bare === input) return typed;
  const other = read(bare);
  const score = (r: ParsedQuickAdd) => Number(!!r.date) + Number(!!r.start) + Number(!!r.endDate) + Number(!!r.place);
  return score(other) > score(typed) ? other : typed;
}

// Something one does for a while (the five languages, accents stripped).
const ACTIVITY =
  'reviser|revisions?|travailler|bosser|etudier|apprendre|lire|ecrire|rediger|coder|courir|marcher|nager|pratiquer|repeter|jouer|dessiner|mediter|ranger|nettoyer|cuisiner|bricoler|jardiner|' +
  'study|revise|review|work|read|write|code|run|walk|swim|practi[cs]e|play|draw|meditate|clean|cook|' +
  'estudiar|repasar|trabajar|leer|escribir|correr|entrenar|practicar|lernen|arbeiten|lesen|schreiben|laufen|trainieren|uben|studiare|ripassare|lavorare|leggere|scrivere|correre';
const SPENT = new RegExp(
  String.raw`^((?:.*?[\s'])??(?:${ACTIVITY})(?:\s[^\d]*?)?)\s(?:for\s)?([1-6])\s?(?:heures?|hours?|hrs?|horas?|ore|ora|stunden?|std|h)\s?(\d{2})?(?=\s|$)(?!\s?[-–—]\s?[\dm])(?!\s(?:et|and)\s(?:\d|midi|minuit|noon|midnight))(?!\s(?:du\smatin|am|pm|a\.m|p\.m)\b)`,
);
// The word before the hour that makes it a time of the day (or a length the sentence already says its own way).
const AT_WORD = /\s(?:a|vers|de|des|at|by|from|until|till|um|gegen|ab|alle|las|pendant|durant|avant|apres|before|after|dans|in)$/;

/**
 * « Réviser 2h », « Travailler 1h30 », « Study 2 hours »: after what one does for a while, a small bare hour is how long
 * it lasts, not 2 in the morning. With a start elsewhere in the sentence (« Réviser 2h demain 14h »), it gives the end;
 * without, it stays in the title and the item has no time.
 */
function spentTime(input: string, read: (s: string) => ParsedQuickAdd): ParsedQuickAdd {
  // Same length as `input` (accents stripped), so the match maps back.
  const m = input.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").match(SPENT);
  if (!m || AT_WORD.test(m[1]) || Number(m[3] ?? 0) > 59) return read(input);
  // « 2h à 4h » is from 2 to 4; « 2h à 14h » (more than 6 hours apart, or at noon) is 2 hours, at 14:00.
  const to = input.slice(m[0].length).toLowerCase().match(/^\s(?:[aà]|to|bis|alle)\s(?:(\d{1,2})|midi|noon)/);
  if (to && Number(to[1] ?? 12) - Number(m[2]) <= 6) return read(input);
  // Hidden from the reading (a mark between the number and its « h »), where it is.
  const digit = m[1].length + m[0].slice(m[1].length).search(/\d/) + 1;
  const r = read(`${input.slice(0, digit)}⁠${input.slice(digit)}`);
  if (!r.start) return { ...r, title: r.title.replace('⁠', '') };
  const until = toMinutes(r.start) + Number(m[2]) * 60 + Number(m[3] ?? 0);
  const title = r.title.replace(/(?:\bfor\s)?\d⁠\s?[^\s,;]*/, '').replace(/\s+/g, ' ').trim();
  return { ...r, title, ...(!r.end && until < 24 * 60 && { end: fromMinutes(until) }) };
}

/** The title without the punctuation left alone once the day and hour are out (« Rdv , » → « Rdv », « : appeler » → « Appeler »). */
function tidyTitle(r: ParsedQuickAdd): ParsedQuickAdd {
  const title = r.title
    .replace(/\s+([,;])/g, '$1')
    .replace(/([,;])(?:\s*[,;])+/g, '$1')
    .replace(/^[\s,;:.]+|[\s,;:]+$/g, '');
  return title === r.title ? r : { ...r, title: title.charAt(0).toUpperCase() + title.slice(1) };
}

function readQuickAdd(input: string, base: Date, language: Lang, extras: boolean): ParsedQuickAdd {
  // Another language: its own words, unless the French reading understands more (« Dentiste demain 9h »).
  if (language !== 'fr') {
    const other = parseQuickAddIn(language, input, base);
    const french = readQuickAdd(input, base, 'fr', extras);
    const score = (r: ParsedQuickAdd) => Number(!!r.date) + Number(!!r.start);
    return score(french) > score(other) ? french : other;
  }
  let text = ` ${input} `;
  let date: Date | null = null;
  let endDate: Date | null = null;
  let start: string | null = null;
  let end: string | null = null;
  let every: Repeat | undefined;
  let impossible = false; // « le 30 février »: no date, rather than « le 30 » of this month
  let nightEnd: string | null = null;
  // Same length as `text` (accents stripped, no trim) so match indices map back.
  // The typographic apostrophe of phone keyboards (« aujourd’hui ») counts as a plain one.
  const n = () => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'");

  const find = (re: RegExp) => n().match(re);
  const remove = (m: RegExpMatchArray) => {
    text = text.slice(0, m.index) + ' ' + text.slice(m.index! + m[0].length);
  };
  const cut = (re: RegExp) => {
    const m = find(re);
    if (m) remove(m);
    return m;
  };
  /** That day this year, else the next year it exists and isn't more than a month ago (« 29/02 » → the next leap year). */
  const upcoming = (y: number, month: number, day: number, yearGiven: boolean) => {
    if (yearGiven) return realDate(y, month, day);
    for (let k = 0; k <= 8; k++) {
      const d = realDate(y + k, month, day);
      if (d && differenceInCalendarDays(d, base) >= -30) return d;
    }
    return null;
  };

  // The reminder said in the sentence, taken out first (its « à 7h » is not the start): « rappel 1h avant »,
  // « rappelle-moi la veille à 18h », « rappel à 7h », « sans rappel ». Turned into minutes once the day is known.
  let remind: RemindSpec | undefined;
  const R = String.raw`\s(?:avec\s)?(?:un\s)?(?:rappel|rappelle-moi|rappelle\smoi|previens-moi|previens\smoi)`;
  const HOUR = String.raw`(\d{1,2})\s?(?:heures?|h|:)\s?(\d{2})?`;
  let rm: RegExpMatchArray | null;
  if (!extras) {
    /* the reminder words stay in the text */
  } else if (cut(/\s(?:sans|pas\sde|aucun)\srappels?(?=\s)/)) remind = { none: true };
  else if ((rm = cut(new RegExp(`${R}\\s(\\d{1,3}|une?)\\s?(min|mn|minutes?|h|heures?|j|jours?|semaines?)\\s(?:avant|before)(?=\\s)`)))) {
    const k = /^une?$/.test(rm[1]) ? 1 : Number(rm[1]);
    remind = { before: k * (/^(min|mn)/.test(rm[2]) ? 1 : /^(h|heure)/.test(rm[2]) ? 60 : /^j/.test(rm[2]) ? 1440 : 10080) };
  } else if ((rm = cut(new RegExp(`${R}\\s(?:la\\s)?veille(?:\\s(?:a|vers)\\s${HOUR})?(?=\\s)`)))) remind = { eve: true, at: (rm[1] && hm(rm[1], rm[2])) || '18:00' };
  else if ((rm = cut(new RegExp(`${R}\\s(?:le\\sjour\\smeme\\s)?(?:a|vers)\\s${HOUR}(?=\\s)`)))) remind = rm[1] && hm(rm[1], rm[2]) ? { at: hm(rm[1], rm[2])! } : undefined;

  // « dans 2 heures », « dans 30 min », « dans 1h30 »: that moment, counted from now (not « 2 h » of the morning).
  const soon = cut(/\sdans\s(\d{1,3}|une|deux|trois)\s?(?:(?:heures?|h)\s?(\d{2})?|(minutes?|min|mn))(?=\s)/);
  if (soon) {
    const k = ({ une: 1, deux: 2, trois: 3 } as Record<string, number>)[soon[1]] ?? Number(soon[1]);
    const at = new Date(base.getTime() + (soon[3] ? k : k * 60 + Number(soon[2] ?? 0)) * 60_000);
    date = at;
    start = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }

  // A length, not a time: « pendant 2h », « durant 30 min », « (1h) », « de 2h » when another hour gives the start
  // (« Réunion de 2h demain 10h »). It gives the end once the start is known.
  let length = 0;
  const TIME = /\s(?:a\s|vers\s)?(\d{1,2})\s?(?:heures?|h|:)\s?(\d{2})?(?=\s)|\s(?:midi|minuit)(?=\s)/;
  const lasting =
    find(/\s(?:pendant|durant)\s(\d{1,2}|une)\s?(?:heures?|h)\s?(\d{2})?(?=\s)|\s\((\d{1,2})\s?h\s?(\d{2})?\)(?=\s)/) ??
    find(/\s(?:pendant|durant|de)\s(\d{1,3})\s?(?:min|mn|minutes?)(?=\s)/) ??
    find(/\sde\s(\d{1,2})\s?(?:heures?|h)\s?(\d{2})?(?=\s)(?!\s?(?:-|–|—|a|jusqu'a)\s?(?:\d|midi|minuit))/);
  if (lasting) {
    const minutesOnly = /min|mn/.test(lasting[0]);
    const h = lasting[1] === 'une' ? 1 : Number(lasting[1] ?? lasting[3]);
    const m = Number(lasting[2] ?? lasting[4] ?? 0);
    const rest = n().slice(0, lasting.index) + ' ' + n().slice(lasting.index! + lasting[0].length);
    // « de 14h » alone is the start (« Cours de 8h »): a length only with another hour in the sentence.
    if ((!/^\sde\s/.test(lasting[0]) || minutesOnly || TIME.test(rest)) && m < 60) {
      length = minutesOnly ? h : h * 60 + m;
      remove(lasting);
    }
  }

  // Times: "14h", "14h30", "14:30", "de 14h à 16h", "14h-16h", "14h–16h" (dash of the autocorrect), "midi", "10h à midi"
  // Also « midi-14h », « de 20h à minuit », « entre 9h et 10h ».
  const HOURS = String.raw`(\d{1,2})\s?(?:heures?|h|:)\s?(\d{2})?`;
  const NAMED = String.raw`(midi|minuit)(\set\sdemie?)?`;
  const BOTH = (sep: string) => String.raw`(?:${HOURS}|${NAMED})\s?${sep}\s?(?:${HOURS}|${NAMED})(?=\s)`;
  const range = soon ? null : (find(new RegExp(String.raw`\sentre\s${BOTH('et')}`)) ?? find(new RegExp(String.raw`\s(?:de\s)?${BOTH("(?:-|–|—|a|jusqu'a)")}`)));
  if (range) {
    const named = (word: string, half?: string) => `${word === 'midi' ? '12' : '00'}:${half ? '30' : '00'}`;
    start = range[1] ? hm(range[1], range[2]) : named(range[3], range[4]);
    end = range[5] ? hm(range[5], range[6]) : named(range[7], range[8]);
    // « 20h-minuit »: until the end of that day (not a night that ends the next day at 0:00).
    if (start && start > '00:00' && end === '00:00') end = '23:59';
    if (start) remove(range);
    // « Garde de nuit 21h-7h », « de 22h à 6h »: a night, it ends the next morning (an event over two days, below).
    if (start && end && end < start && start >= '17:00' && end <= '08:00') nightEnd = end;
    if (!start || !end || end <= start) end = null; // « de 14h à 9h »: only the start makes sense
  }
  if (!start) {
    const t = find(/\s(?:a\s|vers\s)?(\d{1,2})\s?(?:heures?|h|:)\s?(\d{2})?(?=\s)/);
    if (t && (start = hm(t[1], t[2]))) remove(t);
  }
  // « ce midi » is today.
  let thisNoon = false;
  if (!start) {
    const t = cut(/\s(?:a\s|vers\s|(ce\s))?(midi|minuit)(\set\sdemie?)?(?=\s)/);
    if (t) {
      start = `${t[2] === 'midi' ? '12' : '00'}:${t[3] ? '30' : '00'}`;
      thisNoon = !!t[1];
    }
  } else if (cut(/\sce\smidi(?=\s)/)) thisNoon = true; // « Déjeuner 12h-13h ce midi »

  // « 8h du soir », « vendredi soir 8h », « 3h de l'après-midi »: the afternoon hour.
  const pm = find(/\s(?:(du\s)?soir|(de\sl'apres-midi|de\sl'aprem))(?=\s)/);
  if (pm && start && Number(start.slice(0, 2)) >= 1 && Number(start.slice(0, 2)) < 12) {
    const later = (t: string) => `${Number(t.slice(0, 2)) + 12}${t.slice(2)}`;
    start = later(start);
    if (end && Number(end.slice(0, 2)) < 12) end = later(end);
    if (pm[1] || pm[2]) remove(pm);
  }
  // « 10h du matin »: the hour as it is, the words out of the title (« ce matin » / « demain matin » are days, below).
  if (start) cut(/\sdu\smatin(?=\s)/);

  // The length typed: the end, on the same day.
  if (start && !end && length > 0 && toMinutes(start) + length < 24 * 60) end = fromMinutes(toMinutes(start) + length);

  // « Rendre le dossier vendredi important », « Réunion urgente demain », « Payer les impôts ! ».
  let important = false;
  const flag = cut(/\s(?:\(?(?:tres\s)?(?:important|importante|urgent|urgente)\)?|!+)(?=\s)/);
  if (flag) important = true;

  // « Anniversaire de Léa le 12 mars tous les ans »: the date as said, repeated each year.
  if (cut(/\s(?:tous\sles\sans|chaque\sannee|toutes\sles\sannees)(?=\s)/)) every = 'year';

  // « tous les mardis », « chaque lundi »: every week, from the next one. « toutes les semaines » (with or without
  // « le mercredi » further on), « tous les jours », « tous les mois », « une semaine sur deux »: the day said, else the one shown.
  // The calendar's own words (`extras`): « tous les 3 mois », « tous les lundis et jeudis », « le 1er lundi du mois ».
  let rule: RepeatRule | undefined;
  const NUM: Record<string, number> = { deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, dix: 10, douze: 12 };
  const UNITS: Record<string, RepeatRule['unit']> = { jours: 'day', semaines: 'week', mois: 'month', ans: 'year' };
  const NTHS: Record<string, number> = { premier: 1, '1er': 1, deuxieme: 2, '2e': 2, troisieme: 3, '3e': 3, quatrieme: 4, '4e': 4, dernier: -1 };
  let rr: RegExpMatchArray | null = null;
  if (!extras) {
    /* the ready-made words below only */
  } else if ((rr = cut(/\s(?:tous\sles|toutes\sles)\s(\d{1,2}|deux|trois|quatre|cinq|six|dix|douze)\s(jours|semaines|mois|ans)(?=\s)/))) {
    const n = NUM[rr[1]] ?? Number(rr[1]);
    if (n >= 1) rule = { unit: UNITS[rr[2]], interval: n };
  } else if ((rr = cut(new RegExp(`\\s(?:le|chaque|tous\\sles)\\s(premier|1er|deuxieme|2e|troisieme|3e|quatrieme|4e|dernier)s?\\s(${DAY})s?\\s(?:du|de\\schaque)\\smois(?=\\s)`)))) {
    const nth = NTHS[rr[1]];
    const wd = WEEKDAYS.indexOf(rr[2]);
    // The next such day, this month or the next ones.
    for (let k = 0; k < 3 && !date; k++) {
      const m = new Date(base.getFullYear(), base.getMonth() + k, 1);
      const d = nth > 0 ? new Date(m.getFullYear(), m.getMonth(), 1 + ((wd - m.getDay() + 7) % 7) + (nth - 1) * 7) : (last => new Date(m.getFullYear(), m.getMonth(), last.getDate() - ((last.getDay() - wd + 7) % 7)))(new Date(m.getFullYear(), m.getMonth() + 1, 0));
      if (d.getMonth() === m.getMonth() && differenceInCalendarDays(d, base) >= 0) date = d;
    }
    rule = { unit: 'month', interval: 1, nth };
  } else if ((rr = cut(new RegExp(`\\s(?:tous\\sles|chaque)\\s(${DAY})s?((?:\\s?(?:,|et)\\s?(?:le\\s)?(?:${DAY})s?)+)${PERIOD}(?=\\s)`)))) {
    const days = [rr[1], ...(rr[2].match(new RegExp(DAY, 'g')) ?? [])].map(d => WEEKDAYS.indexOf(d));
    rule = { unit: 'week', interval: 1, days: [...new Set(days)] };
    // From the first of those days to come.
    date = addDays(base, Math.min(...rule.days!.map(w => (w - base.getDay() + 7) % 7)));
  }
  const weekday = rule ? null : cut(new RegExp(`\\s(?:tous\\sles|chaque)\\s(${DAY})s?${PERIOD}(?=\\s)`));
  if (rule) {
    /* said above */
  } else if (weekday) {
    every = 'week';
    date = addDays(base, (WEEKDAYS.indexOf(weekday[1]) - base.getDay() + 7) % 7);
  } else if (cut(/\s(?:toutes\sles\s(?:2|deux)\ssemaines|une\ssemaine\ssur\s(?:2|deux)|tous\sles\squinze\sjours)(?=\s)/)) every = '2weeks';
  else if (cut(/\s(?:toutes\sles\ssemaines|chaque\ssemaine|une\sfois\spar\ssemaine)(?=\s)/)) every = 'week';
  else if (cut(/\s(?:tous\sles\sjours|chaque\sjour)(?=\s)/)) every = 'day';
  else if (cut(/\s(?:tous\sles\smois|chaque\smois|une\sfois\spar\smois)(?=\s)/)) every = 'month';

  // Relative days: "dans 5 jours", "dans une semaine", "demain", "la semaine prochaine"…
  const rel = !date && cut(/\sdans\s(\d{1,3}|une|deux|trois)\s(jours?|semaines?)(?=\s)/);
  if (rel) {
    const k = ({ une: 1, deux: 2, trois: 3 } as Record<string, number>)[rel[1]] ?? Number(rel[1]);
    date = addDays(base, rel[2].startsWith('semaine') ? k * 7 : k);
  } else if (date) {
    /* already found */
  } else if (cut(new RegExp(`\\s(?:apres-demain|apres demain)${PERIOD}(?=\\s)`))) date = addDays(base, 2);
  else if (cut(new RegExp(`\\sdemain${PERIOD}(?=\\s)`))) date = addDays(base, 1);
  else if (cut(new RegExp(`\\s(?:avant-hier|avant hier)${PERIOD}(?=\\s)`))) date = addDays(base, -2);
  else if (cut(new RegExp(`\\shier${PERIOD}(?=\\s)`))) date = addDays(base, -1);
  // « le contrôle d'aujourd'hui »: the « d' » goes with the day.
  else if (cut(/\s(?:d')?(?:aujourd'hui|aujourdhui)(?=\s)|\s(?:ce soir|ce matin|cet aprem|cet apres-midi)(?=\s)/) || thisNoon) date = base;
  else if (cut(/\s(?:la\s)?semaine\sprochaine(?=\s)/)) date = addDays(weekStart(base), 7);

  // From one day to another: « Congés du 22 au 26 décembre », « du 28 décembre au 2 janvier », « du 22/12 au 26/12 »,
  // « du lundi 3 au mercredi 5 »: one event over several days (the calendar makes one a day, linked: lib/repeat spanDays).
  if (!date) {
    const TO = `(?:\\s+(?:au|a|jusqu'au)\\s+|\\s*[-–—]\\s*)(?:(?:le\\s)?${DAY}\\s)?`;
    const D = `(?:${DAY}\\s)?(\\d{1,2})(?:er)?`;
    const M = `(${MONTH_WORDS.join('|')})\\.?`;
    const Y = `(?:\\s(\\d{4}))?`;
    const NUM = `(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?`;
    const year = (y?: string) => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : null);
    let m: RegExpMatchArray | null;
    let span: [number, number | null, number | null, number, number | null, number | null] | null = null; // day, month, year × 2
    if ((m = find(new RegExp(`\\s${BEFORE}(?:du\\s|de\\s)?${D}(?:\\s${M})?${Y}${TO}(\\d{1,2})(?:er)?\\s${M}${Y}${PERIOD}(?=\\s)`))))
      span = [Number(m[1]), m[2] ? monthIndex(m[2]) : null, year(m[3]), Number(m[4]), monthIndex(m[5]), year(m[6])];
    else if ((m = find(new RegExp(`\\s${BEFORE}(?:du\\s|de\\s)?(?:${DAY}\\s)?${NUM}${TO}${NUM}${PERIOD}(?=\\s)`))))
      span = [Number(m[1]), Number(m[2]) - 1, year(m[3]), Number(m[4]), Number(m[5]) - 1, year(m[6])];
    // Without a month (« du 22 au 26 »): the next 22nd; « du » is needed, « de 14 à 16 » is a time.
    else if ((m = find(new RegExp(`\\s${BEFORE}du\\s${D}\\s+(?:au|jusqu'au)\\s+(?:${DAY}\\s)?(\\d{1,2})(?:er)?${PERIOD}(?=\\s)(?!\\s?(?:h|heures?|:)\\d?)`))))
      span = [Number(m[1]), null, null, Number(m[2]), null, null];
    if (m && span) {
      const [d1, m1, y1, d2, m2, y2] = span;
      let from: Date | null = null;
      let to: Date | null = null;
      if (m2 === null) {
        // The next d1 (this month, or the next one when it's past), the end in the same month or the next.
        for (let k = 0; k < 3 && !from; k++) {
          const d = realDate(base.getFullYear(), base.getMonth() + k, d1) ?? realDate(base.getFullYear() + 1, base.getMonth() + k - 12, d1);
          if (d && differenceInCalendarDays(d, base) >= 0) from = d;
        }
        if (from) to = realDate(from.getFullYear(), from.getMonth() + (d2 > d1 ? 0 : 1), d2) ?? realDate(from.getFullYear() + 1, from.getMonth() + (d2 > d1 ? 0 : 1) - 12, d2);
      } else {
        // « du 28 au 3 janvier » starts the month before; « du 28 décembre au 2 janvier » ends the next year.
        const month1 = m1 ?? (d1 > d2 ? m2 - 1 : m2);
        const wrap = month1 < 0;
        const mo = wrap ? 11 : month1;
        from = realDate(y1 ?? (y2 !== null ? (mo > m2 ? y2 - 1 : y2) : base.getFullYear() - (wrap ? 1 : 0)), mo, d1);
        if (from && y1 === null && y2 === null && differenceInCalendarDays(from, base) < -30) from = realDate(from.getFullYear() + 1, from.getMonth(), d1);
        if (from) to = realDate(y2 ?? from.getFullYear() + (m2 < from.getMonth() ? 1 : 0), m2, d2);
      }
      if (from && to && to > from) {
        date = from;
        endDate = to;
        remove(m);
      } else if (!from || !to) impossible = true;
    }
  }

  // dd/mm(/yyyy), with the day name that may come before: "mardi 3/11"
  if (!date && !impossible) {
    // « 12/11 » anywhere; « 12.11 » or « 12-11 » only after « le », « du » or a day name (« exercices 5-6 », « pages 10-12 »).
    const m =
      find(new RegExp(`\\s${BEFORE}(?:(?:le\\s)?${DAY}\\s)?(?:le\\s|du\\s)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?${PERIOD}(?=\\s)`)) ??
      find(new RegExp(`\\s${BEFORE}(?:(?:le\\s)?${DAY}\\s(?:le\\s|du\\s)?|le\\s|du\\s)(\\d{1,2})[.-](\\d{1,2})(?:[.-](\\d{2,4}))?${PERIOD}(?=\\s)`));
    if (m) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : base.getFullYear();
      date = upcoming(y, Number(m[2]) - 1, Number(m[1]), !!m[3]);
      if (date) remove(m);
      else impossible = true;
    }
  }

  // "12 novembre", "1er nov", "mardi 3 novembre 2026"
  if (!date) {
    const m = find(new RegExp(`\\s${BEFORE}(?:(?:le\\s)?${DAY}\\s)?(?:le\\s|du\\s)?(\\d{1,2})(?:er)?\\s(${MONTH_WORDS.join('|')})\\.?(?:\\s(\\d{4}))?${PERIOD}(?=\\s)`));
    if (m) {
      date = upcoming(m[3] ? Number(m[3]) : base.getFullYear(), monthIndex(m[2]), Number(m[1]), !!m[3]);
      if (date) remove(m);
      else impossible = true;
    }
  }

  // A day name and its number without a month: « dimanche 15 » is the next 15th that is a Sunday (test n°3: « salle
  // dimanche 15 à 11h » was put on Sunday the 8th, the number left in the title). Not « lundi 21h » (an hour).
  if (!date && !impossible) {
    const m = find(new RegExp(`\\s${BEFORE}(?:ce\\s|le\\s)?(${DAY})\\s(\\d{1,2})(?:er)?${PERIOD}(?=\\s)(?!\\s?(?:h|heures?|:)\\d?)`));
    const day = m ? Number(m[2]) : 0;
    if (m && day >= 1 && day <= 31) {
      const target = WEEKDAYS.indexOf(m[1]);
      let first: Date | null = null;
      for (let k = 0; k < 14 && !date; k++) {
        const d = realDate(base.getFullYear(), base.getMonth() + k, day) ?? realDate(base.getFullYear() + 1, base.getMonth() + k - 12, day);
        if (!d || differenceInCalendarDays(d, base) < 0) continue;
        first ??= d;
        if (d.getDay() === target) date = d;
      }
      // No such Sunday the 15th within a year: the next 15th (the number said wins over the name).
      date ??= first;
      if (date) remove(m);
    }
  }

  // Weekday names: "vendredi" (the next one), "vendredi soir", "lundi prochain".
  // « Jeudi prochain » is the Thursday of next week (« ce jeudi » / « jeudi » is the coming one):
  // said on a Wednesday it is in 8 days, said on a Saturday « mardi prochain » is in 3 days.
  if (!date) {
    const m = cut(new RegExp(`\\s${BEFORE}(?:ce\\s|le\\s)?(${DAY})(\\sprochain)?${PERIOD}(?=\\s)`));
    if (m) {
      const target = WEEKDAYS.indexOf(m[1]);
      if (m[2]) date = addDays(weekStart(base), 7 + ((target + 6) % 7));
      else {
        let delta = (target - base.getDay() + 7) % 7;
        if (delta === 0) delta = 7;
        date = addDays(base, delta);
      }
    }
  }

  // A day number alone: « le 15 » is the next 15th (this month, or the next one when it's past).
  if (!date && !impossible) {
    // Not the start of a range (« du 20 au 25 »): a single event can't hold it, the sentence stays as typed.
    const m = find(new RegExp(`\\s${BEFORE}(?:le|du)\\s(\\d{1,2})(?:er)?${PERIOD}(?=\\s)(?!\\s+(?:au|à|a|-|jusqu'au)\\s+\\d)`));
    const day = m ? Number(m[1]) : 0;
    if (m && day >= 1) {
      for (let k = 0; k < 3 && !date; k++) {
        const d = realDate(base.getFullYear(), base.getMonth() + k, day) ?? realDate(base.getFullYear() + 1, base.getMonth() + k - 12, day);
        if (d && differenceInCalendarDays(d, base) >= 0) date = d;
      }
      if (date) remove(m);
    }
  }

  // A night (« lundi 21h-7h »): from that evening to the next morning, as two linked days (lib/repeat spanDays).
  if (nightEnd && !endDate && !every && !impossible) {
    date = date ?? base;
    endDate = addDays(date, 1);
    end = nightEnd;
  }

  // Where (« à la mairie », « chez le kiné », « au CHU », « salle B12 »): the Lieu field, not the title. Up to the end
  // of what is left, or « avec … » / « pour … » / a comma. Not « au sujet de », « à la place », nor a title left empty.
  let place: string | undefined;
  const where = extras && find(/\s((?:chez\s|en\ssalle\s|salle\s|a\sla\s|a\sl'|aux\s|au\s))(?!(?:sujet|plus|moins|cas|lieu|fait|revoir|place|fois|bout|cours|besoin|maximum|minimum|total)(?:\s|$))([^\s,()]+(?:\s(?!avec\s|pour\s|et\s|puis\s)[^\s,()]+){0,4})(?=\s*(?:$|,|\savec\s|\spour\s|\set\s|\spuis\s))/);
  if (where && where.index! > 1) {
    const word = where[1].trim();
    const raw = text.slice(where.index! + 1 + where[1].length, where.index! + where[0].length).trim();
    // « chez le kiné » reads as a place as said; « à la mairie » is « Mairie », « salle B12 » stays « Salle B12 ».
    const value = word === 'chez' || word.endsWith('salle') ? text.slice(where.index! + 1, where.index! + where[0].length).trim() : raw;
    // « Penser à la lessive », « Répondre à la prof », « Jouer au foot »: what is to do, not where. Nor a phone number.
    const before = n().slice(0, where.index).trim().split(' ').pop() ?? '';
    const about = word !== 'chez' && !word.endsWith('salle') && NOT_PLACE.test(before);
    if (value && !about && !/^[\d\s.+-]+$/.test(value) && text.slice(0, where.index).trim()) {
      place = value.charAt(0).toUpperCase() + value.slice(1);
      remove(where);
    }
  }

  const title = text
    .replace(/\s+/g, ' ')
    .replace(/\s(le|Le|a|à|de|De|du|Du|pour|Pour|avant|Avant)\s*$/, '')
    .trim();

  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    date: date && isValid(date) ? toKey(date) : null,
    start,
    end,
    ...(endDate && { endDate: toKey(endDate) }),
    ...(every && { every }),
    ...(every === 'week' && { weekly: true }),
    ...(every === 'year' && { yearly: true }),
    ...(important && { important }),
    ...(impossible && { impossible }),
    ...(remind && { remind }),
    ...(place && { place }),
    ...(rule && { rule }),
  };
}

/** A reminder said in a quick add: none, a length before, or a moment (that day, or the day before) at a time. */
export interface RemindSpec {
  none?: true;
  before?: number;
  eve?: boolean;
  at?: string;
}

/** The reminders of an event on `date` at `start` from what the sentence said ([] for « sans rappel »; undefined: the usual ones). */
export function remindMinutes(spec: RemindSpec | undefined, date: string, start?: string | null): number[] | undefined {
  if (!spec) return undefined;
  if (spec.none) return [];
  if (spec.before !== undefined) return [spec.before];
  const day = spec.eve ? toKey(addDays(fromKey(date), -1)) : date;
  const n = minutesBefore(date, start ?? undefined, day, spec.at ?? '18:00');
  // « rappel à 15h » for an event at 14h: after it, impossible; the usual ones then.
  return n >= 0 ? [n] : undefined;
}

/** "08:15" → 495 */
export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** 495 → "08:15" (clamped to the day). */
export const fromMinutes = (min: number) => {
  const v = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

/** Already behind us: an earlier day, or today with its end (else its start) passed. Without a time, it lasts all day. */
export function isOver(e: { date: string; start?: string | null; end?: string | null }, now = new Date()) {
  const today = toKey(now);
  if (e.date !== today) return e.date < today;
  const last = e.end ?? e.start;
  return !!last && last <= format(now, 'HH:mm');
}

/** Already started (today, its start passed): too late to prepare for it. */
export function hasStarted(e: { date: string; start?: string | null }, now = new Date()) {
  const today = toKey(now);
  if (e.date !== today) return e.date < today;
  return !!e.start && e.start <= format(now, 'HH:mm');
}

/** « 14 », « 14h », « 14h30 », « 1430 », « 9:5 » → « 14:00 », « 14:30 », « 09:05 »; null when it isn't a time. */
export function parseTime(text: string): string | null {
  const m = /^\s*(\d{1,2})\s*(?:[:hH.]\s*(\d{1,2})?)?\s*$/.exec(text) ?? /^\s*(\d{2})(\d{2})\s*$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
