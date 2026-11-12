// Test visiteurs (Mathis) : pour un partiel dans 33 jours, 3 séances seulement, toutes dans les 5 derniers jours ; et
// « Planifie mes révisions pour mon partiel d’anatomie du 15 décembre » demandait d'ajouter l'examen d'abord.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
// Jeudi 12 novembre 2026, 10 h.
vi.useFakeTimers({ now: new Date(2026, 10, 12, 10, 0), toFake: ['Date'] });
const { revisionDays, examSaid, restDay, sessionsFor } = await import('../src/copilot/revisionPlan');
const { localReply } = await import('../src/copilot/localBrain');
const { useCalendar } = await import('../src/store/calendar');
const { useNotes } = await import('../src/store/notes');
const { useSettings } = await import('../src/store/settings');

const TODAY = '2026-11-12';
const gaps = (days: string[]) => days.slice(1).map((d, i) => Math.round((Date.parse(d) - Date.parse(days[i])) / 86_400_000));

beforeEach(() => {
  useCalendar.setState({ events: [], trash: [] });
  useNotes.setState({ notes: [], folders: [] });
  useSettings.setState({ usage: 'etudes', revisionTime: '18:00', revisionSessions: 3 });
  localReply('non');
});

describe('les jours des séances de révision', () => {
  it('dans 33 jours : 9 séances, de demain à la veille, sans trou de plus de 5 jours', () => {
    const days = revisionDays('2026-12-15', TODAY);
    expect(days).toHaveLength(9);
    expect(days[0]).toBe('2026-11-13');
    expect(days.at(-1)).toBe('2026-12-14');
    expect(Math.max(...gaps(days))).toBeLessThanOrEqual(5);
    expect(Math.min(...gaps(days))).toBeGreaterThanOrEqual(3);
  });

  it.each([
    [3, 2], [5, 3], [7, 3], [8, 3], [14, 4], [21, 6], [33, 9], [35, 10], [90, 10],
  ])('dans %i jours : %i séances', (until, n) => {
    const exam = new Date(2026, 5, 1 + until); // from 1 June: no rest day in the way of the count
    const key = `${exam.getFullYear()}-${String(exam.getMonth() + 1).padStart(2, '0')}-${String(exam.getDate()).padStart(2, '0')}`;
    const days = revisionDays(key, '2026-06-01');
    expect(days).toHaveLength(n);
    expect(new Set(days).size).toBe(n);
    for (const d of days) expect(d >= '2026-06-01' && d < key).toBe(true);
  });

  it('dans la semaine : la veille puis un jour sur deux, comme avant', () => {
    expect(revisionDays('2026-11-19', TODAY)).toEqual(['2026-11-14', '2026-11-16', '2026-11-18']);
  });

  it('jamais dans le passé, jamais un jour férié ni le soir du 24 ou du 31 décembre, rien pour un examen passé', () => {
    const days = revisionDays('2027-01-05', '2026-12-01');
    expect(days).toHaveLength(10);
    for (const d of days) expect(restDay(d)).toBe(false);
    expect(revisionDays('2026-11-10', TODAY)).toEqual([]);
    expect(revisionDays(TODAY, TODAY)).toEqual([TODAY]);
    expect(revisionDays('2026-11-13', TODAY)).toEqual([TODAY]);
  });

  it('un nombre demandé est gardé tel quel', () => {
    expect(revisionDays('2026-12-15', TODAY, 3, 4)).toHaveLength(4);
    expect(revisionDays('2026-12-15', TODAY, 3, 1)).toEqual(['2026-12-14']);
  });
});

describe('l’examen dit dans la phrase', () => {
  const now = new Date(2026, 10, 12, 10, 0);
  it('un nom et un jour à venir', () => {
    expect(examSaid('partiel d’anatomie du 15 décembre', now)).toEqual({ title: 'Partiel d’anatomie', date: '2026-12-15' });
    expect(examSaid('contrôle de maths vendredi 14h', now)).toEqual({ title: 'Contrôle de maths', date: '2026-11-13', start: '14:00' });
  });
  it('sans jour, sans nom, ou un jour passé : rien n’est inventé', () => {
    expect(examSaid('partiel d’anatomie', now)).toBeNull();
    expect(examSaid('le 15 décembre', now)).toBeNull();
    expect(examSaid('', now)).toBeNull();
  });
});

describe('« Planifie mes révisions pour mon partiel d’anatomie du 15 décembre »', () => {
  const ask = () => localReply('Planifie mes révisions pour mon partiel d’anatomie du 15 décembre');
  const exams = () => useCalendar.getState().events.filter(e => e.category === 'examen');

  it('calendrier vide : l’examen est ajouté, puis les séances étalées jusqu’à la veille', () => {
    const r = ask();
    expect(exams()).toHaveLength(1);
    expect(exams()[0]).toMatchObject({ title: 'Partiel d’anatomie', date: '2026-12-15' });
    const sessions = sessionsFor(exams()[0], useCalendar.getState().events);
    expect(sessions).toHaveLength(9);
    expect(sessions[0].date).toBe('2026-11-13');
    expect(r.text).toContain('J’ai ajouté « Partiel d’anatomie »');
    expect(r.text).toContain('9 séances');
    expect(r.text).not.toContain('Ajoute-');
  });

  it('l’examen est déjà là : il est retrouvé, pas ajouté en double', () => {
    useCalendar.getState().add({ title: 'Partiel d’anatomie', date: '2026-12-15', category: 'examen' });
    const r = ask();
    expect(exams()).toHaveLength(1);
    expect(r.text).not.toContain('J’ai ajouté');
    expect(sessionsFor(exams()[0], useCalendar.getState().events)).toHaveLength(9);
    // Asked again: no second plan.
    expect(ask().text).toContain('déjà planifié');
  });

  it('un examen du même nom un autre jour : pas de doublon, la question est posée', () => {
    useCalendar.getState().add({ title: 'Partiel d’anatomie', date: '2026-12-17', category: 'examen' });
    const r = ask();
    expect(exams()).toHaveLength(1);
    expect(r.text).toContain('Je ne trouve pas');
  });

  it('un autre examen à venir n’empêche pas d’ajouter celui de la phrase', () => {
    useCalendar.getState().add({ title: 'Contrôle de maths', date: '2026-11-20', category: 'examen' });
    ask();
    expect(exams().map(e => e.title).sort()).toEqual(['Contrôle de maths', 'Partiel d’anatomie']);
  });

  it('sans jour dans la phrase et rien au calendrier : toujours « ajoute-le »', () => {
    const r = localReply('Planifie mes révisions pour mon partiel d’anatomie');
    expect(exams()).toHaveLength(0);
    expect(r.text).toContain('Ajoute-');
  });
});
