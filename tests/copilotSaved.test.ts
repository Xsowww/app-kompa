import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from 'date-fns';

// Test n°3: Kompaly said « ajouté » for nights the server refused, « c'est dans Famille » for an event in « perso »,
// and couldn't work in a shared calendar. Here: he says what the store and the server hold, nothing else.

const memory = new Map<string, string>();
const session = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
  sessionStorage: { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => session.set(k, v), removeItem: (k: string) => session.delete(k) },
});

// The server check (saveCheck) and the shared calendars' server (lib/groups) are stand-ins: nothing leaves the test.
const check = vi.hoisted(() => ({ next: { ok: true } as { ok: boolean; offline?: boolean; missing?: string[] }, calls: [] as string[][] }));
vi.mock('../src/copilot/saveCheck', () => ({
  retrySaving: async () => void check.calls.push(['retry']),
  confirmSaved: async (_table: string, ids: string[]) => {
    check.calls.push(ids);
    const r = check.next;
    return r.missing ? { ...r, missing: ids } : r;
  },
}));
const server = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], deleted: [] as string[] }));
vi.mock('../src/lib/groups', async orig => {
  const real = (await orig()) as Record<string, unknown>;
  const row = (groupId: string, e: Record<string, unknown>, i: number) => ({ id: `g-ev-${server.rows.length + i}`, groupId, title: e.title, date: e.date, start: e.start ?? null, end: e.end ?? null, place: e.place ?? null, category: e.category ?? null, details: null, createdBy: 'me', createdAt: '', people: [], reminders: e.reminders ?? [], series: e.series ?? null, updatedBy: null, updatedAt: null });
  return {
    ...real,
    createEvent: async (groupId: string, e: Record<string, unknown>) => {
      const r = row(groupId, e, 0);
      server.rows.push(r);
      return r;
    },
    createEvents: async (groupId: string, list: Record<string, unknown>[]) => {
      const made = list.map((e, i) => row(groupId, e, i));
      server.rows.push(...made);
      return made;
    },
    fetchEvents: async (groupId: string) => ({ events: server.rows.filter(r => r.groupId === groupId), attendance: [] }),
    deleteEvents: async (ids: string[]) => void server.deleted.push(...ids),
  };
});

const { useCalendar } = await import('../src/store/calendar');
const { useSettings } = await import('../src/store/settings');
const { useGroups } = await import('../src/store/groups');
const { useAuth } = await import('../src/store/auth');
const { useCopilot, answerOrphan } = await import('../src/store/copilot');
const { claudeReply, resetClaudeHistory } = await import('../src/copilot/claudeBrain');
const { acceptOffer } = await import('../src/copilot/offers');
const { aiPausedUntil, aiPauseReason } = await import('../src/copilot/aiPause');
const { toKey } = await import('../src/lib/dates');

let sent: { tool_use_id: string; content: string; is_error?: boolean }[] = [];
let bodies: { messages: { role: string; content: { type: string; text?: string }[] }[]; turn?: string }[] = [];
const answers = (...steps: unknown[]) => {
  const queue = [...steps];
  sent = [];
  bodies = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const last = body.messages.at(-1)!;
    if (last.role === 'user') sent.push(...(last.content.filter((b: { type: string }) => b.type === 'tool_result') as never[]));
    return new Response(JSON.stringify(queue.shift()), { status: 200 });
  });
};
const tool = (name: string, input: unknown) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: name + Math.random(), name, input }] });
const said = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const inDays = (n: number) => toKey(addDays(new Date(), n));
const famille = { id: 'g1', name: 'Famille', color: null, photo: null, ownerId: 'me', createdAt: '', kind: 'agenda' as const, categories: [], defaultRole: 'editeur' as const, defaultCanInvite: true };
const club = { ...famille, id: 'g2', name: 'Club photo', ownerId: 'other' };

beforeEach(() => {
  resetClaudeHistory();
  check.next = { ok: true };
  check.calls = [];
  server.rows = [];
  server.deleted = [];
  memory.clear();
  session.clear();
  useCalendar.setState({ events: [], trash: [] });
  useSettings.setState({ defaultReminders: [60], usage: 'perso' });
  useGroups.setState({ groups: [famille, club], myRoles: { g1: 'editeur', g2: 'lecteur' }, loaded: true, failed: false, events: {} });
  useAuth.setState({ user: { id: 'me', name: 'Sandrine', email: 's@x.fr' } as never });
  useCopilot.setState({ messages: [], thinking: false });
});

