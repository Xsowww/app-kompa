// Finding words in a text: no case, no accents; also across the spaces and line-end hyphens of a PDF.

// ── Accent- and case-insensitive matching ──────────────────────────────────
// Each character folds to exactly one character, so positions in the folded text
// are positions in the original one (needed to cut snippets and highlight).

const foldCache = new Map<string, string>();
function foldChar(c: string) {
  let f = foldCache.get(c);
  if (f === undefined) {
    // The typographic apostrophe of phone keyboards (’) matches a plain one.
    f = c === '’' || c === '‘' ? "'" : ((c.normalize('NFD')[0] ?? c).toLowerCase()[0] ?? c);
    foldCache.set(c, f);
  }
  return f;
}

export function fold(s: string) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += code < 128 ? (code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : s[i]) : foldChar(s[i]);
  }
  return out;
}

/** Without spaces and line-end hyphens: « respon- sabilité » and « d r o i t » are still found. */
const squeeze = (s: string) => s.replace(/-\s+/g, '').replace(/\s+/g, '');

/** Where the `n`-th character of squeeze(text) is in `text`. */
function squeezedAt(text: string, n: number) {
  let kept = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i]) || (text[i] === '-' && /\s/.test(text[i + 1] ?? ''))) continue;
    if (kept++ === n) return i;
  }
  return text.length;
}

/** Where `q` (folded) is in a folded text: as typed, else ignoring spaces and line-end hyphens; -1 if absent. */
export function findIn(folded: string, q: string): { at: number; len: number } {
  const at = folded.indexOf(q);
  if (at >= 0) return { at, len: q.length };
  const sq = squeeze(q);
  if (sq.length < 4) return { at: -1, len: 0 };
  const ci = squeeze(folded).indexOf(sq);
  if (ci < 0) return { at: -1, len: 0 };
  const start = squeezedAt(folded, ci);
  return { at: start, len: squeezedAt(folded, ci + sq.length - 1) - start + 1 };
}

