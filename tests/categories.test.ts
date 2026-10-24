import { beforeEach, describe, expect, it } from 'vitest';

// The stores reach for the browser when they load: give them the two globals they read.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { applyUsage, useCalendar, catOf, allCategories, guessCategory, createCategory, updateCategory, deleteCategory, labelTaken, builtinLabel, knowSharedCategories } = await import('../src/store/calendar');
type CustomCategory = import('../src/store/calendar').CustomCategory;
const { useSettings } = await import('../src/store/settings');

beforeEach(() => {
  useSettings.setState({ customCategories: [] });
  useCalendar.setState({ events: [], trash: [] });
});

describe('own categories', () => {
  it('are created once per name and listed after the built-in ones', () => {
    const stage = createCategory('  Stage ', '#1f8a8a');
    expect(stage.id).toMatch(/^c-[a-z0-9-]{1,40}$/); // what the database accepts
    expect(createCategory('stage', '#d9483b').id).toBe(stage.id);
    expect(allCategories().slice(-1)).toEqual([stage.id]);
    expect(catOf(stage.id)).toMatchObject({ label: 'Stage', color: '#1f8a8a' });
  });

  it('are picked from the title, before the built-in guesses', () => {
    const asso = createCategory('Asso', '#d6457f');
    expect(guessCategory('Réunion asso jeudi')).toBe(asso.id);
    expect(guessCategory('Associé du cabinet')).not.toBe(asso.id); // whole words only
    expect(guessCategory('Partiel de maths')).toBe('examen');
  });

  it('can be renamed, and deleting one moves its events to Perso', () => {
    const job = createCategory('Job', '#6b7280');
    updateCategory(job.id, { label: 'Job étudiant' });
    expect(catOf(job.id).label).toBe('Job étudiant');
    const ev = useCalendar.getState().add({ title: 'Service', date: '2026-10-20', category: job.id });
    deleteCategory(job.id);
    expect(useCalendar.getState().events.find(e => e.id === ev.id)?.category).toBe('perso');
    expect(catOf(job.id).label).toBe(catOf('perso').label); // a stale id never breaks the display
  });

  it('compare les noms sans tenir compte des espaces en trop', () => {
    const asso = createCategory('Asso', '#d6457f');
    updateCategory(asso.id, { label: '  Club   théâtre ' });
    expect(catOf(asso.id).label).toBe('Club théâtre');
    expect(labelTaken('club théâtre')).toBe(true);
    expect(labelTaken('Club  théâtre', asso.id)).toBe(false); // itself
    expect(createCategory('Club théâtre', '#1f8a8a').id).toBe(asso.id);
  });

  it('réserve les noms de base de tous les usages', () => {
    applyUsage('travail');
    expect(builtinLabel('Réunion')).toBe('current');
    expect(builtinLabel(' cours ')).toBe('other'); // « Cours » reviendrait en double en repassant aux études
    expect(labelTaken('Cours')).toBe(true);
    expect(builtinLabel('Stage')).toBeNull();
    applyUsage('etudes');
    expect(builtinLabel('Cours')).toBe('current');
  });
});

describe('a shared calendar’s categories', () => {
  it('live in their own list, are guessed from it and shown for every member', () => {
    let list: CustomCategory[] = [];
    const scope = { list: () => list, save: (next: CustomCategory[]) => void ((list = next), knowSharedCategories(next)) };
    const menage = createCategory('Ménage', '#2f9e6b', scope);
    expect(menage.id).toMatch(/^c-[a-z0-9-]{1,20}$/); // what set_agenda_categories accepts
    expect(useSettings.getState().customCategories).toEqual([]); // not added to mine
    expect(createCategory('ménage', '#d9483b', scope).id).toBe(menage.id);
    expect(labelTaken('Ménage', undefined, scope)).toBe(true);
    expect(labelTaken('Ménage')).toBe(false); // my own list doesn't have it
    expect(guessCategory('Ménage de la cuisine', false, list)).toBe(menage.id);
    expect(guessCategory('Ménage de la cuisine')).not.toBe(menage.id);
    expect(catOf(menage.id)).toMatchObject({ label: 'Ménage', color: '#2f9e6b' });
    updateCategory(menage.id, { color: '#7a5ad6' }, scope);
    expect(catOf(menage.id).color).toBe('#7a5ad6');
    const ev = useCalendar.getState().add({ title: 'Perso', date: '2026-10-20', category: 'perso' });
    deleteCategory(menage.id, scope);
    expect(list).toEqual([]);
    expect(useCalendar.getState().events.find(e => e.id === ev.id)?.category).toBe('perso'); // my calendar untouched
  });
});
