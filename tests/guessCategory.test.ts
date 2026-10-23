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

  it('the other site languages: their words too, whole words only', () => {
    useSettings.setState({ usage: 'etudes' });
    for (const x of ['Physics exam', 'Midterm', 'Maths test', 'Mathe-Klausur', 'Physikprüfung', 'Prüfung Chemie', 'Esame di fisica', 'Verifica di storia', 'Parcial de química', 'Quiz'])
      expect(guessCategory(x), x).toBe('examen');
    for (const x of ['History lesson', 'Lecture', 'Vorlesung Analysis', 'Deutschkurs', 'Seminar', 'Lezione di storia', 'Corso di inglese', 'Clase de historia'])
      expect(guessCategory(x, true), x).toBe('cours');
    for (const x of ['Homework', 'Essay assignment', 'Mathehausaufgaben', 'Abgabe Referat', 'Deberes de mates', 'Entrega del trabajo', 'Compiti di latino', 'Consegna relazione'])
      expect(guessCategory(x), x).toBe('devoir');
    for (const x of ['Gym', 'Gimnasio', 'Palestra', 'Fitness', 'Training', 'Entrenamiento', 'Allenamento'])
      expect(guessCategory(x, true), x).toBe('sport');
    // Not inside another word, and French stays French.
    for (const x of ['Testament', 'Contest', 'Classeur à acheter', 'Rendu final', 'Projet final'])
      expect(guessCategory(x), x).not.toBe('examen');
    expect(guessCategory('Rendu final')).toBe('devoir');

    useSettings.setState({ usage: 'perso' });
    for (const x of ['Dentist', 'Doctor', 'Zahnarzt', 'Hausarzt', 'Zahnarzttermin', 'Dentista', 'Médico', 'Cita con el banco', 'Appuntamento dal medico', 'Meeting', 'Reunión de vecinos', 'Riunione condominio', 'Elternbesprechung'])
      expect(guessCategory(x, true), x).toBe('cours');
    for (const x of ['Birthday party', 'Geburtstag von Lea', 'Kindergeburtstag', 'Compleanno di Marco', 'Cumpleaños de Ana'])
      expect(guessCategory(x), x).toBe('examen');
    expect(guessCategory('Doctorat : dossier')).not.toBe('cours');

    useSettings.setState({ usage: 'travail' });
    for (const x of ['Dentist', 'Zahnarzt', 'Dentista', 'Birthday drinks', 'Geburtstag von Lea'])
      expect(guessCategory(x, true), x).toBe('perso');
    for (const x of ['Client meeting', 'Kundentermin', 'Teambesprechung', 'Reunión con cliente', 'Riunione cliente', 'Appuntamento con il fornitore', 'Appointment with Sam'])
      expect(guessCategory(x, true), x).toBe('cours');
    for (const x of ['Abgabe Bericht', 'Entrega del informe', 'Consegna progetto'])
      expect(guessCategory(x), x).toBe('examen');
    expect(guessCategory('Abgabetermin Bericht')).toBe('examen');
    expect(guessCategory('Soutenance de doctorat')).toBe('examen');
  });
});
