import { beforeEach, describe, expect, it } from 'vitest';
import { isLegalPath, legalBack, legalFrom, rememberLegalFrom } from '../src/pages/legal/back';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage;
});

describe('« Retour » des pages légales', () => {
  it('reconnaît les pages légales', () => {
    expect(isLegalPath('/tarifs')).toBe(true);
    expect(isLegalPath('/a-propos/')).toBe(true);
    expect(isLegalPath('/notes')).toBe(false);
  });

  it('revient d’un coup à la page de l’appli, quel que soit le nombre de pages légales lues', () => {
    rememberLegalFrom('/notes', '?note=1', 3);
    // Pages légales lues ensuite : elles ne remplacent pas la page retenue.
    rememberLegalFrom('/mentions-legales', '', 4);
    rememberLegalFrom('/confidentialite', '', 5);
    rememberLegalFrom('/tarifs', '', 6);
    expect(legalFrom()).toEqual({ path: '/notes?note=1', idx: 3 });
    expect(legalBack(legalFrom(), 6)).toEqual({ delta: -3 });
    expect(legalBack(legalFrom(), 4)).toEqual({ delta: -1 });
  });

  it('ouverte directement : la page d’accueil (celle de l’appli, ou la publique déconnecté)', () => {
    expect(legalBack(null, 0)).toEqual({ to: '/' });
    expect(legalBack(null, undefined)).toEqual({ to: '/' });
  });

  it('ouverte directement après une autre visite (lien de l’extérieur) : la page d’accueil, pas une page d’avant', () => {
    rememberLegalFrom('/inscription', '', 2);
    expect(legalBack(legalFrom(), 0)).toEqual({ to: '/' });
  });
});

it('connaît toutes les pages légales du pied de page', async () => {
  const { LEGAL_LINKS } = await import('../src/pages/legal/links');
  for (const l of LEGAL_LINKS) expect(isLegalPath(l.to)).toBe(true);
});