describe('add_event: the AI is told what is really saved', () => {
  it('reads the event back: day, place in its own field, its real reminders, its calendar, « enregistre »', async () => {
    answers(tool('add_event', { title: 'Kiné', date: inDays(3), start: '17:30', place: 'chez le kiné' }), said('Ajouté.'));
    await claudeReply('Kiné jeudi 17h30 chez le kiné', 'Sandrine');
    const ev = useCalendar.getState().events[0];
    expect(ev.place).toBe('chez le kiné');
    const res = JSON.parse(sent[0].content);
    expect(res).toMatchObject({ agenda: 'agenda perso', lieu: 'chez le kiné', rappels: ['1 h avant'], enregistre: true });
    expect(check.calls).toEqual([[ev.id]]);
  });

  it('a night: every day of it is checked on the server', async () => {
    answers(tool('add_event', { title: 'Garde de nuit', date: inDays(2), start: '21:00', end: '07:00' }), said('Ajouté.'));
    await claudeReply('Garde de nuit 21h-7h', 'Yanis');
    expect(useCalendar.getState().events).toHaveLength(2);
    expect(check.calls[0]).toHaveLength(2);
  });

  it('refused by the server: an error for the AI, the app says it anyway, and « Réessayer l’enregistrement »', async () => {
    check.next = { ok: false, missing: [] };
    answers(tool('add_event', { title: 'Garde de nuit', date: inDays(2), start: '21:00', end: '07:00' }), said('C’est ajouté !'));
    const reply = await claudeReply('Garde de nuit 21h-7h', 'Yanis');
    expect(sent[0].is_error).toBe(true);
    expect(sent[0].content).toMatch(/^PAS ENREGISTRÉ/);
    expect(reply.text).toMatch(/Pas enregistré en ligne/);
    expect(reply.offers?.[0]).toMatchObject({ kind: 'retry_save', label: 'Réessayer l’enregistrement' });
  });

  it('offline: kept on the device, said as such (not refused)', async () => {
    check.next = { ok: false, offline: true };
    answers(tool('add_todo', { title: 'Appeler la mairie', due: inDays(1), time: '10:00' }), said('Ajouté, envoyé au retour du réseau.'));
    await claudeReply('Rappelle-moi d’appeler la mairie demain 10h', 'Gérard');
    const res = JSON.parse(sent[0].content);
    expect(sent[0].is_error).toBeUndefined();
    expect(res.hors_ligne).toMatch(/pas de réseau/);
    expect(res.rappels).toEqual(['1 h avant']);
  });

  it('a question and its next steps carry one turn id (the server gives the question back if a step fails)', async () => {
    answers(tool('list_events', { from: inDays(0), to: inDays(7) }), said('Rien.'));
    await claudeReply('Ma semaine ?', 'Lina');
    expect(bodies).toHaveLength(2);
    expect(bodies[0].turn).toBeTruthy();
    expect(bodies[1].turn).toBe(bodies[0].turn);
  });
});

describe('shared calendars and groups (test n°3, majeur 4)', () => {
  it('add_event with « agenda »: written in that calendar, read back from its server', async () => {
    answers(tool('add_event', { title: 'Repas chez mamie', date: inDays(4), start: '12:30', agenda: 'famille' }), said('Ajouté dans Famille.'));
    const reply = await claudeReply('Ajoute repas chez mamie dimanche 12h30 dans Famille', 'Sandrine');
    expect(useCalendar.getState().events).toHaveLength(0);
    expect(server.rows).toHaveLength(1);
    expect(JSON.parse(sent[0].content)).toMatchObject({ agenda: 'agenda partagé « Famille »', enregistre: true, titre: 'Repas chez mamie' });
    expect(reply.links?.[0].to).toContain('/agendas?g=g1');
  });

  it('an unknown calendar, or one where he only reads: said, nothing created', async () => {
    answers(tool('add_event', { title: 'Sortie', date: inDays(4), agenda: 'Boulot' }), tool('add_event', { title: 'Sortie', date: inDays(4), agenda: 'Club photo' }), said('Pas possible.'));
    await claudeReply('Ajoute sortie samedi', 'Sandrine');
    expect(sent[0]).toMatchObject({ is_error: true });
    expect(sent[0].content).toMatch(/aucun agenda partagé ni groupe nommé « Boulot » \(les siens : Famille, Club photo\)/);
    expect(sent[1].content).toMatch(/seulement lecteur/);
    expect(server.rows).toHaveLength(0);
  });

  it('choose_agenda: one button per calendar, nothing created before the answer', async () => {
    answers(tool('choose_agenda', { request: 'Ajoute judo mercredi 14h' }), said('Dans quel agenda ?'));
    const reply = await claudeReply('Ajoute judo mercredi 14h', 'Julie');
    expect(reply.offers?.map(o => o.label)).toEqual(['Mon agenda perso', 'Famille', 'Club photo']);
    expect(reply.offers?.[1]).toMatchObject({ kind: 'ask', payload: { prompt: 'Ajoute judo mercredi 14h, dans l’agenda « Famille ».' } });
    expect(useCalendar.getState().events).toHaveLength(0);
  });

  it('the [Contexte] names his shared calendars', async () => {
    answers(said('Ok.'));
    await claudeReply('Salut', 'Sandrine');
    const context = bodies[0].messages[0].content[0].text!;
    expect(context).toContain('Agendas partagés et groupes : « Famille » (agenda partagé), « Club photo » (agenda partagé, lecteur seulement)');
  });

  it('move_event: from « perso » to « Famille », the whole night, removed from perso only once it is there', async () => {
    useCalendar.getState().addMany([
      { title: 'Nuit', date: inDays(5), start: '21:00', end: '23:59', category: 'perso', series: 'span-n' },
      { title: 'Nuit', date: inDays(6), start: '00:00', end: '07:00', category: 'perso', series: 'span-n' },
    ]);
    const first = useCalendar.getState().events[0];
    answers(tool('move_event', { event_id: first.id, to: 'Famille' }), said('Déplacé dans Famille.'));
    await claudeReply('Mets ma nuit dans l’agenda Famille', 'Sandrine');
    expect(server.rows.map(r => r.date)).toEqual([inDays(5), inDays(6)]);
    expect(new Set(server.rows.map(r => r.series)).size).toBe(1);
    expect(useCalendar.getState().events).toHaveLength(0);
    expect(useCalendar.getState().trash).toHaveLength(0);
    expect(JSON.parse(sent[0].content)).toMatchObject({ vers: 'agenda partagé « Famille »', occurrences: 2, enregistre: true });
  });
});

