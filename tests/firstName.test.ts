import { describe, expect, it } from 'vitest';
import { firstName } from '../src/lib/firstName';

// « Prénom » takes a full name too (test n°3: « Bonsoir, Dylan Test-Visiteur » on two lines): the greeting uses the first word.
describe('firstName', () => {
  it('keeps the first word of a full name', () => {
    expect(firstName('Dylan Test-Visiteur')).toBe('Dylan');
    expect(firstName('  Marie   Curie ')).toBe('Marie');
  });
  it('keeps a compound first name whole', () => {
    expect(firstName('Jean-Pierre Martin')).toBe('Jean-Pierre');
    expect(firstName('Lina')).toBe('Lina');
  });
  it('skips a title or an initial', () => {
    expect(firstName('M. Bernard Dupont')).toBe('Bernard');
    expect(firstName('Dr Gérard Petit')).toBe('Gérard');
    expect(firstName('Mme Chantal Roux')).toBe('Chantal');
  });
  it('never returns nothing for a name it was given', () => {
    expect(firstName('M.')).toBe('M.');
    expect(firstName('')).toBe('');
  });
});
