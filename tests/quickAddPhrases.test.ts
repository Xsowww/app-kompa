import { afterEach, describe, expect, it } from 'vitest';

// The phrases of the visitors' test (n°2): one event over several days, repeats, categories, the hour in a long sentence.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { parseQuickAdd } = await import('../src/lib/dates');
const { guessCategory, useCalendar } = await import('../src/store/calendar');
const { useSettings } = await import('../src/store/settings');
const { localReply } = await import('../src/copilot/localBrain');
const { isSpan } = await import('../src/lib/repeat');

// Jeudi 5 novembre 2026, 16 h.
const base = new Date(2026, 10, 5, 16);
const fr = (s: string) => parseQuickAdd(s, base, 'fr');

afterEach(() => useSettings.setState({ usage: 'etudes' }));

describe('quick add: one event over several days', () => {
  it.each([
    ['Congés du 22 au 26 décembre', { title: 'Congés', date: '2026-12-22', endDate: '2026-12-26' }],
    ['Congés du 28 décembre au 2 janvier', { title: 'Congés', date: '2026-12-28', endDate: '2027-01-02' }],
    ['Voyage du 28 au 3 janvier', { title: 'Voyage', date: '2026-12-28', endDate: '2027-01-03' }],
    ['Vacances du 22/12 au 26/12', { title: 'Vacances', date: '2026-12-22', endDate: '2026-12-26' }],
    ['Partiels du 12/01 au 16/01/2027', { title: 'Partiels', date: '2027-01-12', endDate: '2027-01-16' }],
    ['Voyage du lundi 21 au vendredi 25 décembre', { title: 'Voyage', date: '2026-12-21', endDate: '2026-12-25' }],
    ['Congés 22-26 décembre', { title: 'Congés', date: '2026-12-22', endDate: '2026-12-26' }],
    ['Stage du 22 au 26', { title: 'Stage', date: '2026-11-22', endDate: '2026-11-26' }],
    ['Stage du 2 au 6', { title: 'Stage', date: '2026-12-02', endDate: '2026-12-06' }], // the 2nd is past: next month
    ['Séminaire du 3 au 5 mars de 9h à 17h', { title: 'Séminaire', date: '2027-03-03', endDate: '2027-03-05', start: '09:00', end: '17:00' }],
  ])('%s', (input, expected) => expect(fr(input)).toMatchObject(expected));

  it('a time range or numbers are not days: « de 14 à 16h », « Révisions 14-16 », « exercices 5-6 »', () => {
    expect(fr('Cours de 14h à 16h')).toMatchObject({ start: '14:00', end: '16:00' });
    expect(fr('Révisions 14-16')).toMatchObject({ title: 'Révisions 14-16', date: null });
    expect(fr('Faire exercices 5-6')).toMatchObject({ title: 'Faire exercices 5-6', date: null });
    expect(fr('Congés du 22 au 26 décembre').endDate).toBeDefined();
    expect(fr('Dentiste le 22 décembre')).not.toHaveProperty('endDate');
  });

  it('a day that does not exist is said, not guessed', () => {
    expect(fr('Congés du 30 au 31 février')).toMatchObject({ date: null, impossible: true });
  });
});

describe('quick add: repeats', () => {
  it.each([
    ['Yoga chaque mardi 18h', { title: 'Yoga', date: '2026-11-10', start: '18:00', every: 'week', weekly: true }],
    ['Sport tous les jeudis', { title: 'Sport', date: '2026-11-05', every: 'week' }],
    ['Yoga toutes les semaines', { title: 'Yoga', date: null, every: 'week', weekly: true }],
    ['Piscine toutes les semaines le mercredi à 17h', { title: 'Piscine', date: '2026-11-11', start: '17:00', every: 'week' }],
    ['Réunion d’équipe chaque semaine lundi 9h', { title: 'Réunion d’équipe', date: '2026-11-09', start: '09:00', every: 'week' }],
    ['Garde une semaine sur deux le vendredi', { title: 'Garde', date: '2026-11-06', every: '2weeks' }],
    ['Méditation tous les jours 7h', { title: 'Méditation', start: '07:00', every: 'day' }],
    ['Loyer tous les mois le 5', { title: 'Loyer', every: 'month' }],
    ['Anniversaire de Léa le 12 mars tous les ans', { title: 'Anniversaire de Léa', date: '2027-03-12', every: 'year', yearly: true }],
  ])('%s', (input, expected) => expect(fr(input)).toMatchObject(expected));
});

describe('quick add: the hour in a long sentence', () => {
  it.each([
    ['Relancer M. Durand jeudi prochain vers 10h pour le dossier', { title: 'Relancer M. Durand pour le dossier', date: '2026-11-12', start: '10:00' }],
    ['Appeler le plombier demain vers 14h pour la fuite de la cuisine', { title: 'Appeler le plombier pour la fuite de la cuisine', date: '2026-11-06', start: '14:00' }],
    ['Rdv chez le notaire mardi prochain à 15h30 pour signer le compromis', { title: 'Rdv chez le notaire pour signer le compromis', date: '2026-11-10', start: '15:30' }],
    ['RDV banque lundi 10h du matin', { title: 'RDV banque', date: '2026-11-09', start: '10:00' }],
    ['Garde de nuit vendredi 20h', { title: 'Garde de nuit', date: '2026-11-06', start: '20:00' }],
    ['Sortie rando dimanche 9h', { title: 'Sortie rando', date: '2026-11-08', start: '09:00' }],
  ])('%s', (input, expected) => expect(fr(input)).toMatchObject(expected));
});

