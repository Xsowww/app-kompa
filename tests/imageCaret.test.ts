import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { caretAfterImage } from '../src/pages/notes/imageCaret';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
    image: { group: 'block', attrs: { src: {} }, toDOM: n => ['img', { src: n.attrs.src as string }] },
    text: {},
  },
});
const p = (text = '') => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
const img = (src = 'data:image/png;base64,AAAA') => schema.nodes.image.create({ src });
const doc = (...blocks: ReturnType<typeof p>[]) => schema.nodes.doc.create(null, blocks);
const shape = (d: ReturnType<typeof doc>) => {
  const out: string[] = [];
  d.forEach(n => out.push(n.type.name === 'image' ? 'img' : `p:${n.textContent}`));
  return out;
};

/** What the editor does when a picture is added at the caret (NoteEditor › insertImages), then a letter is typed. */
function addThenType(state: EditorState) {
  let next = state.apply(caretAfterImage(state.tr.replaceSelectionWith(img())));
  expect(next.selection instanceof NodeSelection, 'l’image ne reste pas sélectionnée').toBe(false);
  next = next.apply(next.tr.insertText('a'));
  return shape(next.doc);
}

describe('une image ajoutée à une note', () => {
  it('sur une ligne vide en fin de note : la frappe suivante ne la remplace pas', () => {
    const d = doc(p('Cours'), p());
    const state = EditorState.create({ doc: d, selection: TextSelection.create(d, d.content.size - 1) });
    // Sans la correction : ['p:Cours', 'p:a'] (l’image, restée sélectionnée, partait avec la première lettre).
    expect(addThenType(state)).toEqual(['p:Cours', 'img', 'p:a']);
  });

  it('dans une note vide', () => {
    const d = doc(p());
    expect(addThenType(EditorState.create({ doc: d, selection: TextSelection.create(d, 1) }))).toEqual(['img', 'p:a']);
  });

  it('suivie de texte : le curseur va au début de ce texte', () => {
    const d = doc(p(), p('suite'));
    expect(addThenType(EditorState.create({ doc: d, selection: TextSelection.create(d, 1) }))).toEqual(['img', 'p:asuite']);
  });

  it('une image déjà sélectionnée : la nouvelle va après, les deux restent', () => {
    const d = doc(p('Cours'), img('data:image/png;base64,UN'), p('fin'));
    const state = EditorState.create({ doc: d, selection: NodeSelection.create(d, 7) });
    let next = state.apply(caretAfterImage(state.tr.insert(state.selection.to, img('data:image/png;base64,DEUX'))));
    next = next.apply(next.tr.insertText('a'));
    expect(shape(next.doc)).toEqual(['p:Cours', 'img', 'img', 'p:afin']);
  });

  it('sans image sélectionnée, rien ne bouge', () => {
    const d = doc(p('Cours'));
    const state = EditorState.create({ doc: d, selection: TextSelection.create(d, 3) });
    const tr = caretAfterImage(state.tr);
    expect(tr.docChanged).toBe(false);
    expect(tr.selection.from).toBe(3);
  });
});
