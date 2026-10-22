import { afterEach, describe, expect, it } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { guessCategory } = await import('../src/store/calendar');
const { useSettings } = await import('../src/store/settings');

afterEach(() => useSettings.setState({ usage: 'etudes', customCategories: [] }));

describe('guessed category', () => {
  it('a revision session typed by hand is never the exam itself', () => {
    for (const usage of ['etudes', 'perso'] as const) {
      useSettings.setState({ usage });
      expect(guessCategory('Révision partiel de droit', true)).toBe('devoir');
      expect(guessCategory('Réviser le contrôle de maths', true)).toBe('devoir');
      expect(guessCategory('Révisions exam de chimie')).toBe('devoir');
    }
    useSettings.setState({ usage: 'travail' });
    expect(guessCategory('Révision partiel de droit')).not.toBe('examen');
  });

  it('studies: nothing else changes', () => {
    expect(guessCategory('Partiel de droit')).toBe('examen');
    expect(guessCategory('Contrôle de maths', true)).toBe('examen');
    expect(guessCategory('TD de physique', true)).toBe('cours');
    expect(guessCategory('Rendre DM')).toBe('devoir');
    expect(guessCategory('Rendre TP', true)).toBe('devoir'); // « Rendre TP le 12/11 à 9h30 »: handed in, not a class
    expect(guessCategory('Rendu du TD 3', true)).toBe('devoir');
    expect(guessCategory('Projet tutoré')).toBe('devoir');
    expect(guessCategory('Dentiste')).toBe('perso');
    expect(guessCategory('Foot')).toBe('sport');
  });

  it('work: private life is Perso, a report or a project is not a quote', () => {
    useSettings.setState({ usage: 'travail' });
    expect(guessCategory('Dentiste', true)).toBe('perso');
    expect(guessCategory('Anniversaire de Léa')).toBe('perso');
    expect(guessCategory('Rendre le rapport')).toBe('examen');
    expect(guessCategory('Projet Dupont', true)).toBe('cours');
    expect(guessCategory('Projet Dupont')).not.toBe('devoir');
    expect(guessCategory('Envoyer le devis')).toBe('devoir');
    expect(guessCategory('Réunion client', true)).toBe('cours');
    expect(guessCategory('Livraison site client')).toBe('examen');
  });

  it('personal life: appointments, big days, things to do', () => {
    useSettings.setState({ usage: 'perso' });
    expect(guessCategory('Dentiste', true)).toBe('cours');
    expect(guessCategory('Anniversaire de Léa')).toBe('examen');
    expect(guessCategory('Payer les impôts')).toBe('devoir');
  });

  it('« Courses » (faire les courses) is not sport, a run still is', () => {
    for (const usage of ['etudes', 'perso', 'travail'] as const) {
      useSettings.setState({ usage });
      expect(guessCategory('Courses', true)).toBe('perso');
      expect(guessCategory('Faire les courses')).toBe('perso');
      expect(guessCategory('Course à pied', true)).toBe('sport');
      expect(guessCategory('Footing', true)).toBe('sport');
    }
    useSettings.setState({ usage: 'etudes' });
    expect(guessCategory('Cours de droit', true)).toBe('cours');
  });
});

describe('guessed category: whole words', () => {
  it('a word inside another is not the category (« Mathilde », « Déco », « secours », « prendre »)', () => {
    for (const usage of ['etudes', 'perso'] as const) {
      useSettings.setState({ usage });
      expect(guessCategory('Apéro chez Mathilde', true)).toBe('perso');
      expect(guessCategory('Déco du salon')).toBe('perso');
      expect(guessCategory('Biocoop')).toBe('perso');
      expect(guessCategory('Prendre le train', true)).toBe('perso');
      expect(guessCategory('Profiter du soleil')).toBe('perso');
      expect(guessCategory('Chorale', true)).toBe('perso');
    }
    useSettings.setState({ usage: 'etudes' });
    expect(guessCategory('Formation premiers secours')).toBe('perso');
    expect(guessCategory('Cours de maths', true)).toBe('cours');
    expect(guessCategory('Économie', true)).toBe('cours');
    expect(guessCategory('Oral d’anglais')).toBe('examen');
    useSettings.setState({ usage: 'travail' });
    expect(guessCategory('Déco du salon')).toBe('perso');
    expect(guessCategory('Prendre le train', true)).toBe('perso');
    expect(guessCategory('Salon de l’agriculture')).toBe('examen');
  });

  it('work: a « Point », a call or a video call is a meeting', () => {
    useSettings.setState({ usage: 'travail' });
    expect(guessCategory('Point équipe', true)).toBe('cours');
    expect(guessCategory('Point avec Marc', true)).toBe('cours');
    expect(guessCategory('Appel client', true)).toBe('cours');
    expect(guessCategory('Visio avec Sophie')).toBe('cours');
    expect(guessCategory('Point relais colis')).toBe('perso');
  });
});
