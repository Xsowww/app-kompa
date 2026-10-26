import { describe, expect, it } from 'vitest';
import { zipPaths } from '../src/lib/zipPaths';

const f = (id: string, name: string, parentId: string | null, kind: 'file' | 'folder' = 'file') => ({ id, name, parentId, kind });

describe('zip du Drive', () => {
  it('keeps folders, renames twins, ignores what was not chosen', () => {
    const items = [f('a', 'Cours', null, 'folder'), f('b', 'td.pdf', 'a'), f('c', 'TD.pdf', 'a'), f('d', 'Sous', 'a', 'folder'), f('e', 'x/y.txt', 'd'), f('z', 'autre.pdf', null)];
    expect(zipPaths(items, ['a']).map(e => e.path)).toEqual(['Cours', 'Cours/td.pdf', 'Cours/TD (2).pdf', 'Cours/Sous', 'Cours/Sous/x-y.txt']);
  });
  it('gives names every system can open', () => {
    const items = [f('a', '..', null, 'folder'), f('b', 'a:b?.txt', 'a'), f('c', 'notes. ', 'a'), f('d', '.', null), f('e', 'x<y>|"*.md', null)];
    expect(zipPaths(items, ['a', 'd', 'e']).map(e => e.path)).toEqual(['Sans titre', 'Sans titre/a-b-.txt', 'Sans titre/notes', 'Sans titre (2)', 'x-y----.md']);
  });
});
