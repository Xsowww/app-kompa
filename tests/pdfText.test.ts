import { describe, expect, it } from 'vitest';
import { pageText } from '../src/lib/docText';

const item = (str: string, x: number, y: number, width: number, h = 10, hasEOL = false) => ({ str, transform: [h, 0, 0, h, x, y], width, height: h, hasEOL });

describe('PDF page text', () => {
  it('puts a space between words placed apart on a line', () => {
    expect(pageText([item('Droit', 0, 100, 25), item('civil', 28, 100, 20)])).toBe('Droit civil');
  });
  it('keeps pieces of one word together', () => {
    expect(pageText([item('respon', 0, 100, 30), item('sabilité', 30.5, 100, 40)])).toBe('responsabilité');
  });
  it('a new line when the line changes, never a second space', () => {
    expect(pageText([item('Chapitre 1 ', 0, 100, 50), item('Les', 0, 85, 15), item('contrats', 18, 85, 40, 10, true), item('Fin', 0, 70, 15)])).toBe('Chapitre 1 Les contrats\nFin');
    expect(pageText([item('Les', 0, 100, 15), item('contrats', 0, 85, 40)])).toBe('Les\ncontrats');
  });
});
