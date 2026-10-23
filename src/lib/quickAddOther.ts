// Quick add (« Dentist Tuesday 5pm ») in English, Spanish, German and Italian. French has its own,
// richer parser in dates.ts; this one knows the common forms: times, today / tomorrow, weekdays,
// « next », « every », « in 3 days », 12/11, « 12 November », « November 12 », and an « urgent » flag.

import { addDays, differenceInCalendarDays, format, startOfWeek } from 'date-fns';
import type { Lang } from '../i18n';

interface Words {
  /** Sunday first, without accents. */
  days: string[][];
  months: string[];
  /** Short month forms, each the start of its full name. */
  shortMonths: string[];
  today: string[];
  tomorrow: string[];
  afterTomorrow: string[];
  nextWeek: string[];
  /** « next » before or after the day name. */
  next: string[];
  every: string[];
  /** Before a time: « at 5 », « um 17 », « alle 17 ». */
  at: string[];
  /** Between two times: « 2 to 4pm », « de 14 a 16 », « 14 bis 16 ». */
  to: string[];
  /** « in 3 days » → [word, days unit, weeks unit]. */
  inN: [string, string, string];
  pm: string[];
  /** 12:00 and 00:00 said in words. */
  noon: string[];
  midnight: string[];
  flags: string[];
  /** Small words left at the end of the title once the date is cut out (« Meeting on »). */
  fillers: string[];
}

