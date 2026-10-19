import { afterEach, describe, expect, it } from 'vitest';
import { setDictForTests, t, tn } from '../src/i18n';

afterEach(() => setDictForTests('fr', {}));

describe('traduction', () => {
  it('rend le texte traduit, ou le français quand il manque', () => {
    setDictForTests('en', { 'Nouvelle tâche': 'New task', 'Bonjour {name}': 'Hi {name}' });
    expect(t('Nouvelle tâche')).toBe('New task');
    expect(t('Bonjour {name}', { name: 'Léa' })).toBe('Hi Léa');
    expect(t('Pas encore traduit')).toBe('Pas encore traduit');
  });
  it('choisit le pluriel selon la langue', () => {
    expect(tn(0, '{n} tâche', '{n} tâches')).toBe('0 tâche');
    expect(tn(2, '{n} tâche', '{n} tâches')).toBe('2 tâches');
    setDictForTests('en', { '{n} tâche': '{n} task', '{n} tâches': '{n} tasks' });
    expect(tn(0, '{n} tâche', '{n} tâches')).toBe('0 tasks');
    expect(tn(1, '{n} tâche', '{n} tâches')).toBe('1 task');
  });
});

describe('contexte', () => {
  it('ne montre jamais le contexte après ||', () => {
    expect(t('En cours||ce qui avance')).toBe('En cours');
    setDictForTests('en', { 'En cours||ce qui avance': 'In progress' });
    expect(t('En cours||ce qui avance')).toBe('In progress');
  });
});

describe('dictionnaires', () => {
  it('chaque texte du site est traduit dans chaque langue, avec les mêmes {variables}', async () => {
    // @ts-expect-error -- plain JavaScript script
    const { check } = await import('../scripts/i18n.mjs');
    const r = check();
    expect(r.dynamic).toEqual([]);
    for (const [lang, v] of Object.entries(r.langs) as [string, { missing: string[]; badVars: string[] }][]) {
      expect({ lang, missing: v.missing.slice(0, 5), badVars: v.badVars.slice(0, 5) }).toEqual({ lang, missing: [], badVars: [] });
    }
  });
});
