import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import TiptapImage from '@tiptap/extension-image';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import {
  AlertTriangle, ArrowLeft, Bold, Italic, Strikethrough, Highlighter, Heading1, Heading2, List, ListOrdered, ListChecks, Quote, Code2, Link2, Trash2, Undo2, Redo2, Flag,
} from 'lucide-react';
import { useAuth } from '../../store/auth';
import { ReportDialog } from '../../components/FeedbackDialogs';
import { useGroups } from '../../store/groups';
import { askText, confirmAction, toast } from '../../store/ui';
import { deleteNote, fetchNote, groupError, saveNote, summary, type GroupNote } from '../../lib/groups';
import { cx, relativeTime } from '../../lib/utils';
import { withProtocol } from '../notes/noteUtils';
import { groupWordsNow, useGroupWords, useMemberName } from './util';
import { t } from '../../i18n';

function Toolbar({ editor }: { editor: Editor }) {
  const btn = (label: string, Icon: typeof Bold, active: boolean, run: () => void) => (
    <button
      key={label}
      type="button"
      title={label} aria-label={label}
      onMouseDown={e => e.preventDefault()}
      onClick={run}
      className={cx('flex h-7 w-7 items-center justify-center rounded-md transition-colors', active ? 'bg-stone-200/70 text-ink' : 'text-stone-500 hover:bg-stone-100 hover:text-ink')}
    >
      <Icon size={15} />
    </button>
  );
  const c = () => editor.chain().focus();
  const sep = (k: string) => <span key={k} className="mx-1 h-4 w-px bg-stone-200" />;
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {btn(t('Titre 1'), Heading1, editor.isActive('heading', { level: 1 }), () => c().toggleHeading({ level: 1 }).run())}
      {btn(t('Titre 2'), Heading2, editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run())}
      {sep('s1')}
      {btn(t('Gras (Ctrl + B)'), Bold, editor.isActive('bold'), () => c().toggleBold().run())}
      {btn(t('Italique (Ctrl + I)'), Italic, editor.isActive('italic'), () => c().toggleItalic().run())}
      {btn(t('Barré'), Strikethrough, editor.isActive('strike'), () => c().toggleStrike().run())}
      {btn(t('Surligner'), Highlighter, editor.isActive('highlight'), () => c().toggleHighlight().run())}
      {sep('s2')}
      {btn(t('Liste à puces'), List, editor.isActive('bulletList'), () => c().toggleBulletList().run())}
      {btn(t('Liste numérotée'), ListOrdered, editor.isActive('orderedList'), () => c().toggleOrderedList().run())}
      {btn(t('Cases à cocher'), ListChecks, editor.isActive('taskList'), () => c().toggleTaskList().run())}
      {sep('s3')}
      {btn(t('Citation'), Quote, editor.isActive('blockquote'), () => c().toggleBlockquote().run())}
      {btn(t('Bloc de code'), Code2, editor.isActive('codeBlock'), () => c().toggleCodeBlock().run())}
      {btn(t('Lien'), Link2, editor.isActive('link'), () => {
        const prev = editor.getAttributes('link').href as string | undefined;
        void askText(prev ? t('Modifier le lien') : t('Adresse du lien'), prev ?? '', t('Valider'), { url: true }).then(url => {
          if (url === null) return;
          if (!url.trim() || url.trim() === 'https://') c().unsetLink().run();
          else c().extendMarkRange('link').setLink({ href: withProtocol(url) }).run();
        });
      })}
      {sep('s4')}
      {btn(t('Annuler (Ctrl + Z)'), Undo2, false, () => c().undo().run())}
      {btn(t('Rétablir'), Redo2, false, () => c().redo().run())}
    </div>
  );
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
  const w = useGroupWords();
  const id = initial.id;
  const nameOf = useMemberName(initial.groupId);
  const [meta, setMeta] = useState({ updatedAt: initial.updatedAt, updatedBy: initial.updatedBy });
  const me = useAuth(s => s.user?.id);
  const [reporting, setReporting] = useState(false);
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

  const changed = useCallback(() => {
    dirty.current = true;
    edits.current++;
    if (blocked.current) return;
    setStatus('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
  }, [save]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: t('Écris ici…') }),
      Highlight,
      TiptapImage.configure({ allowBase64: true }), // notes partagées depuis ses notes perso
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: initial.content,
    editable: !readOnly,
    editorProps: { attributes: { class: 'prose-note', 'aria-label': t('Contenu de la note'), 'aria-multiline': 'true' } },
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
      if (body) {
        editor.commands.setContent({ type: 'doc', content: body.split('\n').map(l => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] })) }, { emitUpdate: false });
        html.current = editor.getHTML();
      }
      editor.commands.setTextSelection(editor.state.doc.content.size);
      editor.view.focus();
    } else if (el) {
      el.value = head;
      el.focus();
      el.setSelectionRange(head.length, head.length);
    }
    if (head.trim() || body?.trim()) changed();
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

  const remove = async () => {
    if (!(await confirmAction(t('Supprimer cette note pour {all} ?', { all: w.all }), t('C’est définitif.')))) return;
    try {
      blocked.current = true;
      await deleteNote(id);
      useGroups.getState().dropNote(initial.groupId, id);
      toast(t('Note supprimée'), 'success');
      onClose();
    } catch (e) {
      blocked.current = false;
      toast(groupError(e), 'error');
    }
  };

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
        </div>
        {/* Someone else wrote in it: it can be reported to the administrator. */}
        {(initial.createdBy !== me || meta.updatedBy !== me) && (
          <button className="icon-btn mt-1" title={t('Signaler la note')} aria-label={t('Signaler la note')} onClick={() => setReporting(true)}>
            <Flag size={15} />
          </button>
        )}
        {!readOnly && (
          <button className="icon-btn mt-1 hover:text-red-600" title={t('Supprimer la note')} aria-label={t('Supprimer la note')} onClick={() => void remove()}>
            <Trash2 size={15} />
          </button>
        )}
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
      <div className="min-h-0 flex-1 cursor-text overflow-y-auto px-4 pt-5 pb-room md:px-11" onClick={() => !editor.isFocused && editor.commands.focus('end')}>
        <EditorContent editor={editor} onClick={e => e.stopPropagation()} />
      </div>
    </div>
  );
}
