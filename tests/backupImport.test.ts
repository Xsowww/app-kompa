import { beforeEach, describe, expect, it } from 'vitest';

// « Restaurer une sauvegarde » : nothing lost, nothing twice, a damaged file never half taken.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
  document: { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} }, querySelector: () => null },
});
const { importBackup } = await import('../src/lib/backup');
const { useCalendar } = await import('../src/store/calendar');
const { useTodos } = await import('../src/store/todos');
const { useNotes } = await import('../src/store/notes');
const { useDrive } = await import('../src/store/drive');
const { useSettings, DEFAULT_SETTINGS } = await import('../src/store/settings');

const file = (data: unknown) => new File([typeof data === 'string' ? data : JSON.stringify(data)], 'sauvegarde.json');
const base = { app: 'kompaly', version: 1, calendar: [], notes: { notes: [], folders: [] } };

beforeEach(() => {
  useCalendar.setState({ events: [], trash: [] });
  useTodos.setState({ todos: [], trash: [] });
  useNotes.setState({ notes: [], folders: [], trashNotes: [], trashFolders: [] });
  useDrive.setState({ items: [], trash: [] });
  useSettings.setState(DEFAULT_SETTINGS);
});

describe('restaurer une sauvegarde', () => {
  it('une tâche qui est dans la corbeille ne revient pas en double (elle est comptée « dans la corbeille »)', async () => {
    const kept = useTodos.getState().add('Gardée');
    const gone = useTodos.getState().add('Supprimée');
    const saved = { ...base, todos: useTodos.getState().todos };
    useTodos.getState().remove(gone.id);
    const r = await importBackup(file(saved));
    expect(r.todos).toBe(0);
    expect(r.inTrash).toBe(1);
    expect(useTodos.getState().todos.map(x => x.id)).toEqual([kept.id]);
    expect(useTodos.getState().trash.map(x => x.id)).toEqual([gone.id]);
  });

  it('aller-retour : tout ce qui a été supprimé pour de bon revient, une seule fois, à l’identique', async () => {
    const ev = useCalendar.getState().add({ title: 'Examen « maths » 🎓', date: '2028-02-29', start: '23:30', end: '23:59', category: 'examen', important: true, place: 'Salle B12', reminders: [60, 15] });
    const todo = useTodos.getState().add('Rendre le mémoire', '2026-12-31', '08:00');
    const folder = useNotes.getState().createFolder('Chimie', null);
    const note = useNotes.getState().createNote({ title: 'Mitose', content: '<p>é</p>', folderId: folder.id });
    const saved = JSON.parse(JSON.stringify({ ...base, calendar: useCalendar.getState().events, todos: useTodos.getState().todos, notes: { notes: useNotes.getState().notes, folders: useNotes.getState().folders } }));
    const before = { ev: useCalendar.getState().events, todos: useTodos.getState().todos, notes: useNotes.getState().notes, folders: useNotes.getState().folders };
    useCalendar.setState({ events: [] });
    useTodos.setState({ todos: [] });
    useNotes.setState({ notes: [], folders: [] });
    expect(await importBackup(file(saved))).toEqual({ notes: 1, events: 1, todos: 1, folders: 1, inTrash: 0 });
    expect(useCalendar.getState().events).toEqual(before.ev);
    expect(useTodos.getState().todos).toEqual(before.todos);
    expect(useNotes.getState().notes).toEqual(before.notes);
    expect(useNotes.getState().folders).toEqual(before.folders);
    // A second time: nothing more.
    expect(await importBackup(file(saved))).toEqual({ notes: 0, events: 0, todos: 0, folders: 0, inTrash: 0 });
    expect([ev.id, todo.id, note.id].length).toBe(3);
  });

  it('un fichier abîmé : ce qui est faux est laissé, le reste arrive en entier (avant : l’import s’arrêtait à moitié)', async () => {
    const r = await importBackup(
      file({
        ...base,
        calendar: [{ id: 'x1', title: 'Heure fausse', date: '2026-11-12', start: 930, end: {}, category: 42, reminders: 'abc', done: 'oui' }, { id: 'x2', title: 5, date: 'hier' }, null, 7, { id: 'x3', title: 'Fin sans début', date: '2026-11-12', end: '10:00', start: '25:00' }],
        notes: { notes: [{ id: 'n1', title: 'N', content: '<p>ok</p>', links: [{ kind: 'x', id: 1 }, { kind: 'file', id: 'f1' }], pinned: 'oui' }, { id: 5 }], folders: 'non' },
        todos: [{ id: 't1', title: 'Jour faux', due: '2026-02-30' }, { id: 't2', title: 'Tâche', due: '2026-12-01', time: 77, repeat: 'x', reminders: {} }],
        driveFolders: [{ id: 'd1', name: 'Un fichier', kind: 'file' }, { id: 'd2', name: 'Dossier', kind: 'folder', parentId: 'inconnu', tags: 'x' }],
      }),
    );
    expect(r).toEqual({ notes: 1, events: 2, todos: 1, folders: 1, inTrash: 0 });
    const [e1, e3] = useCalendar.getState().events;
    expect(e1).toMatchObject({ id: 'x1', title: 'Heure fausse', date: '2026-11-12', category: 'perso', done: false });
    expect(e1.start).toBeUndefined();
    expect(e1.end).toBeUndefined();
    expect(e1.reminders).toBeUndefined();
    expect(typeof e1.createdAt).toBe('string');
    expect(e3.start).toBeUndefined();
    expect(e3.end).toBeUndefined();
    expect(useTodos.getState().todos).toMatchObject([{ id: 't2', title: 'Tâche', due: '2026-12-01', done: false }]);
    expect(useTodos.getState().todos[0].time).toBeUndefined();
    expect(useTodos.getState().todos[0].repeat).toBeUndefined();
    expect(useNotes.getState().notes).toMatchObject([{ id: 'n1', folderId: null, links: [{ kind: 'file', id: 'f1' }] }]);
    expect(useNotes.getState().notes[0].pinned).toBeUndefined();
    expect(useDrive.getState().items).toMatchObject([{ id: 'd2', kind: 'folder', parentId: null }]);
  });

  it('pas une sauvegarde : refusée avec un message clair, rien n’est touché', async () => {
    for (const bad of ['', 'null', '[1,2]', '{"app":"kompaly","calendar":[', JSON.stringify({ app: 'autre', calendar: [], notes: {} }), JSON.stringify({ app: 'kompaly', calendar: 'x', notes: {} })])
      await expect(importBackup(file(bad)), bad).rejects.toThrow('Ce fichier n’est pas une sauvegarde Kompaly.');
    expect(useCalendar.getState().events).toEqual([]);
  });

  it('réglages : un choix inconnu est laissé de côté ; l’ordre du menu et les nouvelles des agendas reviennent', async () => {
    await importBackup(file({ ...base, settings: { accent: 'zzz', theme: 'zzz', textSize: 'énorme', language: 'xx', proWall: 'x', style: 'x', persona: 'x', chattiness: 'x', usage: 'x', customCategories: [{ id: 'c-1' }, { id: 'c-2', label: 'Sport', color: '#2f9e6b' }], icsFeeds: [{ id: 1 }] } }));
    const s = useSettings.getState();
    for (const k of ['accent', 'theme', 'textSize', 'language', 'proWall', 'style', 'persona', 'chattiness', 'usage'] as const) expect(s[k], k).toBe(DEFAULT_SETTINGS[k]);
    expect(s.customCategories).toEqual([{ id: 'c-2', label: 'Sport', color: '#2f9e6b' }]);
    expect(s.icsFeeds).toEqual([]);
    await importBackup(file({ ...base, settings: { accent: 'vert', theme: 'sombre', navOrder: ['notes', 'calendrier'], calendarNews: false } }));
    expect(useSettings.getState()).toMatchObject({ accent: 'vert', theme: 'sombre', navOrder: ['notes', 'calendrier'], calendarNews: false });
  });
});
