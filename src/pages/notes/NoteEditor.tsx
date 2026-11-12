import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Bold, Italic, Underline, Strikethrough, Highlighter, Heading1, Heading2, List, ListOrdered, ListChecks, Quote, Code2, Link2, Link2Off, ExternalLink, Minus, Undo2, Redo2, ImagePlus, MoreHorizontal,
} from 'lucide-react';
import { useNotes, type Note } from '../../store/notes';
import { askText, toast } from '../../store/ui';
import { cx } from '../../lib/utils';
import { findHits } from './searchHits';
import { compressImage, imageFiles } from './images';
import { caretAfterImage } from './imageCaret';
import { cleanPastedHtml, pastedHtmlHasText, registerEditorFlush, withProtocol } from './noteUtils';
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
      // The caret after the picture: left selected, the next key typed replaced it.
      view.dispatch(caretAfterImage(tr).scrollIntoView());
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

/**
 * The note's own titles come under the page's « Notes » for screen readers: « Titre 1 » is read as a level 2, and so
 * on (one main title per page). Only said to them: nothing changes on screen nor in the saved note.
 */
const HeadingLevels = Extension.create({
  name: 'headingLevels',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: state => {
            const marks: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'heading') marks.push(Decoration.node(pos, pos + node.nodeSize, { 'aria-level': String(node.attrs.level + 1) }));
            });
            return DecorationSet.create(state.doc, marks);
          },
        },
      }),
    ];
  },
});

interface Tool {
  key: string;
  label: string;
  Icon: typeof Bold;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
  /** Shown in the tooltip and the « … » panel (computers). */
  shortcut?: string;
  /** Its name in the « … » panel, when the tooltip's is long. */
  short?: string;
  /** The tools that stay in the row first when it is narrow (lowest first); the others go in « … ». */
  rank: number;
}

/** Room taken by the row: each group has its separator (padding), its buttons and the gaps between them. */
interface Metrics { room: number; size: number; gap: number; pad: number }

