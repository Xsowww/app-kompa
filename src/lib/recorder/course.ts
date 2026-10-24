// What a recorded class becomes: the transcript in timed passages, the parts rewritten by the AI,
// then the course document (Markdown, turned into a Word file by lib/docx). No browser APIs here (tested).

import { matchKeywords, type Keyword } from '../keywords';
import { t, tn } from '../../i18n';

export interface Segment {
  id: string;
  /** Seconds since the start of the recording. */
  start: number;
  end: number;
  text: string;
  /** Keywords heard in it. */
  hits: string[];
  /** Marked by hand (« Moment important »). */
  starred: boolean;
  /** Written by the browser (when the server couldn't), or not written at all. */
  origin?: 'navigateur' | 'manquant';
}

export interface Alert {
  id: string;
  time: number;
  /** null: a moment marked by hand. */
  keyword: string | null;
  excerpt: string;
}

export interface Part {
  title: string;
  text: string;
  points: string[];
  /** Seconds of the class it covers, up to. */
  until: number;
  /** Not rewritten (the AI wasn't available): the transcript as it is. */
  raw?: boolean;
}

/** A part of the class is sent to the AI once its transcript is this long (about 4 to 5 min of speech). */
export const PART_CHARS = 4000;

/** 754 → « 00:12:34 ». */
export function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(':');
}

/** Seconds recorded from the start to the end (or `now`), pauses left out: the one going on and those before (`paused`, ms). */
export function recordedSeconds(s: { startedAt: number; endedAt?: number; pausedAt?: number; paused?: number }, now = Date.now()): number {
  const end = Math.min(s.endedAt ?? now, s.pausedAt ?? Infinity);
  return Math.max(0, (end - s.startedAt - (s.paused ?? 0)) / 1000);
}

/** 5520 → « 1 h 32 », 300 → « 5 min », 26 → « 26 s ». */
export function duration(seconds: number): string {
  if (seconds < 59.5) return t('{s} s', { s: Math.max(0, Math.round(seconds)) });
  const m = Math.round(seconds / 60);
  return m >= 60 ? t('{h} h {min}', { h: Math.floor(m / 60), min: String(m % 60).padStart(2, '0') }) : t('{min} min', { min: m });
}

/** The end of a text, cut at a word: what was being said when a keyword was heard. */
export function excerpt(text: string, limit = 160): string {
  const t = text.replace(/^[\s.,;]+/, '').trim();
  if (t.length <= limit) return t;
  const tail = t.slice(-limit);
  return `…${tail.slice(tail.indexOf(' ') + 1)}`;
}

/** A passage written down, with its keywords and whether a star falls in it. */
export function makeSegment(id: string, start: number, end: number, text: string, keywords: readonly Keyword[], stars: readonly number[], origin?: Segment['origin']): Segment {
  const clean = text.replace(/\s+/g, ' ').trim();
  return {
    id,
    start,
    end,
    text: clean,
    hits: matchKeywords(clean, keywords),
    starred: stars.some(s => s >= start - 1 && s < end + 1),
    ...(origin && { origin }),
  };
}

const flagged = (s: Segment) => s.starred || s.hits.length > 0;

/**
 * The next part to rewrite: passages after `upTo` (seconds), whole ones, until about PART_CHARS.
 * null while there isn't enough yet, unless `all` (the end of the class: whatever is left).
 */
export function nextPart(segments: readonly Segment[], upTo: number, all = false): { text: string; until: number } | null {
  const rest = segments.filter(s => s.start >= upTo - 0.01 && s.end > upTo && s.origin !== 'manquant').sort((a, b) => a.start - b.start);
  let size = 0;
  const take: Segment[] = [];
  for (const s of rest) {
    take.push(s);
    size += s.text.length + 1;
    if (size >= PART_CHARS) break;
  }
  if (!take.length || (!all && size < PART_CHARS)) return null;
  return { text: take.map(s => `${flagged(s) ? '⚑ ' : ''}${s.text}`).join('\n'), until: take[take.length - 1].end };
}

/** A part as it is when the AI can't rewrite it: the passages, with their time. */
export function rawPart(segments: readonly Segment[], from: number, until: number, title: string): Part {
  const text = segments
    .filter(s => s.start >= from - 0.01 && s.end <= until + 0.01)
    .map(s => `**${clock(s.start)}** ${flagged(s) ? '(⚑) ' : ''}${s.origin === 'manquant' ? `*(${t('passage non transcrit')})*` : s.text}`)
    .join('\n\n');
  return { title, text, points: [], until, raw: true };
}

export interface CourseInfo {
  title: string;
  /** « lundi 19 octobre 2026 ». */
  date: string;
  seconds: number;
  parts: readonly Part[];
  alerts: readonly Alert[];
  /** Passages that couldn't be written down (no transcription left today, network…). */
  missing?: number;
}

