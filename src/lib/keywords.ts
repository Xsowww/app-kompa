// Words to watch during a recorded class (« examen », « à retenir »…): heard → marked, and a notification if wanted.
// Same rules as Copilote Cours (the Mac app it comes from): case, accents and punctuation don't count,
// and a keyword only has to start a word, so « examen » also catches « examens ».

import type { Usage } from './usage';

export interface Keyword {
  word: string;
  /** false: only marked in the transcript, no notification. */
  notify: boolean;
}

const list = (...words: string[]): Keyword[] => words.map(word => ({ word, notify: true }));

/** The words watched until the student changes them: a class, a work meeting, anything else. */
export const KEYWORDS_BY_USAGE: Record<Usage, Keyword[]> = {
  etudes: list('examen', 'partiel', 'contrôle', 'interro', 'important', 'à retenir', 'retenez', 'par cœur', 'tombera', 'DM', 'à rendre', 'date limite'),
  travail: list('important', 'à retenir', 'urgent', 'date limite', 'décision', 'action', 'à faire', 'budget', 'client', 'prochaine réunion'),
  perso: list('important', 'à retenir', 'rendez-vous', 'date limite', 'à faire', 'adresse'),
};
export const DEFAULT_KEYWORDS = KEYWORDS_BY_USAGE.etudes;

const sameWords = (a: readonly Keyword[], b: readonly Keyword[]) => a.length === b.length && a.every((k, i) => normalize(k.word) === normalize(b[i].word));

/** The list in use: a default list never changed by hand follows the account's usage (a pro account gets « décision », « action »…). */
export function keywordsFor(saved: readonly Keyword[], usage: Usage | undefined): Keyword[] {
  const own = KEYWORDS_BY_USAGE[usage ?? 'etudes'] ?? DEFAULT_KEYWORDS;
  // Bells switched on or off are kept for the words both lists share.
  if (Object.values(KEYWORDS_BY_USAGE).some(d => sameWords(saved, d))) return own.map(k => ({ ...k, notify: saved.find(x => normalize(x.word) === normalize(k.word))?.notify ?? true }));
  return [...saved];
}

/** Lower case, no accents nor punctuation: « C'est À RETENIR ! » → « c est a retenir ». */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** « examen, DM; à rendre » or one per line → the keywords, without duplicates. */
export function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[\n,;]/)
    .map(w => w.trim())
    .filter(w => {
      const n = normalize(w);
      if (!n || seen.has(n)) return false;
      seen.add(n);
      return true;
    });
}

/** The keywords heard in `text` (as the student typed them). */
export function matchKeywords(text: string, keywords: readonly Keyword[]): string[] {
  const hay = ` ${normalize(text)}`;
  return keywords.filter(k => {
    const n = normalize(k.word);
    return n && hay.includes(` ${n}`);
  }).map(k => k.word);
}

/** Where each keyword starts in `text` (for highlighting): [start, end) ranges in the original text. */
export function keywordRanges(text: string, keywords: readonly Keyword[]): [number, number][] {
  const words = keywords.map(k => normalize(k.word)).filter(Boolean);
  if (!words.length) return [];
  // Normalise character by character, keeping where each one came from.
  let norm = '';
  const from: number[] = [];
  let space = true;
  for (let i = 0; i < text.length; i++) {
    const c = normalize(text[i]);
    if (!c) {
      if (!space) {
        norm += ' ';
        from.push(i);
        space = true;
      }
      continue;
    }
    for (const ch of c) {
      norm += ch;
      from.push(i);
    }
    space = false;
  }
  const out: [number, number][] = [];
  for (const w of words) {
    for (let at = norm.indexOf(w); at >= 0; at = norm.indexOf(w, at + 1)) {
      if (at > 0 && norm[at - 1] !== ' ') continue;
      // Up to the end of the word that starts with the keyword (« examens »).
      let end = at + w.length;
      while (end < norm.length && norm[end] !== ' ') end++;
      out.push([from[at], from[end - 1] + 1]);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.filter((r, i) => i === 0 || r[0] >= out[i - 1][1]);
}

/** Settings may come from another device or an old version: keep only valid keywords. */
export function cleanKeywords(list: unknown): Keyword[] {
  if (!Array.isArray(list)) return DEFAULT_KEYWORDS;
  const seen = new Set<string>();
  return list
    .filter((k): k is Keyword => !!k && typeof (k as Keyword).word === 'string')
    .map(k => ({ word: k.word.trim().slice(0, 60), notify: k.notify !== false }))
    .filter(k => {
      const n = normalize(k.word);
      if (!n || seen.has(n)) return false;
      seen.add(n);
      return true;
    })
    .slice(0, 60);
}