function Toolbar({ editor }: { editor: Editor }) {
  // The toolbar isn't re-rendered at each keystroke: only when what it shows changes (a style on or off, the link, the history).
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      link: ed.isActive('link') ? ((ed.getAttributes('link').href as string | undefined) ?? '') : null,
      undo: ed.can().undo(),
      redo: ed.can().redo(),
      h1: ed.isActive('heading', { level: 1 }),
      h2: ed.isActive('heading', { level: 2 }),
      bold: ed.isActive('bold'),
      italic: ed.isActive('italic'),
      underline: ed.isActive('underline'),
      strike: ed.isActive('strike'),
      highlight: ed.isActive('highlight'),
      bullet: ed.isActive('bulletList'),
      ordered: ed.isActive('orderedList'),
      tasks: ed.isActive('taskList'),
      quote: ed.isActive('blockquote'),
      code: ed.isActive('codeBlock'),
    }),
  });
  const link = state.link;
  const c = () => editor.chain().focus();
  // (Kept in a state, not a ref: the tools are made during the render.)
  const [imageInput, setImageInput] = useState<HTMLInputElement | null>(null);

  const groups: Tool[][] = [
    [
      { key: 'h1', label: t('Titre 1'), Icon: Heading1, active: state.h1, run: () => c().toggleHeading({ level: 1 }).run(), shortcut: keys('mod', 'alt', '1'), rank: 5 },
      { key: 'h2', label: t('Titre 2'), Icon: Heading2, active: state.h2, run: () => c().toggleHeading({ level: 2 }).run(), shortcut: keys('mod', 'alt', '2'), rank: 10 },
    ],
    [
      { key: 'bold', label: t('Gras'), Icon: Bold, active: state.bold, run: () => c().toggleBold().run(), shortcut: keys('mod', 'B'), rank: 1 },
      { key: 'italic', label: t('Italique'), Icon: Italic, active: state.italic, run: () => c().toggleItalic().run(), shortcut: keys('mod', 'I'), rank: 2 },
      { key: 'underline', label: t('Souligné'), Icon: Underline, active: state.underline, run: () => c().toggleUnderline().run(), shortcut: keys('mod', 'U'), rank: 8 },
      { key: 'strike', label: t('Barré'), Icon: Strikethrough, active: state.strike, run: () => c().toggleStrike().run(), shortcut: keys('mod', 'shift', 'S'), rank: 13 },
      { key: 'highlight', label: t('Surligner'), Icon: Highlighter, active: state.highlight, run: () => c().toggleHighlight().run(), shortcut: keys('mod', 'shift', 'H'), rank: 11 },
    ],
    [
      { key: 'bullet', label: t('Liste à puces'), Icon: List, active: state.bullet, run: () => c().toggleBulletList().run(), shortcut: keys('mod', 'shift', '8'), rank: 3 },
      { key: 'ordered', label: t('Liste numérotée'), Icon: ListOrdered, active: state.ordered, run: () => c().toggleOrderedList().run(), shortcut: keys('mod', 'shift', '7'), rank: 9 },
      { key: 'tasks', label: t('Cases à cocher'), Icon: ListChecks, active: state.tasks, run: () => c().toggleTaskList().run(), shortcut: keys('mod', 'shift', '9'), rank: 4 },
    ],
    [
      { key: 'quote', label: t('Citation'), Icon: Quote, active: state.quote, run: () => c().toggleBlockquote().run(), shortcut: keys('mod', 'shift', 'B'), rank: 15 },
      { key: 'code', label: t('Bloc de code'), Icon: Code2, active: state.code, run: () => c().toggleCodeBlock().run(), shortcut: keys('mod', 'alt', 'C'), rank: 16 },
      { key: 'link', label: link !== null ? t('Modifier le lien') : t('Lien'), Icon: Link2, active: link !== null, run: () => void editLink(editor), shortcut: keys('mod', 'K'), rank: 12 },
      ...(link !== null
        ? [
            { key: 'open-link', label: t('Ouvrir le lien'), Icon: ExternalLink, run: () => openLink(withProtocol(link)), shortcut: keys('mod', t('clic')), rank: 12.1 },
            { key: 'unlink', label: t('Retirer le lien'), Icon: Link2Off, run: () => c().extendMarkRange('link').unsetLink().run(), rank: 12.2 },
          ]
        : []),
      { key: 'rule', label: t('Séparateur'), Icon: Minus, run: () => c().setHorizontalRule().run(), rank: 17 },
      // Kept in the row even on a phone (rank: just after bold and italic): in « … », it wasn't found.
      { key: 'image', label: t('Ajouter une image (ou colle-la dans la note)'), Icon: ImagePlus, run: () => imageInput?.click(), short: t('Image||outil de la note'), rank: 2.5 },
    ],
    [
      { key: 'undo', label: t('Annuler la frappe'), Icon: Undo2, run: () => c().undo().run(), shortcut: keys('mod', 'Z'), disabled: !state.undo, short: t('Annuler||la frappe'), rank: 6 },
      { key: 'redo', label: t('Rétablir'), Icon: Redo2, run: () => c().redo().run(), shortcut: keys('mod', 'shift', 'Z'), disabled: !state.redo, rank: 7 },
    ],
  ];

  // One row, never scrolled nor wrapped: what doesn't fit goes in « … » (the least used first). Measured from the
  // buttons themselves (their size changes under a finger).
  const row = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<Metrics | null>(null);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => {
      const g = el.querySelector<HTMLElement>('[data-tool-group]');
      const b = el.querySelector<HTMLElement>('[data-tool]');
      if (!g || !b) return;
      const cs = getComputedStyle(g);
      const next = { room: el.clientWidth, size: b.offsetWidth, gap: parseFloat(cs.columnGap) || 0, pad: parseFloat(cs.paddingLeft) || 0 };
      setM(o => (o && o.room === next.room && o.size === next.size && o.gap === next.gap && o.pad === next.pad ? o : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = groups.flat();
  const shown = new Set(all.map(x => x.key));
  if (m) {
    const width = (keep: Set<string>, more: boolean) => {
      let w = 0;
      for (const g of groups) {
        const n = g.filter(x => keep.has(x.key)).length;
        if (n) w += m.pad + n * m.size + (n - 1) * m.gap;
      }
      return w + (more ? m.pad + m.size : 0);
    };
    if (width(shown, false) > m.room + 0.5) {
      shown.clear();
      for (const x of [...all].sort((a, b) => a.rank - b.rank)) {
        shown.add(x.key);
        if (width(shown, true) > m.room + 0.5) {
          shown.delete(x.key);
          break;
        }
      }
    }
  }
  const hidden = all.filter(x => !shown.has(x.key));

  const btnClass = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-35 pointer-coarse:h-9 pointer-coarse:w-9';
  const btn = (x: Tool) => (
    <button
      key={x.key}
      data-tool
      type="button"
      title={x.shortcut ? `${x.label} (${x.shortcut})` : x.label}
      aria-label={x.label}
      aria-pressed={x.active || undefined}
      disabled={x.disabled}
      onMouseDown={e => e.preventDefault()}
      onClick={x.run}
      className={cx(btnClass, x.active ? 'bg-stone-200/70 text-ink' : 'text-stone-500 hover:bg-stone-100 hover:text-ink disabled:hover:bg-transparent')}
    >
      <x.Icon size={15} />
    </button>
  );
  // Groups wrap as a whole; the separator is drawn before each group and hidden at the start of the row
  // (the row is shifted left under a clipping box), so the row doesn't start with a lone separator.
  const groupClass = 'relative flex shrink-0 items-center gap-0.5 pl-[9px] before:absolute before:left-1 before:top-1/2 before:h-4 before:w-px before:-translate-y-1/2 before:bg-stone-200';

  return (
    <div className="-mx-1 -my-1 overflow-hidden px-1 py-1">
      <div ref={row} className="-ml-[9px] flex items-center">
        {groups.map((g, i) => {
          const visible = g.filter(x => shown.has(x.key));
          return visible.length ? (
            <div key={i} data-tool-group className={groupClass}>
              {visible.map(btn)}
            </div>
          ) : null;
        })}
        {hidden.length > 0 && (
          <div className={groupClass}>
            <MoreTools tools={hidden} btnClass={btnClass} />
          </div>
        )}
      </div>
      <input
        ref={setImageInput}
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
    </div>
  );
}

/**
 * The tools that don't fit in the row: a small panel under « … », each with its name. It doesn't take the focus from
 * the text (a phone's keyboard stays open), except when opened from the keyboard.
 */
function MoreTools({ tools, btnClass }: { tools: Tool[]; btnClass: string }) {
  const [at, setAt] = useState<{ top: number; right: number; left?: number } | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const fine = typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;
  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      const n = e.target as Node | null;
      if (e.type === 'pointerdown' && n && (panel.current?.contains(n) || opener.current?.contains(n))) return;
      setAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setAt(null);
      if (panel.current?.contains(document.activeElement)) opener.current?.focus();
    };
    addEventListener('pointerdown', close, true);
    addEventListener('resize', close);
    addEventListener('keydown', onKey, true);
    return () => {
      removeEventListener('pointerdown', close, true);
      removeEventListener('resize', close);
      removeEventListener('keydown', onKey, true);
    };
  }, [at]);
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (at) return setAt(null);
    const r = e.currentTarget.getBoundingClientRect();
    // Phones: from margin to margin (two columns of names, none cut).
    const narrow = window.innerWidth < 480;
    setAt({ top: r.bottom + 6, right: narrow ? 8 : Math.max(8, window.innerWidth - r.right - 4), left: narrow ? 8 : undefined });
    // From the keyboard: in the panel at once.
    if (e.detail === 0) requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus());
  };
  const anyActive = tools.some(x => x.active);
  return (
    <>
      <button
        ref={opener}
        type="button"
        title={t('Plus d’outils')}
        aria-label={t('Plus d’outils')}
        aria-expanded={!!at}
        aria-haspopup="true"
        onMouseDown={e => e.preventDefault()}
        onClick={toggle}
        // A style of the text that sits in the panel shows here too.
        className={cx(btnClass, at || anyActive ? 'bg-stone-200/70 text-ink' : 'text-stone-500 hover:bg-stone-100 hover:text-ink')}
      >
        <MoreHorizontal size={15} />
      </button>
      {at &&
        createPortal(
          <div
            ref={panel}
            role="group"
            aria-label={t('Plus d’outils')}
            className={cx(
              'enter fixed z-[65] grid max-w-[calc(100vw-16px)] gap-0.5 overflow-y-auto rounded-xl border border-stone-200 bg-surface p-1 shadow-pop',
              tools.length > 5 ? 'grid-cols-2' : 'grid-cols-1',
            )}
            style={{ top: at.top, right: at.right, left: at.left, maxHeight: `calc(100dvh - ${Math.round(at.top) + 8}px)` }}
            onMouseDown={e => e.preventDefault()}
          >
            {tools.map(x => (
              <button
                key={x.key}
                type="button"
                aria-pressed={x.active || undefined}
                disabled={x.disabled}
                title={x.shortcut && fine ? `${x.label} (${x.shortcut})` : x.label}
                onClick={() => {
                  setAt(null);
                  x.run();
                }}
                className={cx(
                  'flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors outline-none disabled:opacity-35 pointer-coarse:h-10',
                  'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
                  x.active ? 'bg-stone-200/70 text-ink' : 'text-stone-700 hover:bg-stone-100 disabled:hover:bg-transparent',
                )}
              >
                <x.Icon size={15} className="shrink-0 text-stone-500" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{x.short ?? x.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * A tap beside the text (its margins, under its last line): the caret at the nearest place of the text, the note not
 * moved (it went to the very end of the note and scrolled there, far from the finger).
 */
function focusAt(editor: Editor, x: number, y: number) {
  const r = editor.view.dom.getBoundingClientRect();
  const at = editor.view.posAtCoords({ left: Math.min(Math.max(x, r.left + 1), r.right - 1), top: Math.min(Math.max(y, r.top + 1), r.bottom - 1) });
  if (at) editor.chain().setTextSelection(at.pos).focus(undefined, { scrollIntoView: false }).run();
  else editor.commands.focus('end', { scrollIntoView: false });
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
      HeadingLevels,
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
      transformPastedHTML: cleanPastedHtml,
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        // Cells copied from Excel come with a picture of themselves: their text is pasted, not that picture.
        if (!files.length || pastedHtmlHasText(event.clipboardData?.getData('text/html'))) return false;
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
      <div data-note-scroll className={cx('min-h-0 flex-1 overflow-y-auto', inset, !readOnly && 'cursor-text')} onClick={e => !readOnly && !editor.isFocused && focusAt(editor, e.clientX, e.clientY)}>
        <EditorContent editor={editor} onClick={e => e.stopPropagation()} />
      </div>
    </div>
  );
}
