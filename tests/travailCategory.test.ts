import { beforeEach, describe, expect, it, vi } from 'vitest';

// Visitors' test (13 nov.): « Travail » becomes a category of its own. A server not updated yet (its check knows the five
// first categories) gets it as « c-travail », which it takes, and every device reads it back as « Travail ».
const memory = new Map<string, string>();
const noop = () => undefined;
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
    removeItem: (k: string) => memory.delete(k),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
  },
  window: globalThis,
  document: { hidden: false, addEventListener: noop, removeEventListener: noop },
  addEventListener: noop,
  removeEventListener: noop,
});

type Row = Record<string, unknown>;
const sent: Row[] = [];
let migrated = false; // the server's events_category_check, before or after migration 2026-11-13
const known = ['cours', 'examen', 'devoir', 'perso', 'sport'];
const refused = (r: Row) => !(known.includes(String(r.category)) || (migrated && r.category === 'travail') || /^c-[a-z0-9-]{1,40}$/.test(String(r.category)));
const fake = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  from: () => ({
    upsert: async (rows: Row | Row[]) => {
      const list = Array.isArray(rows) ? rows : [rows];
      if (list.some(refused)) return { error: { code: '23514', message: 'new row for relation "events" violates check constraint "events_category_check"' } };
      sent.push(...list);
      return { error: null };
    },
    delete: () => ({ in: async () => ({ error: null }) }),
  }),
  rpc: async () => ({ error: null }),
};
vi.mock('../src/lib/supabase', () => ({ supabase: fake, cloudEnabled: true }));

const { useCalendar, CATEGORIES, CATEGORY_LABELS, allCategories, catOf, fromDbCategory, demoCategory } = await import('../src/store/calendar');
const { useSettings } = await import('../src/store/settings');
const { startSync, stopSync, whenSaved, refusedCount } = await import('../src/lib/cloudSync');
const { readDemo } = await import('../src/lib/demoFirst');
const { demoKept } = await import('../src/pages/landingDemo');
const { keepStatus, pickStatus, statusChosen, isLycee, needOptions, STATUS_GROUPS, OWN_BOSS, SANTE } = await import('../src/lib/welcome');
const { bigDayWords, WORDS } = await import('../src/lib/usage');
const { reminderLabel, remindersText, TASK_DEFAULTS } = await import('../src/lib/reminders');

beforeEach(() => {
  stopSync();
  memory.clear();
  sent.length = 0;
  migrated = false;
  useCalendar.setState({ events: [], trash: [] });
  useSettings.setState({ usage: 'etudes', usages: [], customCategories: [] });
  startSync('u1');
});

describe('la catégorie Travail', () => {
  it('existe partout sous ce nom, avec sa couleur à elle', () => {
    expect(allCategories([])).toContain('travail');
    for (const names of Object.values(CATEGORY_LABELS)) expect(names.travail).toBe('Travail');
    const others = (Object.keys(CATEGORIES) as (keyof typeof CATEGORIES)[]).filter(k => k !== 'travail').map(k => CATEGORIES[k].color);
    expect(others).not.toContain(CATEGORIES.travail.color);
    expect(catOf('travail').label).toBe('Travail');
  });

  it('serveur pas encore mis à jour : envoyée comme « c-travail », gardée, relue « Travail »', async () => {
    const ev = useCalendar.getState().add({ title: 'Chantier Dupont', category: 'travail', date: '2026-11-20', start: '08:00' });
    expect(await whenSaved('events', [ev.id])).toEqual({ state: 'saved' });
    expect(sent.find(r => r.id === ev.id)?.category).toBe('c-travail');
    expect(refusedCount()).toBe(0);
    expect(useCalendar.getState().events[0].category).toBe('travail');
    expect(fromDbCategory('c-travail')).toBe('travail');
    expect(fromDbCategory('perso')).toBe('perso');
    expect(fromDbCategory(null)).toBeNull();
  });

  it('serveur mis à jour : envoyée telle quelle', async () => {
    migrated = true;
    const ev = useCalendar.getState().add({ title: 'Brief client', category: 'travail', date: '2026-11-20' });
    expect(await whenSaved('events', [ev.id])).toEqual({ state: 'saved' });
    expect(sent.find(r => r.id === ev.id)?.category).toBe('travail');
  });
});

