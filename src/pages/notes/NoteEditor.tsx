import { useCallback, useEffect, useRef } from 'react';
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import TiptapImage from '@tiptap/extension-image';
import type { EditorView } from '@tiptap/pm/view';
import { NodeSelection } from '@tiptap/pm/state';
import {
  Bold, Italic, Underline, Strikethrough, Highlighter, Heading1, Heading2, List, ListOrdered, ListChecks, Quote, Code2, Link2, Link2Off, ExternalLink, Minus, Undo2, Redo2, ImagePlus,
} from 'lucide-react';
import { useNotes, type Note } from '../../store/notes';
import { askText, toast } from '../../store/ui';
import { cx } from '../../lib/utils';
import { compressImage, imageFiles } from './images';
import { registerEditorFlush, withProtocol } from './noteUtils';
import { localSavesFailing } from '../../lib/userStorage';
import './notes.css';
import { t } from '../../i18n';

/** Compresses then inserts images at `pos` (drop) or at the selection (paste, toolbar). */
async function insertImages(view: EditorView, files: File[], pos?: number) {
  for (const file of files) {
    // Browser storage full (local mode): the image would show but be gone at the next visit.
    if (localSavesFailing()) return toast(t('Mémoire du navigateur pleine : image non ajoutée. Retire des images de tes notes ou exporte une sauvegarde.'), 'error');
    try {
      const src = await compressImage(file);
      if (view.isDestroyed) return;
      const { state } = view;
      const node = state.schema.nodes.image.create({ src });
      // A selected image is kept: the new one goes right after it.
      const at = pos ?? (state.selection instanceof NodeSelection ? state.selection.to : null);
      const tr = at == null ? state.tr.replaceSelectionWith(node) : state.tr.insert(Math.min(at, state.doc.content.size), node);
      view.dispatch(tr.scrollIntoView());
    } catch (e) {
      toast(e instanceof Error ? e.message : t('Impossible d’ajouter l’image'), 'error');
    }
  }
}

const openLink = (href: string) => window.open(href, '_blank', 'noopener,noreferrer');

function Toolbar({ editor }: { editor: Editor }) {
  // The toolbar isn't re-rendered at each keystroke: the link state is followed on its own.
  const link = useEditorState({ editor, selector: ({ editor: ed }) => (ed.isActive('link') ? ((ed.getAttributes('link').href as string | undefined) ?? '') : null) });
  const btnClass = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors pointer-coarse:h-9 pointer-coarse:w-9';
  const btn = (label: string, Icon: typeof Bold, active: boolean, run: () => void) => (
    <button
      key={label}
      type="button"
      title={label} aria-label={label}
      onMouseDown={e => e.preventDefault()}
      onClick={run}
      className={cx(btnClass, active ? 'bg-stone-200/70 text-ink' : 'text-stone-500 hover:bg-stone-100 hover:text-ink')}
    >
      <Icon size={15} />
    </button>
  );
  const c = () => editor.chain().focus();
  // Groups wrap as a whole; the separator is drawn before each group and hidden at the start of a line
  // (the row is shifted left under a clipping box), so no line starts with a lone separator.
  const group = (k: string, children: React.ReactNode) => (
    <div key={k} className="relative flex shrink-0 items-center gap-0.5 pl-[9px] before:absolute before:left-1 before:top-1/2 before:h-4 before:w-px before:-translate-y-1/2 before:bg-stone-200">
      {children}
    </div>
  );
  const editLink = async () => {
    const url = await askText(link !== null ? t('Modifier le lien') : t('Adresse du lien'), link ?? '', link !== null ? t('Modifier') : t('Ajouter'), { url: true });
    if (url === null || !url.trim()) return void c().run();
    c().extendMarkRange('link').setLink({ href: withProtocol(url) }).run();
  };

  return (
    <div className="-mx-1 -my-1 overflow-hidden px-1 py-1 pointer-coarse:overflow-x-auto">
      <div className="-ml-[9px] flex flex-wrap items-center gap-y-0.5 pointer-coarse:flex-nowrap">
        {group('g1', <>
          {btn(t('Titre 1'), Heading1, editor.isActive('heading', { level: 1 }), () => c().toggleHeading({ level: 1 }).run())}
          {btn(t('Titre 2'), Heading2, editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run())}
        </>)}
        {group('g2', <>
          {btn(t('Gras (Ctrl + B)'), Bold, editor.isActive('bold'), () => c().toggleBold().run())}
          {btn(t('Italique (Ctrl + I)'), Italic, editor.isActive('italic'), () => c().toggleItalic().run())}
          {btn(t('Souligné (Ctrl + U)'), Underline, editor.isActive('underline'), () => c().toggleUnderline().run())}
          {btn(t('Barré'), Strikethrough, editor.isActive('strike'), () => c().toggleStrike().run())}
          {btn(t('Surligner'), Highlighter, editor.isActive('highlight'), () => c().toggleHighlight().run())}
        </>)}
        {group('g3', <>
          {btn(t('Liste à puces'), List, editor.isActive('bulletList'), () => c().toggleBulletList().run())}
          {btn(t('Liste numérotée'), ListOrdered, editor.isActive('orderedList'), () => c().toggleOrderedList().run())}
          {btn(t('Cases à cocher'), ListChecks, editor.isActive('taskList'), () => c().toggleTaskList().run())}
        </>)}
        {group('g4', <>
          {btn(t('Citation'), Quote, editor.isActive('blockquote'), () => c().toggleBlockquote().run())}
          {btn(t('Bloc de code'), Code2, editor.isActive('codeBlock'), () => c().toggleCodeBlock().run())}
          {btn(link !== null ? t('Modifier le lien') : t('Lien'), Link2, link !== null, () => void editLink())}
          {link !== null && btn(t('Ouvrir le lien (ou Ctrl + clic)'), ExternalLink, false, () => openLink(withProtocol(link)))}
          {link !== null && btn(t('Retirer le lien'), Link2Off, false, () => c().extendMarkRange('link').unsetLink().run())}
          {btn(t('Séparateur'), Minus, false, () => c().setHorizontalRule().run())}
          <label
        key="image"
        title={t('Image (ou colle-la dans la note)')}
        onMouseDown={e => e.preventDefault()}
        className={cx(btnClass, 'cursor-pointer text-stone-500 hover:bg-stone-100 hover:text-ink')}
      >
        <ImagePlus size={15} />
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={e => {
            const files = imageFiles(e.target.files);
            e.target.value = '';
            if (files.length) void insertImages(editor.view, files);
          }}
        />
      </label>
        </>)}
        {group('g5', <>
          {btn(t('Annuler (Ctrl + Z)'), Undo2, false, () => c().undo().run())}
          {btn(t('Rétablir'), Redo2, false, () => c().redo().run())}
        </>)}
      </div>
    </div>
  );
}

