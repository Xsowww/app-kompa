import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import { de, enGB, es, it as itLocale } from 'date-fns/locale';
import { datePattern, fmt, parseQuickAdd, hasStarted } from '../src/lib/dates';

// Mardi 13 octobre 2026, 10 h.
const base = new Date(2026, 9, 13, 10);

describe('parseQuickAdd', () => {
  it.each([
    ['Exam de maths vendredi 14h', { title: 'Exam de maths', date: '2026-10-16', start: '14:00', end: null }],
    ['Rendre TP le 12/11 à 9h30', { title: 'Rendre TP', date: '2026-11-12', start: '09:30', end: null }],
    ['Sport demain 18h-19h', { title: 'Sport', date: '2026-10-14', start: '18:00', end: '19:00' }],
    ['Révisions dans 2 semaines', { title: 'Révisions', date: '2026-10-27', start: null, end: null }],
    ['Partiel 3 novembre', { title: 'Partiel', date: '2026-11-03', start: null, end: null }],
    ['Dentiste mardi', { title: 'Dentiste', date: '2026-10-20', start: null, end: null }], // même jour → semaine suivante
    ['Juste une idée', { title: 'Juste une idée', date: null, start: null, end: null }],
    ['Exam mardi 3 novembre', { title: 'Exam', date: '2026-11-03', start: null, end: null }],
    ['Fête le 1er novembre', { title: 'Fête', date: '2026-11-01', start: null, end: null }],
    ['Exam 3 nov 14h', { title: 'Exam', date: '2026-11-03', start: '14:00', end: null }],
    ['Repas à midi', { title: 'Repas', date: null, start: '12:00', end: null }],
    ['Rendre DM vendredi soir', { title: 'Rendre DM', date: '2026-10-16', start: null, end: null }],
    ['Exam la semaine prochaine', { title: 'Exam', date: '2026-10-19', start: null, end: null }],
    ['Sport tous les jeudis à 18h', { title: 'Sport', date: '2026-10-15', start: '18:00', end: null, weekly: true }],
    ['Révisions 14-16', { title: 'Révisions 14-16', date: null, start: null, end: null }], // pas un 16e mois
    ['Anniversaire le 31/02', { title: 'Anniversaire le 31/02', date: null, start: null, end: null, impossible: true }],
    ['Rdv lundi 14h75', { title: 'Rdv 14h75', date: '2026-10-19', start: null, end: null }],
    ['Sport lundi de 18h à 9h', { title: 'Sport', date: '2026-10-19', start: '18:00', end: null }],
    ['Exam aujourd’hui 14h', { title: 'Exam', date: '2026-10-13', start: '14:00', end: null }], // apostrophe des téléphones
    ['Cours 14h–16h', { title: 'Cours', date: null, start: '14:00', end: '16:00' }], // tiret de la correction auto
    ['Déjeuner ce midi', { title: 'Déjeuner', date: '2026-10-13', start: '12:00', end: null }],
    ['Fête du 1er novembre', { title: 'Fête', date: '2026-11-01', start: null, end: null }],
    ['Rendre DM avant vendredi', { title: 'Rendre DM', date: '2026-10-16', start: null, end: null }],
    ['Exam hier', { title: 'Exam', date: '2026-10-12', start: null, end: null }],
    ['Exam de maths le 15', { title: 'Exam de maths', date: '2026-10-15', start: null, end: null }],
    ['Vacances du 20 au 25', { title: 'Vacances du 20 au 25', date: null, start: null, end: null }], // une plage : laissée telle quelle
    ['Rdv le 2 à 9h', { title: 'Rdv', date: '2026-11-02', start: '09:00', end: null }], // le 2 est passé : mois suivant
    ['Stage du 2 au 6 novembre', { title: 'Stage du 2 au 6 novembre', date: '2026-11-02', start: null, end: null }], // plage : premier jour, phrase intacte
    ['Vacances du 20 au 25 octobre', { title: 'Vacances du 20 au 25 octobre', date: '2026-10-20', start: null, end: null }],
    ['Voyage du 28 au 3 novembre', { title: 'Voyage du 28 au 3 novembre', date: '2026-10-28', start: null, end: null }], // commence le mois d’avant
  ])('%s', (input, expected) => {
    expect(parseQuickAdd(input, base)).toEqual(expected);
  });

  it('une date passée de plus d’un mois tombe l’année suivante', () => {
    expect(parseQuickAdd('Rentrée le 2/9', base).date).toBe('2027-09-02');
  });

  it('ignore une heure impossible', () => {
    expect(parseQuickAdd('Truc 25h', base).start).toBeNull();
  });
});

