import { describe, expect, it } from 'vitest';
import { entryKey, remember } from '../src/layout/scrollMemory';

describe('la page revient où elle était lue après « Retour »', () => {
  it('garde une position par zone qui défile, la dernière', () => {
    let list = remember([], { path: [0, 1], top: 120 });
    list = remember(list, { path: [0, 2], top: 40 });
    list = remember(list, { path: [0, 1], top: 300 });
    expect(list).toEqual([
      { path: [0, 2], top: 40 },
      { path: [0, 1], top: 300 },
    ]);
  });

  it('remontée tout en haut : plus rien à remettre', () => {
    const list = remember([{ path: [0], top: 500 }], { path: [0], top: 0 });
    expect(list).toEqual([]);
  });

  it('une autre page chargée dans le même onglet ne reprend pas la position de la première', () => {
    // Le routeur nomme « default » la page sur laquelle l’onglet s’ouvre, quelle qu’elle soit.
    expect(entryKey('default', '/profil?onglet=copilot')).not.toBe(entryKey('default', '/profil?onglet=notifications'));
    expect(entryKey('default', '/notes')).toBe(entryKey('default', '/notes')); // rechargée : elle revient où elle était
    expect(entryKey('k3x9a2', '/notes')).toBe('k3x9a2'); // les autres entrées de l’historique ont leur propre nom
  });
});
