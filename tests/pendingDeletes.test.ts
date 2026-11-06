import { beforeEach, describe, expect, it, vi } from 'vitest';

// Test n°3, majeur n°10: deleting in a shared calendar, then reloading during « Supprimé · Annuler » (6 s): the
// deletion was never sent, the event came back. Now it is written on the device at once, sent on leaving the page
// (keepalive) and at the next start; « Annuler » forgets it.
const memory = new Map<string, string>();
const store = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => memory.set(k, v),
  removeItem: (k: string) => memory.delete(k),
};
const listeners: Record<string, (() => void)[]> = {};
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: store,
  sessionStorage: store,
  addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
  window: globalThis,
  document: { visibilityState: 'visible', addEventListener: () => undefined },
});
vi.stubEnv('VITE_SUPABASE_URL', 'https://base.example');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');

const deleted: { table: string; ids: string[] }[] = [];
const removedPaths: string[][] = [];
const fake = {
  from: (table: string) => ({ delete: () => ({ in: async (_c: string, ids: string[]) => (deleted.push({ table, ids }), { error: null }) }) }),
  storage: { from: () => ({ remove: async (p: string[]) => (removedPaths.push(p), { error: null }) }) },
};
vi.mock('../src/lib/supabase', () => ({ supabase: fake, cloudEnabled: true, authStorageKey: 'sb-base-auth-token' }));
const fetches: { url: string; init: RequestInit }[] = [];
globalThis.fetch = (async (url: string, init: RequestInit) => (fetches.push({ url, init }), new Response(null, { status: 204 }))) as typeof fetch;

const { setStorageUser } = await import('../src/lib/userStorage');
const { rememberDelete, forgetDelete, sendOnLeave, sendLeftDeletes } = await import('../src/lib/pendingDeletes');
const { removeWithUndo } = await import('../src/pages/groups/pending');
const { useUi } = await import('../src/store/ui');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const waiting = () => JSON.parse(memory.get('cop:u1:deletes-waiting') ?? '[]') as { key: string; ids: string[] }[];

beforeEach(() => {
  memory.clear();
  deleted.length = 0;
  removedPaths.length = 0;
  fetches.length = 0;
  memory.set('sb-base-auth-token', JSON.stringify({ access_token: 'jeton' }));
  setStorageUser('u1');
  useUi.setState({ toasts: [] });
});

describe('suppressions partagées en attente de « Annuler »', () => {
  it('écrites tout de suite sur l’appareil, envoyées au départ de la page (keepalive)', () => {
    const key = rememberDelete({ table: 'group_events', ids: [A, B] });
    expect(waiting().map(x => x.ids)).toEqual([[A, B]]);
    sendOnLeave([key]);
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe(`https://base.example/rest/v1/group_events?id=in.(${A},${B})`);
    expect(fetches[0].init).toMatchObject({ method: 'DELETE', keepalive: true, headers: { apikey: 'anon', Authorization: 'Bearer jeton' } });
  });

  it('la page rechargée avant l’envoi : la suppression part au démarrage suivant (fichier compris)', async () => {
    rememberDelete({ table: 'group_files', ids: [A], paths: [`g1/${A}`] });
    await sendLeftDeletes('u1');
    expect(deleted).toEqual([{ table: 'group_files', ids: [A] }]);
    expect(removedPaths).toEqual([[`g1/${A}`]]);
    expect(waiting()).toEqual([]);
  });

  it('« Annuler » l’oublie : rien n’est envoyé, ni maintenant ni au démarrage suivant', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    removeWithUndo([A], 'Note supprimée', send, { table: 'group_notes', ids: [A] });
    expect(waiting()).toHaveLength(1);
    useUi.getState().toasts.at(-1)!.action!.run();
    expect(waiting()).toEqual([]);
    vi.advanceTimersByTime(10_000);
    expect(send).not.toHaveBeenCalled();
    listeners.pagehide?.forEach(f => f());
    expect(fetches).toHaveLength(0);
    await sendLeftDeletes('u1');
    expect(deleted).toEqual([]);
    vi.useRealTimers();
  });

  it('sans « Annuler » : envoyée à la fin du message, puis oubliée', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    removeWithUndo([B], 'Note supprimée', send, { table: 'group_notes', ids: [B] });
    vi.advanceTimersByTime(6500);
    vi.useRealTimers();
    await vi.waitFor(() => expect(waiting()).toEqual([]));
    expect(send).toHaveBeenCalledTimes(1);
    forgetDelete('inconnue'); // nothing to forget: no error
  });
});
