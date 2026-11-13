import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../src/lib/dates';
import { demoKept, demoMonday, demoPlace, exampleBase, keyOf, mondayOf, nightEnd, rowsFor, splitSentence, weekOf, weeksAhead, type DemoItem } from '../src/pages/landingDemo';

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
  const place = (s: string) => demoPlace(parseQuickAdd(s, friday, 'fr'), '2026-11-06', s);
  it('une heure : un événement', () => {
    expect(place('Réviser le partiel jeudi 18h')).toEqual({ kind: 'event', title: 'Réviser le partiel', date: '2026-11-12', start: '18:00', end: null });
    expect(place('Appeler mamie 19h')).toEqual({ kind: 'event', title: 'Appeler mamie', date: '2026-11-06', start: '19:00', end: null });
  });
  it('une plage : son heure de fin ; la nuit, le lendemain matin', () => {
    expect(place('Cours de 9h à 11h lundi')).toEqual({ kind: 'event', title: 'Cours', date: '2026-11-09', start: '09:00', end: '11:00' });
    expect(place('Garde de nuit lundi 21h-7h')).toEqual({ kind: 'event', title: 'Garde de nuit', date: '2026-11-09', start: '21:00', end: '07:00', nextDay: true });
    expect(place('Garde de nuit lundi de 22h à 6h30')).toMatchObject({ start: '22:00', end: '06:30', nextDay: true });
  });
  it('les exemples de l’accueil', () => {
    expect(place('Cardiologue jeudi 9h30')).toMatchObject({ kind: 'event', title: 'Cardiologue', date: '2026-11-12', start: '09:30' });
    expect(place('Judo de Léo mercredi 14h')).toMatchObject({ kind: 'event', title: 'Judo de Léo', date: '2026-11-11', start: '14:00' });
    expect(place('Dentiste mardi 17h30')).toMatchObject({ kind: 'event', title: 'Dentiste', start: '17:30' });
  });
  it('avec un jour sans heure : une tâche', () => {
    expect(place('Relancer M. Dupont vendredi')).toEqual({ kind: 'task', title: 'Relancer M. Dupont', date: '2026-11-13', start: null });
  });
  it('ni jour ni heure, ou une question : pas un rendez-vous (la démo propose un exemple)', () => {
    expect(place('Acheter du pain')).toEqual({ error: 'notEvent' });
    expect(place('Comment ça marche')).toEqual({ error: 'notEvent' });
    expect(place('Tu peux ranger mon cours demain ?')).toEqual({ error: 'notEvent' });
  });
  it('rien à ajouter', () => {
    expect(place('demain 14h')).toEqual({ error: 'empty' });
    expect(place('Exam le 31/11')).toEqual({ error: 'impossible' });
  });
});

describe('phrases à plusieurs heures', () => {
  it('une partie par heure, la plage compte pour une', () => {
    expect(splitSentence('Conduite 9h, repos 11h')).toEqual(['Conduite 9h', 'repos 11h']);
    expect(splitSentence('Dentiste mardi 9h puis kiné 11h30')).toEqual(['Dentiste mardi 9h', 'kiné 11h30']);
    expect(splitSentence('Conduite 9h repos 11h et déjeuner 12h30 demain')).toEqual(['Conduite 9h', 'repos 11h', 'déjeuner 12h30 demain']);
    expect(splitSentence('Cours de 9h à 11h jeudi')).toEqual(['Cours de 9h à 11h jeudi']);
    expect(splitSentence('Garde de nuit lundi 21h-7h')).toEqual(['Garde de nuit lundi 21h-7h']);
    expect(splitSentence('Dentiste mardi 17h30')).toEqual(['Dentiste mardi 17h30']);
  });
  it('une durée n’est pas une heure', () => {
    expect(splitSentence('Réunion 10h pendant 2h')).toEqual(['Réunion 10h pendant 2h']);
    expect(splitSentence('Footing 18h (1h)')).toEqual(['Footing 18h (1h)']);
  });
  it('au plus 3 parties', () => {
    expect(splitSentence('A 8h, B 9h, C 10h, D 11h')).toHaveLength(3);
  });
  it('la fin d’une nuit', () => {
    expect(nightEnd('Garde de nuit 21h-7h')).toBe('07:00');
    expect(nightEnd('de 23 h à 5 h 30')).toBe('05:30');
    expect(nightEnd('Cours de 9h à 11h')).toBeNull();
    expect(nightEnd('Dentiste 17h30')).toBeNull();
  });
});

describe('la phrase gardée pour le compte', () => {
  it('{ text, at } en ISO, coupé à 120 signes', () => {
    const kept = JSON.parse(demoKept('  Dentiste mardi 17h30 ', friday));
    expect(kept).toEqual({ text: 'Dentiste mardi 17h30', at: friday.toISOString(), typed: true });
    expect(JSON.parse(demoKept('x'.repeat(200), friday)).text).toHaveLength(120);
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
  it('une nuit du dimanche au lundi : dans ses deux semaines', () => {
    const night: DemoItem = { id: 13, kind: 'event', title: 'Garde', date: '2026-11-15', start: '21:00', end: '07:00', nextDay: true, color: '' };
    expect(rowsFor([night], '2026-11-09').map(i => i.id)).toEqual([13]);
    expect(rowsFor([night], '2026-11-16').map(i => i.id)).toEqual([13]);
    expect(rowsFor([night], '2026-11-23')).toEqual([]);
  });
  it('une autre semaine : seulement ce qui y tombe', () => {
    const later: DemoItem = { id: 12, kind: 'task', title: 'Passeport', date: '2026-12-01', start: null, color: '' };
    expect(rowsFor([...items, later], mondayOf('2026-12-01')).map(i => i.id)).toEqual([12]);
  });
});