const WORDS: Record<Exclude<Lang, 'fr'>, Words> = {
  en: {
    days: [['sunday'], ['monday'], ['tuesday'], ['wednesday'], ['thursday'], ['friday'], ['saturday']],
    months: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
    shortMonths: ['jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'oct', 'nov', 'dec'],
    today: ['today', 'tonight', 'this morning', 'this afternoon', 'this evening'],
    tomorrow: ['tomorrow'],
    afterTomorrow: ['the day after tomorrow', 'day after tomorrow'],
    nextWeek: ['next week'],
    next: ['next'],
    every: ['every'],
    at: ['at', 'around'],
    to: ['to', 'until', 'till'],
    inN: ['in', 'days?', 'weeks?'],
    pm: ['in the evening', 'in the afternoon', 'at night'],
    noon: ['noon', 'midday'],
    midnight: ['midnight'],
    flags: ['very important', 'important', 'urgent'],
    fillers: ['on', 'at', 'by', 'before', 'for', 'the', 'due'],
  },
  es: {
    days: [['domingo'], ['lunes'], ['martes'], ['miercoles'], ['jueves'], ['viernes'], ['sabado']],
    months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    shortMonths: ['ene', 'feb', 'mar', 'abr', 'jun', 'jul', 'ago', 'sept', 'sep', 'oct', 'nov', 'dic'],
    today: ['hoy', 'esta noche', 'esta manana', 'esta tarde'],
    tomorrow: ['manana'],
    afterTomorrow: ['pasado manana'],
    nextWeek: ['la semana que viene', 'la proxima semana', 'semana que viene', 'proxima semana'],
    next: ['proximo', 'que viene'],
    every: ['todos los', 'cada'],
    at: ['a las', 'a la', 'sobre las', 'hacia las'],
    to: ['a', 'hasta'],
    inN: ['en', 'dias?', 'semanas?'],
    pm: ['de la tarde', 'de la noche'],
    noon: ['mediodia'],
    midnight: ['medianoche'],
    flags: ['muy importante', 'importante', 'urgente'],
    fillers: ['el', 'la', 'a', 'de', 'del', 'para', 'antes', 'antes del', 'antes de'],
  },
  de: {
    days: [['sonntag', 'sonntags'], ['montag', 'montags'], ['dienstag', 'dienstags'], ['mittwoch', 'mittwochs'], ['donnerstag', 'donnerstags'], ['freitag', 'freitags'], ['samstag', 'samstags', 'sonnabend']],
    months: ['januar', 'februar', 'marz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'],
    shortMonths: ['jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'okt', 'nov', 'dez'],
    today: ['heute', 'heute abend', 'heute morgen', 'heute nachmittag'],
    tomorrow: ['morgen'],
    afterTomorrow: ['ubermorgen'],
    nextWeek: ['nachste woche', 'kommende woche'],
    next: ['nachsten', 'nachster', 'kommenden'],
    every: ['jeden'],
    at: ['um', 'gegen', 'ab'],
    to: ['bis'],
    inN: ['in', 'tagen?', 'wochen?'],
    pm: ['abends', 'nachmittags'],
    noon: ['mittag'],
    midnight: ['mitternacht'],
    flags: ['sehr wichtig', 'wichtig', 'dringend'],
    fillers: ['am', 'um', 'bis', 'vor', 'fur', 'an', 'den', 'der', 'die'],
  },
  it: {
    days: [['domenica'], ['lunedi'], ['martedi'], ['mercoledi'], ['giovedi'], ['venerdi'], ['sabato']],
    months: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
    shortMonths: ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'],
    today: ['oggi', 'stasera', 'stamattina', 'oggi pomeriggio'],
    tomorrow: ['domani'],
    afterTomorrow: ['dopodomani'],
    nextWeek: ['la prossima settimana', 'prossima settimana', 'la settimana prossima', 'settimana prossima'],
    next: ['prossimo', 'prossima'],
    every: ['ogni', 'tutti i', 'tutte le'],
    at: ['alle', 'all', 'verso le', 'per le'],
    to: ['alle', 'a', 'fino alle'],
    inN: ['(?:tra|fra)', 'giorni|giorno', 'settimane|settimana'],
    pm: ['di sera', 'del pomeriggio', 'di pomeriggio'],
    noon: ['mezzogiorno'],
    midnight: ['mezzanotte'],
    flags: ['molto importante', 'importante', 'urgente'],
    fillers: ['il', 'lo', 'la', 'a', 'di', 'del', 'per', 'entro', 'prima', 'prima di'],
  },
};

const alt = (words: string[]) => [...words].sort((a, b) => b.length - a.length).map(w => w.replace(/ /g, '\\s')).join('|');
const ARTICLES = '(?:(?:on|this|el|este|am|diesen|diesem|il|questo|questa)\\s)?';

function hm(h: number, m: number, suffix?: string) {
  if (suffix === 'pm' && h < 12) h += 12;
  if (suffix === 'am' && h === 12) h = 0;
  return h < 24 && m < 60 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : null;
}

function realDate(y: number, month: number, day: number) {
  const d = new Date(y, month, day);
  return month >= 0 && month < 12 && d.getMonth() === month && d.getDate() === day ? d : null;
}

export interface Parsed {
  title: string;
  date: string | null;
  start: string | null;
  end: string | null;
  weekly?: boolean;
  important?: boolean;
}

export function parseQuickAddIn(lang: Exclude<Lang, 'fr'>, input: string, base = new Date()): Parsed {
  const w = WORDS[lang];
  let text = ` ${input} `;
  let date: Date | null = null;
  let start: string | null = null;
  let end: string | null = null;
  let weekly = false;
  // Same length as `text` (accents stripped), so match indices map back. ß stays one letter.
  const n = () => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'");
  const find = (re: RegExp) => n().match(re);
  const remove = (m: RegExpMatchArray) => {
    text = `${text.slice(0, m.index)} ${text.slice(m.index! + m[0].length)}`;
  };
  const cut = (re: RegExp) => {
    const m = find(re);
    if (m) remove(m);
    return m;
  };
  const dayWords = w.days.flatMap((names, i) => names.map(name => ({ name, i })));
  const DAY = `(${alt(dayWords.map(d => d.name))})`;
  const dayIndex = (word: string) => dayWords.find(d => d.name === word)?.i ?? -1;
  const MONTH = `(${alt([...w.months, ...w.shortMonths])})`;
  const monthIndex = (word: string) => w.months.findIndex(m => m.startsWith(word));
  const upcoming = (y: number, month: number, day: number, yearGiven: boolean) => {
    if (yearGiven) return realDate(y, month, day);
    for (let k = 0; k <= 8; k++) {
      const d = realDate(y + k, month, day);
      if (d && differenceInCalendarDays(d, base) >= -30) return d;
    }
    return null;
  };

  // Numeric dates first (« 12.11. » would otherwise read as 12:11): 12/11, 12/11/2026, 12.11. A month over 12
  // (« 17.30 ») is a time, left for below.
  const numeric = find(new RegExp(`\\s(?:${ARTICLES}${DAY},?\\s)?(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4})|\\.)?(?=\\s)`));
  if (numeric && Number(numeric[3]) >= 1 && Number(numeric[3]) <= 12) {
    const y = numeric[4] ? (numeric[4].length === 2 ? 2000 + Number(numeric[4]) : Number(numeric[4])) : base.getFullYear();
    date = upcoming(y, Number(numeric[3]) - 1, Number(numeric[2]), !!numeric[4]);
    if (date) remove(numeric);
  }

  // Times: « 5pm », « 17:30 », « 17.30 », « 17h », « 17 Uhr », « at 5 », « 2-4pm », « von 14 bis 16 Uhr ».
  const SFX = lang === 'en' ? 'am|pm|a\\.m\\.|p\\.m\\.|h' : lang === 'de' ? 'uhr|h' : 'h';
  const T = `(\\d{1,2})(?:[:.h](\\d{2}))?\\s?(${SFX})?`;
  const suffix = (s?: string) => (s ? s.replace(/\./g, '') : undefined);
  const range = find(new RegExp(`\\s(?:(from|de|desde|von|dalle|da)\\s)?(?:${alt(w.at)}\\s)?${T}\\s?(?:-|–|—|${alt(w.to)})\\s?${T}(?=\\s)`));
  // A bare « 14 a 16 » is a time range only after « de / von / dalle… ».
  if (range && (range[1] || range[3] || range[4] || range[6] || range[7])) {
    const s2 = suffix(range[7]);
    let s1 = suffix(range[4]);
    // « 2-4pm »: the first one is in the afternoon too.
    if (!s1 && (s2 === 'pm' || s2 === 'am') && Number(range[2]) < 12 && Number(range[2]) <= Number(range[5])) s1 = s2;
    start = hm(Number(range[2]), Number(range[3] ?? 0), s1);
    end = hm(Number(range[5]), Number(range[6] ?? 0), s2);
    if (start) remove(range);
    if (!start || !end || end <= start) end = null;
  }
  if (!start) {
    const at = find(new RegExp(`\\s(?:${alt(w.at)})\\s${T}(?=\\s)`));
    const marked = at ?? find(new RegExp(`\\s(\\d{1,2})(?:(?:[:.h](\\d{2}))\\s?(${SFX})?|\\s?(${SFX}))(?=\\s)`));
    if (marked) {
      const sfx = suffix(marked[3] ?? marked[4]);
      start = hm(Number(marked[1]), Number(marked[2] ?? 0), sfx);
      if (start) remove(marked);
    }
  }
  if (!start) {
    const word = (list: string[]) => cut(new RegExp(`\\s(?:(?:${alt(w.at)})\\s)?(?:${alt(list)})(?=\\s)`));
    if (word(w.noon)) start = '12:00';
    else if (word(w.midnight)) start = '00:00';
  }
  const pm = w.pm.length ? cut(new RegExp(`\\s(?:${alt(w.pm)})(?=\\s)`)) : null;
  if (pm && start && Number(start.slice(0, 2)) >= 1 && Number(start.slice(0, 2)) < 12) {
    const later = (t: string) => `${Number(t.slice(0, 2)) + 12}${t.slice(2)}`;
    start = later(start);
    if (end && Number(end.slice(0, 2)) < 12) end = later(end);
  }

  let important = false;
  if (cut(new RegExp(`\\s(?:\\(?(?:${alt(w.flags)})\\)?|!+)(?=\\s)`))) important = true;

  const every = cut(new RegExp(`\\s(?:${alt(w.every)})\\s${DAY}s?(?=\\s)`)) ?? (lang === 'de' ? cut(/\s(sonntags|montags|dienstags|mittwochs|donnerstags|freitags|samstags)(?=\s)/) : null);
  if (every) {
    weekly = true;
    date = addDays(base, (dayIndex(every[1]) - base.getDay() + 7) % 7);
  }

  const rel = !date && cut(new RegExp(`\\s${w.inN[0]}\\s(\\d{1,3})\\s(${w.inN[1]}|${w.inN[2]})(?=\\s)`));
  if (rel) date = addDays(base, new RegExp(`^(?:${w.inN[2]})$`).test(rel[2]) ? Number(rel[1]) * 7 : Number(rel[1]));
  else if (date) {
    /* every … */
  } else if (cut(new RegExp(`\\s(?:${alt(w.afterTomorrow)})(?=\\s)`))) date = addDays(base, 2);
  // German « morgen früh » is tomorrow; « heute morgen » (this morning) was taken by `today` first.
  else if (cut(new RegExp(`\\s(?:${alt(w.today)})(?=\\s)`))) date = base;
  else if (cut(new RegExp(`\\s(?:${alt(w.tomorrow)})(?:\\s(?:fruh|morning|por la manana|mattina))?(?=\\s)`))) date = addDays(base, 1);
  else if (cut(new RegExp(`\\s(?:${alt(w.nextWeek)})(?=\\s)`))) date = addDays(startOfWeek(base, { weekStartsOn: 1 }), 7);

  // « 12 November », « 12. November », « 12 de noviembre », « November 12th », « Tuesday, November 12 ».
  if (!date) {
    const m = find(new RegExp(`\\s(?:${ARTICLES}${DAY},?\\s)?(?:the\\s)?(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s(?:of\\s|de\\s)?${MONTH}\\.?(?:,?\\s(?:de\\s)?(\\d{4}))?(?=\\s)`));
    if (m) {
      date = upcoming(m[4] ? Number(m[4]) : base.getFullYear(), monthIndex(m[3]), Number(m[2]), !!m[4]);
      if (date) remove(m);
    }
  }
  if (!date && lang === 'en') {
    const m = find(new RegExp(`\\s(?:${ARTICLES}${DAY},?\\s)?${MONTH}\\.?\\s(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s(\\d{4}))?(?=\\s)`));
    if (m) {
      date = upcoming(m[4] ? Number(m[4]) : base.getFullYear(), monthIndex(m[2]), Number(m[3]), !!m[4]);
      if (date) remove(m);
    }
  }
  // Weekdays: « Friday » (the coming one), « next Friday » / « el próximo viernes » / « nächsten Freitag » (next week's).
  if (!date) {
    const NEXT = alt(w.next);
    const m = cut(new RegExp(`\\s${ARTICLES}(?:(?:el|il|la)\\s)?(?:(${NEXT})\\s)?${DAY}(?:\\s(${NEXT}))?(?=\\s)`));
    if (m) {
      const target = dayIndex(m[2]);
      if (m[1] || m[3]) date = addDays(startOfWeek(base, { weekStartsOn: 1 }), 7 + ((target + 6) % 7));
      else {
        let delta = (target - base.getDay() + 7) % 7;
        if (delta === 0) delta = 7;
        date = addDays(base, delta);
      }
    }
  }

  let title = text.replace(/\s+/g, ' ').trim();
  const tail = new RegExp(`\\s(?:${alt(w.fillers)})$`, 'i');
  for (let k = 0; k < 2; k++) title = title.normalize('NFD').replace(/[̀-ͯ]/g, '').match(tail) ? title.replace(/\s\S+$/, '') : title;
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    date: date ? format(date, 'yyyy-MM-dd') : null,
    start,
    end,
    ...(weekly && { weekly }),
    ...(important && { important }),
  };
}
