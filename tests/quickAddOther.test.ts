import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../src/lib/dates';

// Monday 19 October 2026, 10:00.
const base = new Date(2026, 9, 19, 10, 0);
const p = (lang: 'en' | 'es' | 'de' | 'it', s: string) => parseQuickAdd(s, base, lang);

describe('saisie rapide dans les autres langues', () => {
  it('anglais', () => {
    expect(p('en', 'Dentist Tuesday 5pm')).toMatchObject({ title: 'Dentist', date: '2026-10-20', start: '17:00' });
    expect(p('en', 'Call mum tomorrow at 9:30')).toMatchObject({ title: 'Call mum', date: '2026-10-20', start: '09:30' });
    expect(p('en', 'Gym next Friday 6-7pm')).toMatchObject({ title: 'Gym', date: '2026-10-30', start: '18:00', end: '19:00' });
    expect(p('en', 'Essay due November 12th urgent')).toMatchObject({ title: 'Essay', date: '2026-11-12', important: true });
    expect(p('en', 'Team meeting every Monday 14:00')).toMatchObject({ title: 'Team meeting', date: '2026-10-19', start: '14:00', weekly: true });
    expect(p('en', 'Report on 12/11')).toMatchObject({ title: 'Report', date: '2026-11-12' });
  });
  it('espagnol', () => {
    expect(p('es', 'Dentista el martes a las 17')).toMatchObject({ title: 'Dentista', date: '2026-10-20', start: '17:00' });
    expect(p('es', 'Examen pasado mañana 9:00')).toMatchObject({ title: 'Examen', date: '2026-10-21', start: '09:00' });
    expect(p('es', 'Reunión de 14 a 16 el 3 de noviembre')).toMatchObject({ title: 'Reunión', date: '2026-11-03', start: '14:00', end: '16:00' });
  });
  it('allemand', () => {
    expect(p('de', 'Zahnarzt Dienstag um 17 Uhr')).toMatchObject({ title: 'Zahnarzt', date: '2026-10-20', start: '17:00' });
    expect(p('de', 'Klausur am 12.11. wichtig')).toMatchObject({ title: 'Klausur', date: '2026-11-12', important: true });
    expect(p('de', 'Sport übermorgen 18:30')).toMatchObject({ title: 'Sport', date: '2026-10-21', start: '18:30' });
    expect(p('de', 'Abgabe nächsten Freitag')).toMatchObject({ title: 'Abgabe', date: '2026-10-30' });
  });
  it('italien', () => {
    expect(p('it', 'Dentista martedì alle 17')).toMatchObject({ title: 'Dentista', date: '2026-10-20', start: '17:00' });
    expect(p('it', 'Esame domani 9:30')).toMatchObject({ title: 'Esame', date: '2026-10-20', start: '09:30' });
    expect(p('it', 'Consegna il 5 novembre')).toMatchObject({ title: 'Consegna', date: '2026-11-05' });
  });
  it('sans date ni heure reconnue : le français prend le relais, sinon le texte reste', () => {
    expect(p('en', 'Buy milk')).toMatchObject({ title: 'Buy milk', date: null, start: null });
    expect(p('en', 'Dentiste demain 9h')).toMatchObject({ title: 'Dentiste', date: '2026-10-20', start: '09:00' });
  });
});
