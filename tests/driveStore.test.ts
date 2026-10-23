import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { useDrive, isPlainText, pasteForbidden, FOLDER_COLORS, folderColorKey, keepExtension } = await import('../src/store/drive');

beforeEach(() => {
  useDrive.setState({ items: [], trash: [], clipboard: null });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T10:00:00'));
});

/** Cours › Maths, both empty (no file content to copy). */
function tree() {
  const d = useDrive.getState();
  const cours = d.createFolder('Cours', null);
  const maths = d.createFolder('Maths', cours.id);
  return { cours, maths };
}

describe('drive paste', () => {
  it('refuses to copy a folder into one of its subfolders', async () => {
    const { cours, maths } = tree();
    useDrive.getState().copy([cours.id]);
    expect(await useDrive.getState().paste(maths.id)).toBe(false);
    expect(await useDrive.getState().paste(cours.id)).toBe(false);
    expect(useDrive.getState().items).toHaveLength(2);
    // The clipboard stays, to paste elsewhere.
    expect(useDrive.getState().clipboard?.ids).toEqual([cours.id]);
  });

  it('refuses to move a folder into itself', async () => {
    const { cours, maths } = tree();
    useDrive.getState().cut([cours.id]);
    expect(await useDrive.getState().paste(maths.id)).toBe(false);
    expect(useDrive.getState().items.find(i => i.id === cours.id)?.parentId).toBeNull();
  });

  it('still copies a folder next to itself', async () => {
    const { cours } = tree();
    useDrive.getState().copy([cours.id]);
    expect(await useDrive.getState().paste(null)).toBe(true);
    expect(useDrive.getState().items.filter(i => i.parentId === null).map(i => i.name).sort()).toEqual(['Cours', 'Cours - copie']);
  });

  it('pasteForbidden only blocks the folder and its content', () => {
    const { cours, maths } = tree();
    const items = useDrive.getState().items;
    expect(pasteForbidden(items, [cours.id], maths.id)).toBe(true);
    expect(pasteForbidden(items, [maths.id], cours.id)).toBe(false);
    expect(pasteForbidden(items, [cours.id], null)).toBe(false);
  });
});

describe('drive dates', () => {
  it('labels and colour do not change the modification date', () => {
    const { cours } = tree();
    vi.setSystemTime(new Date('2026-10-15T12:00:00'));
    useDrive.getState().update(cours.id, { tags: ['Partiels'], color: 'vert' });
    const it = useDrive.getState().items.find(i => i.id === cours.id)!;
    expect(it.tags).toEqual(['Partiels']);
    expect(it.updatedAt).toBe(cours.updatedAt);
  });

  it('purging a folder keeps the date of what was trashed earlier from it', () => {
    const { cours, maths } = tree();
    useDrive.getState().remove([maths.id]);
    vi.setSystemTime(new Date('2026-10-15T11:00:00'));
    useDrive.getState().remove([cours.id]);
    vi.setSystemTime(new Date('2026-10-15T12:00:00'));
    useDrive.getState().purge([cours.id]);
    const left = useDrive.getState().trash;
    expect(left.map(i => i.id)).toEqual([maths.id]);
    expect(left[0].parentId).toBeNull();
    expect(left[0].updatedAt).toBe(maths.updatedAt);
  });
});

describe('isPlainText', () => {
  it('shows CSV as text', () => {
    expect(isPlainText({ kind: 'file', name: 'budget.csv', mime: 'text/csv' })).toBe(true);
    expect(isPlainText({ kind: 'file', name: 'notes.txt' })).toBe(true);
    expect(isPlainText({ kind: 'file', name: 'tableau.xlsx' })).toBe(false);
    expect(isPlainText({ kind: 'folder', name: 'data.csv' })).toBe(false);
  });
});

describe('folderColorKey', () => {
  it('keeps the app’s colour keys', () => {
    for (const k of Object.keys(FOLDER_COLORS)) expect(folderColorKey(k)).toBe(k);
  });
  it('drops anything else (server rows, imported files)', () => {
    for (const v of [null, undefined, '', 'Bleu', '#3b6fd8', 'constructor', 'toString', 42]) expect(folderColorKey(v)).toBeUndefined();
  });
});

describe('keepExtension', () => {
  it('puts the old extension back when the new name has none', () => {
    expect(keepExtension('notes.txt', 'Notes cours')).toBe('Notes cours.txt');
    expect(keepExtension('notes.txt', '  Notes  ')).toBe('Notes.txt');
    expect(keepExtension('rapport.final.docx', 'Rapport')).toBe('Rapport.docx');
  });
  it('keeps a name that already has an extension, or a file that had none', () => {
    expect(keepExtension('notes.txt', 'notes.md')).toBe('notes.md');
    expect(keepExtension('README', 'Lisez-moi')).toBe('Lisez-moi');
    expect(keepExtension('.env', 'config')).toBe('config');
  });
  it('keeps the old extension when the new one is of another kind of file', () => {
    expect(keepExtension('Cours-reseaux.pdf', 'Cours-reseaux.docx')).toBe('Cours-reseaux.pdf');
    expect(keepExtension('photo.jpg', 'photo.pdf')).toBe('photo.jpg');
    expect(keepExtension('rapport.docx', 'Rapport final.DOC')).toBe('Rapport final.DOC');
  });
  it('a dot that is no extension keeps the old one after it', () => {
    expect(keepExtension('Cours.pdf', 'Cours v1.2')).toBe('Cours v1.2.pdf');
    expect(keepExtension('notes.txt', 'notes.v2')).toBe('notes.v2.txt');
  });
});
