// What the simple mode understands for sure, recognised before anything is sent to an AI: « dentiste mardi 17h30 »,
// « Ajoute un rendez-vous dentiste mardi 17h30 », « qu'est-ce que j'ai demain ? ». These phrases are answered on
// the device (localBrain), even when the AI is there: they never leave it, and they never fail on an AI's whim.
// Pure (no store): tested in tests/simpleIntent.test.ts.

import { normalize } from '../lib/utils';
import { parseQuickAdd, type ParsedQuickAdd } from '../lib/dates';
import { askedDay, askedPeriod } from './dayQuestion';

const clean = (s: string) => normalize(s).replace(/[’‘]/g, "'").trim();

/** « Ajoute (moi) un rendez-vous », « Mets », « Planifie », « Note dans mon agenda »…: what may come before the event itself. */
const ADD = /^(?:ajoute|ajouter|rajoute|planifie|programme|cale|mets?|note dans (?:le|mon) (?:calendrier|agenda))(?:[- ]moi)?\s+(?:(?:un|une|le|mon|ma)\s+)?(?:(?:nouvel?\s+)?(?:[eé]v[eé]nement|rdv|rendez-vous)\s+)?/i;

/** A second request in the same sentence (« … et rappelle-moi la veille », « puis supprime… »): for the AI. */
const MORE = /\b(?:et|puis|ensuite|aussi)\s+(?:rappelle|previens|ajoute|mets|supprime|efface|deplace|decale|cree|fais|planifie|organise|prepare|envoie|ecris|change|modifie|bloque)|[,;]\s*(?:rappelle|previens|ajoute|mets|supprime|deplace|cree|fais|planifie)|\b(?:rappel|previens|notifie|alerte)/;

/** Not an event to add: a question, a change to something already there, or another kind of thing. */
const NOT_EVENT = /\?|^(?:est[- ]ce|qu'|que |quoi|quel|quand|combien|comment|pourquoi|ou |peux|pourrais|tu |je |j'|il |elle |on |explique|resume|fais|cree|ecris|aide|trouve|cherche|supprime|efface|annule|deplace|decale|reporte|change|modifie|renomme|coche|termine|lis|ouvre|montre|liste|analyse|interroge|rappelle)|\b(?:note|notes|tache|taches|todo|dossier|fichier|favoris|corbeille|categorie|fiche|quiz|periode)\b/;

export interface QuickEvent extends ParsedQuickAdd {
  /** A day and a title for sure (`date` may still be null when only an hour was said, with « Ajoute »). */
  title: string;
}

/**
 * An event said in one sentence: « Ajoute un rendez-vous dentiste mardi 17h30 » (a verb, then a title with a day or an
 * hour), or just « Judo de Léo mercredi 14h » (a short title, a day and an hour). Null when it isn't clearly that.
 */
export function quickEvent(input: string, base = new Date()): QuickEvent | null {
  const typed = input.trim().replace(/[.!\s]+$/, '');
  if (!typed || typed.length > 160) return null;
  const q = clean(typed);
  if (MORE.test(q)) return null;
  const verb = ADD.exec(typed);
  const rest = verb ? typed.slice(verb[0].length) : typed;
  if (!rest.trim() || NOT_EVENT.test(clean(rest)) || (!verb && NOT_EVENT.test(q))) return null;
  const parsed = parseQuickAdd(rest, base);
  if (!parsed.title || parsed.impossible) return null;
  const words = parsed.title.split(/\s+/).length;
  if (verb ? !(parsed.date || parsed.start) || words > 10 : !(parsed.date && parsed.start) || words > 6) return null;
  return parsed;
}

/** « Qu'est-ce que j'ai demain ? », « mon planning de la semaine »: a plain question about what is planned. */
export function dayQuestion(input: string, base = new Date()): boolean {
  const q = clean(input);
  if (q.split(/\s+/).length > 10 || /\b(?:pourquoi|comment|conseil|propose|organise|prepare|aide|resume|analyse|optimise|equilibre|charge|trop)\b|\bet\s+(?:dis|fais|propose|ajoute|cree|mets)/.test(q)) return false;
  return !!askedDay(input, base) || !!askedPeriod(input, base);
}

/** Answered on the device, never sent to an AI. */
export function isSimpleRequest(input: string, base = new Date()): boolean {
  return !!quickEvent(input, base) || dayQuestion(input, base);
}
