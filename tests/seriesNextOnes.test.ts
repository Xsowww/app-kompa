// Test complet V9 : « celui-ci et les suivants » d'une répétition sans fin (supprimés ou déplacés), puis le temps passe.
import { beforeEach, describe, expect, it } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { endSeriesBefore, movedRule, moveSeriesRule, planEndless, refillEndless, rememberRule, savedRule } = await import('../src/lib/repeatSeries');
const { ruleDays, endlessUntil } = await import('../src/lib/repeat');
const { useCalendar, nextInSeries } = await import('../src/store/calendar');
const { useSettings, getSettings } = await import('../src/store/settings');
const { changedFields } = await import('../src/pages/calendar/source');

const weekday = (key: string) => new Date(`${key}T12:00`).getDay();
const TODAY = '2026-11-11';

/** Yoga chaque mardi, sans fin, fait le 11 novembre 2026 (un an d'avance). */
function makeYoga() {
  const rule = { unit: 'week' as const, interval: 1 };
  const days = ruleDays('2026-11-17', rule, endlessUntil(rule, TODAY)).days;
  useCalendar.setState({ events: [], trash: [] });
  useSettings.getState().set({ repeatRules: {} });
  useCalendar.getState().addMany(days.map(date => ({ title: 'Yoga', date, start: '18:00', category: 'sport' as const, series: 'yoga' })));
  rememberRule('yoga', rule, '2026-11-17');
  return useCalendar.getState().events;
}

describe('série sans fin : « celui-ci et les suivants » supprimés', () => {
  beforeEach(makeYoga);

  it('la série s’arrête là : rien ne revient des mois plus tard, même corbeille vidée', () => {
    const events = useCalendar.getState().events;
    const cut = events.find(e => e.date === '2026-12-15')!;
    const ids = [cut.id, ...nextInSeries(cut, events).map(e => e.id)];
    const undo = endSeriesBefore('yoga', cut.date);
    useCalendar.getState().removeMany(ids);
    expect(undo).toBeTypeOf('function');
    expect(savedRule('yoga')?.rule.until).toBe('2026-12-08');
    // Huit mois plus tard, corbeille vidée depuis longtemps.
    useCalendar.getState().emptyTrash();
    expect(refillEndless('2027-07-01')).toBe(0);
    expect(useCalendar.getState().events.map(e => e.date)).toEqual(['2026-11-17', '2026-11-24', '2026-12-01', '2026-12-08']);
  });

  it('sans ce correctif, les suivants étaient refaits (la règle restée « sans fin »)', () => {
    const events = useCalendar.getState().events.filter(e => e.date < '2026-12-15');
    expect(planEndless(getSettings().repeatRules, events, [], '2027-07-01').add.length).toBeGreaterThan(20);
  });

  it('« Annuler » remet les événements et la répétition sans fin', () => {
    const events = useCalendar.getState().events;
    const cut = events.find(e => e.date === '2026-12-15')!;
    const ids = [cut.id, ...nextInSeries(cut, events).map(e => e.id)];
    const undo = endSeriesBefore('yoga', cut.date)!;
    useCalendar.getState().removeMany(ids);
    useCalendar.getState().restore(ids);
    undo();
    expect(savedRule('yoga')?.rule.until).toBeUndefined();
    expect(useCalendar.getState().events).toHaveLength(events.length);
    expect(refillEndless('2027-07-01')).toBeGreaterThan(20);
  });

  it('toute la série supprimée, ou une série qui a déjà une fin : la règle ne bouge pas', () => {
    expect(endSeriesBefore('yoga', '2026-11-17')).toBeNull();
    rememberRule('fini', { unit: 'week', interval: 1, until: '2027-06-30' }, '2026-11-17');
    expect(endSeriesBefore('fini', '2026-12-15')).toBeNull();
    expect(endSeriesBefore('inconnue', '2026-12-15')).toBeNull();
  });
});

