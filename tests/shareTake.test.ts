import { afterEach, describe, expect, it } from 'vitest';
import { takeShared } from '../src/lib/shareTarget';

const g = globalThis as { caches?: unknown };
const before = g.caches;
afterEach(() => {
  g.caches = before;
});

describe('ce qu’une autre appli partage à Kompaly', () => {
  it('la réserve du navigateur refusée (navigation privée) : le texte de l’adresse arrive quand même', async () => {
    g.caches = { has: () => Promise.reject(new Error('SecurityError')) };
    const got = await takeShared(new URLSearchParams('title=Article&text=bonjour&url=https://exemple.fr'));
    expect(got).toEqual({ text: { title: 'Article', text: 'bonjour', url: 'https://exemple.fr' }, files: [] });
  });

  it('un nom de fichier avec un « % » ne bloque pas le partage', async () => {
    const res = new Response(new Blob(['x'], { type: 'text/plain' }), { headers: { 'X-Name': '100% réussi.txt' } });
    let deleted = false;
    g.caches = {
      has: () => Promise.resolve(true),
      open: () => Promise.resolve({ keys: () => Promise.resolve([{ url: 'http://localhost/__kompaly/partage/fichier-0' }]), match: () => Promise.resolve(res) }),
      delete: () => Promise.resolve((deleted = true)),
    };
    const got = await takeShared(new URLSearchParams(''));
    expect(got.files.map(f => f.name)).toEqual(['100% réussi.txt']);
    expect(deleted).toBe(true);
  });
});
