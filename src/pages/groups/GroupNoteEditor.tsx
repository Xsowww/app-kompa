import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import { NodeSelection } from '@tiptap/pm/state';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useNavigate } from 'react-router-dom';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import TiptapImage from '@tiptap/extension-image';
import { TaskList } from '@tiptap/extension-list';
import { QuietTaskItem } from '../notes/taskItem';
import {
  AlertTriangle, ArrowLeft, Bold, Italic, Underline, Strikethrough, Highlighter, Heading1, Heading2, List, ListOrdered, ListChecks, Quote, Code2, Link2, Link2Off, ExternalLink, Minus, ImagePlus,
  Trash2, Undo2, Redo2, Flag, MoreHorizontal, Printer, FileDown, NotebookPen,
} from 'lucide-react';
import { useAuth } from '../../store/auth';
import { ReportDialog } from '../../components/FeedbackDialogs';
import { ContextMenu, type MenuItem } from '../../components/Overlays';
import { useGroups } from '../../store/groups';
import { useNotes, type Note } from '../../store/notes';
import { askText, toast } from '../../store/ui';
import { supabase } from '../../lib/supabase';
import { deleteNote, fetchNote, groupError, saveNote, summary, type GroupNote } from '../../lib/groups';
import { cx, relativeTime } from '../../lib/utils';
import { tablesToLines, withProtocol } from '../notes/noteUtils';
import { compressImage, imageFiles } from '../notes/images';
import { downloadMarkdown, printNote } from '../notes/exportNote';
import { groupWordsNow, useMemberName } from './util';
import { removeWithUndo } from './pending';
import GroupNoteComments from './GroupNoteComments';
import { t, tn } from '../../i18n';

/** A shared note's limit in the database (its images count: they are inside it). */
const MAX_NOTE = 500_000;

/** Compresses then inserts images at `pos` (drop) or at the selection (paste, toolbar), as in my own notes. */
async function insertImages(view: EditorView, files: File[], pos?: number) {
  for (const file of files) {
    try {
      const src = await compressImage(file);
      if (view.isDestroyed) return;
      // The database refuses a note over 500 000 characters: said now, rather than « Non enregistré » later.
      if (view.dom.innerHTML.length + src.length > MAX_NOTE) return toast(t('Plus de place pour une image dans cette note partagée : retire une image ou crée une autre note.'), 'error');
      const { state } = view;
      const node = state.schema.nodes.image.create({ src });
      const at = pos ?? (state.selection instanceof NodeSelection ? state.selection.to : null);
      const tr = at == null ? state.tr.replaceSelectionWith(node) : state.tr.insert(Math.min(at, state.doc.content.size), node);
      view.dispatch(tr.scrollIntoView());
    } catch (e) {
      toast(e instanceof Error ? e.message : t('Impossible d’ajouter l’image'), 'error');
    }
  }
}

const openLink = (href: string) => window.open(href, '_blank', 'noopener,noreferrer');

/** The same tools as my own notes (NoteEditor), larger buttons on a touch screen, on one row that scrolls on a phone. */
function Toolbar({ editor }: { editor: Editor }) {
  // The link under the cursor, followed on its own (the toolbar isn't drawn again at each key).
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
  // Groups wrap as a whole; the separator before each one is hidden at the start of a line (see NoteEditor).
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
          <label key="image" title={t('Image (ou colle-la dans la note)')} onMouseDown={e => e.preventDefault()} className={cx(btnClass, 'cursor-pointer text-stone-500 hover:bg-stone-100 hover:text-ink')}>
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

/**
 * Who else has this note open (« Léa modifie cette note »): Realtime presence on a private channel per note, that
 * only the group's members may join (migration 2026-11-03; without it, the channel is refused and nothing shows).
 * Returns the others, and `typing()` to call at each change (« modifie » for a few seconds).
 */
function usePresence(noteId: string, me: string | undefined) {
  const [others, setOthers] = useState<{ id: string; typing: boolean }[]>([]);
  const channel = useRef<RealtimeChannel | null>(null);
  const typingUntil = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const db = supabase;
    if (!db || !me) return;
    let alive = true;
    let ch: RealtimeChannel | null = null;
    void (async () => {
      // The same note just closed (reopened at once): its channel has the same name and leaves first.
      const old = db.getChannels().find(c => c.topic === `realtime:note:${noteId}`);
      if (old) await db.removeChannel(old);
      if (!alive) return;
      const c = (ch = db.channel(`note:${noteId}`, { config: { private: true, presence: { key: me } } }));
      c.on('presence', { event: 'sync' }, () => {
        const state = c.presenceState<{ typing?: boolean }>();
        setOthers(Object.entries(state).filter(([id]) => id !== me).map(([id, metas]) => ({ id, typing: metas.some(m => m.typing) })));
      }).subscribe(status => {
        if (status === 'SUBSCRIBED') void c.track({ typing: false });
      });
      channel.current = c;
    })();
    return () => {
      alive = false;
      clearTimeout(idle.current);
      channel.current = null;
      if (ch) void db.removeChannel(ch);
    };
  }, [noteId, me]);
  const typing = useCallback(() => {
    const ch = channel.current;
    if (!ch) return;
    // Said once when typing starts, and again 5 s after the last key (a message per key would be too many).
    if (Date.now() > typingUntil.current) void ch.track({ typing: true });
    typingUntil.current = Date.now() + 5000;
    clearTimeout(idle.current);
    idle.current = setTimeout(() => void channel.current?.track({ typing: false }), 5000);
  }, []);
  return { others, typing };
}