/** Heading of the list that also lets a revision sheet or an exam be made later, from the document alone. */
export const ESSENTIAL = t('L’essentiel à retenir');
const MOMENTS = t('Moments signalés');
/** The same headings in French: a document made before switching language is still read back. */
const ESSENTIAL_FR = 'L’essentiel à retenir';
const MOMENTS_FR = 'Moments signalés';

/** The moments marked (keyword heard, or by hand), as lines for the document and the AI. */
export function momentLines(alerts: readonly Alert[]): string[] {
  // Two keywords in one sentence (« ceci tombera à l'examen »): one line.
  const groups: { time: number; words: string[]; excerpt: string }[] = [];
  for (const a of [...alerts].sort((x, y) => x.time - y.time)) {
    const same = groups.find(g => g.excerpt === a.excerpt && Math.abs(g.time - a.time) < 5);
    const word = a.keyword ? t('« {keyword} »', { keyword: a.keyword }) : t('moment marqué');
    if (same) {
      if (!same.words.includes(word)) same.words.push(word);
    } else groups.push({ time: a.time, words: [word], excerpt: a.excerpt });
  }
  // Marked before anything was said: the time alone, not « moment marqué : Moment marqué ».
  return groups.map(g => (g.excerpt ? t('{time} · {words} : {excerpt}', { time: clock(g.time), words: g.words.join(', '), excerpt: g.excerpt }) : `${clock(g.time)} · ${g.words.join(', ')}`));
}

/** The course document, in the Markdown that lib/docx turns into Word. */
export function courseMarkdown(c: CourseInfo): string {
  const out = [`# ${c.title}`, `*${t('{date} · {duration} · enregistré et rédigé avec Kompaly', { date: c.date, duration: duration(c.seconds) })}*`];
  if (c.parts.some(p => p.raw)) out.push(`> ${t('Une partie n’a pas pu être rédigée par l’IA : elle est recopiée telle qu’elle a été entendue.')}`);
  if (c.missing) out.push(`> ${tn(c.missing, 'Un passage n’a pas pu être transcrit : ce document peut être incomplet.', '{n} passages n’ont pas pu être transcrits : ce document peut être incomplet.')}`);
  c.parts.forEach((p, i) => {
    out.push(`## ${p.title || t('Partie {n}', { n: i + 1 })}`);
    // The AI writes its subtitles with ### : they stay below the part's title.
    out.push(p.text.replace(/^#{1,2}\s/gm, '### '));
  });
  if (c.alerts.length) out.push(`## ${MOMENTS}`, ...momentLines(c.alerts).map(l => `- ${l}`));
  const points = c.parts.flatMap(p => p.points);
  if (points.length) out.push(`## ${ESSENTIAL}`, ...points.map(p => `- ${p}`));
  return out.join('\n\n') + '\n';
}

/** The plan and the essentials of a course document made by Kompaly (read back from the file), else null. */
export function essentialsOf(text: string): { points: string[]; moments: string[] } | null {
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim());
  const plain = (l: string) => l.replace(/[’']/g, "'").replace(/ pendant le cours$/, '');
  const is = (l: string, titles: string[]) => titles.some(title => plain(l) === plain(title));
  const headings = [ESSENTIAL_FR, ESSENTIAL, MOMENTS_FR, MOMENTS];
  const section = (titles: string[]) => {
    const at = lines.findIndex(l => is(l, titles));
    if (at < 0) return [];
    const out: string[] = [];
    for (const l of lines.slice(at + 1)) {
      if (!l) continue;
      // The next heading: a short line that isn't an item (mammoth's raw text loses the markers).
      if (is(l, headings)) break;
      out.push(l.replace(/^[-•◦]\s*/, ''));
    }
    return out;
  };
  const points = section([ESSENTIAL_FR, ESSENTIAL]);
  return points.length ? { points, moments: section([MOMENTS_FR, MOMENTS]) } : null;
}

/** Long text → pieces of about `size` characters, cut between paragraphs (or sentences). */
export function chunkText(text: string, size = 10_000): string[] {
  const paras = text.replace(/\r/g, '').split(/\n+/).map(p => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = '';
  };
  for (const p of paras) {
    if (p.length > size) {
      push();
      for (const s of p.match(new RegExp(`[^]{1,${size}}(?=\\s|$)`, 'g')) ?? [p]) out.push(s.trim());
      continue;
    }
    if (cur.length + p.length + 1 > size) push();
    cur += `${p}\n`;
  }
  push();
  return out;
}

/** « 2026-10-19 – Droit des contrats » : how the files of a class are named. */
export function baseName(title: string, date: Date): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${d} – ${title.replace(/[\\/:*?"<>|]+/g, '-').trim() || t('Enregistrement')}`;
}
