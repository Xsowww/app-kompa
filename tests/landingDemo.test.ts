import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../src/lib/dates';
import { demoMonday, demoPlace, exampleBase, keyOf, mondayOf, rowsFor, weekOf, weeksAhead, type DemoItem } from '../src/pages/landingDemo';

// Vendredi 6 novembre 2026, 10 h.
const friday = new Date(2026, 10, 6, 10);
const monday = new Date(2026, 10, 2, 10);

describe('semaine de la démo', () => {
  it('lundi de la semaine, ses 7 jours', () => {
    expect(mondayOf('2026-11-06')).toBe('2026-11-02');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02'); // dimanche
    expect(weekOf('2026-10-26')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  });
  it('cette semaine tant que mardi est à venir, sinon la suivante', () => {
    expect(demoMonday(monday)).toBe('2026-11-02');
    expect(demoMonday(new Date(2026, 10, 3, 9))).toBe('2026-11-02');
    expect(demoMonday(friday)).toBe('2026-11-09');
    expect(weeksAhead('2026-11-09', friday)).toBe(1);
    expect(weeksAhead('2026-11-02', friday)).toBe(0);
  });
  it('les exemples (mercredi, jeudi, vendredi) tombent dans la semaine montrée, quel que soit le jour', () => {
    for (let d = 2; d <= 8; d++) {
      const now = new Date(2026, 10, d, 19);
      const shown = demoMonday(now);
      for (const s of ['Judo de Léo mercredi 14h', 'Réviser le partiel jeudi 18h', 'Relancer M. Dupont vendredi 10h']) {
        const date = parseQuickAdd(s, exampleBase(now), 'fr').date!;
        expect(mondayOf(date), `${s}, le ${d}`).toBe(shown);
        expect(date >= keyOf(now)).toBe(true);
      }
    }
  });
});

describe('demoPlace', () => {
  const place = (s: string) => demoPlace(parseQuickAdd(s, friday, 'fr'), '2026-11-06');
  it('une heure : un événement', () => {
    expect(place('Réviser le partiel jeudi 18h')).toEqual({ kind: 'event', title: 'Réviser le partiel', date: '2026-11-12', start: '18:00' });
    expect(place('Appeler mamie 19h')).toEqual({ kind: 'event', title: 'Appeler mamie', date: '2026-11-06', start: '19:00' });
  });
  it('sans heure : une tâche, avec ou sans jour', () => {
    expect(place('Relancer M. Dupont vendredi')).toEqual({ kind: 'task', title: 'Relancer M. Dupont', date: '2026-11-13', start: null });
    expect(place('Acheter du pain')).toEqual({ kind: 'task', title: 'Acheter du pain', date: null, start: null });
  });
  it('rien à ajouter', () => {
    expect(place('demain 14h')).toEqual({ error: 'empty' });
    expect(place('Exam le 31/11')).toEqual({ error: 'impossible' });
  });
});

describe('rowsFor', () => {
  const ex = (id: number, date: string, start: string): DemoItem => ({ id, kind: 'event', title: `ex${id}`, date, start, color: '', example: true });
  const items: DemoItem[] = [ex(1, '2026-11-09', '09:00'), ex(2, '2026-11-12', '08:30'), ex(3, '2026-11-15', '12:30')];
  it('les exemples font de la place aux phrases du visiteur, dans l’ordre de la semaine', () => {
    const mine: DemoItem = { id: 10, kind: 'event', title: 'Judo', date: '2026-11-11', start: '14:00', color: '' };
    const task: DemoItem = { id: 11, kind: 'task', title: 'Pain', date: null, start: null, color: '' };
    expect(rowsFor(items, '2026-11-09').map(i => i.id)).toEqual([1, 2, 3]);
    expect(rowsFor([...items, mine], '2026-11-09').map(i => i.id)).toEqual([1, 10, 2, 3]);
    expect(rowsFor([...items, mine, task], '2026-11-09').map(i => i.id)).toEqual([1, 10, 2, 11]);
  });
  it('une autre semaine : seulement ce qui y tombe', () => {
    const later: DemoItem = { id: 12, kind: 'task', title: 'Passeport', date: '2026-12-01', start: null, color: '' };
    expect(rowsFor([...items, later], mondayOf('2026-12-01')).map(i => i.id)).toEqual([12]);
  });
});