/** The same note, give or take the empty line the editor adds at the end. */
const sameContent = (a: string, b: string) => a.replace(/(<p><\/p>)+$/, '') === b.replace(/(<p><\/p>)+$/, '');

export default function NoteEditor({ note, readOnly = false, inset = 'px-4 pb-room pt-6 md:px-12' }: { note: Note; readOnly?: boolean; inset?: string }) {
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Typing not saved yet in the store. */
  const unsaved = useRef(false);
  /** The content this editor last wrote or loaded: anything else in the store came from another device. */
  const known = useRef(note.content);
  const save = useCallback(
    (html: string) => {
      unsaved.current = false;
      known.current = html;
      useNotes.getState().updateNote(note.id, { content: html });
    },
    [note.id],
  );
  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit.configure({ link: false }),
      // Not « inclusive »: what is typed right after a link stays plain text.
      Link.extend({ inclusive: () => false }).configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
      Placeholder.configure({ placeholder: t('Commence à écrire… (tape «\u00a0#\u00a0» pour un titre, «\u00a0-\u00a0» pour une liste)') }),
      Highlight,
      TaskList,
      TaskItem.configure({
        nested: true,
        a11y: { checkboxLabel: node => (node.textContent.trim() ? t('Case à cocher\u00a0: {text}', { text: node.textContent.trim() }) : t('Case à cocher vide')) },
      }),
      TiptapImage.configure({ allowBase64: true }),
    ],
    content: note.content,
    editorProps: {
      attributes: { class: 'prose-note', 'aria-label': t('Contenu de la note'), 'aria-multiline': 'true' },
      // A click places the cursor in a link (to edit it); Ctrl+click (⌘+click) opens it.
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement | null)?.closest?.('a[href]');
        if (!a || !(event.ctrlKey || event.metaKey)) return false;
        openLink(withProtocol(a.getAttribute('href') ?? ''));
        return true;
      },
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length) return false;
        event.preventDefault();
        void insertImages(view, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = moved ? [] : imageFiles(event.dataTransfer?.files);
        if (!files.length) return false;
        event.preventDefault();
        void insertImages(view, files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      // The editor tidying what it was given (an empty line added at the end of a template), not typing:
      // nothing to save, the note stays « modifiée » when it really was.
      if (sameContent(ed.getHTML(), known.current)) return;
      unsaved.current = true;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(ed.getHTML()), 350);
    },
  });

  // Newer version from another device (synchronisation): shown here, unless the student is
  // typing (then their text wins). Without this, the next keystroke would save the old text over it.
  useEffect(() => {
    if (!editor || editor.isDestroyed || unsaved.current || note.content === known.current) return;
    editor.commands.setContent(note.content, { emitUpdate: false });
    known.current = editor.getHTML();
  }, [editor, note.content]);

  // Flush pending save when switching notes, leaving the page or closing the tab.
  useEffect(() => {
    const flush = () => {
      clearTimeout(saveTimer.current);
      if (editor && !editor.isDestroyed && !readOnly) {
        const html = editor.getHTML();
        const saved = useNotes.getState().notes.find(n => n.id === note.id);
        // Gone (e.g. moved to the trash): nothing to save.
        if (saved && !sameContent(html, saved.content) && !sameContent(html, known.current)) save(html);
      }
    };
    window.addEventListener('pagehide', flush);
    registerEditorFlush(flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      registerEditorFlush(null, flush);
      flush();
    };
  }, [editor, note.id, readOnly, save]);

  if (!editor) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!readOnly && (
        <div className="sticky top-0 z-10 border-b border-stone-100 bg-surface px-4 py-1.5 md:px-11">
          <Toolbar editor={editor} />
        </div>
      )}
      <div className={cx('min-h-0 flex-1 overflow-y-auto', inset, !readOnly && 'cursor-text')} onClick={() => !readOnly && !editor.isFocused && editor.commands.focus('end')}>
        <EditorContent editor={editor} onClick={e => e.stopPropagation()} />
      </div>
    </div>
  );
}