describe('the day’s questions used up (30/30): simple mode, said', () => {
  it('pauses the AI until midnight as « mine » once the server says 30/30', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ...said('Voilà.'), quota: { used: 30, max: 30 } }), { status: 200 }));
    await claudeReply('Organise ma semaine', 'Karim');
    expect(aiPausedUntil()).toBeGreaterThan(Date.now());
    expect(aiPauseReason()).toBe('mine');
    // Another tab or a reload: the same, read from the quota kept for the day.
    session.clear();
    expect(aiPausedUntil()).toBeGreaterThan(Date.now());
  });
});

describe('the conversation', () => {
  it('what was answered in simple mode never goes to the AI, not even in the recap', async () => {
    useCopilot.setState({
      messages: [
        { id: '1', role: 'user', text: 'rdv psy mardi 18h', at: new Date().toISOString(), local: true },
        { id: '2', role: 'bot', text: 'C’est noté : psy mardi 18h.', at: new Date().toISOString(), local: true },
        { id: '3', role: 'user', text: 'Prépare ma semaine', at: new Date().toISOString() },
      ],
    });
    answers(said('Ok.'));
    await claudeReply('Prépare ma semaine', 'Thomas');
    expect(JSON.stringify(bodies[0])).not.toContain('psy');
  });

  it('a question left without answer (page closed meanwhile) gets one, with « Réessayer »', () => {
    useCopilot.setState({ messages: [{ id: '1', role: 'user', text: 'Ma semaine ?', at: new Date().toISOString() }] });
    answerOrphan();
    const last = useCopilot.getState().messages.at(-1)!;
    expect(last).toMatchObject({ role: 'bot', retry: 'Ma semaine ?' });
    answerOrphan();
    expect(useCopilot.getState().messages).toHaveLength(2);
  });

  it('one welcome a day: the greeting that comes after the panel’s welcome line is not added', () => {
    useCopilot.getState().greet('Bonjour Léa ! Dis-moi.');
    useCopilot.getState().say({ text: 'Salut Léa ! Rien de prévu aujourd’hui.', hello: true, brief: true });
    expect(useCopilot.getState().messages).toHaveLength(1);
  });

  it('« Réessayer l’enregistrement »: sends again, says the outcome once read back', async () => {
    const ev = useCalendar.getState().add({ title: 'Nuit', date: inDays(2), start: '21:00', category: 'perso' });
    useCopilot.setState({ pose: 'open' });
    acceptOffer({ label: 'Réessayer l’enregistrement', kind: 'retry_save', payload: { writes: JSON.stringify([{ table: 'events', ids: [ev.id] }]) } });
    expect(useCopilot.getState().thinking).toBe(true);
    await vi.waitFor(() => expect(useCopilot.getState().thinking).toBe(false));
    expect(useCopilot.getState().messages.at(-1)!.text).toBe('C’est enregistré en ligne.');
    expect(check.calls).toEqual([['retry'], [ev.id]]);
  });
});
