import { useCallback, useEffect, useRef } from 'react';
import { useEditor, useEditorState, EditorContent, Extension, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { TaskList } from '@tiptap/extension-list';
import { QuietTaskItem } from './taskItem';
import TiptapImage from '@tiptap/extension-image';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import {
  Bold, Italic, Underline, Strikethrough, Highlighter, Heading1, Heading2, List, ListOrdered, ListChecks, Quote, Code2, Link2, Link2Off, ExternalLink, Minus, Undo2, Redo2, ImagePlus,
} from 'lucide-react';
import { useNotes, type Note } from '../../store/notes';
import { askText, toast } from '../../store/ui';
import { cx } from '../../lib/utils';
import { findHits } from './searchHits';
import { compressImage, imageFiles } from './images';
import { registerEditorFlush, tablesToLines, withProtocol } from './noteUtils';
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

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** A shortcut as written on this keyboard: « Ctrl + Maj + S », « ⌘⇧S » on a Mac. */
const keys = (...k: string[]) =>
  MAC ? k.map(x => ({ mod: '⌘', shift: '⇧', alt: '⌥' })[x] ?? x).join('') : k.map(x => ({ mod: t('Ctrl'), shift: t('Maj'), alt: 'Alt' })[x] ?? x).join(' + ');

/** Adds or changes the link of the selection (the toolbar's button, Ctrl+K). */
async function editLink(editor: Editor) {
  const href = editor.isActive('link') ? ((editor.getAttributes('link').href as string | undefined) ?? '') : null;
  const url = await askText(href !== null ? t('Modifier le lien') : t('Adresse du lien'), href ?? '', href !== null ? t('Modifier') : t('Ajouter'), { url: true });
  if (editor.isDestroyed) return;
  if (url === null || !url.trim()) return void editor.chain().focus().run();
  editor.chain().focus().extendMarkRange('link').setLink({ href: withProtocol(url) }).run();
}

// ── Words found by a search ──
const hitKey = new PluginKey<DecorationSet>('searchHits');
/** The words a search opened the note with, marked until the note is changed (like a browser's « Rechercher »). */
const SearchHits = Extension.create({
  name: 'searchHits',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: hitKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => (tr.getMeta(hitKey) as DecorationSet | undefined) ?? (tr.docChanged ? DecorationSet.empty : set),
        },
        props: { decorations: state => hitKey.getState(state) },
      }),
    ];
  },
});

function Toolbar({ editor }: { editor: Editor }) {
  // The toolbar isn't re-rendered at each keystroke: the link and the undo history are followed on their own.
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      link: ed.isActive('link') ? ((ed.getAttributes('link').href as string | undefined) ?? '') : null,
      undo: ed.can().undo(),
      redo: ed.can().redo(),
    }),
  });
  const link = state.link;
  const btnClass = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-35 pointer-coarse:h-9 pointer-coarse:w-9';
  /** `shortcut`: shown in the tooltip (computers). */
  const btn = (label: string, Icon: typeof Bold, active: boolean, run: () => void, shortcut?: string, disabled = false) => (
    <button
      key={label}
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onMouseDown={e => e.preventDefault()}
      onClick={run}
      className={cx(btnClass, active ? 'bg-stone-200/70 text-ink' : 'text-stone-500 hover:bg-stone-100 hover:text-ink disabled:hover:bg-transparent')}
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

  return (
    // Fingers: one row that scrolls sideways (two rows took a third of a phone's screen above the text).
    <div className="-mx-1 -my-1 overflow-hidden px-1 py-1 pointer-coarse:overflow-x-auto pointer-coarse:[scrollbar-width:none]">
      <div className="-ml-[9px] flex flex-wrap items-center gap-y-0.5 pointer-coarse:flex-nowrap">
        {group('g1', <>
          {btn(t('Titre 1'), Heading1, editor.isActive('heading', { level: 1 }), () => c().toggleHeading({ level: 1 }).run(), keys('mod', 'alt', '1'))}
          {btn(t('Titre 2'), Heading2, editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run(), keys('mod', 'alt', '2'))}
        </>)}
        {group('g2', <>
          {btn(t('Gras'), Bold, editor.isActive('bold'), () => c().toggleBold().run(), keys('mod', 'B'))}
          {btn(t('Italique'), Italic, editor.isActive('italic'), () => c().toggleItalic().run(), keys('mod', 'I'))}
          {btn(t('Souligné'), Underline, editor.isActive('underline'), () => c().toggleUnderline().run(), keys('mod', 'U'))}
          {btn(t('Barré'), Strikethrough, editor.isActive('strike'), () => c().toggleStrike().run(), keys('mod', 'shift', 'S'))}
          {btn(t('Surligner'), Highlighter, editor.isActive('highlight'), () => c().toggleHighlight().run(), keys('mod', 'shift', 'H'))}
        </>)}
        {group('g3', <>
          {btn(t('Liste à puces'), List, editor.isActive('bulletList'), () => c().toggleBulletList().run(), keys('mod', 'shift', '8'))}
          {btn(t('Liste numérotée'), ListOrdered, editor.isActive('orderedList'), () => c().toggleOrderedList().run(), keys('mod', 'shift', '7'))}
          {btn(t('Cases à cocher'), ListChecks, editor.isActive('taskList'), () => c().toggleTaskList().run(), keys('mod', 'shift', '9'))}
        </>)}
        {group('g4', <>
          {btn(t('Citation'), Quote, editor.isActive('blockquote'), () => c().toggleBlockquote().run(), keys('mod', 'shift', 'B'))}
          {btn(t('Bloc de code'), Code2, editor.isActive('codeBlock'), () => c().toggleCodeBlock().run(), keys('mod', 'alt', 'C'))}
          {btn(link !== null ? t('Modifier le lien') : t('Lien'), Link2, link !== null, () => void editLink(editor), keys('mod', 'K'))}
          {link !== null && btn(t('Ouvrir le lien'), ExternalLink, false, () => openLink(withProtocol(link)), keys('mod', t('clic')))}
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
          {btn(t('Annuler la frappe'), Undo2, false, () => c().undo().run(), keys('mod', 'Z'), !state.undo)}
          {btn(t('Rétablir'), Redo2, false, () => c().redo().run(), keys('mod', 'shift', 'Z'), !state.redo)}
        </>)}
      </div>
    </div>
  );
}

