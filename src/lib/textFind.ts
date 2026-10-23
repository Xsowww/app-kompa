// Finding words in a text: no case, no accents; also across the line-end hyphens and spread-out letters of a PDF.

// ── Accent- and case-insensitive matching ──────────────────────────────────
// Each character folds to one character, except « œ » / « æ » (two: « oe », « ae », as typed on a keyboard):
// folding() says where each folded character comes from, to cut snippets and highlight.

const foldCache = new Map<string, string>();
function foldChar(c: string) {
  let f = foldCache.get(c);
  if (f === undefined) {
    // The typographic apostrophe of phone keyboards (’) matches a plain one.
    f = c === '’' || c === '‘' ? "'" : c === 'œ' || c === 'Œ' ? 'oe' : c === 'æ' || c === 'Æ' ? 'ae' : ((c.normalize('NFD')[0] ?? c).toLowerCase()[0] ?? c);
    foldCache.set(c, f);
  }
  return f;
}

// Capitals and everything beyond ASCII, in one pass (no string built character by character: big PDFs froze the tab).
const FOLD_RE = /[A-Z\u0080-￿]/g;
const WIDE = /[œŒæÆ]/;

export const fold = (s: string) => s.replace(FOLD_RE, foldChar);

/** fold(s), and `map[i]`: where the i-th folded character is in `s` (null when they are at the same places). */
export function folding(s: string): { folded: string; map: Int32Array | null } {
  const folded = fold(s);
  if (folded.length === s.length) return { folded, map: null };
  const map = new Int32Array(folded.length + 1);
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    map[j++] = i;
    if (WIDE.test(s[i])) map[j++] = i;
  }
  map[j] = s.length;
  return { folded, map };
}

/** The part of `s` that the folded range [at, at + len) comes from. */
export const original = (map: Int32Array | null, at: number, len: number): { at: number; len: number } =>
  map && len > 0 ? { at: map[at], len: map[at + len - 1] + 1 - map[at] } : { at, len };

// ── Pieces of a PDF's text glued back ──────────────────────────────────────
// A word cut at the end of a line (« respon- sabilité »), letters placed one by one (« m i t o s e », three at
// least). The other spaces stay: « la mer » is not « lame ».
const GLUE_RE = /(?<=\p{L})- (?=\p{L})|(?<!\S)\p{L}(?: \p{L}){2,}(?!\S)/gu;

/** A folded text glued back; for every cut, from `at[k]` on (glued positions), add `shift[k]` to be in the folded text. */
export interface Glued {
  text: string;
  at: number[];
  shift: number[];
}

export function glue(folded: string): Glued {
  const at: number[] = [];
  const shift: number[] = [];
  let removed = 0;
  const text = folded.replace(GLUE_RE, (m: string, offset: number) => {
    if (m[0] === '-') {
      removed += m.length;
      at.push(offset + m.length - removed);
      shift.push(removed);
      return '';
    }
    const letters = m.split(' ');
    let pos = offset;
    letters.forEach((l, i) => {
      if (i) {
        pos++;
        removed++;
        at.push(pos - removed);
        shift.push(removed);
      }
      pos += l.length;
    });
    return letters.join('');
  });
  return { text, at, shift };
}

/** Where the n-th character of a glued text is in the folded one. */
function unglue(g: Glued, n: number) {
  let lo = 0;
  let hi = g.at.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g.at[mid] <= n) lo = mid + 1;
    else hi = mid;
  }
  return n + (lo ? g.shift[lo - 1] : 0);
}

/**
 * Where `q` (folded) is in a folded text: as typed, else in the text glued back (`glued`: glue(folded), kept by
 * the caller so that it is not made again at every key typed); at -1 if absent.
 */
export function findIn(folded: string, q: string, glued?: Glued): { at: number; len: number } {
  const at = folded.indexOf(q);
  if (at >= 0) return { at, len: q.length };
  const gq = glue(q).text;
  if (gq.length < 4) return { at: -1, len: 0 };
  const g = glued ?? glue(folded);
  const ci = g.at.length ? g.text.indexOf(gq) : -1;
  if (ci < 0) return { at: -1, len: 0 };
  const start = unglue(g, ci);
  return { at: start, len: unglue(g, ci + gq.length - 1) - start + 1 };
}

/** Splits `text` around the matches of `query`, for highlighting (also a word glued back by findIn). */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  text = text.normalize('NFC'); // « É » written as « E » + accent (files from a Mac) is found as « e »
  const q = fold(query.trim());
  if (!q) return [{ text, hit: false }];
  const { folded, map } = folding(text);
  const hits: { at: number; len: number }[] = [];
  for (let i = folded.indexOf(q); i >= 0; i = folded.indexOf(q, i + q.length)) hits.push(original(map, i, q.length));
  if (!hits.length) {
    const r = findIn(folded, q);
    if (r.at >= 0) hits.push(original(map, r.at, r.len));
  }
  const parts: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const { at, len } of hits) {
    if (at < pos) continue;
    if (at > pos) parts.push({ text: text.slice(pos, at), hit: false });
    parts.push({ text: text.slice(at, at + len), hit: true });
    pos = at + len;
  }
  if (pos < text.length || !parts.length) parts.push({ text: text.slice(pos), hit: false });
  return parts;
}

/**
 * An extract to show: a word cut at the end of a line written whole again (« respon- sabilité » → « responsabilité »;
 * not « pré- et post-opératoire »).
 */
export const unhyphen = (s: string) => s.replace(/(?<=\p{L})- (?=\p{Ll})(?!(?:et|ou) )/gu, '');

/** The page (from 1) of a PDF holding the character at `at`, `starts` saying where each page starts. */
export function pageAt(starts: number[], at: number) {
  let page = 1;
  while (page < starts.length && starts[page] <= at) page++;
  return page;
}
