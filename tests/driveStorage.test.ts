import { describe, expect, it } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { driveUsed } = await import('../src/store/drive');
const { formatBytes } = await import('../src/lib/utils');
const { SPACE, MAX_FILE, QUOTA } = await import('../src/lib/blobStore');
const { dropTargetAt, edgeSpeed } = await import('../src/pages/drive/touchGestures');

const file = (size: number, extra = {}) => ({ id: String(Math.random()), name: 'f', kind: 'file' as const, parentId: null, size, createdAt: '', updatedAt: '', ...extra });

describe('Drive storage display (decimal units, as the owner reads them)', () => {
  it('25 Mo used out of the 500 Mo of an account leaves 475 Mo', () => {
    const used = 25 * 1000 * 1000;
    expect(QUOTA).toBe(500 * 1000 * 1000);
    expect(formatBytes(SPACE)).toBe('500 Mo');
    expect(formatBytes(used)).toBe('25 Mo');
    expect(formatBytes(SPACE - used)).toBe('475 Mo');
  });

  it('one unit system everywhere: 1000, never 1024', () => {
    expect(formatBytes(999)).toBe('999 o');
    expect(formatBytes(1000)).toBe('1 Ko');
    expect(formatBytes(1500)).toBe('1,5 Ko');
    expect(formatBytes(3 * 1000 * 1000)).toBe('3 Mo');
    // 999,99 Mo is « 1 Go », not « 1000 Mo ».
    expect(formatBytes(999_990_000)).toBe('1 Go');
    expect(formatBytes(MAX_FILE)).toBe('50 Mo');
  });

  it('counts the files and the trash, not the folders', () => {
    const items = [file(10_000_000), file(5_000_000), { ...file(0), kind: 'folder' as const, size: undefined }, file(-3)]; // a broken size counts for nothing
    const trash = [file(2_000_000, { deletedAt: '2026-11-01' })];
    expect(driveUsed(items, trash)).toBe(17_000_000);
    expect(driveUsed([], trash)).toBe(2_000_000);
    expect(driveUsed([], [])).toBe(0);
  });
});

describe('Drive touch drag', () => {
  it('scrolls near the edges of the list only, faster closer to them', () => {
    expect(edgeSpeed(400, 100, 700)).toBe(0);
    expect(edgeSpeed(110, 100, 700)).toBeLessThan(0);
    expect(edgeSpeed(690, 100, 700)).toBeGreaterThan(0);
    expect(edgeSpeed(699, 100, 700)).toBeGreaterThan(edgeSpeed(660, 100, 700));
    // Above the list (the breadcrumb, a drop target): no scroll.
    expect(edgeSpeed(80, 100, 700)).toBe(0);
  });

  it('a folder dragged over itself is no drop target; the root is one', () => {
    const at = (el: object | null) => Object.assign(globalThis, { document: { elementFromPoint: () => el && { closest: () => el } } });
    at({ dataset: { dropKey: 'f1', dropTarget: 'f1' } });
    expect(dropTargetAt(0, 0, ['f1'])).toBeNull();
    expect(dropTargetAt(0, 0, ['f2'])).toEqual({ key: 'f1', target: 'f1' });
    at({ dataset: { dropKey: 'crumb-root', dropTarget: '' } });
    expect(dropTargetAt(0, 0, ['f2'])).toEqual({ key: 'crumb-root', target: null });
    at(null);
    expect(dropTargetAt(0, 0, ['f2'])).toBeNull();
  });
});