/** The same note, give or take the empty line the editor adds at the end. */
const sameContent = (a: string, b: string) => a.replace(/(<p><\/p>)+$/, '') === b.replace(/(<p><\/p>)+$/, '');

/** `highlight`: words a search found in the note, marked and scrolled to when it opens. */
export default function NoteEditor({ note, readOnly = false, inset = 'px-4 pb-room pt-6 md:px-12', highlight }: { note: Note; readOnly?: boolean; inset?: string; highlight?: string }) {
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
      Placeholder.configure({ placeholder: t('Commence à écrire… (tape « # » pour un titre, « - » pour une liste)') }),
      Highlight,
      TaskList,
      QuietTaskItem.configure({
        nested: true,
        a11y: { checkboxLabel: node => (node.textContent.trim() ? t('Case à cocher : {text}', { text: node.textContent.trim() }) : t('Case à cocher vide')) },
      }),
      TiptapImage.configure({ allowBase64: true }),
      SearchHits,
    ],
    content: note.content,
    editorProps: {
      attributes: { class: 'prose-note', 'aria-label': t('Contenu de la note'), 'aria-multiline': 'true' },
      // Ctrl+K (⌘K) is the link here, not the search of the whole app: the key stops at the note.
      handleKeyDown: (_view, event) => {
        if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'k') return false;
        event.preventDefault();
        event.stopPropagation();
        const ed = (_view.dom as HTMLElement & { editor?: Editor }).editor;
        if (ed && ed.isEditable) void editLink(ed);
        return true;
      },
      // A click places the cursor in a link (to edit it); Ctrl+click (⌘+click) opens it.
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement | null)?.closest?.('a[href]');
        if (!a || !(event.ctrlKey || event.metaKey)) return false;
        openLink(withProtocol(a.getAttribute('href') ?? ''));
        return true;
      },
      transformPastedHTML: tablesToLines,
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
    if (!editor || editor.isDestroyed || note.content === known.current) return;
    if (unsaved.current) {
      // Typed here while another tab (or device) saved this note: this version is saved over it, so say it,
      // with the other one a click away (its text vanished without a word).
      const other = note.content;
      toast(t('Cette note a aussi été modifiée dans un autre onglet ou appareil : ta version est gardée.'), 'info', {
        label: t('Reprendre l’autre'),
        run: () => {
          if (editor.isDestroyed) return;
          clearTimeout(saveTimer.current);
          editor.commands.setContent(other, { emitUpdate: false });
          save(editor.getHTML());
        },
      });
      return;
    }
    editor.commands.setContent(note.content, { emitUpdate: false });
    known.current = editor.getHTML();
  }, [editor, note.content, save]);

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
    // Ctrl+S (⌘S): everything is saved as it is typed; said, instead of the browser's « Enregistrer la page ».
    const onKey = (e: KeyboardEvent) => {
      if (readOnly || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 's' || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      flush();
      toast(t('Enregistré automatiquement'), 'success');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('keydown', onKey);
      registerEditorFlush(null, flush);
      flush();
    };
  }, [editor, note.id, readOnly, save]);

  // Opened from a search: the words found are marked, the first one brought into view.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !highlight) return;
    const hits = findHits(editor.state.doc, highlight);
    if (!hits.length) return;
    const { state, view } = editor;
    view.dispatch(state.tr.setMeta(hitKey, DecorationSet.create(state.doc, hits.map(h => Decoration.inline(h.from, h.to, { class: 'search-hit' })))));
    requestAnimationFrame(() => view.dom.querySelector('.search-hit')?.scrollIntoView({ block: 'center' }));
  }, [editor, highlight]);

  if (!editor) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!readOnly && (
        // No background of its own: nothing scrolls under it, and a translucent one drew a lighter band over the
        // glass card (Verre, Liquid Glass).
        <div className="border-b border-stone-100 px-4 py-1.5 md:px-11 max-md:py-1">
          <Toolbar editor={editor} />
        </div>
      )}
      <div data-note-scroll className={cx('min-h-0 flex-1 overflow-y-auto', inset, !readOnly && 'cursor-text')} onClick={() => !readOnly && !editor.isFocused && editor.commands.focus('end')}>
        <EditorContent editor={editor} onClick={e => e.stopPropagation()} />
      </div>
    </div>
  );
}
