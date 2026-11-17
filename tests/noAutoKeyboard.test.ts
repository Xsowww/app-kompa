// Téléphone : le clavier ne s'ouvre que si la personne touche un endroit pour écrire.
import { describe, expect, it } from 'vitest';
import { mayFocus } from '../src/lib/keyboard';

// Just what mayFocus reads of an element: its parents (closest) and what it holds (contains).
interface Fake { name: string; parent?: Fake; tag?: string; opens?: boolean; contains(o: Fake): boolean; closest(sel: string): Fake | null }
const node = (name: string, parent?: Fake, extra: Partial<Fake> = {}): Fake => {
  const n: Fake = {
    name,
    parent,
    ...extra,
    contains(o) {
      for (let x: Fake | undefined = o; x; x = x.parent) if (x === n) return true;
      return false;
    },
    closest(sel) {
      for (let x: Fake | undefined = n; x; x = x.parent) if ((sel === 'label' && x.tag === 'label') || (sel === '[data-opens-typing]' && x.opens)) return x;
      return null;
    },
  };
  return n;
};
const may = (field: Fake, touched: Fake | null, ago: number) => mayFocus(field as unknown as Element, touched as unknown as Element, ago);

describe('curseur posé tout seul', () => {
  const page = node('page');
  it('à l’ouverture d’une fenêtre (toucher sur « Nouvelle tâche ») : non', () => {
    expect(may(node('titre', page), node('bouton', page), 100)).toBe(false);
  });
  it('sans aucun toucher (au démarrage) : non', () => {
    expect(may(node('titre', page), null, 0)).toBe(false);
  });
  it('le champ touché lui-même, ou son étiquette : oui', () => {
    const label = node('label', page, { tag: 'label' });
    const field = node('titre', label);
    expect(may(field, field, 50)).toBe(true);
    expect(may(field, label, 50)).toBe(true);
  });
  it('la loupe de recherche (data-opens-typing) : oui, mais pas longtemps après', () => {
    const loupe = node('loupe', page, { opens: true });
    const icon = node('icône', loupe);
    expect(may(node('recherche', page), icon, 300)).toBe(true);
    expect(may(node('recherche', page), loupe, 5000)).toBe(false);
  });
});
