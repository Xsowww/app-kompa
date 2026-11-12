import { beforeEach, describe, expect, it } from 'vitest';

// Test visiteurs (Nora) : un enregistrement où rien n'a été transcrit créait un document vide, « enregistré et rédigé
// avec Kompaly ». Rien n'est créé, et c'est dit.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { nothingWritten } = await import('../src/lib/recorder/course');
const { useRecorder, completeDocuments } = await import('../src/store/recorder');
const { useDrive } = await import('../src/store/drive');
const { useUi } = await import('../src/store/ui');

const session = (segments: { text: string; origin?: string }[]) => ({
  id: 's1',
  title: 'Anatomie',
  source: 'micro' as const,
  folderId: null,
  newFolder: 'Anatomie',
  keywords: [],
  make: { fiche: true, examen: true },
  startedAt: Date.now() - 60_000,
  endedAt: Date.now(),
  phase: 'finishing' as const,
  segments: segments.map((s, i) => ({ id: String(i), start: i * 10, end: i * 10 + 10, hits: [], ...s })),
  live: [],
  alerts: [],
  stars: [],
  parts: [],
  partsUpTo: 0,
  files: {},
});

beforeEach(() => {
  useDrive.setState({ items: [], trash: [] });
  useRecorder.setState({ session: null, history: [] });
});

describe('enregistrement sans rien de transcrit', () => {
  it('« rien d’écrit » : aucun passage, ou seulement des passages vides', () => {
    expect(nothingWritten([])).toBe(true);
    expect(nothingWritten([{ text: '' }, { text: '  ' }])).toBe(true);
    expect(nothingWritten([{ text: '' }, { text: 'Le fémur est un os long.' }])).toBe(false);
  });

  it.each([
    ['aucun passage', []],
    ['des passages non transcrits', [{ text: '', origin: 'manquant' }, { text: '', origin: 'manquant' }]],
  ])('%s : pas de document, pas de dossier, pas de ligne dans la liste, et c’est dit', async (_, segments) => {
    useRecorder.setState({ session: session(segments) as never });
    await completeDocuments();
    const s = useRecorder.getState().session!;
    expect(s.phase).toBe('done');
    expect(s.empty).toBe(true);
    expect(s.files).toEqual({});
    expect(useDrive.getState().items).toEqual([]);
    expect(useRecorder.getState().history).toEqual([]);
    expect(JSON.stringify(useUi.getState())).toContain('Rien n’a pu être transcrit');
  });
});