describe('fmt', () => {
  it('écrit « 1er » devant le mois', () => {
    expect(fmt(new Date(2026, 10, 1), 'EEEE d MMMM')).toBe('dimanche 1er novembre');
    expect(fmt(new Date(2026, 8, 1), 'd MMM yyyy')).toBe('1er sept. 2026');
    expect(fmt(new Date(2026, 10, 2), 'EEEE d MMMM')).toBe('lundi 2 novembre');
    expect(fmt(new Date(2026, 10, 1), 'dd/MM')).toBe('01/11');
  });

  it('allemand et espagnol : « Freitag, 23. Oktober », « viernes, 23 de octubre de 2026 »', () => {
    const fri = new Date(2026, 9, 23);
    const f = (l: 'de' | 'es' | 'it' | 'en', p: string) => format(fri, datePattern(p, l), { locale: { de, es, it: itLocale, en: enGB }[l] });
    expect(f('de', 'EEEE d MMMM')).toBe('Freitag, 23. Oktober');
    expect(f('de', 'EEE d MMM')).toBe('Fr., 23. Okt.');
    expect(f('de', 'd MMMM yyyy')).toBe('23. Oktober 2026');
    expect(f('de', 'EEEE d MMMM yyyy')).toBe('Freitag, 23. Oktober 2026');
    expect(f('de', 'dd/MM')).toBe('23/10');
    expect(f('es', 'EEEE d MMMM')).toBe('viernes, 23 de octubre');
    expect(f('es', 'd MMMM yyyy')).toBe('23 de octubre de 2026');
    expect(f('es', 'EEEE d MMMM yyyy')).toBe('viernes, 23 de octubre de 2026');
    expect(f('es', 'MMMM yyyy')).toBe('octubre de 2026');
    expect(f('it', 'EEEE d MMMM')).toBe('venerdì 23 ottobre');
    expect(f('en', 'EEEE d MMMM')).toBe('Friday 23 October');
  });
});

describe('hasStarted', () => {
  const now = new Date(2026, 9, 15, 19, 55);
  it('un examen commencé ou passé', () => {
    expect(hasStarted({ date: '2026-10-15', start: '19:00' }, now)).toBe(true);
    expect(hasStarted({ date: '2026-10-14' }, now)).toBe(true);
  });
  it('un examen à venir, ou sans heure aujourd’hui', () => {
    expect(hasStarted({ date: '2026-10-15', start: '21:00' }, now)).toBe(false);
    expect(hasStarted({ date: '2026-10-15' }, now)).toBe(false);
  });
});

describe('parseQuickAdd : important', () => {
  const base = new Date(2026, 9, 13, 10, 0);
  it.each([
    ['Rendre le dossier vendredi important', 'Rendre le dossier'],
    ['Réunion urgente demain 10h', 'Réunion'],
    ['Payer les impôts demain !', 'Payer les impôts'],
    ['Dentiste mardi (très important)', 'Dentiste'],
  ])('%s', (input, title) => {
    const p = parseQuickAdd(input, base);
    expect(p.important).toBe(true);
    expect(p.title).toBe(title);
  });
  it('sans mot-clé : pas important', () => {
    expect(parseQuickAdd('Sport demain 18h', base).important).toBeUndefined();
  });
});

describe('parseQuickAdd : durées et dates impossibles', () => {
  const base = new Date(2026, 9, 13, 10, 0);
  it.each([
    ['Réunion demain 10h pendant 2h', { title: 'Réunion', date: '2026-10-14', start: '10:00', end: '12:00' }],
    ['Réunion de 2h demain 10h', { title: 'Réunion', date: '2026-10-14', start: '10:00', end: '12:00' }], // « de 2h » : une durée, l’heure est 10h
    ['Réunion 10h pendant 1h30', { title: 'Réunion', date: null, start: '10:00', end: '11:30' }],
    ['Atelier demain 14h (1h)', { title: 'Atelier', date: '2026-10-14', start: '14:00', end: '15:00' }],
    ['Pause de 10 min à 15h', { title: 'Pause', date: null, start: '15:00', end: '15:10' }],
    ['Réunion 10h à midi demain', { title: 'Réunion', date: '2026-10-14', start: '10:00', end: '12:00' }],
    ['Cours de 9h à midi et demi', { title: 'Cours', date: null, start: '09:00', end: '12:30' }],
    ['Cours de 8h', { title: 'Cours', date: null, start: '08:00', end: null }], // seule heure : c’est le début
    ['Réunion de 14h à 16h', { title: 'Réunion', date: null, start: '14:00', end: '16:00' }],
  ])('%s', (input, expected) => {
    expect(parseQuickAdd(input, base)).toEqual(expected);
  });

  it('une date qui n’existe pas est signalée, pas remplacée en silence', () => {
    expect(parseQuickAdd('Visite le 31/11', base)).toMatchObject({ title: 'Visite le 31/11', date: null, impossible: true });
    expect(parseQuickAdd('Rdv 30 février', base)).toMatchObject({ date: null, impossible: true });
    expect(parseQuickAdd('Visite le 30/11', base).impossible).toBeUndefined();
  });
});
