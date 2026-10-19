import { describe, expect, it } from 'vitest';
import { passwordStrength } from '../src/lib/passwordStrength';

describe('force du mot de passe', () => {
  it('monte avec la longueur et la variété', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abc')).toBe(1);
    expect(passwordStrength('abcdefgh')).toBe(1); // pas de chiffre
    expect(passwordStrength('plage7riz')).toBe(1);
    expect(passwordStrength('Plage7rizBleu')).toBe(3);
    expect(passwordStrength('Plage7riz!Bleu-Ocean')).toBe(4);
  });
  it('reste faible pour les mots de passe connus, les suites et le prénom', () => {
    expect(passwordStrength('Azerty123456!')).toBe(1);
    expect(passwordStrength('Ab12345678!x')).toBe(1);
    expect(passwordStrength('Camille2026!Zz', ['Camille'])).toBe(1);
    expect(passwordStrength('Camille2026!Zz')).toBeGreaterThan(2);
  });
});
