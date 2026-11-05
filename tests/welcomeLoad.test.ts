import { beforeEach, describe, expect, it, vi } from 'vitest';

// The account's load (store/session › loadUserData) in cloud mode, with the download faked: does a sign-in on a new
// device know that the questionnaire is still to answer (the blank page after sign-in), and say so in time?
const memory = new Map<string, string>();
const store = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) });
const root = { dataset: {}, style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } };
Object.assign(globalThis, { location: new URL('http://localhost/'), localStorage: store(memory), sessionStorage: store(new Map()), document: { documentElement: root, querySelector: () => null } });

const cloud = vi.hoisted(() => ({ local: false, profile: { name: 'Lina', onboarded: false } as { name: string; onboarded: boolean } | Error, settings: {} as Record<string, unknown> }));
vi.mock('../src/lib/supabase', async orig => ({ ...(await orig<typeof import('../src/lib/supabase')>()), cloudEnabled: true }));
vi.mock('../src/lib/cloudSync', async orig => {
  const real = await orig<typeof import('../src/lib/cloudSync')>();
  const { useSettings } = await import('../src/store/settings');
  return {
    ...real,
    hasLocalCopy: () => cloud.local,
    pushLeftovers: async () => undefined,
    startSync: () => undefined,
    stopSync: () => undefined,
    updateCloudProfile: async () => undefined,
    pullAll: async () => {
      await new Promise(r => setTimeout(r, 5));
      if (cloud.profile instanceof Error) throw cloud.profile;
      useSettings.setState(cloud.settings);
      return cloud.profile;
    },
  };
});

const { loadUserData, useWelcome } = await import('../src/store/session');
const { setStorageUser } = await import('../src/lib/userStorage');
const { useSettings } = await import('../src/store/settings');

beforeEach(() => {
  memory.clear();
  cloud.local = false;
  cloud.profile = { name: 'Lina', onboarded: false };
  cloud.settings = {};
  setStorageUser('u1');
  useSettings.getState().reset();
});

describe('loading an account that has not finished the questionnaire', () => {
  it('new device: the questionnaire, known before the load ends (and « checking » meanwhile)', async () => {
    const seen: boolean[] = [];
    const off = useWelcome.subscribe(s => seen.push(s.checking));
    await loadUserData();
    off();
    expect(seen[0]).toBe(true);
    expect(useWelcome.getState()).toEqual({ pending: true, unsure: false, checking: false });
  });

  it('done on another device (settings synced) even if the profile flag never left it', async () => {
    cloud.settings = { welcomeDone: true };
    await loadUserData();
    expect(useWelcome.getState().pending).toBe(false);
  });

  it('a regular of this device left it half-way: the questionnaire at once, before the download', async () => {
    cloud.local = true;
    useSettings.getState().set({ welcomeDraft: { step: 2, answers: {} } });
    await loadUserData(); // its copy on this device, saved by the line above
    expect(useWelcome.getState().pending).toBe(true);
  });

  it('new device offline: not known, the app opens with « Termine ton profil »', async () => {
    cloud.profile = new Error('offline');
    await loadUserData();
    expect(useWelcome.getState()).toEqual({ pending: false, unsure: true, checking: false });
  });

  it('an account done long ago: nothing asked', async () => {
    cloud.profile = { name: 'Lina', onboarded: true };
    await loadUserData();
    expect(useWelcome.getState()).toEqual({ pending: false, unsure: false, checking: false });
  });
});
