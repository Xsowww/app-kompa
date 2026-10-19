import { useCallback, useEffect, useRef, useState } from 'react';
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
      {btn('Titre 1', Heading1, editor.isActive('heading', { level: 1 }), () => c().toggleHeading({ level: 1 }).run())}
      {btn('Titre 2', Heading2, editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run())}
      {sep('s1')}
      {btn('Gras (Ctrl+B)', Bold, editor.isActive('bold'), () => c().toggleBold().run())}
      {btn('Italique (Ctrl+I)', Italic, editor.isActive('italic'), () => c().toggleItalic().run())}
      {btn('Barré', Strikethrough, editor.isActive('strike'), () => c().toggleStrike().run())}
      {btn('Surligner', Highlighter, editor.isActive('highlight'), () => c().toggleHighlight().run())}
      {sep('s2')}
      {btn('Liste à puces', List, editor.isActive('bulletList'), () => c().toggleBulletList().run())}
      {btn('Liste numérotée', ListOrdered, editor.isActive('orderedList'), () => c().toggleOrderedList().run())}
      {btn('Cases à cocher', ListChecks, editor.isActive('taskList'), () => c().toggleTaskList().run())}
      {sep('s3')}
      {btn('Citation', Quote, editor.isActive('blockquote'), () => c().toggleBlockquote().run())}
      {btn('Bloc de code', Code2, editor.isActive('codeBlock'), () => c().toggleCodeBlock().run())}
      {btn('Lien', Link2, editor.isActive('link'), () => {
        const prev = editor.getAttributes('link').href as string | undefined;
        void askText(prev ? 'Modifier le lien' : 'Adresse du lien', prev ?? '', 'Valider', { url: true }).then(url => {
          if (url === null) return;
          if (!url.trim() || url.trim() === 'https://') c().unsetLink().run();
          else c().extendMarkRange('link').setLink({ href: withProtocol(url) }).run();
        });
      })}
      {sep('s4')}
      {btn('Annuler (Ctrl+Z)', Undo2, false, () => c().undo().run())}
      {btn('Rétablir', Redo2, false, () => c().redo().run())}
    </div>
  );
}

type Status = 'saved' | 'pending' | 'saving' | 'error';

/** Charge la note, puis affiche l'éditeur. */
/** `fresh` : la note qu'on vient de créer (pas de rechargement) et le titre déjà tapé pendant sa création. */
export default function GroupNoteEditor({ noteId, onClose, readOnly = false, fresh }: { noteId: string; onClose: () => void; readOnly?: boolean; fresh?: { note: GroupNote; title: { current: string } } }) {
  const preset = fresh?.note.id === noteId ? fresh : undefined;
  const [note, setNote] = useState<GroupNote | null | undefined>(preset?.note);
  useEffect(() => {
    if (preset) return;
    let alive = true;
    fetchNote(noteId).then(
      n => alive && setNote(n),
      () => alive && setNote(null),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la note fraîche ne sert qu'au premier affichage
  }, [noteId]);

  if (note === undefined) return <div className="flex-1 p-8 text-[13px] text-stone-500">Chargement de la note…</div>;
  if (note === null)
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-[14px] font-medium">Cette note n’existe plus</p>
        <button className="btn-secondary mt-4" onClick={onClose}>Retour à la liste</button>
      </div>
    );
  return <LoadedEditor initial={note} onClose={onClose} readOnly={readOnly} startTitle={preset?.title.current} />;
}

