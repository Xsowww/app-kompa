import { describe, expect, it } from 'vitest';
import { findIn, fold } from '../src/lib/textFind';

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
  });
  it('a short word is not looked for across spaces', () => {
    expect(findIn(fold('le sol'), 'les').at).toBe(-1);
    expect(findIn(fold('rien ici'), 'absent').at).toBe(-1);
  });
});
