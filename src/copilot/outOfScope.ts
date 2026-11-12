// « Fais une facture », « Fais le planning de mes 8 employés »: things Kompaly doesn't do. Said plainly (the simple
// mode answered « je n'ai pas tout compris » and suggested « Trouve le dossier Clients »), with what it can do instead.
// Pure (no store): tested in tests/outOfScope.test.ts.

import { normalize } from '../lib/utils';

export type OutOfScope = 'facture' | 'equipe' | 'compta';

/** A reminder, a task, a note or an event about an invoice (« Rappelle-moi d'envoyer la facture ») is Kompaly's job. */
const MINE = /^(?:ajoute|rajoute|note|mets?|rappelle|programme|cale|trouve|cherche|ouvre|montre)\b|\brappel|\btaches?\b|\bnotes?\b(?! de frais)|\b(?:fichier|dossier|document)s?\b/;
/** Asking Kompaly to do it (or whether it can), not naming something to do oneself (« Faire le devis Dupuis demain 9h »). */
const ASK = /\b(?:fais|fait|cree|genere|edite|etablis|redige|calcule|prepare|envoie|gere|tiens|peux|peut|sais|sait|comment|est-ce|veux|voudrais|aimerais|besoin|possible)\b|\?/;
const INVOICE = /\b(?:factur\w*|devis)\b/;
const ACCOUNTS = /\b(?:compta\w*|tva|bilan comptable|notes? de frais|fiches? de paie|bulletins? de (?:paie|salaire))\b/;
const STAFF = /\b(?:plannings?|roulements?|horaires|emplois? du temps|conges|absences|paie)\b.*\b(?:employes?|salaries?|equipes?|personnel|staff|serveurs?|collaborateurs?)\b|\bgestion (?:rh|du personnel|des employes|des salaries)\b|\bressources humaines\b/;

/** What is asked for that Kompaly doesn't do, or null. */
export function outOfScope(input: string): OutOfScope | null {
  const q = normalize(input).replace(/[’‘]/g, "'");
  if (MINE.test(q) || !ASK.test(q)) return null;
  if (INVOICE.test(q)) return 'facture';
  if (STAFF.test(q)) return 'equipe';
  if (ACCOUNTS.test(q)) return 'compta';
  return null;
}
