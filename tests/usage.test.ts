import { afterEach, describe, expect, it } from 'vitest';

// The stores reach for the browser when they load: give them the two globals they read.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { CATEGORIES, applyUsage, guessCategory } = await import('../src/store/calendar');
const { useSettings } = await import('../src/store/settings');

afterEach(() => {
  useSettings.setState({ usage: 'etudes' });
  applyUsage('etudes');
});

describe('usage', () => {
  it('keeps the student guesses by default', () => {
    expect(guessCategory('Partiel de maths')).toBe('examen');
    expect(guessCategory('Réunion client')).toBe('perso');
  });
  it('understands work words for a work account', () => {
    useSettings.setState({ usage: 'travail' });
    expect(guessCategory('Réunion client jeudi')).toBe('cours');
    expect(guessCategory('Envoyer le devis Dupont')).toBe('devoir');
    expect(guessCategory('Deadline site web')).toBe('examen');
  });
  it('renames the categories', () => {
    applyUsage('travail');
    expect(CATEGORIES.cours.label).toBe('Réunion');
    expect(CATEGORIES.devoir.label).toBe('Devis');
    applyUsage('etudes');
    expect(CATEGORIES.cours.label).toBe('Cours');
  });
});
