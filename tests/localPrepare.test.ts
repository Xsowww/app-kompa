import { describe, expect, it } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { localReply } = await import('../src/copilot/localBrain');
const { useCalendar } = await import('../src/store/calendar');
const { useSettings } = await import('../src/store/settings');
const { addDays, format } = await import('date-fns');
const inDays = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd');

describe('Kompaly en mode simple', () => {
  it('« Ajoute une tâche » sans titre demande laquelle, sans créer d’événement', () => {
    const before = useCalendar.getState().events.length;
    expect(localReply('Ajoute une tâche').text).toMatch(/^Quelle tâche/);
    expect(useCalendar.getState().events.length).toBe(before);
  });
  it('« prépare … » prépare un examen', () => {
    useSettings.setState({ usage: 'etudes' });
    useCalendar.getState().add({ title: 'Partiel de chimie', date: inDays(10), start: '09:00', category: 'examen' });
    expect(localReply('prépare mon partiel de chimie').text).not.toMatch(/pas tout compris/);
  });
  it('« prépare … » d’un événement ordinaire explique quoi faire', () => {
    useSettings.setState({ usage: 'travail' });
    useCalendar.getState().add({ title: 'Réunion client', date: inDays(5), start: '10:00', category: 'autre' });
    const r = localReply('prépare la réunion client');
    expect(r.text).toMatch(/Réunion client.*important/);
    expect(r.links?.[0].to).toMatch(/^\/calendrier\?jour=/);
  });
});
