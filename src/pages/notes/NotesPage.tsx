import { lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { flashWhenReady } from '../../lib/flash';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronRight, FilePlus2, FolderPlus, Folder, FolderOpen, FolderInput, FileText, Pencil, Trash2, CopyPlus, Pin, PinOff, Search, ArrowLeft, MoreHorizontal, NotebookPen,
  Paperclip, Printer, FileDown, BookOpenCheck, FlaskConical, ScrollText, GraduationCap, Presentation, Users, X,
  ArrowUpDown, Check, HardDriveUpload, FolderDown,
} from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { useNotes, type Note, type NoteFolder } from '../../store/notes';
import { useGroups } from '../../store/groups';
import { useAuth } from '../../store/auth';
import { createNote as createGroupNote, groupError, summary, type Group } from '../../lib/groups';
import { groupWordsNow } from '../groups/util';
import { askText, confirmAction, toast } from '../../store/ui';
import { ContextMenu, type MenuItem } from '../../components/Overlays';
import { FolderColorPicker } from '../../components/FolderColorPicker';
import { folderIconStyle } from '../../store/drive';
import { useProgressive } from '../../lib/useProgressive';
import { cx, normalize, noteSearchText, noteText, relativeTime } from '../../lib/utils';
import { LinkChips, LinkPicker } from './NoteLinks';
import { noteTemplates, type NoteTemplate } from './templates';
import { downloadMarkdown, exportNotesZip, printNote } from './exportNote';
import { saveNoteToDrive } from './driveBridge';
import { arrowNav, isMenuKey, menuPoint } from '../../lib/a11y';
import { countWords, fileHref, flushNoteEditor, isBlankNote, sortNotes, type NoteSort } from './noteUtils';
import { highlightParts, textSnippet } from '../../lib/textFind';
import { StorageError } from '../../lib/blobStore';
import { isTrashedNote } from '../../lib/trash';
import NoteMoveDialog, { type NoteMoveTarget } from './NoteMoveDialog';
import { takeContentBuffer, takeTitleBuffer } from './titleBuffer';
import { useCreateActions } from '../../store/create';
import type { Editor } from '@tiptap/react';
import { t, tn, locale } from '../../i18n';
import './notes.css';

// The editor (Tiptap) is heavy: load it when a note opens, and ahead of time once the list is idle.
const loadEditor = () => import('./NoteEditor');
const NoteEditor = lazy(loadEditor);

const DRAG_NOTE = 'application/x-cop-note';
const SORT_KEY = 'cop:notes-sort';
const SORTS: { key: NoteSort; label: string }[] = [
  { key: 'modified', label: t('Modifiées récemment') },
  { key: 'created', label: t('Créées récemment') },
  { key: 'title', label: t('Titre (A → Z)') },
];
function readSort(): NoteSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === 'created' || v === 'title' ? v : 'modified';
  } catch {
    return 'modified';
  }
}

/** The date in the list: the time today, « 3 oct. » this year, « 3 oct. 2025 » before. */
// The formats made once (toLocale…String made a new one for each row, on each render of the list).
const formats = new Map<string, Intl.DateTimeFormat>();
const format = (key: string, options: Intl.DateTimeFormatOptions) => {
  const id = `${locale()}|${key}`;
  let f = formats.get(id);
  if (!f) formats.set(id, (f = new Intl.DateTimeFormat(locale(), options)));
  return f;
};

function listDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return format('time', { hour: '2-digit', minute: '2-digit' }).format(d);
  return d.getFullYear() === now.getFullYear() ? format('day', { day: 'numeric', month: 'short' }).format(d) : format('year', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** The words searched for, marked in a result's extract. */
const marked = (text: string, q: string) =>
  highlightParts(text, q).map((p, i) =>
    p.hit ? (
      <mark key={i} className="rounded-sm bg-amber-100 px-px text-ink">
        {p.text}
      </mark>
    ) : (
      p.text
    ),
  );
const DRAG_FOLDER = 'application/x-cop-note-folder';

const TEMPLATE_ICONS: Record<string, typeof FileText> = {
  vide: FileText,
  fiche: BookOpenCheck,
  tp: FlaskConical,
  dissertation: ScrollText,
  cours: GraduationCap,
  expose: Presentation,
};

export default function NotesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { notes, folders } = useNotes();
  const store = useNotes.getState();
  const allGroups = useGroups(s => s.groups);
  const groupMembers = useGroups(s => s.members);
  const me = useAuth(s => s.user?.id);
  const urlNoteId = params.get('note');
  // A note just created is shown at once: the URL (a router transition) can take a few hundred ms,
  // and the first keys typed after « Nouvelle note » must land in its title.
  const [created, setCreated] = useState<string | null>(null);
  useEffect(() => setCreated(null), [urlNoteId]);
  // Fetch the editor while the list is idle, so opening a note stays instant.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    const id = idle(() => void loadEditor(), { timeout: 3000 });
    return () => cancel(id as number);
  }, []);
  const noteId = created ?? urlNoteId;
  const folderParam = params.get('dossier');
  // Arriving on a note from elsewhere (search, Kompaly, a notification): its row in the list glows.
  const [arrivedOn] = useState(urlNoteId);
  useEffect(() => {
    if (arrivedOn) flashWhenReady(() => document.querySelector(`[data-note-open="${CSS.escape(arrivedOn)}"]`)?.parentElement); // its row
  }, [arrivedOn]);
  const active = notes.find(n => n.id === noteId);
  // A computer shows the list and the note side by side: arriving on Notes, the last note changed opens instead of an
  // empty panel (once per visit: closing it afterwards keeps it closed). A phone shows the list first.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || noteId || folderParam || !matchMedia('(min-width: 1024px)').matches) return;
    autoOpened.current = true;
    const last = [...notes].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))[0];
    if (last) setParams({ note: last.id }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // The trash lives on its own page now: old links (and links to a deleted note) go there.
  // Checked when the link changes only, not when the open note is deleted from here.
  const oldTrashLink = params.has('corbeille');
  const toldGone = useRef<string | null>(null); // once per link (effects run twice in dev)
  useEffect(() => {
    if (oldTrashLink) navigate('/corbeille?type=notes', { replace: true });
    else if (noteId && isTrashedNote(noteId)) navigate(`/corbeille?type=notes&apercu=${noteId}`, { replace: true });
    else if (noteId && !useNotes.getState().notes.some(n => n.id === noteId)) {
      // Deleted for good (an old link from Kompaly or a notification): say so instead of a silent page.
      if (toldGone.current !== noteId) toast(t('Cette note n’existe plus'), 'info');
      toldGone.current = noteId;
      navigate('/notes', { replace: true });
    }
  }, [oldTrashLink, noteId, navigate]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folders.map(f => f.id)));
  const [focusFolder, setFocusFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [moving, setMoving] = useState<NoteMoveTarget | null>(null);
  const [sortBy, setSortBy] = useState<NoteSort>(readSort);
  const chooseSort = (by: NoteSort) => {
    setSortBy(by);
    try {
      localStorage.setItem(SORT_KEY, by);
    } catch {
      /* private browsing: the order just isn't remembered */
    }
  };
  // Several notes chosen (Ctrl / Maj + clic, Ctrl+A, a long press on a phone): moved, pinned, exported or trashed together.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selectedIds = notes.filter(n => selected.has(n.id)).map(n => n.id);
  // Focus (and select) the title of a note we just created, once its editor is on screen.
  const focusTitleFor = useRef<string | null>(null);

  /** `q`: words a search found in it, marked in the note once open. */
  const openNote = (id: string | null, q?: string) => {
    setCreated(null);
    setParams(id ? (q ? { note: id, q } : { note: id }) : {});
  };
  const searched = params.get('q') ?? undefined;
  const showNew = (id: string) => {
    focusTitleFor.current = id;
    setCreated(id);
    setParams({ note: id });
  };

  // Links like /notes?dossier=… (from Kompaly or search) reveal that folder.
  useEffect(() => {
    if (!folderParam) return;
    setFocusFolder(folderParam);
    setExpanded(s => new Set([...s, folderParam]));
  }, [folderParam]);

  // Reveal the folder of the opened note.
  useEffect(() => {
    if (active?.folderId) setExpanded(s => (s.has(active.folderId!) ? s : new Set([...s, active.folderId!])));
  }, [active?.folderId]);

  // Blank notes left by a reload or a closed tab go when the page opens (before « + Note » below makes one), except
  // the one the link opens and any touched in the last minute (maybe being written on another device).
  useLayoutEffect(() => {
    const stale = (n: Note) => isBlankNote(n) && n.id !== urlNoteId && Date.now() - Date.parse(n.updatedAt) > 60_000;
    if (useNotes.getState().notes.some(stale)) useNotes.setState(s => ({ notes: s.notes.filter(n => !stale(n)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the page opens
  }, []);

  // Dashboard "+ Note" shortcut (guarded: StrictMode runs effects twice in dev).
  const handledNew = useRef(false);
  const wantsNew = !!params.get('nouvelle');
  useLayoutEffect(() => {
    if (wantsNew && !handledNew.current) {
      handledNew.current = true;
      showNew(useNotes.getState().createNote().id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the link asks for it
  }, [wantsNew]);

  const targetFolder = focusFolder ?? active?.folderId ?? null;

  const newNote = (folderId: string | null = targetFolder, template?: NoteTemplate) => {
    const n = store.createNote({ folderId, title: template?.title, content: template?.html() });
    if (folderId) setExpanded(s => new Set([...s, folderId]));
    showNew(n.id);
  };

  const activeId = active?.id;
  // An empty « Sans titre » note left (another note opened, list shown again, page left) is deleted for good,
  // not trashed: blank notes no longer pile up. Checked once the editor has saved, and only if it was not opened
  // again (effects run twice in dev).
  const openNow = useRef<string | undefined>(undefined);
  useEffect(() => {
    openNow.current = activeId;
    if (!activeId) return;
    return () => {
      openNow.current = undefined;
      setTimeout(() => {
        const n = useNotes.getState().notes.find(x => x.id === activeId);
        if (openNow.current !== activeId && n && isBlankNote(n)) useNotes.setState(s => ({ notes: s.notes.filter(x => x.id !== activeId) }));
      }, 0);
    };
  }, [activeId]);

  // Before paint (no timer): the first letters typed right after the click must land in the title.
  useLayoutEffect(() => {
    if (!activeId || focusTitleFor.current !== activeId) return;
    focusTitleFor.current = null;
    const el = document.getElementById('note-title') as HTMLTextAreaElement | null;
    // Keys typed since « + Note » on another page, while this page was coming up.
    const typed = takeTitleBuffer();
    if (el && typed?.title) {
      el.value = typed.title;
      useNotes.getState().updateNote(activeId, { title: typed.title.trim() || t('Sans titre') });
    }
    if (typed?.toContent) {
      // Enter was pressed after the title: the rest goes to the content, once the editor is there
      // (the hidden field keeps the keys until then).
      const started = Date.now();
      const handOver = () => {
        const editor = (document.querySelector('.prose-note') as (HTMLElement & { editor?: Editor }) | null)?.editor;
        if (!editor) return Date.now() - started < 5000 ? void setTimeout(handOver, 50) : void takeContentBuffer();
        // Focus the editor right now (Tiptap's focus() waits for the next frame): a key typed while the
        // hidden field goes away would otherwise land on <body> and be lost.
        editor.view.focus();
        const chain = editor.chain().focus('end');
        takeContentBuffer()
          .split('\n')
          .forEach((line, i) => {
            if (i) chain.splitBlock();
            if (line) chain.insertContent({ type: 'text', text: line });
          });
        chain.run();
      };
      handOver();
      return;
    }
    el?.focus();
    if (el && typed?.title) el.setSelectionRange(typed.title.length, typed.title.length);
    else el?.select();
  }, [activeId]);

  const templateMenu = (folderId: string | null = targetFolder): MenuItem[] =>
    noteTemplates().map((tpl, i) => {
      const Icon = tpl.icon ?? TEMPLATE_ICONS[tpl.id] ?? FileText;
      return { label: tpl.label, icon: <Icon size={15} />, onClick: () => newNote(folderId, i === 0 ? undefined : tpl) };
    });

  // The « + » button: a note (in the folder chosen, like before), one from a template (its menu over the button), a folder.
  // Not over a note open on a phone (it fills the screen): back to the list for it.
  // One pane (the list, or the note open) on phones, and on phones held sideways (390 px high: two panes left
  // room for two lines of each).
  const narrow = useOnePane();
  useCreateActions(active && narrow ? [] : [
    { label: t('Nouvelle note'), icon: <FilePlus2 />, onClick: () => newNote() },
    {
      label: t('Note depuis un modèle…'),
      icon: <CopyPlus />,
      onClick: () => {
        const r = document.getElementById('create-button')?.getBoundingClientRect();
        if (r) setMenu({ x: r.right, y: r.top - 8, items: templateMenu() });
      },
    },
    { label: t('Nouveau dossier'), icon: <FolderPlus />, onClick: () => void newFolder(null) },
  ]);

  const newFolder = async (parentId: string | null = targetFolder) => {
    const name = await askText(parentId ? t('Nouveau sous-dossier') : t('Nouveau dossier'), t('Nouveau dossier'), t('Créer'), { maxLength: 200 });
    if (name === null) return;
    const f = store.createFolder(name, parentId);
    setExpanded(s => new Set([...s, f.id, ...(parentId ? [parentId] : [])]));
    setFocusFolder(f.id);
  };

  const renameFolder = async (f: NoteFolder) => {
    const name = await askText(t('Renommer le dossier'), f.name, t('Renommer'), { maxLength: 200 });
    if (name) store.renameFolder(f.id, name);
  };

  const renameNote = async (n: Note) => {
    const name = await askText(t('Renommer la note'), n.title, t('Renommer'), { maxLength: 200 });
    if (name) store.updateNote(n.id, { title: name });
  };

  // Deleting moves to the trash: no confirmation, an « Annuler » in the toast instead.
  const isInside = (folderId: string, ancestor: string) => {
    for (let id: string | null = folderId; id; id = folders.find(x => x.id === id)?.parentId ?? null) if (id === ancestor) return true;
    return false;
  };

  // « Annuler » in the toast: the focus goes to what came back, not to <body> with the toast's button.
  const restoreAndFocus = (id: string, kind: 'note' | 'folder') => {
    useNotes.getState().restore([id]);
    setTimeout(() => document.querySelector<HTMLElement>(kind === 'note' ? `[data-note-open="${id}"]` : `[data-folder-open="${id}"]`)?.focus({ preventScroll: true }), 0);
  };

  const deleteFolder = async (f: NoteFolder) => {
    if (!(await confirmAction(t('Mettre le dossier «\u00a0{name}\u00a0» à la corbeille\u00a0?', { name: f.name }), t('Avec ses notes et sous-dossiers. Tu pourras les récupérer dans la corbeille.'), t('Mettre à la corbeille')))) return;
    if (active?.folderId && isInside(active.folderId, f.id)) {
      flushNoteEditor();
      openNote(null);
    }
    if (focusFolder === f.id) setFocusFolder(null);
    // Like a note: the focus goes to the next row of the list (or the previous one) outside the folder.
    const gone = (el: HTMLElement) =>
      el.dataset.folderOpen ? isInside(el.dataset.folderOpen, f.id) : !!notes.find(n => n.id === el.dataset.noteOpen && n.folderId && isInside(n.folderId, f.id));
    const rows = [...document.querySelectorAll<HTMLElement>('[data-folder-open], [data-note-open]')];
    const i = rows.findIndex(r => r.dataset.folderOpen === f.id);
    const next = rows.slice(i + 1).find(r => !gone(r)) ?? rows.slice(0, Math.max(i, 0)).reverse().find(r => !gone(r));
    const nextSel = next ? (next.dataset.folderOpen ? `[data-folder-open="${next.dataset.folderOpen}"]` : `[data-note-open="${next.dataset.noteOpen}"]`) : '#create-button';
    setTimeout(() => document.querySelector<HTMLElement>(nextSel)?.focus({ preventScroll: true }), 0);
    store.removeFolder(f.id);
    toast(t('Mis à la corbeille'), 'info', { label: t('Annuler||l’action'), run: () => restoreAndFocus(f.id, 'folder') });
  };

  // After a deletion the keyboard focus goes to the next note in the list (or the previous one),
  // not to the top of the page.
  const focusNeighbour = (id: string) => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-note-open]')];
    const i = rows.findIndex(r => r.dataset.noteOpen === id);
    const nextId = (rows[i + 1] ?? rows[i - 1])?.dataset.noteOpen;
    // After the next render: the list may only come back on screen then (phones).
    setTimeout(() => {
      const el = nextId ? document.querySelector<HTMLElement>(`[data-note-open="${nextId}"]`) : document.getElementById('create-button');
      el?.focus({ preventScroll: true });
    }, 0);
  };

  const deleteNote = async (n: Note) => {
    if (!(await confirmAction(t('Mettre «\u00a0{name}\u00a0» à la corbeille\u00a0?', { name: n.title.trim() || t('Sans titre') }), t('Tu pourras la récupérer dans la corbeille pendant 30 jours.'), t('Mettre à la corbeille')))) return;
    focusNeighbour(n.id);
    if (n.id === noteId) {
      flushNoteEditor();
      openNote(null);
    }
    store.removeNote(n.id);
    toast(t('Mis à la corbeille'), 'info', { label: t('Annuler||l’action'), run: () => restoreAndFocus(n.id, 'note') });
  };

  // ── Several notes at once ──
  const anchor = useRef<string | null>(null);
  /** The notes of the list, in the order shown. */
  const shownIds = () => [...document.querySelectorAll<HTMLElement>('aside [data-note-open]')].map(el => el.dataset.noteOpen!);
  const clearSelection = () => setSelected(new Set());
  const toggle = (id: string) => {
    anchor.current = id;
    setSelected(sel => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectRange = (id: string) => {
    const order = shownIds();
    const a = order.indexOf(anchor.current ?? id);
    const b = order.indexOf(id);
    if (a < 0 || b < 0) return toggle(id);
    setSelected(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)));
  };
  // The last pointer (a finger: a tap adds to the selection once there is one) and a long press that just selected
  // (the tap that ends it opens nothing).
  const pointer = useRef('mouse');
  const pressed = useRef(false);
  const press = (e: React.PointerEvent, id: string) => {
    pointer.current = e.pointerType;
    if (e.pointerType !== 'touch') return;
    const [x0, y0] = [e.clientX, e.clientY];
    function stop() {
      clearTimeout(timer);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', stop);
      removeEventListener('pointercancel', stop);
    }
    function move(m: PointerEvent) {
      if (Math.hypot(m.clientX - x0, m.clientY - y0) > 10) stop();
    }
    const timer = setTimeout(() => {
      stop();
      pressed.current = true;
      toggle(id);
      navigator.vibrate?.(10);
    }, 450);
    addEventListener('pointermove', move);
    addEventListener('pointerup', stop);
    addEventListener('pointercancel', stop);
  };
  const clickRow = (e: React.MouseEvent, id: string) => {
    if (pressed.current) return void (pressed.current = false);
    if (e.shiftKey && anchor.current) return selectRange(id);
    if (e.metaKey || e.ctrlKey || (selected.size > 0 && pointer.current === 'touch')) return toggle(id);
    if (selected.size) clearSelection();
    anchor.current = id;
    openNote(id);
    setFocusFolder(null);
  };
  const trashSelected = async () => {
    const ids = selectedIds;
    if (!ids.length) return;
    if (!(await confirmAction(tn(ids.length, 'Mettre {n} note à la corbeille ?', 'Mettre {n} notes à la corbeille ?'), t('Tu pourras les récupérer dans la corbeille pendant 30 jours.'), t('Mettre à la corbeille')))) return;
    if (noteId && ids.includes(noteId)) {
      flushNoteEditor();
      openNote(null);
    }
    ids.forEach(id => store.removeNote(id));
    clearSelection();
    toast(tn(ids.length, '{n} note mise à la corbeille', '{n} notes mises à la corbeille'), 'info', { label: t('Annuler||l’action'), run: () => useNotes.getState().restore(ids) });
  };
  const allPinned = selectedIds.length > 0 && selectedIds.every(id => notes.find(n => n.id === id)?.pinned);
  const exportMenu = (roots: string[], name: string): MenuItem[] => [
    { label: t('Markdown (.zip)'), icon: <FileDown size={15} />, onClick: () => (flushNoteEditor(), void exportNotesZip(roots, 'md', name, useNotes.getState())) },
    { label: t('Word (.zip)'), icon: <FileDown size={15} />, onClick: () => (flushNoteEditor(), void exportNotesZip(roots, 'docx', name, useNotes.getState())) },
  ];
  /** Ctrl+A, Échap on the list (not in its search field). */
  const listKeys = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(shownIds()));
    } else if (e.key === 'Escape' && selected.size) {
      e.stopPropagation();
      clearSelection();
    }
  };

  const folderPath = (id: string | null) => {
    const names: string[] = [];
    for (let f = folders.find(x => x.id === id); f; f = folders.find(x => x.id === f!.parentId)) names.unshift(f.name);
    return names.join(' / ');
  };

  const exportPdf = (n: Note) => {
    flushNoteEditor();
    const fresh = useNotes.getState().notes.find(x => x.id === n.id) ?? n;
    printNote(fresh, folderPath(fresh.folderId) || undefined).catch(() => toast(t('Impossible d’ouvrir l’impression'), 'error'));
  };

  const exportMd = (n: Note) => {
    flushNoteEditor();
    downloadMarkdown(useNotes.getState().notes.find(x => x.id === n.id) ?? n);
  };

  // A Word copy at the root of the Drive; the note points to it (the Drive lists it among the file's « Notes liées »).
  const saveToDrive = async (n: Note) => {
    flushNoteEditor();
    const fresh = useNotes.getState().notes.find(x => x.id === n.id) ?? n;
    try {
      const { file, images } = await saveNoteToDrive(fresh);
      if (!file) return;
      store.updateNote(fresh.id, { links: [...(fresh.links ?? []), { kind: 'file', id: file.id }] });
      toast(images ? t('Enregistré dans tes fichiers, sans les images') : t('Enregistré dans tes fichiers'), 'success', { label: t('Voir'), run: () => navigate(fileHref(file)) });
    } catch (e) {
      toast(e instanceof StorageError ? e.message : t('L’enregistrement dans tes fichiers a échoué. Réessaie.'), 'error');
    }
  };

  // « Partager dans un groupe… »: a copy goes to the group, as with the group's own « Partager » (the note stays private).
  // Only the groups already read (online accounts) where I may add notes; the base checks the rights again.
  const shareGroups = allGroups.filter(g => g.kind === 'groupe' && (g.ownerId === me || (groupMembers[g.id]?.find(m => m.userId === me)?.role ?? 'editeur') === 'editeur'));
  const shareToGroup = async (n: Note, g: Group) => {
    flushNoteEditor();
    const fresh = useNotes.getState().notes.find(x => x.id === n.id) ?? n;
    try {
      const copy = await createGroupNote(g.id, fresh.title, fresh.content);
      useGroups.getState().upsertNote(summary(copy));
      toast(t('Note partagée avec {group}', { group: `«\u00a0${g.name}\u00a0»` }), 'success', { label: t('Voir'), run: () => navigate(`/groupes?g=${g.id}&onglet=notes&note=${copy.id}`) });
    } catch (e) {
      toast(groupError(e), 'error');
    }
  };
  // The list of groups opens where the note's menu was.
  const menuAt = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (menu) menuAt.current = { x: menu.x, y: menu.y };
  }, [menu]);
  const shareItems = (n: Note): MenuItem[] =>
    shareGroups.length
      ? [{
          label: t('Partager dans {a}…', { a: groupWordsNow().a }),
          icon: <Users size={15} />,
          onClick: () => setMenu({ ...menuAt.current, items: shareGroups.map(g => ({ label: g.name, icon: <Users size={15} />, onClick: () => void shareToGroup(n, g) })) }),
        }]
      : [];

  const exportItems = (n: Note): MenuItem[] => [
    { label: t('Exporter en PDF'), icon: <Printer size={15} />, onClick: () => exportPdf(n) },
    { label: t('Exporter en Markdown'), icon: <FileDown size={15} />, onClick: () => exportMd(n) },
    { label: t('Enregistrer dans mes fichiers (.docx)'), icon: <HardDriveUpload size={15} />, onClick: () => void saveToDrive(n) },
  ];

  // Keyboard shortcuts shown in the menus, not on touch screens.
  const keyHint = (k: string) => (window.matchMedia('(pointer: coarse)').matches ? undefined : k);

  // `open` false: the menu of the note already open (header), whose title and pin are right beside it:
  // no « Ouvrir », « Renommer » nor « Épingler » there.
  const noteMenu = (n: Note, open = true): MenuItem[] => [
    ...(open ? [
      { label: t('Ouvrir'), icon: <FileText size={15} />, onClick: () => openNote(n.id) },
      { label: t('Renommer'), icon: <Pencil size={15} />, shortcut: keyHint('F2'), onClick: () => void renameNote(n) },
    ] : []),
    { label: t('Dupliquer'), icon: <CopyPlus size={15} />, onClick: () => { const c = store.duplicateNote(n.id); if (c) openNote(c.id); } },
    ...(open ? [{ label: n.pinned ? t('Désépingler') : t('Épingler en haut'), icon: n.pinned ? <PinOff size={15} /> : <Pin size={15} />, onClick: () => store.updateNote(n.id, { pinned: !n.pinned }) }] : []),
    { label: t('Déplacer vers…'), icon: <FolderInput size={15} />, onClick: () => setMoving({ kind: 'note', id: n.id, name: n.title, from: n.folderId }) },
    ...(n.folderId ? [{ label: t('Sortir du dossier'), icon: <FolderOpen size={15} />, onClick: () => store.updateNote(n.id, { folderId: null }) }] : []),
    { label: '', divider: true, onClick: () => {} },
    ...shareItems(n),
    ...exportItems(n),
    { label: '', divider: true, onClick: () => {} },
    { label: t('Supprimer'), icon: <Trash2 size={15} />, shortcut: keyHint(t('Suppr')), danger: true, onClick: () => void deleteNote(n) },
  ];

  // `withNew`: the right-click / keyboard menu; the « … » button has the « Nouvelle note » icon beside it.
  const folderMenu = (f: NoteFolder, withNew = true): MenuItem[] => [
    ...(withNew ? [{ label: t('Nouvelle note ici'), icon: <FilePlus2 size={15} />, onClick: () => newNote(f.id) }] : []),
    { label: t('Nouveau sous-dossier'), icon: <FolderPlus size={15} />, onClick: () => void newFolder(f.id) },
    { label: t('Renommer'), icon: <Pencil size={15} />, shortcut: keyHint('F2'), onClick: () => void renameFolder(f) },
    { label: t('Déplacer vers…'), icon: <FolderInput size={15} />, onClick: () => setMoving({ kind: 'folder', id: f.id, name: f.name, from: f.parentId }) },
    ...(f.parentId ? [{ label: t('Remonter à la racine'), icon: <FolderOpen size={15} />, onClick: () => store.moveFolder(f.id, null) }] : []),
    { label: t('Exporter le dossier…'), icon: <FolderDown size={15} />, onClick: () => setMenu({ ...menuAt.current, items: exportMenu([f.id], f.name) }) },
    { label: '', divider: true, onClick: () => {} },
    {
      label: t('Couleur du dossier'),
      onClick: () => {},
      content: <FolderColorPicker value={f.color ?? null} defaultColor="var(--color-stone-500)" onPick={key => { store.setFolderColor(f.id, key ?? undefined); setMenu(null); }} />,
    },
    { label: '', divider: true, onClick: () => {} },
    { label: t('Supprimer'), icon: <Trash2 size={15} />, shortcut: keyHint(t('Suppr')), danger: true, onClick: () => void deleteFolder(f) },
  ];

  /** Keys shared by the note and folder rows: arrows move between rows, Suppr puts in the trash, F2 renames. */
  const rowKeys = (e: React.KeyboardEvent<HTMLElement>, remove: () => void, rename: () => void) => {
    if (arrowNav(e, e.currentTarget.closest('aside')!, '[data-folder-open], [data-note-open]')) return;
    if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); remove(); }
    else if (e.key === 'F2') { e.preventDefault(); rename(); }
  };

  /** A menu opened from a « … » button: under it, right-aligned (clientX is 0 from the keyboard). */
  const menuUnder = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.right - 208, y: r.bottom + 4 };
  };

  const sortList = (list: Note[]) => sortNotes(list, sortBy, locale());

  // ── Drag & drop (notes and folders into folders) ─────
  const dragOver = (key: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_NOTE) && !e.dataTransfer.types.includes(DRAG_FOLDER)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropOn(key);
  };
  const dropProps = (folderId: string | null, key: string) => ({
    onDragOver: dragOver(key),
    onDragLeave: () => setDropOn(d => (d === key ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropOn(null);
      const nid = e.dataTransfer.getData(DRAG_NOTE);
      const fid = e.dataTransfer.getData(DRAG_FOLDER);
      // Dropped where it already is: nothing changes (not even its « modifiée » date).
      if (nid && useNotes.getState().notes.find(n => n.id === nid)?.folderId !== folderId) store.updateNote(nid, { folderId });
      if (fid && fid !== folderId) store.moveFolder(fid, folderId);
      if (folderId) setExpanded(s => new Set([...s, folderId]));
    },
  });
  const q = normalize(query);
  const results = useMemo(
    () => (q ? sortNotes(notes.filter(n => noteSearchText(n).includes(q)), sortBy, locale()) : []),
    [q, notes, sortBy],
  );

  // The row's main part and its « … » button are siblings: no button nested in a button.
  // Hundreds of notes: the first rows of the list at once, the others right after (useProgressive).
  let noteRows = useProgressive(notes.length, 60);
  // What a row does, read when it happens: the rows stay memoised (only the one that changed re-renders).
  const rowActions = useRef<RowActions>(null!);
  rowActions.current = {
    open: id => {
      openNote(id);
      setFocusFolder(null);
    },
    click: clickRow,
    press,
    // A long press of a finger selects (Android also calls it a right click): no menu then.
    menuAt: (e, n) => (e.type === 'contextmenu' && pointer.current === 'touch' ? undefined : setMenu({ ...menuPoint(e), items: noteMenu(n) })),
    menuUnder: (e, n) => setMenu({ ...menuUnder(e), items: noteMenu(n) }),
    // Suppr on one of several notes chosen: all of them.
    keys: (e, n) => rowKeys(e, () => void (selected.size > 1 && selected.has(n.id) ? trashSelected() : deleteNote(n)), () => void renameNote(n)),
  };
  const selecting = selected.size > 0;
  const renderNote = (n: Note, depth: number) =>
    noteRows-- <= 0 ? null : <NoteRow key={n.id} note={n} depth={depth} active={n.id === noteId} selected={selected.has(n.id)} selecting={selecting} created={sortBy === 'created'} actions={rowActions} />;

  const renderFolder = (f: NoteFolder, depth: number): React.ReactNode => {
    const open = expanded.has(f.id);
    const kids = folders.filter(x => x.parentId === f.id).sort((a, b) => a.name.localeCompare(b.name, locale()));
    const fnotes = sortList(notes.filter(n => n.folderId === f.id));
    return (
      <div key={f.id}>
        <div
          draggable
          onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData(DRAG_FOLDER, f.id); }}
          {...dropProps(f.id, f.id)}
          onContextMenu={e => { e.preventDefault(); setMenu({ ...menuPoint(e), items: folderMenu(f) }); }}
          className={cx(
            'note-folder group flex h-8 items-center gap-0.5 rounded-md pr-1 text-[13px] font-medium transition-colors pointer-coarse:h-9',
            dropOn === f.id ? 'bg-brand-50 ring-1 ring-brand-500' : focusFolder === f.id ? 'bg-stone-100 text-ink' : 'text-stone-700 hover:bg-stone-50',
          )}
        >
          <div
            data-folder-open={f.id}
            onClick={() => {
              setFocusFolder(f.id);
              setExpanded(s => {
                const n = new Set(s);
                if (n.has(f.id)) n.delete(f.id);
                else n.add(f.id);
                return n;
              });
            }}
            onDoubleClick={() => void renameFolder(f)}
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onKeyDown={e => {
              if (isMenuKey(e)) { e.preventDefault(); setMenu({ ...menuPoint(e), items: folderMenu(f) }); }
              else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); }
              else rowKeys(e, () => void deleteFolder(f), () => void renameFolder(f));
            }}
            className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md"
            style={{ paddingLeft: 4 + depth * 16 }}
          >
            <ChevronRight size={13} className={cx('shrink-0 text-stone-400 transition-transform', open && 'rotate-90')} />
            {(() => {
              const Icon = open ? FolderOpen : Folder;
              const style = folderIconStyle(f.color);
              return <Icon size={15} className={cx('shrink-0', !style && 'text-stone-500')} style={style} />;
            })()}
            <span className="flex-1 truncate" title={f.name}>{f.name}</span>
          </div>
          {/* Shown on hover, and always on touch screens (no hover there). */}
          <button
            className="icon-btn hidden h-6 w-6 group-hover:inline-flex [@media(hover:none)]:inline-flex pointer-coarse:h-9 pointer-coarse:w-9"
            tabIndex={-1}
            title={t('Nouvelle note dans ce dossier')}
            aria-label={t('Nouvelle note dans «\u00a0{name}\u00a0»', { name: f.name })}
            onClick={() => newNote(f.id)}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            className="icon-btn hidden h-6 w-6 group-hover:inline-flex [@media(hover:none)]:inline-flex pointer-coarse:h-9 pointer-coarse:w-9"
            tabIndex={-1}
            title={t('Plus d’actions')}
            aria-label={t('Plus d’actions pour «\u00a0{name}\u00a0»', { name: f.name })}
            onClick={e => setMenu({ ...menuUnder(e), items: folderMenu(f, false) })}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
        {open && (
          <div>
            {kids.map(k => renderFolder(k, depth + 1))}
            {fnotes.map(n => renderNote(n, depth + 1))}
            {kids.length === 0 && fnotes.length === 0 && (
              <p className="py-1.5 text-[12px] text-stone-500" style={{ paddingLeft: 30 + depth * 16 }}>
                {t('Dossier vide')}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  // Phones: the header folds into one line while the text is scrolled down, or while typing in it (keyboard open):
  // back, title, links and the toolbar took a third of the screen above the text.
  const [scrolledDown, setScrolledDown] = useState(false);
  const [typing, setTyping] = useState(false);
  const lastY = useRef(0);
  const [foldedFor, setFoldedFor] = useState(activeId);
  if (foldedFor !== activeId) {
    setFoldedFor(activeId);
    setScrolledDown(false);
  }
  const folded = scrolledDown || typing;
  const onTextScroll = (e: React.UIEvent) => {
    const el = e.target as HTMLElement;
    if (!el.hasAttribute('data-note-scroll') || !matchMedia(ONE_PANE).matches) return;
    const y = el.scrollTop;
    if (y > lastY.current + 6 && y > 48) setScrolledDown(true);
    else if (y < lastY.current - 6 || y < 8) setScrolledDown(false);
    lastY.current = y;
  };
  // The header folding as the keyboard opens moved the text up under the finger: the line being typed in stays where
  // it was on the screen (its height before the fold, the text scrolled back by as much just after).
  const caretTop = useRef<number | null>(null);
  useLayoutEffect(() => {
    const before = caretTop.current;
    caretTop.current = null;
    // Nothing kept (the page opening…): no measure (it forced the page's layout in the middle of its first render).
    if (before === null) return;
    const now = selectionTop();
    const box = document.querySelector<HTMLElement>('[data-note-scroll]');
    if (now === null || !box) return;
    box.scrollTop += now - before;
    lastY.current = box.scrollTop; // not a scroll of the reader's: the header doesn't unfold for it
  }, [typing]);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !activeId) return;
    const check = () => {
      const next = matchMedia(ONE_PANE).matches && !!document.activeElement?.closest('.prose-note') && vv.height < window.innerHeight * 0.8;
      setTyping(was => {
        if (was !== next) caretTop.current = selectionTop();
        return next;
      });
    };
    vv.addEventListener('resize', check);
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    return () => {
      vv.removeEventListener('resize', check);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
    };
  }, [activeId]);
  const activeText = active ? noteText(active) : '';
  const words = countWords(activeText);

  const rootFolders = folders.filter(f => f.parentId === null).sort((a, b) => a.name.localeCompare(b.name, locale()));
  const rootNotes = sortList(notes.filter(n => n.folderId === null));
  const mainOpen = !!active;

  return (
    <div className="mx-auto w-full max-w-[1244px] flex h-full gap-4 px-4 pb-4 md:px-8">
      {/* A note open on a phone hides the list and its title: the page keeps one for screen readers. */}
      {mainOpen && <h1 className="sr-only [@media(min-width:768px)_and_(min-height:501px),(min-width:1024px)]:hidden">{t('Notes')}</h1>}
      {/* Sidebar */}
      {/* Fingers (tablets): a little wider, the search's 16 px text (no zoom on iPhone) whole in its field. */}
      <aside className={cx('w-full shrink-0 flex-col [@media(min-width:768px)_and_(min-height:501px),(min-width:1024px)]:flex [@media(min-width:768px)_and_(min-height:501px),(min-width:1024px)]:w-[268px] [@media(min-width:768px)_and_(min-height:501px),(min-width:1024px)]:pointer-coarse:w-[300px]', mainOpen ? 'hidden' : 'flex')} onKeyDown={listKeys} onPointerDownCapture={e => (pointer.current = e.pointerType)}>
        <div className="page-head mb-2 flex items-center gap-1.5 short:mb-0 short:py-1">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{t('Notes')}</h1>
        </div>
        {selectedIds.length > 0 ? (
          <div className="enter mb-2 flex h-10 shrink-0 items-center gap-0.5 rounded-lg bg-inverse px-1 text-on-inverse shadow-pop pointer-coarse:h-11">
            {(() => {
              const barBtn = 'flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-on-inverse/85 hover:bg-on-inverse/10 hover:text-on-inverse pointer-coarse:h-9 pointer-coarse:w-9';
              const name = tn(selectedIds.length, '{n} note', '{n} notes');
              return (
                <>
                  <button className={barBtn} onClick={clearSelection} title={t('Désélectionner (Échap)')} aria-label={t('Désélectionner (Échap)')}>
                    <X size={15} />
                  </button>
                  {/* The narrowest phones: the number alone (four buttons beside it), the words for screen readers. */}
                  <span className="tabular mr-auto truncate px-1 text-[13px] font-medium" role="status">
                    <span aria-hidden className="min-[360px]:hidden">{selectedIds.length}</span>
                    <span className="max-[359px]:sr-only">{tn(selectedIds.length, '{n} sélectionnée', '{n} sélectionnées')}</span>
                  </span>
                  <button className={barBtn} onClick={() => setMoving({ kind: 'notes', ids: selectedIds, name, from: null })} title={t('Déplacer vers…')} aria-label={t('Déplacer vers…')}>
                    <FolderInput size={15} />
                  </button>
                  <button className={barBtn} onClick={() => selectedIds.forEach(id => store.updateNote(id, { pinned: !allPinned }))} title={allPinned ? t('Désépingler') : t('Épingler')} aria-label={allPinned ? t('Désépingler') : t('Épingler')}>
                    {allPinned ? <PinOff size={15} /> : <Pin size={15} />}
                  </button>
                  <button className={barBtn} onClick={e => setMenu({ ...menuUnder(e), items: exportMenu(selectedIds, t('Notes')) })} title={t('Exporter')} aria-label={t('Exporter')} aria-haspopup="menu">
                    <FileDown size={15} />
                  </button>
                  <button className={barBtn} onClick={() => void trashSelected()} title={t('Mettre à la corbeille')} aria-label={t('Mettre à la corbeille')}>
                    <Trash2 size={15} />
                  </button>
                </>
              );
            })()}
          </div>
        ) : (
          <div className="mb-2 flex gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Rechercher dans les notes')} aria-label={t('Rechercher dans les notes')} className="field w-full pl-8" />
            </div>
            <button
              className="icon-btn h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11"
              title={t('Trier')}
              aria-label={t('Trier (actuellement : {order})', { order: SORTS.find(x => x.key === sortBy)!.label })}
              aria-haspopup="menu"
              onClick={e => setMenu({ ...menuUnder(e), items: SORTS.map(x => ({ label: x.label, icon: x.key === sortBy ? <Check size={15} /> : <ArrowUpDown size={15} className="opacity-0" />, onClick: () => chooseSort(x.key) })) })}
            >
              <ArrowUpDown size={16} />
            </button>
          </div>
        )}
        <div
          className={cx('notes-list min-h-0 flex-1 overflow-y-auto rounded-lg p-1 pb-room', dropOn === 'root' && 'ring-1 ring-brand-500')}
          {...dropProps(null, 'root')}
          onClick={() => setFocusFolder(null)}
        >
          {q ? (
            results.length ? (
              // Each one with the words found, in its title or in an extract of its text (and marked once open).
              results.map(n => {
                const extract = textSnippet(noteText(n), query, 24, 80);
                return (
                  <button key={n.id} onClick={() => openNote(n.id, query.trim())} title={n.title} className={cx('block w-full rounded-md px-2.5 py-2 text-left hover:bg-stone-50', n.id === noteId && 'bg-stone-100')}>
                    <p className="truncate text-[13px] font-medium">{marked(n.title, query)}</p>
                    <p className="line-clamp-2 text-[12px] leading-snug text-stone-500">{extract ? marked(extract, query) : noteText(n).slice(0, 160) || t('Note vide')}</p>
                  </button>
                );
              })
            ) : (
              <EmptyState size="sm" tone="search" title={t('Aucun résultat pour « {q} »', { q: query.trim() })} action={{ label: t('Effacer la recherche'), icon: X, onClick: () => setQuery('') }} />
            )
          ) : (
            <div onClick={e => e.stopPropagation()}>
              {rootFolders.map(f => renderFolder(f, 0))}
              {rootNotes.length > 0 && rootFolders.length > 0 && <div className="mx-2 my-2 h-px bg-stone-200/70" />}
              {rootNotes.map(n => renderNote(n, 0))}
              {notes.length === 0 && folders.length === 0 && (
                // Its own button (not only the floating « + », which some never found).
                <EmptyState size="sm" icon={NotebookPen} title={t('Aucune note pour l’instant.')} action={{ label: t('Nouvelle note'), icon: FilePlus2, onClick: () => newNote() }} preview="list" />
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Editor */}
      <section className={cx('notes-editor card @container min-w-0 flex-1 flex-col overflow-hidden [@media(min-width:768px)_and_(min-height:501px),(min-width:1024px)]:mt-2', mainOpen ? 'flex' : 'hidden [@media(min-width:768px)_and_(min-height:501px),(min-width:1024px)]:flex')} onScrollCapture={onTextScroll}>
        {active ? (
          <>
            {/* A narrow editor (phones, tablets, a laptop with the menu and the list): the actions sit above the title, which gets
                the whole width (it was 173 px wide at 768, and cut in two lines at 1024). */}
            <div className={cx('flex flex-wrap items-start gap-1 px-4 pt-6 md:px-12 @max-2xl:pt-4', folded && '[@media(max-width:767px),(max-height:500px)_and_(max-width:1023px)]:flex-nowrap [@media(max-width:767px),(max-height:500px)_and_(max-width:1023px)]:items-center [@media(max-width:767px),(max-height:500px)_and_(max-width:1023px)]:pb-1 [@media(max-width:767px),(max-height:500px)_and_(max-width:1023px)]:pt-1.5')}>
              <button className="icon-btn mt-1 [@media(min-width:768px)_and_(min-height:501px),(min-width:1024px)]:hidden" onClick={() => openNote(null)} title={t('Retour')} aria-label={t('Retour')}>
                <ArrowLeft size={17} />
              </button>
              {folded && (
                <button className="mt-1 min-w-0 flex-1 truncate text-left text-[15px] font-semibold [@media(min-width:768px)_and_(min-height:501px),(min-width:1024px)]:hidden" onClick={() => (setScrolledDown(false), setTyping(false))} aria-label={t('Afficher l’en-tête de la note')}>
                  {active.title}
                </button>
              )}
              <div className={cx('order-last w-full min-w-0 @2xl:order-none @2xl:w-auto @2xl:flex-1', folded && '[@media(max-width:767px),(max-height:500px)_and_(max-width:1023px)]:hidden')}>
                <NoteTitle key={active.id} note={active} />
                {/* A long folder name ends with « … », the time stays whole. */}
                <p className="mt-1 flex min-w-0 text-[12px] text-stone-500">
                  <span className="min-w-12 truncate">{folders.find(f => f.id === active.folderId)?.name ?? t('Sans dossier')}</span>
                  <span className="shrink-0 whitespace-nowrap">&nbsp;· {t('modifiée {time}', { time: relativeTime(active.updatedAt) })}</span>
                  {/* Discreet: how long the note is (characters in a wide editor; nothing on the smallest phones). */}
                  <span className="shrink-0 whitespace-nowrap @max-[22rem]:hidden">
                    &nbsp;· {tn(words, '{n} mot', '{n} mots')}
                    <span className="@max-xl:hidden">&nbsp;· {tn([...activeText].length, '{n} caractère', '{n} caractères')}</span>
                  </span>
                </p>
                <LinkChips note={active} />
              </div>
              <button className="btn-ghost mt-0.5 ml-auto h-8 px-2.5 @2xl:ml-0 pointer-coarse:min-w-9" title={t('Lier à des fichiers ou des événements')} onClick={() => setLinking(true)}>
                <Paperclip size={15} /> <span className="hidden sm:inline">{t('Lier…')}</span>
              </button>
              <button className="icon-btn mt-0.5" title={active.pinned ? t('Désépingler') : t('Épingler')} aria-label={active.pinned ? t('Désépingler') : t('Épingler')} onClick={() => store.updateNote(active.id, { pinned: !active.pinned })}>
                {active.pinned ? <PinOff size={15} /> : <Pin size={15} />}
              </button>
              <button className="icon-btn mt-0.5" title={t('Plus')} aria-label={t('Plus')} onClick={e => setMenu({ ...menuUnder(e), items: noteMenu(active, false) })}>
                <MoreHorizontal size={16} />
              </button>
            </div>
            <Suspense fallback={<div className="flex-1" />}>
              <NoteEditor key={active.id} note={active} highlight={searched} />
            </Suspense>
            <LinkPicker note={active} open={linking} onClose={() => setLinking(false)} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <NotebookPen size={28} strokeWidth={1.5} className="text-stone-300" />
            {/* Nothing at all: the list already says so (and the « + » button offers the templates). Folders only: said here. */}
            {(notes.length > 0 || folders.length > 0) && <p className="mt-3 text-[13px] text-stone-500">{notes.length > 0 ? t('Choisis une note.') : t('Aucune note pour l’instant.')}</p>}
            {notes.length === 0 && folders.length > 0 && (
              <button type="button" className="btn-secondary mt-3" onClick={() => newNote()}>
                <FilePlus2 size={15} /> {t('Nouvelle note')}
              </button>
            )}
          </div>
        )}
      </section>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {moving && <NoteMoveDialog target={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

/**
 * The open note's title. Typed freely (not re-rendered at each key), but follows a rename made
 * elsewhere (menu, list) when it doesn't have the focus, or the next key would bring the old name back.
 * On several lines when it's long: a one-line field cut a long title after a few words on phones.
 */
interface RowActions {
  open: (id: string) => void;
  click: (e: React.MouseEvent, id: string) => void;
  press: (e: React.PointerEvent, id: string) => void;
  menuAt: (e: React.MouseEvent | React.KeyboardEvent, n: Note) => void;
  menuUnder: (e: React.MouseEvent, n: Note) => void;
  keys: (e: React.KeyboardEvent<HTMLElement>, n: Note) => void;
}

/**
 * A note in the list, with its date and the start of its text: re-rendered only when its note or its state changes
 * (hundreds of them). `created`: the list is in the order the notes were made (that date is shown).
 */
const NoteRow = memo(function NoteRow({ note: n, depth, active, selected, selecting, created, actions }: { note: Note; depth: number; active: boolean; selected: boolean; selecting: boolean; created: boolean; actions: RefObject<RowActions> }) {
  return (
    <div
      draggable
      onDragStart={e => e.dataTransfer.setData(DRAG_NOTE, n.id)}
      onContextMenu={e => { e.preventDefault(); actions.current.menuAt(e, n); }}
      className={cx(
        'list-row group flex select-none items-center gap-1 rounded-md pr-1 text-[13px] transition-colors [-webkit-touch-callout:none]',
        selected ? 'bg-brand-50 text-ink ring-1 ring-inset ring-brand-200' : active ? 'bg-stone-100 text-ink' : 'text-stone-600 hover:bg-stone-50 hover:text-ink',
      )}
    >
      <div
        data-note-open={n.id}
        onClick={e => actions.current.click(e, n.id)}
        onPointerDown={e => actions.current.press(e, n.id)}
        role="button"
        tabIndex={0}
        title={n.title}
        aria-current={active ? 'page' : undefined}
        aria-pressed={selecting ? selected : undefined}
        onKeyDown={e => {
          if (isMenuKey(e)) { e.preventDefault(); actions.current.menuAt(e, n); }
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.current.open(n.id); }
          else actions.current.keys(e, n);
        }}
        className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md py-1.5"
        style={{ paddingLeft: 10 + depth * 16 }}
      >
        {selecting ? (
          <span aria-hidden className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px]', selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-300')}>
            {selected && <Check size={10} strokeWidth={3.5} />}
          </span>
        ) : (
          <FileText size={14} className="mt-[3px] shrink-0 text-stone-400" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cx('note-row-title flex-1 truncate', active && 'font-medium')}>{n.title}</span>
            {n.pinned && <Pin size={11} className="shrink-0 text-stone-400" aria-label={t('Épinglée')} />}
            <span className="note-row-date tabular shrink-0 text-[11px] text-stone-500">{listDate(created ? n.createdAt : n.updatedAt)}</span>
          </span>
          <span className="note-row-text block truncate text-[12px] leading-snug text-stone-500">{noteText(n) || t('Note vide')}</span>
        </span>
      </div>
      <button
        className="icon-btn touch-show h-6 w-6 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:h-9 pointer-coarse:w-9"
        tabIndex={-1}
        title={t('Plus d’actions')}
        aria-label={t('Plus d’actions pour «\u00a0{name}\u00a0»', { name: n.title })}
        onClick={e => actions.current.menuUnder(e, n)}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>);
});

function NoteTitle({ note }: { note: Note }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const shown = note.title === 'Sans titre' || note.title === t('Sans titre') ? '' : note.title;
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.value.trim() !== shown) el.value = shown;
    fit();
  }, [shown]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      id="note-title"
      rows={1}
      defaultValue={shown}
      maxLength={200}
      placeholder={t('Sans titre')}
      aria-label={t('Titre de la note')}
      onChange={e => {
        // One line of text, even when pasted with line breaks.
        if (/[\r\n]/.test(e.target.value)) e.target.value = e.target.value.replace(/[\r\n]+/g, ' ');
        fit();
        useNotes.getState().updateNote(note.id, { title: e.target.value.trim() || t('Sans titre') });
      }}
      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), document.querySelector<HTMLElement>('.prose-note')?.focus())}
      className="block w-full resize-none overflow-hidden bg-transparent hyphens-auto pointer-coarse:py-1 text-[22px] font-semibold md:text-[26px] leading-[1.25] tracking-[-0.02em] outline-none placeholder:text-stone-500"
    />
  );
}

/** Where the caret of the note being typed in is on the screen (null: not in the note). */
function selectionTop(): number | null {
  const sel = window.getSelection();
  const node = sel?.rangeCount ? sel.focusNode : null;
  const el = node instanceof HTMLElement ? node : node?.parentElement;
  if (!sel || !el?.closest('.prose-note')) return null;
  const r = sel.getRangeAt(0).getClientRects()[0];
  return r && r.height > 0 ? r.top : el.getBoundingClientRect().top;
}

/** Phones, upright or sideways: the list and the note open take turns on the screen. */
const ONE_PANE = '(max-width: 767px), (max-height: 500px) and (max-width: 1023px)';
const onePane = typeof window !== 'undefined' ? window.matchMedia(ONE_PANE) : null;
const onOnePane = (f: () => void) => {
  onePane?.addEventListener('change', f);
  return () => onePane?.removeEventListener('change', f);
};
function useOnePane() {
  return useSyncExternalStore(onOnePane, () => onePane?.matches ?? false);
}