describe('série sans fin : « celui-ci et les suivants » déplacés à un autre jour', () => {
  beforeEach(makeYoga);

  it('les suivants faits plus tard sont au nouveau jour (ils revenaient au mardi)', () => {
    const cut = useCalendar.getState().events.find(e => e.date === '2026-12-15')!;
    useCalendar.getState().updateSeries(cut.id, { date: '2026-12-16' });
    moveSeriesRule('yoga', '2026-12-15', '2026-12-16');
    const before = useCalendar.getState().events.length;
    expect(refillEndless('2027-07-01')).toBeGreaterThan(20);
    const added = useCalendar.getState().events.slice(before);
    expect(new Set(added.map(e => weekday(e.date)))).toEqual(new Set([3]));
    // Pas de trou ni de doublon : une semaine après le dernier déjà là.
    const all = useCalendar.getState().events.map(e => e.date).sort();
    const from = all.indexOf('2026-12-16');
    for (let i = from + 1; i < all.length; i++) expect(new Date(`${all[i]}T12:00`).getTime() - new Date(`${all[i - 1]}T12:00`).getTime()).toBe(7 * 864e5);
  });

  it('plusieurs jours par semaine : chacun décalé d’autant', () => {
    expect(movedRule({ unit: 'week', interval: 1, days: [1, 4] }, '2026-11-16', '2026-11-17')).toEqual({ unit: 'week', interval: 1, days: [2, 5] });
    expect(movedRule({ unit: 'week', interval: 2, days: [6] }, '2026-11-14', '2026-11-15')).toEqual({ unit: 'week', interval: 2, days: [0] });
    expect(movedRule({ unit: 'week', interval: 1, days: [1, 4] }, '2026-11-16', '2026-11-23')).toEqual({ unit: 'week', interval: 1, days: [1, 4] });
  });

  it('« le 1er lundi du mois » déplacé au lendemain : le rang du nouveau jour dans son mois', () => {
    expect(movedRule({ unit: 'month', interval: 1, nth: 1 }, '2026-12-07', '2026-12-08')).toEqual({ unit: 'month', interval: 1, nth: 2 });
    expect(movedRule({ unit: 'month', interval: 1, nth: 1 }, '2026-12-07', '2026-12-01')).toEqual({ unit: 'month', interval: 1, nth: 1 });
  });

  it('même jour, ou série sans règle gardée : rien ne change', () => {
    const code = getSettings().repeatRules.yoga;
    moveSeriesRule('yoga', '2026-12-15', '2026-12-15');
    moveSeriesRule('inconnue', '2026-12-15', '2026-12-16');
    expect(getSettings().repeatRules).toEqual({ yoga: code });
  });
});

describe('« celui-ci et les suivants » modifiés : seul ce qui a changé passe aux suivants', () => {
  beforeEach(makeYoga);

  it('renommer la série ne vide plus les notes ni l’heure propre d’un des suivants', () => {
    const cal = useCalendar.getState();
    const [first, , third] = cal.events;
    cal.update(third.id, { details: 'Apporter le tapis', start: '19:00' });
    // Ce que la fenêtre envoie : tous ses champs, dont un seul a changé.
    const form = { title: 'Yoga doux', date: first.date, start: '18:00', end: undefined, category: 'sport' as const, details: undefined, place: undefined, important: undefined, reminders: first.reminders };
    const patch = changedFields(form, first);
    expect(patch).toEqual({ title: 'Yoga doux' });
    useCalendar.getState().updateSeries(first.id, patch);
    const after = useCalendar.getState().events.find(e => e.id === third.id)!;
    expect(after).toMatchObject({ title: 'Yoga doux', details: 'Apporter le tapis', start: '19:00' });
  });

  it('la fin déplacée avec la série', () => {
    expect(movedRule({ unit: 'week', interval: 1, until: '2026-12-08' }, '2026-11-24', '2026-11-25').until).toBe('2026-12-09');
  });
});
