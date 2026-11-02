import { TaskItem } from '@tiptap/extension-list';

/**
 * Tiptap's checkbox focuses the editor when ticked: on a phone the keyboard opens and the page jumps.
 * Here a tick only changes the box (the change is caught before Tiptap's own handler), the editor keeps its focus as it was.
 */
export const QuietTaskItem = TaskItem.extend({
  addNodeView() {
    const make = this.parent?.();
    const editor = this.editor;
    if (!make) return null;
    return props => {
      const view = make(props);
      const dom = view.dom as HTMLElement;
      const box = dom.querySelector<HTMLInputElement>('input[type="checkbox"]');
      // A tap on the label's wider area (fingers) must not put the cursor in the text either.
      dom.querySelector('label')?.addEventListener('mousedown', e => e.preventDefault());
      dom.addEventListener(
        'change',
        e => {
          if (!box || e.target !== box || !editor.isEditable || typeof props.getPos !== 'function') return;
          e.stopPropagation();
          const pos = props.getPos();
          if (typeof pos !== 'number') return;
          const node = editor.state.doc.nodeAt(pos);
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node?.attrs, checked: box.checked }));
        },
        true,
      );
      return view;
    };
  },
});
