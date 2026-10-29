import { describe, expect, it } from 'vitest';
import { eventKind, birthdayOf, hasAddress, overlapping, looksRecurring, hasActionItems, isGroupProject } from '../src/copilot/initiatives';
import type { CalendarEvent } from '../src/store/calendar';

const ev = (id: string, title: string, date: string, start?: string, end?: string): CalendarEvent => ({ id, title, date, start, end, category: 'perso', done: false, createdAt: '2026-10-01T00:00:00Z' });

describe('what an event is about', () => {
  it('reads the kind from the title', () => {
    expect(eventKind(ev('a', 'Anniversaire de Léa', '2026-11-02'))).toBe('anniversaire');
    expect(eventKind(ev('b', 'Dentiste 8h30 rue Géliot', '2026-11-02'))).toBe('medical');
    expect(eventKind(ev('c', 'Train pour Lyon', '2026-11-02'))).toBe('voyage');
    expect(eventKind(ev('d', 'Point client Studio Lumen', '2026-11-02'))).toBe('reunion');
    expect(eventKind(ev('e', 'Soutenance de stage', '2026-11-02'))).toBe('presentation');
    expect(eventKind(ev('f', 'Courses', '2026-11-02'))).toBeNull();
  });
  it('finds whose birthday it is', () => {
    expect(birthdayOf('Anniversaire de Léa')).toBe('Léa');
    expect(birthdayOf("Anniv d'Hugo !")).toBe('Hugo');
    expect(birthdayOf('Anniversaire')).toBeNull();
  });
  it('sees an address', () => {
    expect(hasAddress(ev('a', 'Dentiste 8h30 rue Géliot', '2026-11-02'))).toBe(true);
    expect(hasAddress({ title: 'Visite appartement', details: '12 avenue Foch' })).toBe(true);
    expect(hasAddress(ev('b', 'Réviser le chapitre 3', '2026-11-02'))).toBe(false);
  });
});

describe('the calendar around it', () => {
  it('sees two events at the same time, not one right after the other', () => {
    const a = ev('a', 'Dentiste', '2026-11-02', '17:30');
    expect(overlapping(a, [a, ev('b', 'Réunion', '2026-11-02', '17:00', '18:00')]).map(e => e.id)).toEqual(['b']);
    expect(overlapping(a, [a, ev('c', 'Yoga', '2026-11-02', '18:30')])).toEqual([]);
    expect(overlapping(a, [a, ev('d', 'Cours', '2026-11-03', '17:30')])).toEqual([]);
  });
  it('sees a weekly habit typed by hand', () => {
    const now = ev('n', 'Yoga', '2026-11-16', '10:00');
    const past = [ev('p1', 'Yoga', '2026-11-02', '10:00'), ev('p2', 'yoga', '2026-11-09', '10:00')];
    expect(looksRecurring(now, [...past, now])).toBe(true);
    expect(looksRecurring(now, [past[0], now])).toBe(false);
    expect(looksRecurring({ ...now, series: 's' }, [...past, now])).toBe(false);
  });
});

describe('notes and projects', () => {
  it('sees things to do in a note', () => {
    expect(hasActionItems('<p>Compte rendu</p><p>À faire : relancer le client</p>')).toBe(true);
    expect(hasActionItems('<ul><li>Envoyer le devis</li><li>Appeler Hugo</li></ul>')).toBe(true);
    expect(hasActionItems('<p>Recette des lasagnes</p>')).toBe(false);
  });
  it('sees a group project', () => {
    expect(isGroupProject('Exposé de groupe en histoire')).toBe(true);
    expect(isGroupProject('Projet en équipe')).toBe(true);
    expect(isGroupProject('Exposé')).toBe(false);
  });
});
