import { describe, expect, it } from 'vitest';
import { remember } from '../src/layout/scrollMemory';

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
});
