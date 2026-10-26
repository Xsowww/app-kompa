import { locale, t } from '../i18n';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** For searches: no case, no accents, « œ » and « æ » spelled out (« oeufs » finds « œufs »), and the typographic apostrophe of phone keyboards (’) is a plain one. */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[’‘]/g, "'").trim();
}

let decimalMark: string | undefined;
export function formatBytes(bytes = 0): string {
  if (bytes < 1024) return t('{n} o', { n: bytes });
  const units = [t('Ko'), t('Mo'), t('Go'), t('To')];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  // 1023,99 Mo would round to « 1024 Mo »: that's « 1 Go ».
  if (Number(v.toFixed(v < 10 ? 1 : 0)) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  // The language's decimal mark (« 1,5 Mo », « 1.5 MB »), looked up once.
  decimalMark ??= (1.5).toLocaleString(locale()).charAt(1);
  const n = v.toFixed(v < 10 ? 1 : 0).replace(/\.0$/, '').replace('.', decimalMark);
  return t('{n} {unit}', { n, unit: units[i] });
}

/**
 * Plain text of some HTML, entities decoded (« & », not « &amp; »). Only for text, never to put back as HTML.
 * A formatting tag inside a word leaves it whole (« théo<strong>rème</strong> »); any other tag (paragraph, line, cell…) separates.
 */
export function stripHtml(html: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return html
    .replace(/<\/?(?:a|abbr|b|code|del|em|font|i|ins|mark|s|small|span|strike|strong|sub|sup|u)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return entities[e.toLowerCase()] ?? m;
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns `name` or `name (2)`, `name (3)`… so it doesn't clash with `taken`. */
export function uniqueName(name: string, taken: string[]): string {
  const set = new Set(taken.map(t => t.toLowerCase()));
  if (!set.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0;
  const base = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  let i = 2;
  while (set.has(`${base} (${i})${ext}`.toLowerCase())) i++;
  return `${base} (${i})${ext}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return t('à l’instant');
  if (min < 60) return t('il y a {n} min', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('il y a {n} h', { n: h });
  const d = Math.round(h / 24);
  if (d === 1) return t('hier');
  if (d < 7) return t('il y a {n} jours', { n: d });
  return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

// A note's plain text, prepared once per version of the note (a changed note is a new object):
// searches and previews ran stripHtml over every note at each key typed.
const noteTexts = new WeakMap<object, { text: string; search: string }>();
function prepared(n: { title: string; content: string }) {
  let p = noteTexts.get(n);
  if (!p) {
    const text = stripHtml(n.content);
    noteTexts.set(n, (p = { text, search: normalize(`${n.title}\n${text}`) }));
  }
  return p;
}
/** The note's text without its HTML (for a preview). */
export const noteText = (n: { title: string; content: string }) => prepared(n).text;
/** Title and text, normalised, to search in. */
export const noteSearchText = (n: { title: string; content: string }) => prepared(n).search;
