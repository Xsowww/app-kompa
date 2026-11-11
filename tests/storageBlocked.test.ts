import { describe, expect, it } from 'vitest';
import { memoryStorage, shimStorage } from '../src/lib/storageShim';

// A browser that refuses site data throws at the first touch of localStorage: the sign-in page stayed on the start-up
// screen. And a storage that is full must not break the session.
describe('mémoire du navigateur refusée', () => {
  it('une mémoire de remplacement prend sa place, seulement là où la vraie est refusée', () => {
    const real = memoryStorage();
    const win = {} as Window & typeof globalThis;
    Object.defineProperty(win, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    Object.defineProperty(win, 'sessionStorage', { configurable: true, value: real });
    expect(shimStorage(win)).toEqual(['localStorage']);
    expect(win.sessionStorage).toBe(real);
    win.localStorage.setItem('cop:session', 'u1');
    expect(win.localStorage.getItem('cop:session')).toBe('u1');
    expect(shimStorage(win)).toEqual([]); // already usable: left alone
  });

  it('elle se comporte comme la vraie (clés listées, longueur, suppression)', () => {
    const s = memoryStorage();
    expect(s.getItem('a')).toBeNull();
    s.setItem('cop:u1:notes', '{}');
    s.setItem('cop:accounts', '[]');
    expect(Object.keys(s)).toEqual(['cop:u1:notes', 'cop:accounts']);
    expect(s.length).toBe(2);
    expect(s.key(1)).toBe('cop:accounts');
    s.removeItem('cop:accounts');
    expect(Object.keys(s)).toEqual(['cop:u1:notes']);
    s.clear();
    expect(s.length).toBe(0);
  });

  it('la session reste utilisable dans l’onglet quand elle ne peut pas être écrite (mémoire pleine)', async () => {
    const full = { getItem: () => null, removeItem: () => undefined, setItem: () => {
      throw new DOMException('full', 'QuotaExceededError');
    } };
    Object.assign(globalThis, { location: new URL('http://localhost/'), history: { replaceState: () => undefined }, localStorage: full, sessionStorage: full });
    const { authStorage } = await import('../src/lib/supabase');
    expect(() => authStorage.setItem('sb-auth-token', '{"access_token":"a"}')).not.toThrow();
    expect(authStorage.getItem('sb-auth-token')).toBe('{"access_token":"a"}');
    authStorage.removeItem('sb-auth-token');
    expect(authStorage.getItem('sb-auth-token')).toBeNull();
  });
});
