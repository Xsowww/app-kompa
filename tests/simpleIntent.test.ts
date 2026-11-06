import { describe, expect, it, vi } from 'vitest';

// The home page's examples must work in Kompaly's chat, with or without the AI: they are recognised before anything is
// sent (copilot/simpleIntent) and made on the device by the simple mode (copilot/localBrain).
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
  document: { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } }, querySelector: () => null },
});
const { quickEvent, dayQuestion, isSimpleRequest } = await import('../src/copilot/simpleIntent');
const { localReply } = await import('../src/copilot/localBrain');
const { useCalendar } = await import('../src/store/calendar');
const { parseQuickAdd } = await import('../src/lib/dates');

// Vendredi 6 novembre 2026, 10 h.
const base = new Date(2026, 10, 6, 10);

const EXAMPLES: [string, { title: string; date: string; start: string; end?: string | null; endDate?: string }][] = [
  ['Ajoute un rendez-vous dentiste mardi 17h30', { title: 'Dentiste', date: '2026-11-10', start: '17:30' }],
  ['Relancer M. Dupont vendredi 10h', { title: 'Relancer M. Dupont', date: '2026-11-13', start: '10:00' }],
  ['Réviser le partiel jeudi 18h', { title: 'Réviser le partiel', date: '2026-11-12', start: '18:00' }],
  ['Judo de Léo mercredi 14h', { title: 'Judo de Léo', date: '2026-11-11', start: '14:00' }],
  ['Cardiologue jeudi 9h30', { title: 'Cardiologue', date: '2026-11-12', start: '09:30' }],
  ['Garde de nuit lundi 21h-7h', { title: 'Garde de nuit', date: '2026-11-09', start: '21:00', end: '07:00', endDate: '2026-11-10' }],
];

describe('les exemples de la page d’accueil', () => {
  it.each(EXAMPLES)('« %s » est un événement reconnu sans IA', (sentence, want) => {
    const ev = quickEvent(sentence, base);
    expect(ev).toMatchObject(want);
    expect(isSimpleRequest(sentence, base)).toBe(true);
  });

  it('le mode simple les ajoute au calendrier (et propose de prévenir 1 h avant)', () => {
    vi.useFakeTimers({ now: base });
    try {
      for (const [sentence, want] of EXAMPLES) {
        useCalendar.setState({ events: [] });
        const reply = localReply(sentence);
        expect(reply.unknown, sentence).toBeFalsy();
        expect(reply.text, sentence).toContain('Ajouté au calendrier');
        const made = useCalendar.getState().events;
        expect(made[0], sentence).toMatchObject({ title: want.title, date: want.date, start: want.start });
        expect(reply.offers?.[0], sentence).toMatchObject({ kind: 'add_reminder', label: 'Me prévenir 1 h avant' });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('une garde de nuit est sur les deux jours : le soir, puis le lendemain matin', () => {
    vi.useFakeTimers({ now: base });
    try {
      useCalendar.setState({ events: [] });
      const reply = localReply('Garde de nuit lundi 21h-7h');
      const days = useCalendar.getState().events.map(e => [e.date, e.start, e.end]);
      expect(days).toEqual([
        ['2026-11-09', '21:00', '23:59'],
        ['2026-11-10', '00:00', '07:00'],
      ]);
      expect(reply.text).toContain('Jusqu’au lendemain 7h');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ce qui part à l’IA, et ce qui reste sur l’appareil', () => {
  it('les questions simples sur l’agenda restent sur l’appareil', () => {
    for (const q of ['Qu’est-ce que j’ai demain ?', 'je fais quoi jeudi', 'mon planning de la semaine', 'demain ?']) expect(dayQuestion(q, base), q).toBe(true);
  });

  it('une demande plus riche va à l’IA', () => {
    for (const q of [
      'Qu’est-ce que j’ai demain et propose-moi un créneau pour réviser',
      'Ajoute dentiste mardi 17h30 et rappelle-moi la veille',
      'Déplace le dentiste à jeudi 18h',
      'Peux-tu m’expliquer le théorème de Pythagore ?',
      'Supprime le judo de mercredi 14h',
      'Ajoute une note courses demain',
      'Résume mon cours de droit en 5 points',
      'Fais-moi un planning de révisions pour jeudi 18h',
    ])
      expect(isSimpleRequest(q, base), q).toBe(false);
  });

  it('un titre sans heure ni verbe n’est pas pris pour un événement', () => {
    expect(quickEvent('Je suis fatigué aujourd’hui', base)).toBeNull();
    expect(quickEvent('Réunion importante', base)).toBeNull();
    expect(quickEvent('Ajoute un rendez-vous chez le kiné lundi', base)).toMatchObject({ title: 'Chez le kiné', date: '2026-11-09' });
  });
});

describe('les nuits dans l’ajout en une phrase', () => {
  it('« 21h-7h », « de 22h à 6h » finissent le lendemain ; « de 18h à 9h » garde seulement le début', () => {
    expect(parseQuickAdd('Garde lundi de 22h à 6h', base)).toMatchObject({ date: '2026-11-09', start: '22:00', end: '06:00', endDate: '2026-11-10' });
    expect(parseQuickAdd('Garde 21h-7h', base)).toMatchObject({ date: '2026-11-06', start: '21:00', end: '07:00', endDate: '2026-11-07' });
    expect(parseQuickAdd('Sport lundi de 18h à 9h', base)).toMatchObject({ start: '18:00', end: null });
    expect(parseQuickAdd('Sport lundi de 18h à 9h', base).endDate).toBeUndefined();
  });
});
