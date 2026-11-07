import { describe, expect, it } from 'vitest';
import { caretShift } from '../src/lib/keyboard';

// The keyboard leaves 0–400 px visible.
const view = { top: 0, bottom: 400 };

describe('le clavier qui s’ouvre ne perd pas l’endroit où l’on écrit', () => {
  it('ne bouge rien quand le curseur reste visible', () => {
    expect(caretShift({ top: 300, bottom: 324 }, view)).toBe(0);
  });

  it('remonte juste assez pour que la ligne passe au-dessus du clavier (pas au milieu)', () => {
    // Line tapped at 600 px, now under the keyboard: it goes to just above it (400 - 12), not to the middle.
    expect(caretShift({ top: 600, bottom: 624 }, view)).toBe(624 - 388);
  });

  it('une ligne cachée en haut redescend juste sous le bord', () => {
    expect(caretShift({ top: -50, bottom: -26 }, view)).toBe(-62);
  });

  it('une note longue : seul le curseur compte, jamais toute la note (elle sautait à son milieu)', () => {
    // Before, the whole editor (3000 px tall) was centred: a move of ~1300 px. The caret's line only: nothing to do.
    expect(caretShift({ top: 200, bottom: 224 }, view)).toBe(0);
  });

  it('une boîte plus haute que ce qui reste visible : son haut en haut', () => {
    expect(caretShift({ top: 500, bottom: 1100 }, view)).toBe(488);
  });
});
