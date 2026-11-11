import { beforeEach, describe, expect, it, vi } from 'vitest';

// « Tout effacer » and the account's deletion remove the files stored online. A list or a removal that failed (network)
// was ignored: the app said « Données effacées », or deleted the account, with files left online for good.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
  document: { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, removeAttribute() {} }, querySelector: () => null },
});

let files: Record<string, string[]> = {};
let fail: 'list' | 'remove' | null = null;
const removed: string[] = [];
const bucket = {
  list: async (dir: string) => (fail === 'list' ? { data: null, error: { message: 'Failed to fetch' } } : { data: (files[dir] ?? []).map(name => ({ id: name, name })), error: null }),
  remove: async (paths: string[]) => {
    if (fail === 'remove') return { error: { message: 'Failed to fetch' } };
    removed.push(...paths);
    for (const p of paths) {
      const dir = p.slice(0, p.lastIndexOf('/'));
      files[dir] = (files[dir] ?? []).filter(n => `${dir}/${n}` !== p);
    }
    return { error: null };
  },
};
const fake = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  storage: { from: () => bucket },
  from: () => ({ delete: () => ({ eq: async () => ({ error: null }), in: async () => ({ error: null }) }), upsert: async () => ({ error: null }) }),
  rpc: async () => ({ error: null }),
};
vi.mock('../src/lib/supabase', () => ({ supabase: fake, cloudEnabled: true, authStorageKey: 'sb-test-auth-token' }));
vi.mock('../src/lib/groups', () => ({ purgeSoleGroups: async () => undefined }));
const { blobStore } = await import('../src/lib/blobStore');
const { wipeUserData, clearBeforeAccountDeletion } = await import('../src/lib/backup');
const { setStorageUser } = await import('../src/lib/userStorage');
const { useNotes } = await import('../src/store/notes');

beforeEach(() => {
  files = { u1: ['a', 'b'], 'u1/trash': ['c'] };
  fail = null;
  removed.length = 0;
  setStorageUser('u1');
});

describe('fichiers en ligne effacés avec les données', () => {
  it('tout part, corbeille comprise', async () => {
    expect(await blobStore.removeFolder('u1')).toBe(true);
    expect(removed.sort()).toEqual(['u1/a', 'u1/b', 'u1/trash/c']);
  });

  it('la liste ou le retrait échoue : dit (faux), jamais « effacé »', async () => {
    fail = 'list';
    expect(await blobStore.removeFolder('u1')).toBe(false);
    fail = 'remove';
    expect(await blobStore.removeFolder('u1')).toBe(false);
  });

  it('« Tout effacer » : une erreur claire tant que des fichiers restent, puis ça passe au nouvel essai', async () => {
    useNotes.getState().createNote({ title: 'N', content: '' });
    fail = 'remove';
    await expect(wipeUserData()).rejects.toThrow('L’effacement n’a pas pu se faire');
    expect(useNotes.getState().notes).toEqual([]); // the lists are gone online: not shown here any more
    fail = null;
    await wipeUserData();
    expect(files).toEqual({ u1: [], 'u1/trash': [] });
  });

  it('suppression du compte : elle attend que les fichiers soient partis', async () => {
    fail = 'list';
    await expect(clearBeforeAccountDeletion()).rejects.toThrow('La suppression a échoué');
    fail = null;
    await clearBeforeAccountDeletion();
    expect(files.u1).toEqual([]);
  });
});
