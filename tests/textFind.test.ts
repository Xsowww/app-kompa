import { describe, expect, it } from 'vitest';
import { findIn, fold, folding, glue, highlightParts, original, pageAt, unhyphen } from '../src/lib/textFind';

const hits = (text: string, q: string) => highlightParts(text, q).filter(p => p.hit).map(p => p.text);

describe('search inside a file', () => {
  const text = fold('La respon- sabilité civile suppose un d o m m a g e réparable.');
  it('finds what is typed, ignoring case and accents', () => {
    expect(findIn(text, fold('Civile'))).toEqual({ at: text.indexOf('civile'), len: 6 });
    expect(findIn(text, fold('reparable')).at).toBeGreaterThan(0);
  });
  it('finds a word cut at the end of a line or spread out', () => {
    const r = findIn(text, fold('responsabilité'));
    expect(text.slice(r.at, r.at + r.len)).toBe('respon- sabilite');
    const d = findIn(text, 'dommage');
    expect(text.slice(d.at, d.at + d.len)).toBe('d o m m a g e');
    const m = fold('Chapitre 3 : la M I T O S E et la méiose');
    const s = findIn(m, 'mitose');
    expect(m.slice(s.at, s.at + s.len)).toBe('m i t o s e');
    // Typed spread out too.
    expect(findIn(m, 'm i t o s e').at).toBe(s.at);
  });
  it('a short word is not looked for across spaces', () => {
    expect(findIn(fold('le sol'), 'les').at).toBe(-1);
    expect(findIn(fold('rien ici'), 'absent').at).toBe(-1);
  });
  it('does not glue two words together', () => {
    expect(findIn(fold('Elle regarde la mer.'), 'lame').at).toBe(-1);
    expect(findIn(fold('Lorem ipsum dolore magna aliqua'), 'lorem').at).toBe(0);
    expect(findIn(fold('ipsum dolore magna aliqua'), 'lorem').at).toBe(-1);
    expect(findIn(fold('il y a un chat'), 'yaun').at).toBe(-1);
    // A hyphen between two words of the same line stays.
    expect(findIn(fold('porte-monnaie'), 'portemonnaie').at).toBe(-1);
  });
  it('« oe » finds « œ », and the other way round, at the right place', () => {
    const { folded, map } = folding('Le cœur du problème');
    expect(folded).toBe('le coeur du probleme');
    const r = original(map, folded.indexOf('coeur'), 5);
    expect('Le cœur du problème'.slice(r.at, r.at + r.len)).toBe('cœur');
    expect(original(map, folded.indexOf('probleme'), 8)).toEqual({ at: 11, len: 8 });
    expect(fold('Cœur')).toBe(fold('coeur'));
    expect(hits('Un ex æquo, du cœur à l’ouvrage', 'coeur')).toEqual(['cœur']);
    expect(hits('Un ex æquo', 'aequo')).toEqual(['æquo']);
  });
  it('glue() says where each glued character comes from', () => {
    const f = fold('a respon- sabilite et d r o i t');
    const g = glue(f);
    expect(g.text).toBe('a responsabilite et droit');
  });
});

describe('highlighting', () => {
  it('marks every match as typed', () => {
    expect(hits('Le Droit civil et le droit pénal', 'droit')).toEqual(['Droit', 'droit']);
  });
  it('marks a word found glued back', () => {
    expect(hits('La respon- sabilité civile', 'responsabilite')).toEqual(['respon- sabilité']);
    expect(hits('un d o m m a g e réparable', 'dommage')).toEqual(['d o m m a g e']);
  });
  it('keeps the text whole', () => {
    const parts = highlightParts('Le cœur a ses raisons', 'coeur');
    expect(parts.map(p => p.text).join('')).toBe('Le cœur a ses raisons');
    expect(highlightParts('rien', '')).toEqual([{ text: 'rien', hit: false }]);
  });
  it('writes a word cut at the end of a line whole again in an extract', () => {
    expect(unhyphen('la respon- sabilité civile, pré- et post-opératoire')).toBe('la responsabilité civile, pré- et post-opératoire');
  });
});

describe('page of a match in a PDF', () => {
  it('is the last page starting at or before it', () => {
    const starts = [0, 120, 120, 400];
    expect(pageAt(starts, 0)).toBe(1);
    expect(pageAt(starts, 119)).toBe(1);
    // Page 2 has no text: what starts there is on page 3.
    expect(pageAt(starts, 120)).toBe(3);
    expect(pageAt(starts, 5000)).toBe(4);
    expect(pageAt([0], 99)).toBe(1);
  });
});

describe('fold speed', () => {
  it('folds a big PDF quickly', () => {
    const words = 'Lorem ipsum DOLOR réseau élève délictuelle cœur '.split(' ');
    let s = '';
    while (s.length < 2_000_000) s += `${words[s.length % words.length]} `;
    const t = performance.now();
    const f = fold(s);
    expect(f.length).toBeGreaterThan(s.length);
    expect(performance.now() - t).toBeLessThan(1500);
  });
});
