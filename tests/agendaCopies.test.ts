// Un événement ajouté à la fois dans « Perso » et dans un agenda partagé : la copie de l'agenda.
import { describe, expect, it } from 'vitest';
import type { NewEvent } from '../src/store/calendar';

// The stores reach for the browser when they load: give them the two globals they read.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { agendaCopies } = await import('../src/pages/groups/agendaTarget');
const { isSpan } = await import('../src/lib/repeat');
const { newSeries } = await import('../src/lib/seriesId');

const ev = (date: string, extra: Partial<NewEvent> = {}): NewEvent => ({ title: 'Repas', date, category: 'perso', reminders: [30, 1440], ...extra });

describe('copie vers un agenda partagé', () => {
  it('un seul jour : seulement les rappels choisis à la main', () => {
    expect(agendaCopies([ev('2026-11-20')], [15])).toEqual([{ ...ev('2026-11-20'), reminders: [15], series: undefined }]);
  });
  it('une série : un autre identifiant, le même pour toutes ses dates', () => {
    const s = newSeries();
    const out = agendaCopies([ev('2026-11-20', { series: s }), ev('2026-11-27', { series: s })], []);
    expect(out[0].series).not.toBe(s);
    expect(out[0].series).toBe(out[1].series);
    expect(out.map(e => e.reminders)).toEqual([[], []]);
  });
  it('sur plusieurs jours : reste « sur plusieurs jours », rappel le premier jour seulement', () => {
    const s = newSeries(true);
    const out = agendaCopies([ev('2026-11-20', { series: s }), ev('2026-11-21', { series: s })], [60]);
    expect(isSpan(out[0].series)).toBe(true);
    expect(out[0].series).not.toBe(s);
    expect(out.map(e => e.reminders)).toEqual([[60], []]);
  });
});
