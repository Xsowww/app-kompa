import { describe, expect, it } from 'vitest';

// The stores reach for the browser when they load: give them the globals they read.
const memory = new Map<string, string>();
const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) };
Object.assign(globalThis, { location: new URL('http://localhost/'), localStorage: storage, sessionStorage: storage });
const { textToHtml } = await import('../src/copilot/actions');

describe('textToHtml: plans with empty bullets and checkboxes (preparation notes, revision sheets)', () => {
  it('an empty « - » is an empty bullet, not the text « - »', () => {
    expect(textToHtml('# Objectif\n- ')).toBe('<h2>Objectif</h2><ul><li><p></p></li></ul>');
  });

  it('an empty « [ ] » is an empty checkbox, not the text « [ ] »', () => {
    expect(textToHtml('# À préparer\n[ ] \n[ ] ')).toBe(
      '<h2>À préparer</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li><li data-type="taskItem" data-checked="false"><p></p></li></ul>',
    );
  });

  it('filled lines still work, and « **bold** » is not a bullet', () => {
    expect(textToHtml('- un\n[x] fait\n**Gras** ici')).toBe(
      '<ul><li><p>un</p></li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>fait</p></li></ul><p><strong>Gras</strong> ici</p>',
    );
  });
});
