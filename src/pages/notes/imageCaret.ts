import { NodeSelection, Selection, TextSelection, type Transaction } from '@tiptap/pm/state';

/**
 * After a picture is added: the caret in the text right after it, never the picture left selected. Selected, the very
 * next key typed (or the next paste) replaced it: the picture just added vanished with the first letter.
 * No text after it (the picture ends the note): an empty line is added for the caret.
 */
export function caretAfterImage(tr: Transaction): Transaction {
  const sel = tr.selection;
  if (!(sel instanceof NodeSelection)) return tr;
  const after = sel.to;
  const next = after < tr.doc.content.size ? Selection.findFrom(tr.doc.resolve(after), 1, true) : null;
  if (next) return tr.setSelection(next);
  const paragraph = tr.doc.type.schema.nodes.paragraph;
  // A picture inside a block (a list item…): the line goes after that block, at the top level.
  const end = tr.doc.resolve(after).depth ? tr.doc.content.size : after;
  if (!paragraph) return tr;
  tr.insert(end, paragraph.create());
  return tr.setSelection(TextSelection.create(tr.doc, end + 1));
}
