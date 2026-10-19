// « Interroge-moi sur … » without AI: questions built from the structure of a note
// (headings, « terme : définition » bullets, bold words to fill in) and answers checked loosely.

import { normalize } from '../lib/utils';
import type { Note } from '../store/notes';
import { t } from '../i18n';

export interface QuizQuestion {
  q: string;
  answer: string;
  /** 'exact' = a word or short phrase to find; 'keywords' = an explanation, judged on key words */
  mode: 'exact' | 'keywords';
}

export interface Quiz {
  noteId: string;
  title: string;
  questions: QuizQuestion[];
  index: number;
  score: number;
}

const clip = (s: string, n = 260) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

const STOP = new Set(
  'alors aussi avec avoir avant cela celle celui cette comme dans depuis donc elle elles entre est etre fait faire leur leurs mais meme mon nous pour plus quand que quel quelle qui sans sont sous sur tout tous tres une des les par pas ses son aux ces cet vos votre leur ont peut etait sera ainsi apres'.split(' '),
);
const keywords = (s: string) => [...new Set(normalize(s).replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)))];

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The text of each paragraph or list item, one by one (textContent would glue « Chapitres :Type : »),
 * without the blanks of a template (« Chapitres à revoir : » with nothing after, empty checkboxes).
 */
function blocksOf(el: Element): string[] {
  const leaves = [el, ...el.querySelectorAll('p, li, td, th, pre, blockquote')].filter(b => !b.querySelector('p, li, td, th, pre, blockquote'));
  return leaves
    .map(b => (b.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(s => s && !/^[^:]{1,60}:$/.test(s) && !/^(\[ ?\]|-)$/.test(s));
}

/** Builds up to `max` questions from a note's HTML. */
export function buildQuiz(note: Note, max = 6): Quiz | null {
  const doc = new DOMParser().parseFromString(note.content || '', 'text/html');
  const questions: QuizQuestion[] = [];
  const seen = new Set<string>();
  const add = (q: QuizQuestion) => {
    const key = normalize(q.q);
    if (!seen.has(key) && q.answer.trim()) {
      seen.add(key);
      questions.push(q);
    }
  };

  // 1. Headings → "Que sais-tu sur … ?", answer = what follows until the next heading.
  for (const h of doc.body.querySelectorAll('h1, h2, h3')) {
    const parts: string[] = [];
    for (let el = h.nextElementSibling; el && !/^H[1-3]$/.test(el.tagName); el = el.nextElementSibling) parts.push(...blocksOf(el));
    const body = parts.join(' ').replace(/\s+/g, ' ').trim();
    const title = (h.textContent ?? '').trim();
    if (title && keywords(body).length >= 2) add({ q: t('Que sais-tu sur « {title} » ?', { title }), answer: clip(body), mode: 'keywords' });
  }

  // 2. "Terme : définition" (or "Terme — définition") in list items and paragraphs.
  for (const el of doc.body.querySelectorAll('li, p')) {
    if (el.querySelector('li')) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const m = text.match(/^(.{2,60}?)\s*(?::|—|–| - |=)\s*(.{3,})$/);
    if (m && !/^\d{1,2}$/.test(m[1])) add({ q: t('Que signifie « {term} » ?', { term: m[1].trim() }), answer: clip(m[2].trim()), mode: keywords(m[2]).length > 2 ? 'keywords' : 'exact' });
  }

  // 3. Bold words → sentence with a blank to fill.
  for (const b of doc.body.querySelectorAll('strong, b')) {
    const term = (b.textContent ?? '').trim();
    const block = b.closest('p, li, h1, h2, h3');
    const sentence = (block?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!term || term.length > 50 || sentence.length < term.length + 12 || /^H/.test(block?.tagName ?? '')) continue;
    add({ q: t('Complète : « {sentence} »', { sentence: clip(sentence.replace(term, '_____'), 220) }), answer: term, mode: 'exact' });
  }

  if (!questions.length) return null;
  return { noteId: note.id, title: note.title, questions: shuffle(questions).slice(0, max), index: 0, score: 0 };
}

function distance(a: string, b: string) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** 'good' | 'partial' | 'wrong', judged loosely (accents, typos, key words). */
export function checkAnswer(q: QuizQuestion, given: string): 'good' | 'partial' | 'wrong' {
  const a = normalize(given).replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const expected = normalize(q.answer).replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!a) return 'wrong';
  if (q.mode === 'exact') {
    if (a === expected || a.includes(expected) || (expected.includes(a) && a.length >= expected.length * 0.6)) return 'good';
    return distance(a, expected) <= Math.max(1, Math.floor(expected.length / 5)) ? 'good' : 'wrong';
  }
  const keys = keywords(q.answer);
  const said = keywords(given);
  const hits = keys.filter(k => said.some(s => s === k || (k.length > 5 && (s.startsWith(k.slice(0, 5)) || distance(s, k) <= 1)))).length;
  const ratio = hits / Math.max(1, Math.min(keys.length, 8));
  return ratio >= 0.5 ? 'good' : ratio >= 0.2 ? 'partial' : 'wrong';
}
