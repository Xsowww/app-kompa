import { describe, expect, it } from 'vitest';

// The stores read the browser globals.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { normalize } = await import('../src/lib/utils');
const { isBlankNote } = await import('../src/pages/notes/noteUtils');
const { search } = await import('../src/copilot/actions');
const { localReply } = await import('../src/copilot/localBrain');
const { useNotes } = await import('../src/store/notes');
const { useTodos } = await import('../src/store/todos');
const { addDays, format } = await import('date-fns');
const inDays = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd');

const note = (patch: Record<string, unknown> = {}) => ({ id: 'n', title: 'Sans titre', content: '', folderId: null, createdAt: '', updatedAt: '', ...patch });

describe('search: « œ » and « æ »', () => {
  it('« oeufs » finds « œufs », and the other way round', () => {
    expect(normalize('Œufs brouillés')).toBe('oeufs brouilles');
    expect(normalize('œufs').includes(normalize('oeufs'))).toBe(true);
    expect(normalize('ex aequo')).toBe(normalize('ex æquo'));
  });

  it('Kompaly still cuts the words typed right when they have an « œ »', () => {
    useTodos.setState({ todos: [] });
    expect(localReply('Ajoute la tâche acheter des œufs').text).toMatch(/« acheter des œufs »/i);
    expect(useTodos.getState().todos[0]?.title).toMatch(/^[Aa]cheter des œufs$/);
  });
});

describe('notes: blank ones', () => {
  it('only an empty « Sans titre » note, not pinned and without links, is blank', () => {
    expect(isBlankNote(note())).toBe(true);
    expect(isBlankNote(note({ content: '<p></p>' }))).toBe(true);
    expect(isBlankNote(note({ content: '<p><br></p>' }))).toBe(true);
    expect(isBlankNote(note({ content: '<p>x</p>' }))).toBe(false);
    expect(isBlankNote(note({ content: '<p><img src="a"></p>' }))).toBe(false);
    expect(isBlankNote(note({ content: '<ul data-type="taskList"><li></li></ul>' }))).toBe(false);
    expect(isBlankNote(note({ title: 'Courses' }))).toBe(false);
    expect(isBlankNote(note({ pinned: true }))).toBe(false);
    expect(isBlankNote(note({ links: [{ kind: 'file', id: 'f' }] }))).toBe(false);
  });
});

describe('global search', () => {
  it('the place of a hit does not repeat its type', () => {
    useNotes.setState({ folders: [], notes: [], trashFolders: [], trashNotes: [] });
    useNotes.getState().createNote({ title: 'Recette crêpes' });
    useTodos.setState({ todos: [] });
    useTodos.getState().add?.('Recette à tester');
    const hits = search('recette');
    expect(hits.find(h => h.type === 'note')?.where).toBe('');
    for (const h of hits) expect(h.where).not.toMatch(/^(Notes|Tâches)\b/);
  });

  it('includes what the groups and shared calendars already read hold', () => {
    const groups = [
      { id: 'g1', name: 'Projet bio', kind: 'groupe' },
      { id: 'a1', name: 'Famille', kind: 'agenda' },
    ] as never[];
    const notes = { g1: [{ id: 'gn', groupId: 'g1', title: 'Compte rendu bio' }] } as never;
    const events = { a1: [{ id: 'ge', groupId: 'a1', title: 'Repas bio', date: inDays(3) }] } as never;
    const hits = search('bio', 8, { groups, notes, events });
    expect(hits.find(h => h.id === 'gn')).toMatchObject({ type: 'note partagée', where: 'Projet bio', to: '/groupes?g=g1&onglet=notes&note=gn' });
    expect(hits.find(h => h.id === 'ge')).toMatchObject({ type: 'événement partagé', to: '/agendas?g=a1' });
    // Kompaly's own search (which can delete or rename what it finds) stays on my things.
    expect(search('bio').some(h => h.id === 'gn' || h.id === 'ge')).toBe(false);
  });
});

describe('Kompaly in simple mode', () => {
  it('« demain » lists the tasks due tomorrow too', () => {
    useTodos.setState({ todos: [] });
    localReply('Ajoute la tâche appeler la banque demain');
    expect(useTodos.getState().todos[0]?.due).toBe(inDays(1));
    const r = localReply('je fais quoi demain ?');
    expect(r.text).toMatch(/appeler la banque/i);
    expect(r.links?.some(l => l.to === '/taches')).toBe(true);
  });

  it('« résume ma note X » says the AI is needed, not the general summary', () => {
    useNotes.setState({ folders: [], notes: [], trashFolders: [], trashNotes: [] });
    useNotes.getState().createNote({ title: 'Biologie cellulaire', content: '<p>La cellule…</p>' });
    for (const ask of ['résume ma note Biologie cellulaire', 'Fais-moi un résumé de la note biologie', 'résume Biologie cellulaire']) {
      const r = localReply(ask);
      expect(r.text).toMatch(/demande l’IA/);
      expect(r.links?.[0].to).toMatch(/^\/notes\?note=/);
    }
    expect(localReply('résume').text).toMatch(/bilan/);
  });

  it('says plainly when the AI is not there', () => {
    expect(localReply('blablabla xyz').text).toMatch(/l’IA n’est pas disponible/);
  });
});
