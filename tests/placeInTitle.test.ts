import { describe, expect, it } from 'vitest';

// Test visiteurs (Julien) : « Chantier Dupuis - mise aux normes tableau » perdait la fin de son titre, rangée dans « Lieu ».
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { parseQuickAdd } = await import('../src/lib/dates');

// Jeudi 12 novembre 2026, 10 h.
const base = new Date(2026, 10, 12, 10, 0);
const fr = (s: string) => parseQuickAdd(s, base, 'fr', true);

describe('un lieu n’est pas deviné au milieu d’un titre', () => {
  it.each([
    'Chantier Dupuis - mise aux normes tableau',
    'Chantier Dupuis – mise au propre du devis',
    'Mise aux normes tableau',
    'Remise à la banque des chèques',
    'Formation aux premiers secours',
    'Aide aux devoirs',
    'Tarte aux pommes',
    'Gâteau au chocolat',
    'Préparation au concours',
    'Projet Martin : visite au showroom',
    'Accès au chantier',
    'Retour à la maison',
  ])('%s : le titre reste entier', text => {
    const p = fr(text);
    expect(p.place).toBeUndefined();
    expect(p.title).toBe(text);
  });
  it('avec un jour et une heure, le titre reste entier aussi', () => {
    const p = fr('Chantier Dupuis - mise aux normes tableau lundi 8h');
    expect(p).toMatchObject({ title: 'Chantier Dupuis - mise aux normes tableau', date: '2026-11-16', start: '08:00' });
    expect(p.place).toBeUndefined();
  });
  it.each([
    ['Réunion à la mairie', 'Réunion', 'Mairie'],
    ['Dîner au Petit Bistrot', 'Dîner', 'Petit Bistrot'],
    ['Dîner au Petit Bistrot samedi 20h', 'Dîner', 'Petit Bistrot'],
    ['Rdv aux urgences demain', 'Rdv', 'Urgences'],
    ['Garde de nuit au CHU lundi 21h-7h', 'Garde de nuit', 'CHU'],
    ['Rendez-vous chez le kiné jeudi 10h', 'Rendez-vous', 'Chez le kiné'],
    ['TD de maths salle B12 mardi 8h', 'TD de maths', 'Salle B12'],
    ['Chantier Dupuis - pose tableau chez le client', 'Chantier Dupuis - pose tableau', 'Chez le client'],
  ])('%s : le lieu reste compris', (text, title, place) => {
    expect(fr(text)).toMatchObject({ title, place });
  });
});
