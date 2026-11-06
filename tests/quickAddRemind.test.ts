// Test n°3 (Majeur n°6): the reminder said in a quick add is the one made — « 1 h » is 1 h, « à 7h » is 7:00,
// « sans rappel » is none — and its hour is never read as the event's start.
import { describe, expect, it } from 'vitest';
import { parseQuickAdd, remindMinutes } from '../src/lib/dates';
import { reminderMoment } from '../src/lib/reminders';

const base = new Date(2026, 10, 6, 10, 0); // Friday 6 November 2026
const hhmm = (d: Date) => `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const made = (s: string) => {
  const p = parseQuickAdd(s, base, 'fr', true);
  return { p, list: remindMinutes(p.remind, p.date!, p.start) };
};

describe('rappel dit dans la phrase', () => {
  it('« rappel 1h avant » makes 1 h, not the usual 15 min', () => {
    const { p, list } = made('Dentiste demain 16h rappel 1h avant');
    expect(p.title).toBe('Dentiste');
    expect(p.start).toBe('16:00');
    expect(list).toEqual([60]);
  });
  it('« rappel à 7h » rings at 7:00, and 7h is not the start', () => {
    const { p, list } = made('Réunion lundi 9h rappel à 7h');
    expect(p.start).toBe('09:00');
    expect(hhmm(reminderMoment(p.date!, p.start!, list![0]))).toBe('9 07:00');
  });
  it('« rappelle-moi la veille à 18h »', () => {
    const { p, list } = made('Kiné mardi 14h rappelle-moi la veille à 18h');
    expect(p.title).toBe('Kiné');
    expect(hhmm(reminderMoment(p.date!, p.start!, list![0]))).toBe('9 18:00');
  });
  it('« sans rappel » makes none', () => {
    const { p, list } = made('Courses samedi 10h sans rappel');
    expect(p.title).toBe('Courses');
    expect(list).toEqual([]);
  });
  it('nothing said: the usual ones', () => {
    expect(made('Sport demain 18h').list).toBeUndefined();
  });
});

describe('le lieu dans « Lieu », pas dans le titre', () => {
  const where = (s: string) => {
    const p = parseQuickAdd(s, base, 'fr', true);
    return [p.title, p.place];
  };
  it('« à la mairie », « chez le kiné », « au CHU », « salle B12 »', () => {
    expect(where('Mariage de Paul samedi 15h à la mairie')).toEqual(['Mariage de Paul', 'Mairie']);
    expect(where('Rendez-vous chez le kiné jeudi 10h')).toEqual(['Rendez-vous', 'Chez le kiné']);
    expect(where('Garde de nuit au CHU lundi 21h-7h')).toEqual(['Garde de nuit', 'CHU']);
    expect(where('TD de maths salle B12 mardi 8h')).toEqual(['TD de maths', 'Salle B12']);
    expect(where('Dîner chez Marie avec Paul samedi 20h')).toEqual(['Dîner avec Paul', 'Chez Marie']);
    expect(where('Rdv chez le notaire mardi prochain à 15h30 pour signer le compromis')).toEqual(['Rdv pour signer le compromis', 'Chez le notaire']);
  });
  it('no place: the title as it was', () => {
    expect(where('Réunion au sujet du budget lundi 9h')).toEqual(['Réunion au sujet du budget', undefined]);
    expect(where('Chez le kiné jeudi 10h')).toEqual(['Chez le kiné', undefined]);
    expect(where('Exam de maths vendredi 14h')).toEqual(['Exam de maths', undefined]);
  });
});
