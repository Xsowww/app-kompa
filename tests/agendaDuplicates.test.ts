// Un même événement ajouté en même temps dans « Perso » et dans un agenda partagé : affiché une seule fois chez moi.
import { describe, expect, it } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { withoutCopies } = await import('../src/pages/calendar/agendas');
type Shared = Parameters<typeof withoutCopies>[0][number];

const shared = (extra: Partial<Shared> = {}): Shared => ({
  id: 'g1', title: 'Coiffeur', date: '2026-11-14', start: '10:00', end: '11:00', category: 'c-ag-x', done: false,
  createdAt: '2026-11-13T18:00:02Z', agenda: { id: 'x', name: 'Nous deux', kind: 'agenda' }, ...extra,
});
const mine = (extra: object = {}) => ({ title: 'Coiffeur', date: '2026-11-14', start: '10:00', end: '11:00', createdAt: '2026-11-13T18:00:00Z', ...extra });

describe('doublons perso + agenda partagé', () => {
  it('la copie faite en même temps est masquée', () => {
    expect(withoutCopies([shared()], [mine()])).toEqual([]);
  });
  it('majuscules et espaces ne comptent pas', () => {
    expect(withoutCopies([shared({ title: ' coiffeur ' })], [mine()])).toEqual([]);
  });
  it('un événement pareil mais créé un autre jour reste (ce n’est pas une copie)', () => {
    expect(withoutCopies([shared({ createdAt: '2026-11-10T09:00:00Z' })], [mine()])).toHaveLength(1);
  });
  it('une autre heure, un autre jour ou un autre titre : rien n’est masqué', () => {
    expect(withoutCopies([shared({ start: '11:00' }), shared({ id: 'g2', date: '2026-11-15' }), shared({ id: 'g3', title: 'Dentiste' })], [mine()])).toHaveLength(3);
  });
  it('sans heure des deux côtés : masqué', () => {
    expect(withoutCopies([shared({ start: undefined, end: undefined })], [mine({ start: undefined, end: undefined })])).toEqual([]);
  });
});
