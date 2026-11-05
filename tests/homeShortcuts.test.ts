import { describe, expect, it } from 'vitest';
import { shortcutKeys } from '../src/lib/homeShortcuts';

describe('home page shortcuts', () => {
  it('without answers: the usage’s ones, four', () => {
    expect(shortcutKeys('etudes', [])).toEqual(['import', 'record', 'focus', 'group']);
    expect(shortcutKeys('perso', undefined)[0]).toBe('agenda');
  });

  it('the questionnaire’s keys come first', () => {
    expect(shortcutKeys('etudes', ['agenda-partage'])[0]).toBe('agenda');
    expect(shortcutKeys('travail', ['fichiers', 'equipe']).slice(0, 2)).toEqual(['files', 'group']);
    expect(shortcutKeys('perso', ['reviser']).slice(0, 2)).toEqual(['focus', 'record']);
  });

  it('every key of the questionnaire is understood, never more than four, never twice', () => {
    for (const k of ['agenda', 'reviser', 'enregistrer', 'agenda-partage', 'equipe', 'notes', 'fichiers', 'taches', 'focus', 'ia']) {
      const s = shortcutKeys('etudes', [k]);
      expect(s.length).toBe(4);
      expect(new Set(s).size).toBe(4);
    }
    expect(shortcutKeys('etudes', ['agenda', 'reviser', 'enregistrer', 'agenda-partage', 'equipe', 'fichiers']).length).toBe(4);
  });
});
