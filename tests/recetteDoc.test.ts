import { beforeEach, describe, expect, it, vi } from 'vitest';

// The stores read the browser globals.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { search } = await import('../src/copilot/actions');
const { useCalendar } = await import('../src/store/calendar');
const { useNotes } = await import('../src/store/notes');
const { useDrive } = await import('../src/store/drive');
const { useTodos } = await import('../src/store/todos');
const { collectTrash, eventGroups, eventsWhen, restoreTrash, purgeTrash } = await import('../src/lib/trash');
const { mdText, mdCode, mdFence } = await import('../src/pages/notes/exportNote');
type Ev = import('../src/store/calendar').CalendarEvent;

const ev = (id: string, date: string, patch: Partial<Ev> = {}): Ev => ({ id, title: 'Réunion hebdo', date, category: 'reunion', done: false, createdAt: '', ...patch });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T10:00:00'));
  useCalendar.setState({ events: [], trash: [] });
  useNotes.setState({ folders: [], notes: [], trashFolders: [], trashNotes: [] });
  useDrive.setState({ items: [], trash: [] });
  useTodos.setState({ todos: [] });
});

describe('top search: events', () => {
  it('a weekly meeting gives one line, its next date', () => {
    const days = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'];
    useCalendar.setState({ events: days.map((d, i) => ev(`r${i}`, d, { series: 's1' })) });
    const hits = search('réunion hebdo');
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('r8');
  });

  it('a series all over: its last date; equal scores: the one to come first', () => {
    useCalendar.setState({
      events: [ev('v1', '2026-09-01', { title: 'Voyage', series: 'v' }), ev('v2', '2026-09-02', { title: 'Voyage', series: 'v' }), ev('old', '2026-10-01', { title: 'Voyage' }), ev('new', '2026-11-20', { title: 'Voyage' })],
    });
    expect(search('voyage').map(h => h.id)).toEqual(['new', 'old', 'v2']);
  });

  it('reads the notes of an event, a little below its title', () => {
    useCalendar.setState({ events: [ev('d', '2026-11-03', { title: 'Dentiste', details: 'Cabinet du docteur Martin' })] });
    expect(search('martin').map(h => h.id)).toEqual(['d']);
  });

  it('shared events: one line per series, place and notes read', () => {
    const g = { id: 'g1', name: 'Coloc', kind: 'agenda' } as never;
    const ge = (id: string, date: string, place: string | null = null) => ({ id, groupId: 'g1', title: 'Ménage', date, start: null, end: null, place, category: null, details: null, createdBy: null, createdAt: '', people: [], reminders: [], series: 'm' });
    const hits = search('menage', 8, { groups: [g], notes: {}, events: { g1: [ge('a', '2026-10-19'), ge('b', '2026-10-27'), ge('c', '2026-11-03')] } });
    expect(hits.map(h => h.id)).toEqual(['b']);
    expect(search('cuisine', 8, { groups: [g], notes: {}, events: { g1: [{ ...ge('x', '2026-11-01', 'Cuisine'), series: null }] } }).map(h => h.id)).toEqual(['x']);
  });
});

describe('trash: a series deleted at once', () => {
  const at = '2026-10-20T08:00:00.000Z';
  const trip = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].map((d, i) => ev(`t${i}`, d, { title: 'Voyage à Rome', series: 'trip', deletedAt: at }));

  it('one entry for the days deleted together, « du … au … »', () => {
    useCalendar.setState({ trash: [...trip, ev('x', '2026-10-28', { title: 'Seul', deletedAt: at })] });
    const entries = collectTrash();
    expect(entries).toHaveLength(2);
    const e = entries.find(x => x.kind === 'event' && x.events.length > 1)!;
    expect(e.kind === 'event' && e.events.map(x => x.id)).toEqual(['t0', 't1', 't2', 't3']);
    expect(e.place).toBe('Calendrier · du 29 oct. au 1er nov.');
    expect(eventGroups(useCalendar.getState().trash)).toHaveLength(2);
  });

  it('days not in a row: « n fois »; deleted at another moment: their own entry', () => {
    const weekly = ['2026-10-05', '2026-10-12', '2026-10-19'].map((d, i) => ev(`w${i}`, d, { series: 'w', deletedAt: at }));
    expect(eventsWhen(weekly)).toBe('3 fois');
    const later = ev('w9', '2026-10-26', { series: 'w', deletedAt: '2026-10-21T08:00:00.000Z' });
    expect(eventGroups([...weekly, later]).map(g => g.length)).toEqual([3, 1]);
  });

  it('restores and purges the whole series', () => {
    useCalendar.setState({ trash: trip });
    restoreTrash(['t0']);
    expect(useCalendar.getState().events.map(e => e.id).sort()).toEqual(['t0', 't1', 't2', 't3']);
    expect(useCalendar.getState().trash).toHaveLength(0);
    useCalendar.setState({ events: [], trash: trip });
    purgeTrash(['t0']);
    expect(useCalendar.getState().trash).toHaveLength(0);
  });
});

describe('trash: a note restored with its folder', () => {
  it('is not said to go back to the root', () => {
    const notes = useNotes.getState();
    const f = notes.createFolder('Biologie', null);
    const n = notes.createNote({ title: 'Mitose', folderId: f.id });
    useNotes.getState().removeNote(n.id);
    vi.setSystemTime(new Date('2026-10-26T10:05:00'));
    useNotes.getState().removeFolder(f.id);
    useNotes.getState().createFolder('Biologie', null);
    const r = restoreTrash([n.id, f.id]);
    expect(r.orphan).toBe(false);
    expect(r.renamed).toEqual(['Biologie (2)']);
    expect(useNotes.getState().notes.find(x => x.id === n.id)?.folderId).toBe(f.id);
  });
});

describe('Markdown export', () => {
  it('escapes what Markdown would read as HTML or formatting', () => {
    expect(mdText('<script>alert(1)</script>')).toBe('\\<script\\>alert(1)\\</script\\>');
    expect(mdText('x <y et y> z, a*b_c [d] \\e')).toBe('x \\<y et y\\> z, a\\*b\\_c \\[d\\] \\\\e');
  });
  it('fences code with more backticks than it holds', () => {
    expect(mdCode('a`b')).toBe('``a`b``');
    expect(mdCode('`x`')).toBe('`` `x` ``');
    expect(mdCode('plain')).toBe('`plain`');
    expect(mdFence('code ``` here', 3)).toBe('````');
  });
});

describe('duplicating a note', () => {
  it('keeps its links', () => {
    const n = useNotes.getState().createNote({ title: 'Fiche' });
    useNotes.getState().updateNote(n.id, { links: [{ kind: 'event', id: 'e1' }, { kind: 'file', id: 'f1' }] });
    const copy = useNotes.getState().duplicateNote(n.id)!;
    expect(useNotes.getState().notes.find(x => x.id === copy.id)?.links).toEqual([{ kind: 'event', id: 'e1' }, { kind: 'file', id: 'f1' }]);
  });
});