describe('quick add: categories by usage (Réunion / Rendez-vous, not Perso)', () => {
  const cat = (usage: 'etudes' | 'travail' | 'perso', input: string) => {
    useSettings.setState({ usage });
    const p = fr(input);
    return guessCategory(p.title, !!p.start);
  };
  it('work: Réunion (cours) for a meeting, a call, an appointment; Livrable (devoir) for a follow-up; Perso for days off', () => {
    expect(cat('travail', 'Réunion d’équipe lundi 9h')).toBe('cours');
    expect(cat('travail', 'RDV banque lundi 9h')).toBe('cours');
    expect(cat('travail', 'Appeler M. Durand jeudi prochain vers 10h pour le dossier')).toBe('cours');
    expect(cat('travail', 'Rappeler le client demain 11h')).toBe('cours');
    expect(cat('travail', 'Conseil de classe mardi 17h')).toBe('cours');
    expect(cat('travail', 'Relancer M. Durand jeudi prochain vers 10h pour le dossier')).toBe('devoir');
    expect(cat('travail', 'Congés du 22 au 26 décembre')).toBe('perso');
    expect(cat('travail', 'Appeler le médecin demain 9h')).toBe('perso');
  });
  it('personal life: Rendez-vous (cours) for appointments and meetings, À faire (devoir) for a follow-up', () => {
    expect(cat('perso', 'RDV banque lundi 9h')).toBe('cours');
    expect(cat('perso', 'Réunion parents-profs jeudi 18h')).toBe('cours');
    expect(cat('perso', 'Conseil de classe mardi 17h')).toBe('cours');
    expect(cat('perso', 'Relancer M. Durand jeudi 10h')).toBe('devoir');
  });
  it('studies: unchanged (a class is a class, an exam an exam)', () => {
    expect(cat('etudes', 'Partiel de droit du 12/01 au 16/01')).toBe('examen');
    expect(cat('etudes', 'TD de physique mardi 8h')).toBe('cours');
  });
});

describe('quick add in the other languages of the site', () => {
  it.each([
    ['en', 'Holidays from 22 to 26 December', { title: 'Holidays', date: '2026-12-22', endDate: '2026-12-26' }],
    ['en', 'Trip December 22-26', { title: 'Trip', date: '2026-12-22', endDate: '2026-12-26' }],
    ['en', 'Yoga every week', { title: 'Yoga', every: 'week', weekly: true }],
    ['en', 'Gym every Tuesday 6pm', { title: 'Gym', date: '2026-11-10', start: '18:00', every: 'week' }],
    ['en', 'Call Mr Durand next Thursday around 10am about the file', { title: 'Call Mr Durand about the file', date: '2026-11-12', start: '10:00' }],
    ['de', 'Urlaub vom 22. bis 26. Dezember', { title: 'Urlaub', date: '2026-12-22', endDate: '2026-12-26' }],
    ['de', 'Urlaub 22.12.–26.12.', { title: 'Urlaub', date: '2026-12-22', endDate: '2026-12-26' }],
    ['de', 'Yoga jede Woche', { title: 'Yoga', every: 'week' }],
    ['de', 'Meeting 9.10-10.15', { title: 'Meeting', date: null, start: '09:10', end: '10:15' }],
    ['es', 'Vacaciones del 22 al 26 de diciembre', { title: 'Vacaciones', date: '2026-12-22', endDate: '2026-12-26' }],
    ['es', 'Yoga cada semana', { title: 'Yoga', every: 'week' }],
    ['es', 'Reunión de 14 a 16', { title: 'Reunión', start: '14:00', end: '16:00' }],
    ['it', 'Ferie dal 22 al 26 dicembre', { title: 'Ferie', date: '2026-12-22', endDate: '2026-12-26' }],
    ['it', 'Yoga ogni settimana', { title: 'Yoga', every: 'week' }],
  ] as const)('%s: %s', (language, input, expected) => expect(parseQuickAdd(input, base, language)).toMatchObject(expected));
});

describe('Kompaly without the AI understands it too', () => {
  it('« Ajoute congés du 22 au 26 décembre »: one event over several days', () => {
    useCalendar.setState({ events: [] });
    const reply = localReply('Ajoute congés du 22 au 26 décembre');
    const list = useCalendar.getState().events;
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every(e => e.title === 'Congés' && isSpan(e.series))).toBe(true);
    expect(reply.text).toMatch(/^Ajouté au calendrier : Congés/);
    expect(reply.text).toMatch(/Jusqu’au/);
  });
});
