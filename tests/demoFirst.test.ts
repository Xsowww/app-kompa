import { describe, expect, it } from 'vitest';
import { demoPlan, readDemo } from '../src/lib/demoFirst';

// Vendredi 6 novembre 2026, 15 h.
const now = new Date(2026, 10, 6, 15);
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600e3);
const raw = (text: unknown, at: unknown) => JSON.stringify({ text, at });

describe('phrase gardée par la démo', () => {
  it('lue quand elle a moins de 24 h', () => {
    expect(readDemo(raw('Cardiologue jeudi 9h30', hoursAgo(2).toISOString()), now)).toEqual({ text: 'Cardiologue jeudi 9h30', at: hoursAgo(2) });
    expect(readDemo(raw('  Dentiste mardi 17h30  ', hoursAgo(23.9).toISOString()), now)?.text).toBe('Dentiste mardi 17h30');
  });
  it('ignorée si trop vieille, abîmée, vide ou datée du futur', () => {
    expect(readDemo(raw('Dentiste mardi 17h30', hoursAgo(25).toISOString()), now)).toBeNull();
    expect(readDemo(raw('Dentiste mardi 17h30', hoursAgo(-2).toISOString()), now)).toBeNull();
    expect(readDemo(raw('Dentiste', 'pas une date'), now)).toBeNull();
    expect(readDemo(raw('   ', hoursAgo(1).toISOString()), now)).toBeNull();
    expect(readDemo(raw(42, hoursAgo(1).toISOString()), now)).toBeNull();
    expect(readDemo('{pas du json', now)).toBeNull();
    expect(readDemo(null, now)).toBeNull();
  });
});

describe('premier événement recréé', () => {
  it('une heure : un événement à son jour', () => {
    expect(demoPlan('Cardiologue jeudi 9h30', hoursAgo(1), now)).toEqual({ kind: 'event', title: 'Cardiologue', date: '2026-11-12', start: '09:30' });
    expect(demoPlan('Dentiste mardi 17h30', hoursAgo(1), now)).toMatchObject({ kind: 'event', title: 'Dentiste', date: '2026-11-10', start: '17:30' });
  });
  it('une plage horaire garde sa fin (lue comme dans le calendrier)', () => {
    expect(demoPlan('Sport lundi 18h-19h30', hoursAgo(1), now)).toMatchObject({ kind: 'event', title: 'Sport', date: '2026-11-09', start: '18:00', end: '19:30' });
    expect(demoPlan('Garde de nuit lundi 21h-7h', hoursAgo(1), now)).toMatchObject({ kind: 'event', title: 'Garde de nuit', date: '2026-11-09', start: '21:00' });
  });
  it('sans heure : une tâche, datée ou non', () => {
    expect(demoPlan('Relancer M. Dupont vendredi', hoursAgo(1), now)).toEqual({ kind: 'task', title: 'Relancer M. Dupont', date: '2026-11-13' });
    expect(demoPlan('Acheter du pain', hoursAgo(1), now)).toEqual({ kind: 'task', title: 'Acheter du pain' });
  });
  it('« demain » se lit depuis le moment de la démo', () => {
    // Tapée hier à 20 h : « demain » est aujourd'hui.
    expect(demoPlan('Kiné demain 18h', new Date(2026, 10, 5, 20), now)).toMatchObject({ date: '2026-11-06', start: '18:00' });
  });
  it('un jour déjà passé depuis la démo se relit depuis maintenant', () => {
    // Tapée hier à 8 h, « aujourd'hui 9h » : hier, donc relue comme aujourd'hui.
    expect(demoPlan('Dentiste aujourd’hui 9h', new Date(2026, 10, 5, 8), now)).toMatchObject({ date: '2026-11-06', start: '09:00' });
  });
  it('rien à ajouter : null', () => {
    expect(demoPlan('demain 14h', hoursAgo(1), now)).toBeNull();
    expect(demoPlan('Dentiste le 31/11 à 9h', hoursAgo(1), now)).toBeNull();
  });
});
