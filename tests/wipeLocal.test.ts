import { beforeEach, describe, expect, it, vi } from 'vitest';

// Test n°3, majeur n°11: « Retirer de cet appareil » left cop:<uid>:notes, :calendar, :drive… readable in the
// localStorage, while the privacy policy promises to wipe them.
const memory = new Map<string, string>();
const tab = new Map<string, string>();
const storage = (m: Map<string, string>) =>
  new Proxy(
    { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) },
    { ownKeys: t => [...Reflect.ownKeys(t), ...m.keys()], getOwnPropertyDescriptor: (t, k) => (typeof k === 'string' && m.has(k) ? { enumerable: true, configurable: true, value: m.get(k) } : Reflect.getOwnPropertyDescriptor(t, k)) },
  );
Object.assign(globalThis, { location: new URL('https://kompaly.test/connexion'), localStorage: storage(memory), sessionStorage: storage(tab) });

vi.mock('../src/lib/supabase', async original => ({
  ...(await original<typeof import('../src/lib/supabase')>()),
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  revokeSession: async () => undefined,
}));
const { accountKeys, wipeAccountCopy } = await import('../src/lib/wipeLocal');
const { useAuth } = await import('../src/store/auth');
const { rememberAccount } = await import('../src/lib/accounts');

const seed = () => {
  for (const k of ['notes', 'calendar', 'drive', 'todos', 'sync-cursor', 'sync-queue:ab12']) memory.set(`cop:u2:${k}`, '{"secret":true}');
  memory.set('cop:u1:notes', '{"mine":true}');
  memory.set('cop:accounts', '[]');
  tab.set('cop:u2:brouillon', 'x');
};

beforeEach(() => {
  memory.clear();
  tab.clear();
});

describe('copie locale effacée', () => {
  it('accountKeys : seulement ce compte, sa file d’envoi gardée si demandé', () => {
    const keys = ['cop:u2:notes', 'cop:u2:sync-queue:x', 'cop:u22:notes', 'cop:u1:notes', 'cop:accounts'];
    expect(accountKeys(keys, 'u2')).toEqual(['cop:u2:notes', 'cop:u2:sync-queue:x']);
    expect(accountKeys(keys, 'u2', true)).toEqual(['cop:u2:notes']);
  });

  it('wipeAccountCopy efface localStorage et sessionStorage du compte, rien des autres', async () => {
    seed();
    await wipeAccountCopy('u2');
    expect([...memory.keys()].sort()).toEqual(['cop:accounts', 'cop:u1:notes']);
    expect(tab.size).toBe(0);
  });

  it('« Retirer de cet appareil » efface la copie du compte retiré (pas ses changements non envoyés)', async () => {
    seed();
    rememberAccount({ id: 'u2', email: 'b@exemple.fr', name: 'B' });
    useAuth.setState({ user: { id: 'u1', name: 'A', email: 'a@exemple.fr', createdAt: '2026-10-01T00:00:00Z' } });
    useAuth.getState().removeAccount('u2');
    await vi.waitFor(() => expect([...memory.keys()].filter(k => k.startsWith('cop:u2:'))).toEqual(['cop:u2:sync-queue:ab12']));
    expect(memory.get('cop:u1:notes')).toBe('{"mine":true}');
  });
});
