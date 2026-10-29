import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, format } from 'date-fns';

// The stores reach for the browser when they load: give them the globals they read.
const memory = new Map<string, string>();
const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) };
Object.assign(globalThis, { location: new URL('http://localhost/'), localStorage: storage, sessionStorage: storage });
const { nextNudge, saidToday, DAILY_CAP } = await import('../src/copilot/proactive');
const { useCalendar } = await import('../src/store/calendar');
const { useCopilot } = await import('../src/store/copilot');
const { useSettings } = await import('../src/store/settings');

const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd');
/** In the day (Kompaly is quiet at night): the tests don't depend on when they run. */
const noon = () => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
};
const ev = (id: string, title: string, date: string, category: 'examen' | 'devoir') => ({ id, title, date, category, done: false, createdAt: '2026-10-01T00:00:00Z' });

beforeEach(() => {
  useSettings.setState({ usage: 'etudes', copilotVisible: true, proactive: true, chattiness: 'normal' });
  useCopilot.setState({ memory: {}, thinking: false });
});

describe('periodic remarks', () => {
  it('a remark already made today does not hold back the next ones', () => {
    useCalendar.setState({ events: [ev('exam', 'Partiel de droit', day(4), 'examen'), ev('dm', 'Rendre DM', day(-1), 'devoir')] });
    expect(nextNudge(noon())?.key).toBe('exam-soon:exam');
    // The exam remark was made (and the bubble closed): the late homework comes next.
    useCopilot.setState({ memory: { 'exam-soon:exam': Date.now() } });
    const next = nextNudge(noon());
    expect(next?.key).toBe(`late:${day(0)}`);
    expect(next?.fallback).toContain('Rendre DM');
  });

  it('the evening before a deadline still comes after the « due tomorrow » reminder', () => {
    useSettings.setState({ usage: 'travail' });
    useCalendar.setState({ events: [ev('devis', 'Envoyer le devis', day(1), 'devoir'), ev('liv', 'Livraison site client', day(1), 'examen')] });
    const evening = new Date();
    evening.setHours(21, 30, 0, 0);
    useCopilot.setState({ memory: { 'exam-soon:liv': Date.now(), 'due-tomorrow:devis': Date.now() } });
    expect(nextNudge(evening)?.key).toBe('eve:liv');
  });

  it('says nothing when everything has already been said', () => {
    useCalendar.setState({ events: [ev('exam', 'Partiel de droit', day(4), 'examen')] });
    useCopilot.setState({ memory: { 'exam-soon:exam': Date.now(), [`focus-nudge:${day(0)}`]: Date.now() } });
    expect(nextNudge(noon())).toBeUndefined();
  });

  it('stays quiet at night and after its remarks of the day', () => {
    useCalendar.setState({ events: [ev('exam', 'Partiel de droit', day(4), 'examen')] });
    const night = noon();
    night.setHours(23, 15);
    expect(nextNudge(night)).toBeUndefined();
    const morning = noon();
    morning.setHours(7, 30);
    expect(nextNudge(morning)?.key).toBe('exam-soon:exam');
    // Six remarks already made today in « Normal »: nothing more until tomorrow.
    const earlier = noon().getTime() - 3_600_000;
    const memory = Object.fromEntries(Array.from({ length: DAILY_CAP.normal }, (_, i) => [`autre:${i}`, earlier]));
    useCopilot.setState({ memory });
    expect(saidToday(memory, noon())).toBe(DAILY_CAP.normal);
    expect(nextNudge(noon())).toBeUndefined();
    // Yesterday's don't count.
    expect(saidToday({ a: earlier - 86_400_000 }, noon())).toBe(0);
  });
});

describe('pause of the AI', () => {
  it('says how long it really lasts', async () => {
    const { describeApiError, CopilotApiError } = await import('../src/copilot/claudeBrain');
    const { pauseAi } = await import('../src/copilot/aiPause');
    pauseAi(120);
    expect(describeApiError(new CopilotApiError('rate_limited'))).toContain('mode simple deux minutes');
    pauseAi(45);
    expect(describeApiError(new CopilotApiError('rate_limited'))).toContain('mode simple une minute');
    pauseAi(300);
    expect(describeApiError(new CopilotApiError('rate_limited'))).toContain('mode simple 5 minutes');
  });
});

describe('initiatives from what the events are', () => {
  it('a birthday in three days: the gift, unless one is already in the tasks', async () => {
    const { useTodos } = await import('../src/store/todos');
    useTodos.setState({ todos: [] });
    useCalendar.setState({ events: [{ id: 'bday', title: 'Anniversaire de Léa', date: day(3), category: 'perso', done: false, createdAt: '2026-10-01T00:00:00Z' }] });
    const n = nextNudge(noon());
    expect(n?.key).toBe('gift:bday');
    expect(n?.offers?.[0]).toMatchObject({ kind: 'add_todo', payload: { title: 'Acheter un cadeau pour Léa', due: day(2) } });
    useTodos.setState({ todos: [{ id: 't', title: 'Acheter un cadeau pour Léa', done: false, createdAt: new Date().toISOString() }] });
    expect(nextNudge(noon())).toBeUndefined();
  });
});
