import { describe, expect, it } from 'vitest';

// Test complet V9 : la phrase d'ajout rapide écrite comme on écrit vraiment (virgules, point final, « entre 9h et 10h »…).
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { parseQuickAdd } = await import('../src/lib/dates');

// Mercredi 11 novembre 2026, 10 h.
const base = new Date(2026, 10, 11, 10, 0);
const fr = (s: string) => parseQuickAdd(s, base, 'fr', true);

describe('ajout rapide : la ponctuation ne cache plus le jour ni l’heure', () => {
  it.each([
    ['Rdv demain, 14h', { title: 'Rdv', date: '2026-11-12', start: '14:00' }],
    ['Rdv demain 14h.', { title: 'Rdv', date: '2026-11-12', start: '14:00' }],
    ['Rdv demain.', { title: 'Rdv', date: '2026-11-12' }],
    ['Rdv demain?', { title: 'Rdv', date: '2026-11-12' }],
    ['Rdv demain!', { title: 'Rdv', date: '2026-11-12', important: true }],
    ['Rdv le 12/11.', { title: 'Rdv', date: '2026-11-12' }],
    ['Rdv 12 novembre, 14h', { title: 'Rdv', date: '2026-11-12', start: '14:00' }],
    ['Rdv vendredi, 14h-16h, salle 3', { title: 'Rdv', date: '2026-11-13', start: '14:00', end: '16:00', place: 'Salle 3' }],
    ['Dentiste demain 14h, penser à la carte vitale', { title: 'Dentiste, penser à la carte vitale', date: '2026-11-12', start: '14:00' }],
    ['Urgent : appeler la banque demain', { title: 'Appeler la banque', date: '2026-11-12', important: true }],
  ])('%s', (text, want) => expect(fr(text)).toMatchObject(want));

  it('rien à comprendre : la phrase reste comme elle est écrite', () => {
    expect(fr('Acheter 2,5 kg de farine.').title).toBe('Acheter 2,5 kg de farine.');
    expect(fr('Pain, lait, œufs').title).toBe('Pain, lait, œufs');
    expect(fr('Pourquoi ?').title).toBe('Pourquoi ?');
  });

  it('dans les autres langues aussi', () => {
    expect(parseQuickAdd('Meeting Tomorrow, 3pm', base, 'en')).toMatchObject({ title: 'Meeting', date: '2026-11-12', start: '15:00' });
    expect(parseQuickAdd('Meeting tomorrow 14:30.', base, 'en')).toMatchObject({ title: 'Meeting', date: '2026-11-12', start: '14:30' });
    // La date allemande garde ses points.
    expect(parseQuickAdd('Treffen am 12.11. um 9 Uhr', base, 'de')).toMatchObject({ title: 'Treffen', date: '2026-11-12', start: '09:00' });
  });
});

describe('ajout rapide : les heures dites autrement', () => {
  it.each([
    ['Rdv entre 9h et 10h', { title: 'Rdv', start: '09:00', end: '10:00' }],
    ['Déjeuner de midi à 14h', { title: 'Déjeuner', start: '12:00', end: '14:00' }],
    ['Déjeuner midi-14h', { title: 'Déjeuner', start: '12:00', end: '14:00' }],
    ['Soirée de 20h à minuit samedi', { title: 'Soirée', date: '2026-11-14', start: '20:00', end: '23:59' }],
    ['Soirée 20h-minuit', { title: 'Soirée', start: '20:00', end: '23:59' }],
    ['Rdv dans 2 heures', { title: 'Rdv', date: '2026-11-11', start: '12:00' }],
    ['Rdv dans 30 min', { title: 'Rdv', date: '2026-11-11', start: '10:30' }],
    ['Rdv dans 1h30', { title: 'Rdv', date: '2026-11-11', start: '11:30' }],
  ])('%s', (text, want) => expect(fr(text)).toMatchObject(want));

  it('« de 20h à minuit » ne finit plus à 20 h en commençant à minuit, ni le lendemain', () => {
    const p = fr('Soirée de 20h à minuit samedi');
    expect(p.endDate).toBeUndefined();
    expect(p.start! < p.end!).toBe(true);
  });

  it('« dans 15 heures » passe au lendemain', () => {
    expect(fr('Rdv dans 15 heures')).toMatchObject({ date: '2026-11-12', start: '01:00' });
  });

  it('une vraie nuit reste sur deux jours', () => {
    expect(fr('Garde de nuit 21h-7h')).toMatchObject({ date: '2026-11-11', start: '21:00', end: '07:00', endDate: '2026-11-12' });
  });

  it('« tonight at 8 » est le soir', () => {
    expect(parseQuickAdd('Dinner tonight at 8', base, 'en')).toMatchObject({ title: 'Dinner', date: '2026-11-11', start: '20:00' });
    expect(parseQuickAdd('Essen heute Abend um 8 Uhr', base, 'de')).toMatchObject({ date: '2026-11-11', start: '20:00' });
    expect(parseQuickAdd('Dentist today at 8', base, 'en')).toMatchObject({ start: '08:00' });
  });
});

describe('ajout rapide : le lieu', () => {
  it('« aux urgences » : le lieu en entier', () => {
    expect(fr('Rdv aux urgences demain')).toMatchObject({ title: 'Rdv', place: 'Urgences' });
  });
  it.each(['Penser à la lessive demain', 'Répondre à la prof demain', 'Jouer au foot samedi', 'Dire à la voisine demain 18h'])('%s : ce qu’il y a à faire, pas un lieu', text => {
    const p = fr(text);
    expect(p.place).toBeUndefined();
    expect(p.title).toBe(text.replace(/ (demain|samedi)( 18h)?$/, ''));
  });
  it('un numéro de téléphone n’est pas un lieu', () => {
    expect(fr('Appeler au 06 12 34 56 78')).toMatchObject({ title: 'Appeler au 06 12 34 56 78' });
    expect(fr('Appeler au 06 12 34 56 78').place).toBeUndefined();
  });
  it('les vrais lieux restent compris', () => {
    expect(fr('Mariage de Paul samedi 15h à la mairie')).toMatchObject({ title: 'Mariage de Paul', place: 'Mairie' });
    expect(fr('Rdv à 14h au 12 rue de la Paix')).toMatchObject({ title: 'Rdv', place: '12 rue de la Paix' });
    expect(fr('Rdv à l’hôpital demain 9h')).toMatchObject({ title: 'Rdv', place: 'Hôpital' });
  });
});
