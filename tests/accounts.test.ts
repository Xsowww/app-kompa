import { describe, expect, it } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { savedAccounts, rememberAccount, lockAccount, forgetAccount, needsCredentials, reloginHint, unkeptCopyKeys, STALE_DAYS } = await import('../src/lib/accounts');

const DAY = 24 * 3600 * 1000;
const session = { access_token: 'a', refresh_token: 'r' };
const now = Date.now();

describe('comptes de l’appareil', () => {
  it('le plus récent d’abord, un clic tant qu’il a servi récemment', () => {
    memory.clear();
    rememberAccount({ id: 'perso', email: 'lina@exemple.fr', name: 'Lina', session }, now - 1000);
    rememberAccount({ id: 'travail', email: 'lina@boite.fr', name: 'Lina', session }, now);
    expect(savedAccounts(now).map(a => a.id)).toEqual(['travail', 'perso']);
    expect(needsCredentials(savedAccounts(now)[0])).toBe(false);
  });

  it(`inutilisé plus de ${STALE_DAYS} jours : sa session est oubliée et le mot de passe redemandé`, () => {
    const later = now + STALE_DAYS * DAY + 1;
    const perso = savedAccounts(later).find(a => a.id === 'perso')!;
    expect(perso.session).toBeUndefined();
    expect(needsCredentials(perso)).toBe(true);
  });

  it('déconnecté : toujours proposé, mais avec le mot de passe ; une vraie connexion le rouvre', () => {
    lockAccount('travail');
    const t = savedAccounts().find(a => a.id === 'travail')!;
    expect(t.session).toBeUndefined();
    expect(needsCredentials(t)).toBe(true);
    rememberAccount({ id: 'travail', email: 'lina@boite.fr', name: 'Lina', session });
    expect(needsCredentials(savedAccounts().find(a => a.id === 'travail')!)).toBe(false);
  });

  it('retiré de l’appareil : disparaît de la liste', () => {
    forgetAccount('perso');
    expect(savedAccounts().map(a => a.id)).toEqual(['travail']);
  });

  it('compte Google ou Apple : le fournisseur est gardé, et c’est lui qui est redemandé (plus de mot de passe)', () => {
    rememberAccount({ id: 'g', email: 'lina@gmail.com', name: 'Lina', provider: 'google', session });
    lockAccount('g');
    rememberAccount({ id: 'g', email: 'lina@gmail.com', name: 'Lina', session: null }); // sans fournisseur donné : il reste
    const g = savedAccounts().find(a => a.id === 'g')!;
    expect(g.provider).toBe('google');
    expect(reloginHint(g)).toContain('Google');
    // Un mot de passe choisi depuis : la connexion suivante ne donne plus de fournisseur.
    rememberAccount({ id: 'g', email: 'lina@gmail.com', name: 'Lina', provider: undefined, session });
    expect(savedAccounts().find(a => a.id === 'g')!.provider).toBeUndefined();
  });
});

describe('« Rester connecté » décoché, navigateur fermé', () => {
  it('efface la copie des comptes qui ne sont plus ouverts, sauf les changements pas encore envoyés', () => {
    const keys = ['cop:a:notes', 'cop:a:sync-queue:x1', 'cop:a:sync-cursor', 'cop:b:notes', 'cop:accounts', 'cop:drive-view', 'cop-remember'];
    expect(unkeptCopyKeys(keys, new Set(['b']))).toEqual(['cop:a:notes', 'cop:a:sync-cursor']);
    expect(unkeptCopyKeys(keys, new Set(['a', 'b']))).toEqual([]);
  });
});
