// « Réviser 2h » : deux heures de révision, pas un rendez-vous à 2 h du matin.
import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../src/lib/dates';

// Jeudi 12 novembre 2026, 10 h.
const base = new Date(2026, 10, 12, 10, 0);
const fr = (s: string) => parseQuickAdd(s, base, 'fr');
const en = (s: string) => parseQuickAdd(s, base, 'en');

describe('une durée après une activité n’est pas une heure du matin', () => {
  it.each([
    ['Réviser 2h', 'Réviser 2h'],
    ['Réviser 2 h', 'Réviser 2 h'],
    ['réviser 2 heures', 'Réviser 2 heures'],
    ['Réviser les maths 2h', 'Réviser les maths 2h'],
    ['Réviser 2h les maths', 'Réviser 2h les maths'],
    ['Travailler 1h30', 'Travailler 1h30'],
    ['Révisions 3 heures', 'Révisions 3 heures'],
    ['Lire 1h', 'Lire 1h'],
    ['Courir 1h', 'Courir 1h'],
    ['Réviser 2h, important', 'Réviser 2h'],
    ['rappelle-moi de réviser 2h', 'Rappelle-moi de réviser 2h'],
  ])('« %s » : pas d’heure, la durée reste dans le titre', (said, title) => {
    const r = fr(said);
    expect([r.title, r.start, r.end]).toEqual([title, null, null]);
    expect(JSON.stringify(r)).not.toContain('⁠');
  });

  it('avec un jour : ce jour-là, toujours sans heure', () => {
    expect(fr('Réviser 2h demain')).toMatchObject({ title: 'Réviser 2h', date: '2026-11-13', start: null });
    expect(fr('Lire 1h ce soir')).toMatchObject({ title: 'Lire 1h', date: '2026-11-12', start: null });
  });

  it('avec une heure de début ailleurs dans la phrase : la durée donne la fin', () => {
    expect(fr('Réviser 2h demain 14h')).toMatchObject({ title: 'Réviser', date: '2026-11-13', start: '14:00', end: '16:00' });
    expect(fr('Travailler 1h30 demain 9h')).toMatchObject({ title: 'Travailler', start: '09:00', end: '10:30' });
    // Une fin après minuit : pas de fin inventée.
    expect(fr('Réviser 3h ce soir 22h')).toMatchObject({ title: 'Réviser', start: '22:00', end: null });
  });

  it.each([
    ['Réviser à 14h', '14:00', null],
    ['Réviser à 2h', '02:00', null],
    ['Réviser vers 2h', '02:00', null],
    ['Réviser 2h du matin', '02:00', null],
    ['Réviser 14h', '14:00', null],
    ['Réviser 7h', '07:00', null],
    ['Réviser 14h-16h', '14:00', '16:00'],
    ['Réviser 2h-4h', '02:00', '04:00'],
    ['Réviser de 2h à 4h', '02:00', '04:00'],
    ['Dentiste 2h', '02:00', null],
    ['Train 5h', '05:00', null],
  ])('« %s » reste une heure', (said, start, end) => {
    const r = fr(said);
    expect([r.start, r.end]).toEqual([start, end]);
    expect(r.title).toBe(said.split(' ')[0]);
  });

  it('« demain 9h cours » et les phrases habituelles ne changent pas', () => {
    expect(fr('demain 9h cours')).toMatchObject({ title: 'Cours', date: '2026-11-13', start: '09:00', end: null });
    expect(fr('Sport demain 18h-19h')).toMatchObject({ title: 'Sport', date: '2026-11-13', start: '18:00', end: '19:00' });
    expect(fr('Réviser pendant 2h demain 10h')).toMatchObject({ title: 'Réviser', start: '10:00', end: '12:00' });
  });

  it.each([
    ['Study 2h', 'Study 2h'],
    ['Study 2 hours', 'Study 2 hours'],
    ['Study for 2 hours', 'Study for 2 hours'],
    ['Read 1h', 'Read 1h'],
  ])('en anglais « %s » : pas d’heure', (said, title) => {
    const r = en(said);
    expect([r.title, r.start, r.end]).toEqual([title, null, null]);
  });

  it('en anglais, les heures restent des heures', () => {
    expect(en('Study at 2pm')).toMatchObject({ title: 'Study', start: '14:00' });
    expect(en('Study 2pm')).toMatchObject({ title: 'Study', start: '14:00' });
    expect(en('Study 2-4pm')).toMatchObject({ title: 'Study', start: '14:00', end: '16:00' });
    expect(en('Work 3h tomorrow 9am')).toMatchObject({ title: 'Work', date: '2026-11-13', start: '09:00', end: '12:00' });
    expect(en('Dentist tomorrow 2pm')).toMatchObject({ title: 'Dentist', date: '2026-11-13', start: '14:00' });
  });
});

describe('« 2h à 14h » : une durée puis une heure', () => {
  it.each([
    ['Réviser 2h à 14h', '14:00', '16:00'],
    ['Réviser 2h à midi', '12:00', '14:00'],
    ['Réviser 2h à 4h', '02:00', '04:00'],
  ])('%s', (text, start, end) => {
    const r = fr(text);
    expect([r.start, r.end]).toEqual([start, end]);
  });
});
