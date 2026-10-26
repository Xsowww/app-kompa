import { describe, expect, it } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { changedFields } = await import('../src/pages/calendar/source');

describe('changedFields (agenda partagé : seulement ce qui a été modifié)', () => {
  const before = { id: 'e1', title: 'Poubelles', date: '2026-11-02', start: '20:00', category: 'perso', reminders: [60] };
  it('garde seulement les champs modifiés', () => {
    const form = { title: 'Poubelles jaunes', date: '2026-11-02', start: '20:00', end: undefined, category: 'perso', details: undefined, reminders: [60], people: [] };
    expect(changedFields(form, before)).toEqual({ title: 'Poubelles jaunes' });
  });
  it('vide, absent et [] reviennent au même ; une heure effacée compte', () => {
    expect(changedFields({ start: undefined, people: [], details: '' }, before)).toEqual({ start: undefined });
    expect(changedFields({ reminders: [60, 1440] }, before)).toEqual({ reminders: [60, 1440] });
  });
});