describe('la démo de l’accueil garde le monde choisi', () => {
  const at = new Date(2026, 10, 13, 10);
  it('l’onglet est gardé avec la phrase, relu au compte', () => {
    expect(readDemo(demoKept('Chantier Mme Durand jeudi 8h', at, 'travail'), at)).toMatchObject({ text: 'Chantier Mme Durand jeudi 8h', usage: 'travail' });
    expect(readDemo(demoKept('Dentiste mardi 17h30', at), at)?.usage).toBeUndefined();
    expect(readDemo(JSON.stringify({ text: 'x', at: at.toISOString(), usage: 'pirate' }), at)?.usage).toBeUndefined();
  });

  it('un exemple de la semaine prochaine garde ses jours (lu depuis son lundi), jamais plus d’une semaine plus loin', () => {
    const monday = new Date(2026, 10, 16);
    expect(readDemo(demoKept('Réunion vendredi 10h', at, 'travail', false, monday), at)?.from).toEqual(monday);
    expect(readDemo(JSON.stringify({ text: 'x', at: at.toISOString(), from: new Date(2027, 0, 1).toISOString() }), at)?.from).toBeUndefined();
  });

  it('« Travail » arrive en Travail, « Famille » en Perso, quel que soit le compte', () => {
    for (const [usage, usages] of [['etudes', ['etudes']], ['perso', ['perso']], ['etudes', ['etudes', 'travail']]] as const) {
      useSettings.setState({ usage, usages: [...usages] });
      expect(demoCategory('Chantier Mme Durand', 'travail'), usage).toBe('travail');
      expect(demoCategory('Réunion', 'travail'), usage).toBe('travail');
      expect(demoCategory('Appeler M. Dupont', 'travail'), usage).toBe('travail');
      expect(demoCategory('Dentiste', 'travail'), usage).toBe('perso');
    }
    useSettings.setState({ usage: 'travail', usages: ['travail'] });
    expect(demoCategory('Judo de Léo', 'perso')).toBe('perso');
    expect(demoCategory('Cardiologue', 'perso')).toBe('perso');
    expect(demoCategory('Anniversaire de maman', 'perso')).toBe('examen');
    expect(demoCategory('Examen', 'etudes')).toBe('examen');
    // The same life, or none chosen: the account's own guess.
    expect(demoCategory('Réunion', 'travail')).toBe('cours');
    expect(demoCategory('Chantier Mme Durand', null)).toBe('travail');
  });
});

describe('« Tu es… »', () => {
  it('BTS et alternance ensemble ; un autre niveau remplace le premier, l’alternance reste', () => {
    let year = pickStatus('', 'BTS / BUT');
    year = pickStatus(year, 'Alternance');
    expect(year).toBe('BTS / BUT + Alternance');
    expect(statusChosen(year, 'BTS / BUT')).toBe(true);
    expect(statusChosen(year, 'Alternance')).toBe(true);
    expect(statusChosen(year, 'Prépa')).toBe(false);
    year = pickStatus(year, 'Prépa');
    expect(year).toBe('Prépa + Alternance');
    expect(pickStatus(year, 'Alternance')).toBe('Prépa');
    expect(pickStatus('', 'Alternance')).toBe('Alternance');
  });

  it('les nouveaux cas : santé (IFSI) et « Je dirige / à mon compte »', () => {
    expect(STATUS_GROUPS.find(g => g.usage === 'etudes' && g.options.includes(SANTE))).toBeTruthy();
    expect(STATUS_GROUPS.find(g => g.usage === 'travail')?.options).toContain(OWN_BOSS);
    expect(WORDS.etudes.levels).toContain(SANTE);
    expect(WORDS.travail.levels).toContain(OWN_BOSS);
  });

  it('ce que chaque réponse change ailleurs suit le niveau, avec ou sans alternance', () => {
    expect(isLycee('Terminale + Alternance')).toBe(true);
    expect(isLycee('BTS / BUT + Alternance')).toBe(false);
    expect(needOptions({ usage: 'etudes', usages: ['etudes'], year: 'Collège + Alternance' }).find(n => n.key === 'reviser')?.label).toMatch(/brevet/);
    expect(bigDayWords('etudes', 'Doctorat + Alternance')).toBe(WORDS.perso);
    expect(bigDayWords('etudes', SANTE)).toBe(WORDS.etudes);
  });

  it('en changeant les usages, ce qui ne va plus part', () => {
    expect(keepStatus('BTS / BUT + Alternance', ['etudes'])).toBe('BTS / BUT + Alternance');
    expect(keepStatus('BTS / BUT + Alternance', ['travail'])).toBe('Alternance');
    expect(keepStatus('Salarié·e', ['etudes'])).toBe('');
    expect(keepStatus('Autre', ['perso'])).toBe('Autre');
  });
});

describe('les rappels disent la même chose partout', () => {
  it('« La veille à 09:00 » choisi pour un événement à 9 h reste « La veille à 09:00 »', () => {
    expect(reminderLabel(1440, true, '2026-11-20', '09:00')).toBe('La veille à 09:00');
    expect(remindersText([1440, 60], '2026-11-20', '09:00')).toBe('1 h avant, La veille à 09:00');
    expect(reminderLabel(1440, true, '2026-11-20', '14:30')).toBe('La veille à 14:30');
    // Without an event (the usual reminder in Réglages): « 1 jour avant ».
    expect(reminderLabel(1440, true)).toBe('1 jour avant');
    expect(reminderLabel(60, true, '2026-11-20', '09:00')).toBe('1 h avant');
  });

  it('le rappel du jour même d’une tâche n’annonce plus 9 h d’un côté et 8 h de l’autre', () => {
    expect(TASK_DEFAULTS.map(o => o.label).join(' | ')).not.toMatch(/09:00/);
    expect(TASK_DEFAULTS.find(o => o.value === 'les-deux')?.label).toBe('La veille à 18:00 et le matin même');
  });
});