/** `readOnly` : lecteur du groupe (la base refuserait de toute façon l'enregistrement). */
function LoadedEditor({ initial, onClose, readOnly, startTitle }: { initial: GroupNote; onClose: () => void; readOnly: boolean; startTitle?: string }) {
  const w = useGroupWords();
  const id = initial.id;
  const nameOf = useMemberName(initial.groupId);
  const [meta, setMeta] = useState({ updatedAt: initial.updatedAt, updatedBy: initial.updatedBy });
  const me = useAuth(s => s.user?.id);
  const [reporting, setReporting] = useState(false);
  const [title, setTitle] = useState(startTitle ?? (initial.title === 'Sans titre' ? '' : initial.title));
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
        const saved = await saveNote(id, { title: titleRef.current.trim() || 'Sans titre', content: html.current }, force ? null : base.current);
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
          if (remote && (force || remote.updatedAt === base.current)) toast(`Tu ne peux plus modifier cette note : tu es lecteur dans ${groupWordsNow().this}.`, 'error');
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

  // Note neuve : on continue le titre commencé pendant sa création (curseur à la fin), et on l'enregistre.
  useEffect(() => {
    if (startTitle === undefined || readOnly) return;
    const el = titleInput.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
    if (startTitle.trim()) changed();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois, à l'ouverture
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: 'Écris ici…' }),
      Highlight,
      TiptapImage.configure({ allowBase64: true }), // notes partagées depuis ses notes perso
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: initial.content,
    editable: !readOnly,
    editorProps: { attributes: { class: 'prose-note', 'aria-label': 'Contenu de la note', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: ed }) => {
      if (!ed.isEditable) return;
      html.current = ed.getHTML();
      changed();
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEffect(() => {
    editor?.setEditable(!readOnly, false); // sans « update » : rien à enregistrer
  }, [editor, readOnly]);

  const loadRemote = useCallback(
    (n: GroupNote) => {
      editorRef.current?.commands.setContent(n.content, { emitUpdate: false });
      html.current = n.content;
      titleRef.current = n.title === 'Sans titre' ? '' : n.title;
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
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [save]);

  const remove = async () => {
    if (!(await confirmAction(`Supprimer cette note pour ${w.all} ?`, 'C’est définitif.'))) return;
    try {
      blocked.current = true;
      await deleteNote(id);
      useGroups.getState().dropNote(initial.groupId, id);
      toast('Note supprimée', 'success');
      onClose();
    } catch (e) {
      blocked.current = false;
      toast(groupError(e), 'error');
    }
  };

  const statusText =
    readOnly && status === 'saved' ? `Lecture seule · modifiée par ${nameOf(meta.updatedBy)} ${relativeTime(meta.updatedAt)}` : conflict ? 'En attente : choisis la version à garder' : status === 'saving' ? 'Enregistrement…' : status === 'pending' ? 'Modifications non enregistrées' : status === 'error' ? 'Non enregistré' : `Modifiée par ${nameOf(meta.updatedBy)} ${relativeTime(meta.updatedAt)}`;

  if (!editor) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-1 px-4 pt-5 md:px-10">
        <button className="icon-btn mt-1" onClick={onClose} title="Retour à la liste" aria-label="Retour à la liste">
          <ArrowLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <input
            ref={titleInput}
            value={title}
            readOnly={readOnly}
            // A note just created: its title is the first thing to type.
            autoFocus={!readOnly && startTitle === undefined && !title && !initial.content}
            placeholder="Sans titre"
            aria-label="Titre de la note"
            maxLength={200}
            onChange={e => {
              setTitle(e.target.value);
              titleRef.current = e.target.value;
              changed();
            }}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), editor.commands.focus('start'))}
            className="w-full bg-transparent text-[24px] font-semibold tracking-[-0.02em] outline-none placeholder:text-stone-400"
          />
          <p className={cx('mt-0.5 text-[12px]', conflict ? 'text-amber-700' : status === 'error' ? 'text-red-600' : 'text-stone-500')}>{statusText}</p>
        </div>
        {/* Someone else wrote in it: it can be reported to the administrator. */}
        {(initial.createdBy !== me || meta.updatedBy !== me) && (
          <button className="icon-btn mt-1" title="Signaler la note" aria-label="Signaler la note" onClick={() => setReporting(true)}>
            <Flag size={15} />
          </button>
        )}
        {!readOnly && (
          <button className="icon-btn mt-1 hover:text-red-600" title="Supprimer la note" aria-label="Supprimer la note" onClick={() => void remove()}>
            <Trash2 size={15} />
          </button>
        )}
        <ReportDialog target={reporting ? { kind: 'note', id: initial.id, title: title.trim() || 'Sans titre' } : null} onClose={() => setReporting(false)} />
      </div>

      {gone && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800 md:mx-10">
          <AlertTriangle size={15} className="shrink-0" />
          <span className="flex-1">Un membre a supprimé cette note. Tes dernières modifications ne sont plus enregistrées.</span>
          <button className="btn-secondary h-7 px-2.5" onClick={onClose}>Fermer</button>
        </div>
      )}
      {conflict && !gone && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 md:mx-10">
          <AlertTriangle size={15} className="shrink-0" />
          <span className="min-w-0 flex-1">
            {conflict.updatedBy === me ? 'Tu as modifié cette note ailleurs (autre onglet ou appareil)' : `${nameOf(conflict.updatedBy)} a modifié cette note`} {relativeTime(conflict.updatedAt)} pendant que tu écrivais. Rien n’a été écrasé.
          </span>
          <button className="btn-secondary h-7 px-2.5" onClick={() => loadRemote(conflict)}>{conflict.updatedBy === me ? 'Charger l’autre version' : 'Charger sa version'}</button>
          <button className="btn-primary h-7 px-2.5" onClick={() => void save(true)}>{conflict.updatedBy === me ? 'Garder celle-ci' : 'Garder la mienne'}</button>
        </div>
      )}

      {readOnly ? (
        <div className="mt-3 border-t border-stone-100" />
      ) : (
        <div className="mt-3 border-y border-stone-100 bg-surface px-4 py-1.5 md:px-9">
          <Toolbar editor={editor} />
        </div>
      )}
      <div className="min-h-0 flex-1 cursor-text overflow-y-auto px-4 py-5 md:px-11" onClick={() => !editor.isFocused && editor.commands.focus('end')}>
        <EditorContent editor={editor} onClick={e => e.stopPropagation()} />
      </div>
    </div>
  );
}