type Status = 'saved' | 'pending' | 'saving' | 'error';

/** The default title, in French (notes made before a language switch) or translated: shown as an empty title. */
const untitled = (s: string) => s === 'Sans titre' || s === t('Sans titre');

/** Charge la note, puis affiche l'éditeur. */
/** What was typed while a new note was being created: its title, and its first lines after « Entrée » (null: none). */
type Typed = { title: { current: string }; body?: { current: string | null } };

/** `fresh` : la note qu'on vient de créer (pas de rechargement) et ce qui a déjà été tapé pendant sa création. */
export default function GroupNoteEditor({ noteId, onClose, readOnly = false, fresh }: { noteId: string; onClose: () => void; readOnly?: boolean; fresh?: { note: GroupNote } & Typed }) {
  const preset = fresh?.note.id === noteId ? fresh : undefined;
  const [note, setNote] = useState<GroupNote | null | undefined | 'error'>(preset?.note);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (preset) return;
    let alive = true;
    // A note that can't be read (no connection…) isn't a deleted note: « Réessayer » instead of « n'existe plus ».
    fetchNote(noteId).then(
      n => alive && setNote(n),
      () => alive && setNote('error'),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la note fraîche ne sert qu'au premier affichage
  }, [noteId, attempt]);

  if (note === 'error')
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-[14px] font-medium">{t('Impossible d’ouvrir la note. Vérifie ta connexion.')}</p>
        <div className="mt-4 flex gap-2">
          <button className="btn-secondary" onClick={onClose}>{t('Retour à la liste')}</button>
          <button
            className="btn-primary"
            onClick={() => {
              setNote(undefined);
              setAttempt(n => n + 1);
            }}
          >
            {t('Réessayer')}
          </button>
        </div>
      </div>
    );
  if (note === undefined) return <div className="flex-1 p-8 text-[13px] text-stone-500">{t('Chargement de la note…')}</div>;
  if (note === null)
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-[14px] font-medium">{t('Cette note n’existe plus')}</p>
        <button className="btn-secondary mt-4" onClick={onClose}>{t('Retour à la liste')}</button>
      </div>
    );
  return <LoadedEditor initial={note} onClose={onClose} readOnly={readOnly} typed={preset} />;
}

