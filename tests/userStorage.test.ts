import { describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
let writes = 0;
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => (writes++, memory.set(k, v)), removeItem: (k: string) => memory.delete(k) },
});
vi.useFakeTimers();
const { userStorage, setStorageUser, flushStorage, dropPendingStorage } = await import('../src/lib/userStorage');

const v = (n: number) => ({ state: { n }, version: 0 });

describe('sauvegarde sur l’appareil', () => {
  it('regroupe les écritures et relit la dernière valeur avant qu’elle soit écrite', async () => {
    setStorageUser('a');
    for (let i = 1; i <= 50; i++) await userStorage.setItem('notes', v(i));
    expect(writes).toBe(0);
    expect(await userStorage.getItem('notes')).toEqual(v(50));
    vi.advanceTimersByTime(500);
    expect(writes).toBe(1);
    expect(JSON.parse(memory.get('cop:a:notes')!)).toEqual(v(50));
  });
  it('écrit tout de suite en changeant de compte, sous les clés de l’ancien', async () => {
    setStorageUser('a');
    await userStorage.setItem('todos', v(7));
    setStorageUser('b');
    expect(JSON.parse(memory.get('cop:a:todos')!)).toEqual(v(7));
    expect(memory.has('cop:b:todos')).toBe(false);
  });
  it('n’écrit plus rien d’un compte effacé de l’appareil', async () => {
    setStorageUser('c');
    await userStorage.setItem('notes', v(1));
    dropPendingStorage('c');
    flushStorage();
    expect(memory.has('cop:c:notes')).toBe(false);
  });
  it('écrit le Drive tout de suite (un autre onglet ne l’écrase pas avec une liste plus ancienne)', async () => {
    setStorageUser('d');
    await userStorage.setItem('drive', v(3));
    expect(JSON.parse(memory.get('cop:d:drive')!)).toEqual(v(3));
  });
});
