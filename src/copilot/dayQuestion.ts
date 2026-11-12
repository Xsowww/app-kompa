// « Qu'est-ce que j'ai jeudi prochain ? », « je fais quoi demain », « c'est quoi mon programme le 12 ? »:
// the day the question is about; « qu'est-ce qui est prévu ce week-end ? », « mon planning de la semaine »:
// the period (pure, tested in tests/dayQuestion.test.ts).

import { addDays } from 'date-fns';
import { normalize } from '../lib/utils';
import { parseQuickAdd, toKey, weekStart } from '../lib/dates';

/** Asking what is planned (not asking to plan something). */
const ASKING = /(qu'?est[- ]ce que j'ai|j'ai quoi|je fais quoi|on fait quoi|j'ai (?:de )?prevu quoi|c'est quoi (?:mon|le) (?:programme|planning)|(?:mon|le) programme|(?:mon|le) planning|qu'?est[- ]ce qui est prevu|qu'?est[- ]ce qu'il y a|il y a quoi|quoi de prevu|au menu|prevu)/;
const BARE_DAY = /^(?:et\s+)?(?:aujourd'hui|demain|apres[- ]demain|(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?: prochain)?)\s*\??$/;
const BARE_PERIOD = /^(?:et\s+)?(?:ce |le |la |cette )?(?:week-?end|weekend|semaine)(?: prochaine?)?\s*\??$/;

const clean = (input: string) => normalize(input).replace(/[’‘]/g, "'");

/** The day (YYYY-MM-DD) a « what do I have » question is about, or null when it is not one. */
export function askedDay(input: string, base = new Date()): string | null {
  const q = clean(input);
  if (!ASKING.test(q) && !BARE_DAY.test(q)) return null;
  return parseQuickAdd(input.replace(/[’‘]/g, "'"), base).date;
}

/**
 * The period a « what do I have » question is about: the weekend (this one, or the next week's one with
 * « prochain », like « jeudi prochain »), this week, or next week. Null when it is not one.
 */
export function askedPeriod(input: string, base = new Date()): Period | null {
  const q = clean(input);
  if (!ASKING.test(q) && !BARE_PERIOD.test(q)) return null;
  return periodIn(input, base);
}

export interface Period {
  kind: 'weekend' | 'week' | 'next-week';
  from: string;
  to: string;
}

/** The period a sentence names, whatever it asks (« mes tâches cette semaine », « à faire ce week-end »), or null. */
export function periodIn(input: string, base = new Date()): Period | null {
  const q = clean(input);
  // « jeudi de la semaine prochaine », « le 12 »: a day, not a period.
  if (/\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b|\d/.test(q)) return null;
  const monday = weekStart(base);
  const next = /\b(?:week-?end|weekend|semaine) prochaine?\b|\bprochaine? (?:week-?end|weekend|semaine)\b/.test(q);
  if (/\bweek-?end\b|\bweekend\b/.test(q)) {
    const saturday = addDays(monday, next ? 12 : 5);
    // On Sunday, « ce week-end » is what is left of it: today.
    const from = !next && base > saturday && toKey(base) !== toKey(saturday) ? base : saturday;
    return { kind: 'weekend', from: toKey(from), to: toKey(addDays(saturday, 1)) };
  }
  if (/(?:^|\b(?:cette|la|ma) )semaine\b/.test(q)) {
    return next
      ? { kind: 'next-week', from: toKey(addDays(monday, 7)), to: toKey(addDays(monday, 13)) }
      : { kind: 'week', from: toKey(monday), to: toKey(addDays(monday, 6)) };
  }
  return null;
}