/** `readOnly` : lecteur du groupe (la base refuserait de toute façon l'enregistrement). */
function LoadedEditor({ initial, onClose, readOnly, typed }: { initial: GroupNote; onClose: () => void; readOnly: boolean; typed?: Typed }) {
  const startTitle = typed?.title.current;
  const id = initial.id;
  const nameOf = useMemberName(initial.groupId);
  const [meta, setMeta] = useState({ updatedAt: initial.updatedAt, updatedBy: initial.updatedBy });
  const me = useAuth(s => s.user?.id);
  const group = useGroups(s => s.groups.find(g => g.id === initial.groupId));
  const navigate = useNavigate();
  const presence = usePresence(id, me);
  const [reporting, setReporting] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [title, setTitle] = useState(startTitle ?? (untitled(initial.title) ? '' : initial.title));
  const titleInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>('saved');
  const [conflict, setConflict] = useState<GroupNote | null>(null);
  const [deleted, setDeleted] = useState(false);

  // Version en ligne sur laquelle mes modifications s'appuient.
  const base = useRef(initial.updatedAt);
  const dirty = useRef(false);
  const edits = useRef(0); // compteur : savoir si l'on a encore tapé pendant l'enregistrement
  const saving = useRef(false);
  const failed = useRef(false); // échec réseau en cours : un seul message tant qu'il dure
  const blocked = useRef(false); // conflit ou note supprimée : plus d'enregistrement automatique
  const titleRef = useRef(title);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editorRef = useRef<Editor | null>(null);
  const html = useRef(initial.content); // copie tenue à jour : l'éditeur peut être détruit avant le dernier enregistrement

  const adopt = useCallback((n: GroupNote) => {
    base.current = n.updatedAt;
    setMeta({ updatedAt: n.updatedAt, updatedBy: n.updatedBy });
    useGroups.getState().upsertNote(summary(n));
  }, []);

  const save = useCallback(
    async (force = false) => {
      if (saving.current || (blocked.current && !force)) return;
      if (!dirty.current && !force) return;
      saving.current = true;
      setStatus('saving');
      const at = edits.current;
      try {
        const saved = await saveNote(id, { title: titleRef.current.trim() || t('Sans titre'), content: html.current }, force ? null : base.current);
        failed.current = false;
        if (saved) {
          adopt(saved);
          blocked.current = false;
          setConflict(null);
          if (edits.current === at) {
            dirty.current = false;
            setStatus('saved');
          } else setStatus('pending');
        } else {
          // Quelqu'un a enregistré entre-temps, la note a été supprimée, ou la base a refusé
          // (passé lecteur entre-temps) : la version en ligne n'a alors pas bougé.
          blocked.current = true;
          const remote = await fetchNote(id);
          if (remote && (force || remote.updatedAt === base.current)) toast(t('Tu ne peux plus modifier cette note : tu es lecteur dans {group}.', { group: groupWordsNow().this }), 'error');
          else if (remote) setConflict(remote);
          else setDeleted(true);
          setStatus('error');
        }
      } catch (e) {
        setStatus('error');
        if (!failed.current) toast(groupError(e), 'error');
        failed.current = true;
      } finally {
        saving.current = false;
      }
      if (dirty.current && !blocked.current) {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void save(), failed.current ? 5000 : 800);
      }
    },
    [id, adopt],
  );

  const { typing } = presence;
  const changed = useCallback(() => {
    dirty.current = true;
    edits.current++;
    typing();
    if (blocked.current) return;
    setStatus('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
  }, [save, typing]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: t('Écris ici…') }),
      Highlight,
      TiptapImage.configure({ allowBase64: true }), // notes partagées depuis ses notes perso
      TaskList,
      QuietTaskItem.configure({ nested: true }),
    ],
    content: initial.content,
    editable: !readOnly,
    editorProps: {
      attributes: { class: 'prose-note', 'aria-label': t('Contenu de la note'), 'aria-multiline': 'true' },
      // As in my own notes: a click places the cursor in a link (to edit it), Ctrl+click (⌘+click) opens it;
      // a pasted table becomes lines, a pasted or dropped image goes in.
      handleClick: (view, _pos, event) => {
        const a = (event.target as HTMLElement | null)?.closest?.('a[href]');
        // A reader can't edit: a plain click opens it.
        if (!a || !(event.ctrlKey || event.metaKey || !view.editable)) return false;
        openLink(withProtocol(a.getAttribute('href') ?? ''));
        return true;
      },
      transformPastedHTML: tablesToLines,
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length || !view.editable) return false;
        event.preventDefault();
        void insertImages(view, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = moved || !view.editable ? [] : imageFiles(event.dataTransfer?.files);
        if (!files.length) return false;
        event.preventDefault();
        void insertImages(view, files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (!ed.isEditable) return;
      html.current = ed.getHTML();
      changed();
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  // Note neuve : on continue ce qui a été tapé pendant sa création, jusqu'à la dernière lettre (titre, puis
  // premières lignes après « Entrée »), curseur à la fin, et on l'enregistre. Avant l'affichage : aucune touche perdue.
  useLayoutEffect(() => {
    if (!typed || readOnly || !editor) return;
    const head = typed.title.current;
    const body = typed.body?.current ?? null;
    titleRef.current = head;
    setTitle(head);
    const el = titleInput.current;
    if (body !== null) {
      const fill = () => {
        if (body) {
          editor.commands.setContent({ type: 'doc', content: body.split('\n').map(l => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] })) }, { emitUpdate: false });
          html.current = editor.getHTML();
        }
        editor.commands.setTextSelection(editor.state.doc.content.size);
        editor.view.focus();
        if (head.trim() || body.trim()) changed(); // saved once the text is in
      };
      // Its commands exist once it is attached to the page (a title pasted right away came before that).
      if (editor.isInitialized) fill();
      else {
        const once = () => (editor.off('create', once), fill());
        editor.on('create', once);
      }
    } else if (el) {
      el.value = head;
      el.focus();
      el.setSelectionRange(head.length, head.length);
      if (head.trim()) changed();
    } else if (head.trim()) changed();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois, quand l'éditeur est là
  }, [editor]);
  useEffect(() => {
    editor?.setEditable(!readOnly, false); // sans « update » : rien à enregistrer
  }, [editor, readOnly]);

  const loadRemote = useCallback(
    (n: GroupNote) => {
      editorRef.current?.commands.setContent(n.content, { emitUpdate: false });
      html.current = n.content;
      titleRef.current = untitled(n.title) ? '' : n.title;
      setTitle(titleRef.current);
      dirty.current = false;
      blocked.current = false;
      setConflict(null);
      setStatus('saved');
      adopt(n);
    },
    [adopt],
  );

  // Un autre membre a enregistré cette note (Realtime ou retour sur l'onglet).
  const remoteAt = useGroups(s => s.notes[initial.groupId]?.find(n => n.id === id)?.updatedAt);
  const listed = useGroups(s => s.notes[initial.groupId]?.some(n => n.id === id));
  const gone = deleted || listed === false;
  useEffect(() => {
    if (!remoteAt || remoteAt <= base.current || saving.current) return;
    let alive = true;
    void fetchNote(id).then(n => {
      if (!alive || !n || n.updatedAt <= base.current) return;
      if (dirty.current || blocked.current) {
        blocked.current = true;
        setConflict(n);
      } else loadRemote(n);
    });
    return () => {
      alive = false;
    };
  }, [remoteAt, id, loadRemote]);

  // Enregistre ce qui reste en quittant la note ou l'onglet.
  useEffect(() => {
    const flush = () => {
      clearTimeout(timer.current);
      if (dirty.current && !blocked.current) void save();
    };
    // Closing the tab right after typing: the save can't finish in time, so the browser asks first.
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current && !blocked.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [save]);

  // For every member, for good: « Annuler » in the message rather than a question first (my last changes saved
  // before, so undoing gives the note back whole). As the database: its author or the owner.
  const canDelete = !readOnly && (initial.createdBy === me || (!!me && group?.ownerId === me));
  const remove = async () => {
    clearTimeout(timer.current);
    if (dirty.current && !blocked.current) await save();
    blocked.current = true;
    removeWithUndo([id], t('Note supprimée'), async () => {
      await deleteNote(id);
      useGroups.getState().dropNote(initial.groupId, id);
    });
    onClose();
  };

  // The note as my own notes are, for their export and their copy.
  const asNote = (): Note => ({ id, title: titleRef.current.trim() || t('Sans titre'), content: html.current, folderId: null, createdAt: initial.createdAt, updatedAt: meta.updatedAt });
  const menuItems: MenuItem[] = [
    { label: t('Exporter en PDF'), icon: <Printer size={15} />, onClick: () => void printNote(asNote(), group?.name).catch(() => toast(t('Impossible d’ouvrir l’impression'), 'error')) },
    { label: t('Exporter en Markdown'), icon: <FileDown size={15} />, onClick: () => downloadMarkdown(asNote()) },
    {
      label: t('Copier dans mes notes'),
      icon: <NotebookPen size={15} />,
      onClick: () => {
        const n = asNote();
        const copy = useNotes.getState().createNote({ title: n.title, content: n.content });
        toast(t('Copiée dans tes notes'), 'success', { label: t('Voir'), run: () => navigate(`/notes?note=${copy.id}`) });
      },
    },
    // Someone else wrote in it: it can be reported to the administrator.
    ...(initial.createdBy !== me || meta.updatedBy !== me ? [{ label: t('Signaler la note'), icon: <Flag size={15} />, onClick: () => setReporting(true) }] : []),
    ...(canDelete ? [{ label: t('Supprimer la note'), icon: <Trash2 size={15} />, danger: true, onClick: () => void remove() }] : []),
  ];

  // Others on this note right now: those typing first.
  const typingNow = presence.others.filter(o => o.typing).map(o => nameOf(o.id));
  const here = presence.others.filter(o => !o.typing).map(o => nameOf(o.id));
  const presenceText = typingNow.length
    ? tn(typingNow.length, '{names} modifie cette note', '{names} modifient cette note', { names: typingNow.join(', ') })
    : here.length
      ? tn(here.length, '{names} est aussi sur cette note', '{names} sont aussi sur cette note', { names: here.join(', ') })
      : '';

  const statusText =
    readOnly && status === 'saved'
      ? t('Lecture seule · modifiée par {name} {when}', { name: nameOf(meta.updatedBy), when: relativeTime(meta.updatedAt) })
      : conflict
        ? t('En attente : choisis la version à garder')
        : status === 'saving'
          ? t('Enregistrement…')
          : status === 'pending'
            ? t('Modifications non enregistrées')
            : status === 'error'
              ? t('Non enregistré')
              : t('Modifiée par {name} {when}', { name: nameOf(meta.updatedBy), when: relativeTime(meta.updatedAt) });

  if (!editor) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-1 px-4 pt-5 md:px-10">
        <button className="icon-btn mt-1" onClick={onClose} title={t('Retour à la liste')} aria-label={t('Retour à la liste')}>
          <ArrowLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <input
            ref={titleInput}
            value={title}
            readOnly={readOnly}
            // A note just created: its title is the first thing to type.
            autoFocus={!readOnly && startTitle === undefined && !title && !initial.content}
            placeholder={t('Sans titre')}
            aria-label={t('Titre de la note')}
            maxLength={200}
            onChange={e => {
              setTitle(e.target.value);
              titleRef.current = e.target.value;
              changed();
            }}
            // The text takes the very next key (focus('start') alone waits a frame: a quick key went to the title).
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), editor.commands.setTextSelection(0), editor.view.focus())}
            className="w-full bg-transparent text-[20px] font-semibold md:text-[24px] tracking-[-0.02em] outline-none placeholder:text-stone-500"
          />
          <p className={cx('mt-0.5 text-[12px]', conflict ? 'text-amber-700' : status === 'error' ? 'text-red-600' : 'text-stone-500')}>{statusText}</p>
          {presenceText && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-stone-500" role="status">
              <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', typingNow.length ? 'animate-pulse bg-emerald-500' : 'bg-emerald-400')} aria-hidden />
              <span className="truncate">{presenceText}</span>
            </p>
          )}
        </div>
        <button
          className="icon-btn mt-1"
          title={t('Plus d’actions')}
          aria-label={t('Plus d’actions')}
          aria-haspopup="menu"
          onClick={e => {
            // Under the button, right-aligned (clientX is 0 from the keyboard).
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right - 220, y: r.bottom + 4 });
          }}
        >
          <MoreHorizontal size={16} />
        </button>
        {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
        <ReportDialog target={reporting ? { kind: 'note', id: initial.id, title: title.trim() || t('Sans titre') } : null} onClose={() => setReporting(false)} />
      </div>

      {gone && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800 md:mx-10">
          <AlertTriangle size={15} className="shrink-0" />
          <span className="flex-1">{t('Un membre a supprimé cette note. Tes dernières modifications ne sont plus enregistrées.')}</span>
          <button className="btn-secondary h-7 px-2.5" onClick={onClose}>{t('Fermer')}</button>
        </div>
      )}
      {conflict && !gone && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 md:mx-10">
          <AlertTriangle size={15} className="shrink-0" />
          <span className="min-w-0 flex-1">
            {conflict.updatedBy === me
              ? t('Tu as modifié cette note ailleurs (autre onglet ou appareil) {when} pendant que tu écrivais. Rien n’a été écrasé.', { when: relativeTime(conflict.updatedAt) })
              : t('{name} a modifié cette note {when} pendant que tu écrivais. Rien n’a été écrasé.', { name: nameOf(conflict.updatedBy), when: relativeTime(conflict.updatedAt) })}
          </span>
          <button className="btn-secondary h-7 px-2.5" onClick={() => loadRemote(conflict)}>{conflict.updatedBy === me ? t('Charger l’autre version') : t('Charger sa version')}</button>
          <button className="btn-primary h-7 px-2.5" onClick={() => void save(true)}>{conflict.updatedBy === me ? t('Garder celle-ci') : t('Garder la mienne')}</button>
        </div>
      )}

      {readOnly ? (
        <div className="mt-3 border-t border-stone-100" />
      ) : (
        <div className="mt-3 border-y border-stone-100 bg-surface px-4 py-1.5 md:px-9">
          <Toolbar editor={editor} />
        </div>
      )}
      <div className="min-h-0 flex-1 cursor-text overflow-y-auto px-4 pt-5 pb-room md:px-11" onClick={() => !readOnly && !editor.isFocused && editor.commands.focus('end')}>
        <EditorContent editor={editor} onClick={e => e.stopPropagation()} />
        <GroupNoteComments note={initial} />
      </div>
    </div>
  );
}
