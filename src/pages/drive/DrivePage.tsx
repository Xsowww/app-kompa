import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronRight, ClipboardPaste, Copy, CopyPlus, Download, Eye, FolderInput, FolderPlus, FolderUp, HardDrive, LayoutGrid,
  List, Pencil, Scissors, Star, Trash2, Upload, Clock, ArrowUpDown, ArrowUp, ArrowDown, X, MousePointer2, Search, Tag, Link2, Check, Palette,
  MoreHorizontal, ChevronUp, ClipboardList, BookOpenCheck, FolderOpen, WifiOff, FolderDown, ScanText, NotebookPen, Users,
} from 'lucide-react';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import {
  useDrive, childrenOf, pathOf, categoryOf, folderSize, FOLDER_COLORS, type DriveItem,
  pasteForbidden, keepExtension,
} from '../../store/drive';
import { askText, confirmAction, toast, useUi } from '../../store/ui';
import { canMakeFrom, makeFromFile, useRecLive } from '../../store/recorder';
import { useRecWords } from '../record/words';
import { formatBytes, relativeTime, cx } from '../../lib/utils';
import { fold, highlightParts, searchFileContents, startTextIndexing, type ContentMatch } from '../../lib/textIndex';
import FileIcon from '../../components/FileIcon';
import { FileButtons } from '../../components/UploadCard';
import { FolderColorPicker } from '../../components/FolderColorPicker';
import { ContextMenu, type MenuItem } from '../../components/Overlays';
import PreviewModal from './PreviewModal';
import FileThumb from './FileThumb';
import { thumbKey } from './thumbs';
import { canOpenAsNote, openFileAsNote } from '../notes/driveBridge';
import { useNotes } from '../../store/notes';
import StorageGauge from './StorageGauge';
import { downloadItem, downloadZip } from './download';
import PhotoSheetDialog from './PhotoSheetDialog';
import { usePhotoReady } from './photoReady';
import MoveDialog from './MoveDialog';
import ShareDialog from './ShareDialog';
import ShareToGroupDialog from '../groups/ShareToGroup';
import { useGroups } from '../../store/groups';
import { groupWordsNow } from '../groups/util';
import TagDialog, { TagPill } from './TagDialog';
import { filesFromDrop, filesFromInput, pastedFiles, uploadPending } from './upload';
import { isMenuKey, keepFocus, menuPoint } from '../../lib/a11y';
import { isTrashedDriveItem } from '../../lib/trash';
import { StorageError } from '../../lib/blobStore';
import { cloudEnabled } from '../../lib/supabase';
import { useProgressive } from '../../lib/useProgressive';
import { useShallow } from 'zustand/react/shallow';
import { driveWhere, isUploadAbort, notOver, useUploads } from '../../store/uploads';
import { useCreateActions } from '../../store/create';
import { t, tn, locale } from '../../i18n';
import { useTouchDrag } from './touchGestures';
import './drive.css';

type Tab = 'all' | 'starred' | 'recent';
type SortKey = 'name' | 'date' | 'size';
type Sort = { key: SortKey; asc: boolean };
const SORT_LABELS: Record<SortKey, string> = { name: t('Nom'), date: t('Modifié'), size: t('Taille') };
/** The same, inside a sentence (« Trier par nom »). */
const SORT_NAMES: Record<SortKey, string> = { name: t('nom'), date: t('modifié'), size: t('taille') };

const DRAG_MIME = 'application/x-cop-drive';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : `${t('Ctrl')} + `;
/** The trash key: Suppr, or ⌘⌫ on a Mac (⌫ alone goes up to the parent folder). */
const DEL = isMac ? '⌘⌫' : t('Suppr');

/** Two taps on the same item within this time: a double tap (it opens). */
const DOUBLE_TAP = 400;

const folderColor = (item: DriveItem) => (item.color ? FOLDER_COLORS[item.color]?.color : undefined);

/**
 * The picture under the pointer or the finger while dragging: a small opaque chip (its icon, its name, how many), round,
 * nothing see-through. A copy of the tile itself was see-through (glass colours, the page behind its corners) and, placed
 * off screen, came out as a black square in Safari and on phones.
 */
function dragGhost(tile: HTMLElement | null, name: string, n: number): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'drive-ghost';
  // The item's own picture (not the tick of selection mode, nor « ⋯ »).
  const icon = tile?.querySelector('[data-thumb] img, [data-thumb] svg');
  if (icon) {
    const pic = icon.cloneNode(true) as HTMLElement;
    pic.removeAttribute('class');
    pic.setAttribute('width', '22');
    pic.setAttribute('height', '22');
    ghost.appendChild(pic);
  }
  const label = document.createElement('span');
  label.textContent = name;
  ghost.appendChild(label);
  if (n > 1) {
    const count = document.createElement('b');
    count.textContent = String(n);
    ghost.appendChild(count);
  }
  return ghost;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-px text-ink">
            {p.text}
          </mark>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

function readSort(): Sort {
  const [key, dir] = readPref('cop:drive-sort', 'name:asc').split(':');
  return { key: key in SORT_LABELS ? (key as SortKey) : 'name', asc: dir !== 'desc' };
}

/** Folders first, then by the chosen column. */
function sortItems(items: DriveItem[], list: DriveItem[], sort: Sort) {
  const dir = sort.asc ? 1 : -1;
  const size = (i: DriveItem) => (i.kind === 'folder' ? folderSize(items, i.id) : (i.size ?? 0));
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    if (sort.key === 'date') return dir * a.updatedAt.localeCompare(b.updatedAt);
    if (sort.key === 'size') return dir * (size(a) - size(b));
    return dir * a.name.localeCompare(b.name, locale(), { numeric: true });
  });
}

const CANT_COPY_INTO_ITSELF = t('Impossible de copier un dossier dans lui-même ou dans un de ses sous-dossiers.');
const alreadyThere = (n: number) => (n > 1 ? t('Ces éléments sont déjà dans ce dossier') : t('Cet élément est déjà dans ce dossier'));

export default function DrivePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const folderId = params.get('dossier');
  const previewId = params.get('fichier');
  const drive = useDrive();
  const { items, clipboard } = drive;

  const [tab, setTab] = useState<Tab>('all');
  const [view, setView] = useState<'grid' | 'list'>(() => readPref('cop:drive-view', 'grid'));
  // Mon Drive / Favoris sort, remembered; Récents and search results have their own, reset each time.
  const [sort, setSort] = useState<Sort>(readSort);
  const [listSort, setListSort] = useState<Sort | null>(null);
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  // `bar`: opened from « Plus d’actions » of the selection bar, which already shows some actions.
  const [menu, setMenu] = useState<{ x: number; y: number; target: string | null; bar?: boolean } | null>(null);
  const making = useRecLive(s => s.making);
  const rec = useRecWords();
  const [colorMenu, setColorMenu] = useState<{ x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | 'here' | null>(null);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [contentHits, setContentHits] = useState<Map<string, ContentMatch>>(new Map());
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[] | null>(null);
  const [shareItem, setShareItem] = useState<DriveItem | null>(null);
  const [groupShare, setGroupShare] = useState<DriveItem[] | null>(null);
  // Item holding the list's single Tab stop (arrows move it).
  const [focusId, setFocusId] = useState<string | null>(null);
  // Last pointer was a finger. A phone or a tablet starts so (its first tap must already follow the finger's rules): a
  // tap only points at an item, a double tap opens it, a long press selects it (selection mode, where each tap adds or
  // removes one), a long press then a move drags it (touchGestures). Its menu is under « ⋯ ».
  const [touchMode, setTouchMode] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  // An item is being dragged: keep the breadcrumb (drop targets) instead of the selection bar.
  const [dragging, setDragging] = useState(false);
  // What a finger drags (dimmed in place), and the item a finger's tap points at outside selection mode.
  const [dragged, setDragged] = useState<Set<string>>(new Set());
  const [tapped, setTapped] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef(touchMode);
  useEffect(() => {
    touchRef.current = touchMode;
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const current = folderId ? items.find(i => i.id === folderId && i.kind === 'folder') : undefined;
  const parentId = current?.id ?? null;
  const breadcrumb = pathOf(items, parentId);
  const previewItem = previewId ? items.find(i => i.id === previewId && i.kind === 'file') : undefined;

  const q = query.trim();
  const allTags = useMemo(() => [...new Set(items.flatMap(i => i.tags ?? []))].sort((a, b) => a.localeCompare(b, locale())), [items]);
  const activeTag = tagFilter && allTags.includes(tagFilter) ? tagFilter : null;
  const filtering = !!q || !!activeTag;
  // Files on their way into this folder: greyed rows with their percentage, above the folder's content.
  const here = driveWhere(parentId);
  const showPending = useUploads(s => s.items.some(u => notOver(u) && u.where === here)) && tab === 'all' && !filtering;
  // This folder's files coming in show in its list: the import card leaves them out while it is open.
  const inPlace = tab === 'all' && !filtering ? here : null;
  useEffect(() => {
    useUploads.setState({ shownAt: inPlace });
    return () => useUploads.setState({ shownAt: null });
  }, [inPlace]);
  // null: search results in their own order (name matches, then content matches).
  const activeSort = useMemo<Sort | null>(() => (filtering ? listSort : tab === 'recent' ? (listSort ?? { key: 'date', asc: false }) : sort), [filtering, listSort, tab, sort]);

  // Read the text of PDFs / Word / text files in the background, for the search.
  useEffect(() => startTextIndexing(), []);

  useEffect(() => {
    if (q.length < 2) return setContentHits(new Map());
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchFileContents(q, 50).then(hits => !cancelled && setContentHits(new Map(hits.map(h => [h.id, h]))));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, items]);

  const visible = useMemo(() => {
    let list: DriveItem[];
    if (q || activeTag) {
      // Search and label filter look through the whole Drive, whatever the folder.
      const fq = fold(q);
      const byName = items.filter(i => (!q || fold(i.name).includes(fq)) && (!activeTag || i.tags?.includes(activeTag)));
      const named = new Set(byName.map(i => i.id));
      const byContent = q ? items.filter(i => !named.has(i.id) && contentHits.has(i.id) && (!activeTag || i.tags?.includes(activeTag))) : [];
      const found = [...sortItems(items, byName, { key: 'name', asc: true }), ...byContent];
      return activeSort ? sortItems(items, found, activeSort) : found;
    }
    if (tab === 'starred') list = items.filter(i => i.starred);
    // The 40 latest files, then shown in the chosen order (newest first by default).
    else if (tab === 'recent') list = items.filter(i => i.kind === 'file').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40);
    else list = childrenOf(items, parentId);
    return sortItems(items, list, activeSort ?? sort);
  }, [items, parentId, tab, sort, activeSort, q, activeTag, contentHits]);

  // A big folder shows its first rows at once, the rest when the browser is free.
  const shown = useProgressive(visible.length, 60);
  const selectedIds = useMemo(() => [...selected].filter(id => items.some(i => i.id === id)), [selected, items]);
  const single = selectedIds.length === 1 ? items.find(i => i.id === selectedIds[0]) : undefined;
  const selectedFolders = items.filter(i => i.kind === 'folder' && selected.has(i.id));
  const activeId = (visible.find(i => i.id === focusId) ?? visible.find(i => selected.has(i.id)) ?? visible[0])?.id;

  const changeSort = (key: SortKey) => {
    const next = { key, asc: activeSort?.key === key ? !activeSort.asc : true };
    if (filtering || tab === 'recent') return setListSort(next);
    setSort(next);
    try {
      localStorage.setItem('cop:drive-sort', `${key}:${next.asc ? 'asc' : 'desc'}`);
    } catch {
      /* ignore */
    }
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const openFolder = useCallback(
    (id: string | null) => {
      setTab('all');
      setListSort(null);
      setSelected(new Set());
      setQuery('');
      setTagFilter(null);
      setParams(id ? { dossier: id } : {});
    },
    [setParams],
  );

  // Keyboard: once a folder is opened with Entrée (or left with Retour arrière), the focus goes to its first item
  // (or to the folder left) instead of being lost on the page. '' = the first one.
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfter.current;
    if (id === null) return;
    focusAfter.current = null;
    const list = document.querySelector('main [role="listbox"]');
    // An empty folder: the page's content (its « + » and empty state are read from there).
    (list?.querySelector<HTMLElement>(`[role="option"][data-id="${id}"]`) ?? list?.querySelector<HTMLElement>('[role="option"]') ?? document.getElementById('contenu'))?.focus();
  }, [parentId]);

  const openItem = useCallback(
    (item: DriveItem, byKey?: boolean) => {
      if (item.kind === 'folder') {
        if (byKey) focusAfter.current = '';
        openFolder(item.id);
      } else
        setParams(p => {
          const n = new URLSearchParams(p);
          n.set('fichier', item.id);
          // Found inside a PDF: opened on the page of the match.
          const page = q ? contentHits.get(item.id)?.page : undefined;
          if (page && page > 1) n.set('page', String(page));
          return n;
        });
    },
    [openFolder, setParams, q, contentHits],
  );

  const closePreview = useCallback(
    () =>
      setParams(p => {
        const n = new URLSearchParams(p);
        n.delete('fichier');
        n.delete('page');
        return n;
      }),
    [setParams],
  );

  // Select the file targeted by a link (e.g. from search or Kompaly). A link to a file now in the
  // trash goes to its preview there, like notes (checked when the link changes only).
  useEffect(() => {
    if (previewId && isTrashedDriveItem(previewId)) navigate(`/corbeille?type=drive&apercu=${previewId}`, { replace: true });
    // A finger: pointed at only (a selection would put the page in selection mode once the preview is closed).
    else if (previewId && touchRef.current) setTapped(previewId);
    else if (previewId) setSelected(new Set([previewId]));
  }, [previewId, navigate]);

  // « Voir tout dans le Drive » of the search at the top: the same search here (names and content).
  useEffect(() => {
    const asked = params.get('q');
    if (asked === null) return;
    setTab('all');
    setListSort(null);
    setSelected(new Set());
    setQuery(asked);
    setParams(
      p => {
        const n = new URLSearchParams(p);
        n.delete('q');
        return n;
      },
      { replace: true },
    );
  }, [params, setParams]);

  // "Importer" shortcut from the dashboard.
  const handledImport = useRef(false);
  useEffect(() => {
    if (params.get('import') && !handledImport.current) {
      handledImport.current = true;
      fileInput.current?.click();
      setParams(p => {
        const n = new URLSearchParams(p);
        n.delete('import');
        return n;
      });
    }
  }, [params, setParams]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const doUpload = useCallback(
    async (pending: Awaited<ReturnType<typeof filesFromDrop>>, target: string | null) => {
      if (!pending.length) return;
      setBusy(true);
      try {
        const { sent, tooBig } = await uploadPending(pending, target);
        // The files' progress and end show in the import card (UploadCard); only folders alone need a word.
        if (!sent && tooBig.length < pending.length) toast(t('Dossier importé'), 'success');
        if (tooBig.length)
          toast(
            tooBig.length === 1
              ? t('« {name} » n’a pas été importé : 50 Mo maximum par fichier.', { name: tooBig[0] })
              : t('{n} fichiers n’ont pas été importés (plus de 50 Mo chacun) : {names}.', { n: tooBig.length, names: tooBig.join(', ') }),
            'error',
          );
      } catch (e) {
        // A pause or a cancellation is not a failure (the loop deals with them; this is in case one gets here).
        if (!isUploadAbort(e)) toast(e instanceof StorageError ? e.message : t('L’import a échoué. Réessaie.'), 'error');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const newFolder = useCallback(async () => {
    const name = await askText(t('Nouveau dossier'), t('Nouveau dossier'), t('Créer'));
    if (name === null) return;
    const f = useDrive.getState().createFolder(name, parentId);
    setTab('all');
    setSelected(new Set([f.id]));
  }, [parentId]);

  // The « + » button: in the folder open (Favoris and Récents: the one in the address, the root from « Mon Drive »).
  // The right-click menu of the page offers the same, where the pointer is; a drop works too.
  // « Fiche depuis une photo » : only when the server can read photos (server/photo.mjs).
  const photoReady = usePhotoReady();
  const [photoSheet, setPhotoSheet] = useState(false);
  useCreateActions([
    ...(photoReady ? [{ label: t('Fiche depuis une photo'), icon: <ScanText />, onClick: () => setPhotoSheet(true) }] : []),
    { label: t('Importer des fichiers'), icon: <Upload />, onClick: () => fileInput.current?.click() },
    { label: t('Importer un dossier'), icon: <FolderUp />, onClick: () => folderInput.current?.click() },
    { label: t('Nouveau dossier'), icon: <FolderPlus />, onClick: () => void newFolder() },
  ]);

  const rename = useCallback(async (item: DriveItem) => {
    const typed = await askText(item.kind === 'folder' ? t('Renommer le dossier') : t('Renommer le fichier'), item.name, t('Renommer'), { fileName: item.kind !== 'folder' });
    if (typed === null || !typed.trim()) return;
    const name = item.kind === 'file' ? keepExtension(item.name, typed) : typed;
    if (name !== item.name) useDrive.getState().rename(item.id, name);
    // The extension typed was replaced by the old one (not just added): said, or the name would seem ignored.
    if (!name.startsWith(typed.trim())) toast(t('L’extension {ext} est gardée.', { ext: item.name.slice(item.name.lastIndexOf('.')) }), 'info');
  }, []);

  // Asked first, then the toast still offers to undo (and the trash keeps them 30 days).
  const remove = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const items = useDrive.getState().items.filter(i => ids.includes(i.id));
    const one = items.length === 1 ? items[0] : null;
    const title = one ? t('Mettre «\u00a0{name}\u00a0» à la corbeille\u00a0?', { name: one.name }) : tn(ids.length, 'Mettre {n} élément à la corbeille ?', 'Mettre {n} éléments à la corbeille ?');
    const folders = items.some(i => i.kind === 'folder');
    const body = one
      ? `${folders ? `${t('Le dossier part avec tout son contenu.')} ` : ''}${t('Tu pourras le récupérer dans la corbeille.')}`
      : `${folders ? `${t('Les dossiers partent avec tout leur contenu.')} ` : ''}${t('Tu pourras les récupérer dans la corbeille.')}`;
    if (!(await confirmAction(title, body, t('Mettre à la corbeille')))) return;
    useDrive.getState().remove(ids);
    setSelected(new Set());
    toast(ids.length > 1 ? tn(ids.length, '{n} élément mis à la corbeille', '{n} éléments mis à la corbeille') : t('Mis à la corbeille'), 'info', {
      label: t('Annuler||l’action'),
      run: () => useDrive.getState().restore(ids),
    });
  }, []);

  const copy = useCallback((ids: string[]) => {
    if (!ids.length) return;
    useDrive.getState().copy(ids);
    toast(tn(ids.length, '{n} élément copié', '{n} éléments copiés'));
  }, []);

  const cut = useCallback((ids: string[]) => {
    if (!ids.length) return;
    useDrive.getState().cut(ids);
    toast(tn(ids.length, '{n} élément coupé', '{n} éléments coupés'));
  }, []);

  const paste = useCallback(
    async (target: string | null) => {
      const clip = useDrive.getState().clipboard;
      if (!clip?.ids.length) return;
      const before = useDrive.getState().items.length;
      if (!(await useDrive.getState().paste(target))) {
        return toast(clip.mode === 'cut' ? t('Impossible de déplacer un dossier dans lui-même') : CANT_COPY_INTO_ITSELF, 'error');
      }
      // A cut that moved nothing (already in this folder) stays in the clipboard.
      if (clip.mode === 'cut' && useDrive.getState().clipboard) return toast(alreadyThere(clip.ids.length), 'info');
      if (clip.mode === 'copy' && useDrive.getState().items.length === before) return;
      const one = clip.ids.length === 1;
      toast(clip.mode === 'cut' ? (one ? t('Élément déplacé') : t('Éléments déplacés')) : one ? t('Élément collé') : t('Éléments collés'), 'success');
    },
    [],
  );

  const duplicate = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    await useDrive.getState().duplicate(ids);
    toast(ids.length > 1 ? tn(ids.length, '{n} copie créée', '{n} copies créées') : t('Copie créée'), 'success');
  }, []);

  const moveTo = useCallback((ids: string[], target: string | null) => {
    if (pasteForbidden(useDrive.getState().items, ids, target)) return toast(t('Impossible de déplacer un dossier dans lui-même'), 'error');
    const moved = useDrive.getState().move(ids, target);
    if (moved) toast(tn(moved, '{n} élément déplacé', '{n} éléments déplacés'), 'success');
    else toast(alreadyThere(ids.length), 'info');
  }, []);

  // ── Preview ───────────────────────────────────────────────────────────────
  // ← → (and the arrows at its sides) go through the files of the list on screen, in its order (folders skipped).
  const previewFiles = useMemo(() => visible.filter(i => i.kind === 'file'), [visible]);
  const previewAt = previewItem ? previewFiles.findIndex(i => i.id === previewItem.id) : -1;
  // In place of the one shown (Retour closes the preview, it doesn't go back through every file seen).
  const showFile = (item: DriveItem) =>
    setParams(
      p => {
        const n = new URLSearchParams(p);
        n.set('fichier', item.id);
        n.delete('page');
        return n;
      },
      { replace: true },
    );
  // Put in the trash from the preview: the next file shows (or the one before, or the list).
  const trashFromPreview = async (item: DriveItem) => {
    const next = previewFiles[previewAt + 1] ?? previewFiles[previewAt - 1];
    await remove([item.id]);
    if (useDrive.getState().items.some(i => i.id === item.id)) return; // « Annuler » in the question
    if (next && next.id !== item.id) showFile(next);
    else closePreview();
  };
  const openAsNote = async (item: DriveItem) => {
    const note = await openFileAsNote(item).catch(() => null);
    if (!note) return toast(t('Ce fichier n’a pas pu être lu'), 'error');
    toast(t('Note créée à partir de « {name} »', { name: item.name }), 'success');
    navigate(`/notes?note=${note.id}`);
  };
  // The notes that point to the file shown (« Lier… » in a note).
  const notes = useNotes(s => s.notes);
  const linkedNotes = useMemo(
    () => (previewItem ? notes.filter(n => n.links?.some(l => l.kind === 'file' && l.id === previewItem.id)).map(n => ({ id: n.id, title: n.title })) : undefined),
    [notes, previewItem],
  );
  const [previewMore, setPreviewMore] = useState<{ x: number; y: number } | null>(null);
  const previewActions = (item: DriveItem) => {
    const btn = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/75 hover:bg-white/10 hover:text-white pointer-coarse:h-9 pointer-coarse:w-9';
    // Phones: the less frequent ones in « Plus d’actions » (the name keeps some room), favourite and bin too (the name
    // was down to « Co… » at 320 px).
    const rare = [
      ...(canOpenAsNote(item) ? [{ label: t('Ouvrir comme note'), icon: <NotebookPen size={16} />, onClick: () => void openAsNote(item) }] : []),
      { label: t('Renommer'), icon: <Pencil size={16} />, shortcut: 'F2', onClick: () => void rename(item) },
      // Links only exist online.
      ...(cloudEnabled ? [{ label: t('Partager le lien…'), icon: <Link2 size={16} />, onClick: () => setShareItem(item) }] : []),
    ];
    return (
      <>
        {rare.map(a => (
          <button key={a.label} className={cx(btn, 'max-sm:hidden')} onClick={a.onClick} title={a.shortcut ? `${a.label} (${a.shortcut})` : a.label} aria-label={a.label}>
            {a.icon}
          </button>
        ))}
        <button className={cx(btn, 'sm:hidden')} onClick={e => setPreviewMore(under(e))} title={t('Plus d’actions')} aria-label={t('Plus d’actions')} aria-haspopup="menu">
          <MoreHorizontal size={16} />
        </button>
        <button className={cx(btn, 'max-sm:hidden')} aria-pressed={!!item.starred} onClick={() => useDrive.getState().toggleStar(item.id)} title={item.starred ? t('Retirer des favoris') : t('Ajouter aux favoris')} aria-label={t('Favori')}>
          <Star size={16} className={cx(item.starred && 'fill-amber-400 text-amber-400')} />
        </button>
        <button className={cx(btn, 'max-sm:hidden')} onClick={() => void trashFromPreview(item)} title={`${t('Mettre à la corbeille')} (${DEL})`} aria-label={t('Mettre à la corbeille')}>
          <Trash2 size={16} />
        </button>
        {previewMore && (
          <ContextMenu
            x={previewMore.x}
            y={previewMore.y}
            items={[
              ...rare.map(a => ({ ...a, shortcut: undefined })),
              { label: item.starred ? t('Retirer des favoris') : t('Ajouter aux favoris'), icon: <Star size={16} />, onClick: () => useDrive.getState().toggleStar(item.id) },
              { label: '', divider: true, onClick: () => {} },
              { label: t('Mettre à la corbeille'), icon: <Trash2 size={16} />, danger: true, onClick: () => void trashFromPreview(item) },
            ]}
            onClose={() => setPreviewMore(null)}
          />
        )}
      </>
    );
  };

  /** A menu opened from a button of the selection bar: under the button, not over it (and the bar). */
  const under = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.bottom + 6) };
  };

  // ── Selection ─────────────────────────────────────────────────────────────
  const toggle = (id: string) =>
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const lastTap = useRef<{ id: string; at: number; before: Set<string> } | null>(null);
  const onItemClick = (e: React.MouseEvent, item: DriveItem) => {
    e.stopPropagation();
    if (e.shiftKey && anchor) {
      const a = visible.findIndex(i => i.id === anchor);
      const b = visible.findIndex(i => i.id === item.id);
      const [from, to] = a < b ? [a, b] : [b, a];
      setSelected(new Set(visible.slice(from, to + 1).map(i => i.id)));
      return;
    }
    if (touchMode && !e.metaKey && !e.ctrlKey) {
      const now = performance.now();
      const prev = lastTap.current;
      // A double tap opens, in selection mode too (what its first tap changed is put back).
      if (prev && prev.id === item.id && now - prev.at < DOUBLE_TAP) {
        lastTap.current = null;
        setSelected(prev.before);
        openItem(item);
        return;
      }
      lastTap.current = { id: item.id, at: now, before: selected };
      // Selection mode: each tap adds or removes one. Otherwise a tap only points at the item.
      if (selectedIds.length > 0) toggle(item.id);
      else setTapped(item.id);
      setAnchor(item.id);
      return;
    }
    if (e.metaKey || e.ctrlKey) toggle(item.id);
    else setSelected(new Set([item.id]));
    setAnchor(item.id);
  };

  // A finger: long press = selection mode, long press then move = drag and drop (touchGestures).
  // `entered`: this press started selection mode, which ends with its drag.
  const entered = useRef(false);
  const startTouch = useTouchDrag(listRef, {
    onLongPress: id => {
      entered.current = selectedIds.length === 0;
      lastTap.current = null;
      setTapped(null);
      setSelected(s => (s.has(id) ? s : new Set([...(selectedIds.length ? s : []), id])));
      setAnchor(id);
    },
    dragIds: id => (selected.has(id) ? selectedIds : [id]),
    ghost: (id, ids) => dragGhost(document.querySelector(`main [role="option"][data-id="${CSS.escape(id)}"]`), items.find(i => i.id === id)?.name ?? '', ids.length),
    onDragStart: ids => {
      setDragging(true);
      setDragged(new Set(ids));
    },
    onOver: key => setDropTarget(key),
    onDrop: (ids, target) => {
      moveTo(ids, target);
      setSelected(new Set());
    },
    onDragEnd: () => {
      setDragging(false);
      setDropTarget(null);
      setDragged(new Set());
      if (entered.current) setSelected(new Set());
    },
  });

  // Right click, Maj+F10, the menu key (a finger's long press never gets here: see touchGestures).
  const onItemContext = (e: React.MouseEvent | React.KeyboardEvent, item: DriveItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(item.id)) setSelected(new Set([item.id]));
    setMenu({ ...menuPoint(e), target: item.id });
  };

  // Items are focusable: arrows move (Shift extends the selection), Space selects, Enter opens,
  // Shift+F10 / menu key opens the context menu.
  const onItemKey = (e: React.KeyboardEvent<HTMLElement>, item: DriveItem) => {
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      const els = [...(e.currentTarget.closest('[role="listbox"]')?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
      const i = els.indexOf(e.currentTarget);
      // Grid: Up / Down jump a whole row (items on the first line = columns).
      const cols = view === 'grid' && !q ? Math.max(1, els.filter(el => el.offsetTop === els[0].offsetTop).length) : 1;
      const step: Record<string, number> = { ArrowDown: cols, ArrowUp: -cols, ArrowRight: 1, ArrowLeft: -1 };
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : Math.max(0, Math.min(els.length - 1, i + step[e.key]));
      e.preventDefault();
      e.stopPropagation();
      els[to]?.focus();
      if (e.shiftKey && visible[to]) {
        const from = visible.findIndex(v => v.id === (anchor ?? item.id));
        const [a, b] = from < to ? [from, to] : [to, from];
        setSelected(new Set(visible.slice(Math.max(0, a), b + 1).map(v => v.id)));
        if (!anchor) setAnchor(item.id);
      }
    } else if (isMenuKey(e)) onItemContext(e, item);
    else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      openItem(item, true);
    } else if (e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey)
        setSelected(s => {
          const n = new Set(s);
          if (n.has(item.id)) n.delete(item.id);
          else n.add(item.id);
          return n;
        });
      else setSelected(new Set([item.id]));
      setAnchor(item.id);
    }
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Ctrl+V: what Kompaly's « Copier » / « Couper » holds, unless the computer's clipboard holds files (a screenshot):
  // those are imported (the paste event, below, comes right after the key and cancels this).
  const pasteSoon = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, [contenteditable="true"], [role="menu"]') || moveIds || tagIds || shareItem || useUi.getState().dialog) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      // The preview open: F2 and Suppr act on its file (← → are the preview's own).
      if (previewItem) {
        if (e.key === 'F2') {
          e.preventDefault();
          void rename(previewItem);
        } else if (e.key === 'Delete' || (e.key === 'Backspace' && mod)) {
          e.preventDefault();
          void trashFromPreview(previewItem);
        }
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        setSelected(new Set(visible.map(i => i.id)));
      } else if (mod && k === 'c') copy(selectedIds);
      else if (mod && k === 'x') cut(selectedIds);
      else if (mod && k === 'v') {
        clearTimeout(pasteSoon.current);
        if (tab === 'all') pasteSoon.current = setTimeout(() => void paste(parentId), 60);
      } else if (mod && k === 'd') {
        e.preventDefault();
        void duplicate(selectedIds);
        // Suppr or ⌘⌫ / Ctrl+⌫: to the trash. ⌫ alone goes up to the parent folder (below), on a Mac too.
      } else if (e.key === 'Delete' || (e.key === 'Backspace' && mod)) {
        e.preventDefault();
        void remove(selectedIds);
      } else if (e.key === 'F2' && single) {
        e.preventDefault();
        void rename(single);
      } else if (e.key === 'Enter' && single && !el.closest('button, a[href], select')) {
        // (Enter on a button runs that button only, e.g. « Déplacer » in the selection bar.)
        openItem(single, true);
      }
      else if (e.key === 'Escape') setSelected(new Set());
      else if (e.key === 'Backspace' && !mod && current) {
        focusAfter.current = current.id;
        openFolder(current.parentId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trashFromPreview only reads what is listed here
  }, [visible, selectedIds, single, parentId, tab, current, previewItem, moveIds, tagIds, shareItem, copy, cut, paste, duplicate, remove, rename, openItem, openFolder]);

  // A screenshot or files copied on the computer, pasted here (Ctrl+V): imported into the folder open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest?.('input, textarea, [contenteditable="true"]') || previewItem || moveIds || tagIds || shareItem || useUi.getState().dialog) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      clearTimeout(pasteSoon.current);
      void doUpload(pastedFiles(files), tabAll ? parentId : null);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent, item: DriveItem) => {
    const ids = selected.has(item.id) ? selectedIds : [item.id];
    if (!selected.has(item.id)) setSelected(new Set([item.id]));
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'copyMove';
    // The picture under the pointer, placed where the tile already is for the browser to take its picture, then removed
    // before anything is painted.
    const ghost = dragGhost(e.currentTarget as HTMLElement, item.name, ids.length);
    Object.assign(ghost.style, { left: `${e.clientX - 14}px`, top: `${e.clientY - 14}px` });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 14, 14);
    requestAnimationFrame(() => ghost.remove());
    setDragging(true);
  };

  const isInternal = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_MIME);
  const isExternal = (e: React.DragEvent) => e.dataTransfer.types.includes('Files') && !isInternal(e);

  const dropOn = async (e: React.DragEvent, target: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDropTarget(null);
    setDragging(false);
    if (isInternal(e)) {
      const ids: string[] = JSON.parse(e.dataTransfer.getData(DRAG_MIME) || '[]');
      // A folder dropped back on itself (a small slip while clicking): nothing to do, no error.
      if (target && ids.includes(target)) return;
      if (e.altKey) {
        // Alt + drop = copy instead of move
        if (pasteForbidden(useDrive.getState().items, ids, target)) return toast(CANT_COPY_INTO_ITSELF, 'error');
        // Through the clipboard, then the one there was put back: a « Couper » waiting must not be lost.
        const kept = useDrive.getState().clipboard;
        useDrive.getState().copy(ids);
        try {
          await useDrive.getState().paste(target);
        } finally {
          useDrive.setState({ clipboard: kept });
        }
        toast(ids.length === 1 ? t('Élément copié') : t('Éléments copiés'), 'success');
      } else moveTo(ids, target);
    } else if (e.dataTransfer.types.includes('Files')) {
      await doUpload(await filesFromDrop(e.dataTransfer), target);
    }
  };

  const folderDropProps = (target: string | null, key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!isInternal(e) && !isExternal(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = isInternal(e) ? (e.altKey ? 'copy' : 'move') : 'copy';
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      e.stopPropagation();
      // Back to the frame of the whole page only for files from the computer (dropping there uploads them).
      if (dropTarget === key) setDropTarget(tabAll && isExternal(e) ? 'here' : null);
    },
    onDrop: (e: React.DragEvent) => void dropOn(e, target),
  });

  const tabAll = tab === 'all' && !filtering;
  // Inside a folder everything sits in the same place: the « Emplacement » column only helps search, favorites and recents.
  // The last one: « ⋯ ».
  const listCols = tabAll ? 'md:grid-cols-[minmax(0,1fr)_130px_90px_36px]' : 'md:grid-cols-[minmax(0,1fr)_200px_130px_90px_36px]';

  // ── Context menu definitions ──────────────────────────────────────────────
  /** « 3 éléments » under a folder, nothing when it is empty. */
  const childCount = (id: string) => {
    const n = items.filter(i => i.parentId === id).length;
    return n ? tn(n, '{n} élément', '{n} éléments') : '';
  };

  const menuItems: MenuItem[] = useMemo(() => {
    if (!menu) return [];
    if (menu.target === null) {
      return [
        { label: t('Nouveau dossier'), icon: <FolderPlus size={15} />, onClick: () => void newFolder() },
        { label: t('Importer des fichiers'), icon: <Upload size={15} />, onClick: () => fileInput.current?.click() },
        { label: t('Importer un dossier'), icon: <FolderUp size={15} />, onClick: () => folderInput.current?.click() },
        ...(photoReady ? [{ label: t('Fiche depuis une photo'), icon: <ScanText size={15} />, onClick: () => setPhotoSheet(true) }] : []),
        { label: '', divider: true, onClick: () => {} },
        { label: t('Coller'), icon: <ClipboardPaste size={15} />, shortcut: `${MOD}V`, disabled: !clipboard?.ids.length || !tabAll, onClick: () => void paste(parentId) },
        { label: t('Tout sélectionner'), icon: <MousePointer2 size={15} />, shortcut: `${MOD}A`, onClick: () => setSelected(new Set(visible.map(i => i.id))) },
        ...(items.length ? [{ label: t('Tout télécharger (.zip)'), icon: <FolderDown size={15} />, onClick: () => void downloadZip(items, items.filter(i => !i.parentId).map(i => i.id), `Kompaly ${t('Fichiers')}`) }] : []),
      ];
    }
    // « ⋯ » of an item outside the selection: that item alone (the selection stays as it is).
    const ids = menu.bar || selectedIds.includes(menu.target) ? selectedIds : [menu.target];
    const item = items.find(i => i.id === menu.target);
    // Everything but what the phone selection bar shows next to « Plus d’actions ».
    const full = !menu.bar;
    const one = ids.length === 1 && item;
    const targets = items.filter(i => ids.includes(i.id));
    const allFolders = targets.length > 0 && targets.every(i => i.kind === 'folder');
    // (The phones' selection bar has no colour button: it is in its « Plus d’actions ».)
    const palette: MenuItem[] = allFolders
      ? [
          { label: '', divider: true, onClick: () => {} },
          {
            label: t('Couleur'),
            onClick: () => {},
            content: (
              <FolderColorPicker
                value={targets.every(x => (x.color ?? null) === (targets[0].color ?? null)) ? (targets[0].color ?? null) : undefined}
                onPick={key => {
                  for (const x of targets) useDrive.getState().update(x.id, { color: key ?? undefined });
                  setMenu(null);
                }}
              />
            ),
          },
        ]
      : [];
    const list: MenuItem[] = [
      ...(one && full ? [{ label: item.kind === 'folder' ? t('Ouvrir') : t('Aperçu||d’un fichier'), icon: <Eye size={15} />, shortcut: t('Entrée'), onClick: () => openItem(item) }] : []),
      ...(one && canOpenAsNote(item) ? [{ label: t('Ouvrir comme note'), icon: <NotebookPen size={15} />, onClick: () => void openAsNote(item) }] : []),
      ...(one && item.kind === 'file'
        ? [{ label: t('Télécharger'), icon: <Download size={15} />, onClick: () => downloadItem(item) }]
        : [{ label: t('Télécharger (.zip)'), icon: <FolderDown size={15} />, onClick: () => void downloadZip(items, ids, one ? item.name : `Kompaly ${t('Fichiers')}`) }]),
      ...(one ? [{ label: '', divider: true, onClick: () => {} }] : []),
      { label: t('Copier'), icon: <Copy size={15} />, shortcut: `${MOD}C`, onClick: () => copy(ids) },
      { label: t('Couper'), icon: <Scissors size={15} />, shortcut: `${MOD}X`, onClick: () => cut(ids) },
      ...(one && item.kind === 'folder' ? [{ label: t('Coller dans ce dossier'), icon: <ClipboardPaste size={15} />, disabled: !clipboard?.ids.length, onClick: () => void paste(item.id) }] : []),
      { label: t('Dupliquer'), icon: <CopyPlus size={15} />, shortcut: `${MOD}D`, onClick: () => void duplicate(ids) },
      ...(full ? [{ label: t('Déplacer vers…'), icon: <FolderInput size={15} />, onClick: () => setMoveIds(ids) }] : []),
      ...(one ? [{ label: t('Renommer'), icon: <Pencil size={15} />, shortcut: 'F2', onClick: () => void rename(item) }] : []),
      ...(one ? [{ label: item.starred ? t('Retirer des favoris') : t('Ajouter aux favoris'), icon: <Star size={15} />, onClick: () => useDrive.getState().toggleStar(item.id) }] : []),
      ...(full || one ? [{ label: t('Étiquettes…'), icon: <Tag size={15} />, onClick: () => setTagIds(ids) }] : []),
      // Links only exist online: no dead-end entry in the local version.
      ...(one && item.kind === 'file' && cloudEnabled ? [{ label: t('Partager le lien…'), icon: <Link2 size={15} />, onClick: () => setShareItem(item) }] : []),
      // A copy of the files in a group (as « Partager dans un groupe… » of a note), for whoever is in one.
      ...(cloudEnabled && targets.some(i => i.kind === 'file') && useGroups.getState().groups.some(g => g.kind === 'groupe') ? [{ label: t('Partager dans {a}…', { a: groupWordsNow().a }), icon: <Users size={15} />, onClick: () => setGroupShare(targets.filter(i => i.kind === 'file')) }] : []),
      // A course (Word, PDF, text): Kompaly makes its revision sheet or a practice exam, saved next to it.
      ...(one && canMakeFrom(item)
        ? [
            { label: '', divider: true, onClick: () => {} },
            { label: rec.menu.fiche, icon: <ClipboardList size={15} />, disabled: !!making, onClick: () => void makeFromFile(item, 'fiche') },
            { label: rec.menu.examen, icon: <BookOpenCheck size={15} />, disabled: !!making, onClick: () => void makeFromFile(item, 'examen') },
          ]
        : []),
      ...palette,
      ...(full
        ? [
            { label: '', divider: true, onClick: () => {} },
            { label: t('Mettre à la corbeille'), icon: <Trash2 size={15} />, shortcut: DEL, danger: true, onClick: () => void remove(ids) },
          ]
        : []),
    ];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openAsNote reads nothing that changes
  }, [menu, selectedIds, items, clipboard, tabAll, parentId, visible, newFolder, paste, openItem, copy, cut, duplicate, rename, remove, making, rec, photoReady]);
  // No keyboard shortcuts on a phone.
  const shownMenu = touchMode ? menuItems.map(i => ({ ...i, shortcut: undefined })) : menuItems;

  const cutIds = clipboard?.mode === 'cut' ? new Set(clipboard.ids) : new Set<string>();

  const itemProps = (item: DriveItem) => ({
    // Fingers: their own drag (touchGestures; the browser's drag picture was a black square on phones).
    draggable: !touchMode,
    onDragStart: (e: React.DragEvent) => onDragStart(e, item),
    // Dropped outside any target (or cancelled): no highlight left behind.
    onDragEnd: () => {
      setDragging(false);
      setDropTarget(null);
      dragDepth.current = 0;
    },
    onClick: (e: React.MouseEvent) => onItemClick(e, item),
    onPointerDown: (e: React.PointerEvent) => startTouch(e, item.id),
    // (A finger's double tap: its second tap opens the item, see onItemClick.)
    onDoubleClick: () => !touchMode && openItem(item),
    onContextMenu: (e: React.MouseEvent) => onItemContext(e, item),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => onItemKey(e, item),
    onFocus: () => setFocusId(item.id),
    tabIndex: item.id === activeId ? 0 : -1,
    'aria-selected': selected.has(item.id),
    'data-id': item.id,
    'data-drop': dropTarget === item.id || undefined,
    'data-tapped': (tapped === item.id && touchMode && !selectedIds.length) || undefined,
    // Its menu (« ⋯ » for the pointer and the finger).
    'aria-keyshortcuts': 'Shift+F10',
    role: 'option',
    ...(item.kind === 'folder' ? { ...folderDropProps(item.id, item.id), 'data-drop-key': item.id, 'data-drop-target': item.id } : {}),
  });

  const sortBtn = (key: SortKey) => {
    const on = activeSort?.key === key;
    const Arrow = activeSort?.asc ? ArrowUp : ArrowDown;
    return (
      <button
        className={cx('-my-2 flex h-9 items-center gap-1 transition-colors hover:text-ink', on && 'text-stone-700')}
        onClick={() => changeSort(key)}
        aria-label={on ? (activeSort?.asc ? t('Trier par {col}, ordre croissant', { col: SORT_NAMES[key] }) : t('Trier par {col}, ordre décroissant', { col: SORT_NAMES[key] })) : t('Trier par {col}', { col: SORT_NAMES[key] })}
      >
        {SORT_LABELS[key]} {on && <Arrow size={11} aria-hidden />}
      </button>
    );
  };

  /** Round tick shown on each item while selecting with a finger. */
  const tick = (sel: boolean) =>
    touchMode && selectedIds.length > 0 ? (
      <span aria-hidden className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', sel ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-300 bg-surface')}>
        {sel && <Check size={12} strokeWidth={3} />}
      </span>
    ) : null;

  /**
   * « ⋯ » of an item: its menu. Always there for a finger; with a mouse, under the pointer, the focus or the selection.
   * Not a button inside the item (an option holds no control): the keyboard opens the same menu with Maj+F10 or the
   * menu key, and screen readers hear that from the item (aria-keyshortcuts).
   */
  const moreButton = (item: DriveItem, sel: boolean, className?: string) => (
    <span
      aria-hidden
      data-more
      className={cx(
        'drive-more flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-stone-500 transition-opacity hover:bg-stone-200/70 hover:text-ink pointer-coarse:h-9 pointer-coarse:w-9 pointer-coarse:opacity-100',
        touchMode || sel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        className,
      )}
      title={t('Plus d’actions')}
      // Not a press on the item (no long press, no drag), not a click on it either.
      onPointerDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setMenu({ x: Math.round(r.right), y: Math.round(r.bottom + 4), target: item.id });
      }}
    >
      <MoreHorizontal size={17} />
    </span>
  );

  // Content matches only (a name match speaks for itself).
  const snippetOf = (item: DriveItem) => (q && !fold(item.name).includes(fold(q)) ? contentHits.get(item.id)?.snippet : undefined);

  const extOf = (item: DriveItem) => (item.kind === 'file' ? item.name.split('.').pop() : undefined);
  const bar = !dragging && (selectedIds.length > 1 || (selectedIds.length === 1 && !previewItem));
  // Nothing in the breadcrumb row but the selection bar when there is one (the root, Favoris, Récents).
  const rowEmpty = !filtering && (!tabAll || (!breadcrumb.length && !clipboard?.ids.length));

  return (
    <div
      className="drive-page mx-auto w-full max-w-[1244px] flex h-full flex-col px-4 pb-4 md:px-8"
      onPointerDownCapture={e => {
        const touch = e.pointerType === 'touch';
        if (touch !== touchMode) setTouchMode(touch);
      }}
      onDragEnter={e => {
        if (!tabAll || (!isExternal(e) && !isInternal(e))) return;
        dragDepth.current++;
        if (isExternal(e)) setDropTarget(cur => cur ?? 'here');
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDropTarget(null);
      }}
      onDragOver={e => {
        if (tabAll && isExternal(e)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={e => (tabAll ? void dropOn(e, parentId) : e.preventDefault())}
    >
      <input ref={fileInput} type="file" multiple hidden onChange={e => { if (e.target.files) void doUpload(filesFromInput(e.target.files), parentId); e.target.value = ''; }} />
      <input
        ref={folderInput}
        type="file"
        hidden
        // @ts-expect-error non-standard but widely supported folder picker
        webkitdirectory=""
        onChange={e => { if (e.target.files) void doUpload(filesFromInput(e.target.files), parentId); e.target.value = ''; }}
      />

      {/* Header */}
      {/* The essentials (title, tabs, search, sort, view) in the shared page head; tighter on phones held sideways. */}
      <div className="page-head mb-2 flex flex-wrap items-center gap-x-2 gap-y-3 short:mb-0 short:py-1">
        <h1 className="mr-1 text-[24px] font-semibold tracking-[-0.02em] sm:mr-3">{t('Fichiers')}</h1>
        <div className="seg text-[13px]">
          {([
            ['all', t('Mes fichiers'), HardDrive],
            ['starred', t('Favoris'), Star],
            ['recent', t('Récents'), Clock],
          ] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              aria-label={label}
              aria-pressed={tab === k}
              onClick={() => {
                // « Mon Drive » always goes back to the root.
                if (k === 'all') return openFolder(null);
                setTab(k);
                setListSort(null);
                setSelected(new Set());
              }}
              className="seg-item min-w-10 sm:min-w-0"
            >
              <Icon size={13} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
        {/* Phones: the search fills its own row under the title, the views and the tools, from margin to margin (under
            360 px the tools no longer fit beside the title: on the search's row, at its right).
            Computers: at the right of the row, before sort and view, as high as them. */}
        <label className="relative order-last w-full max-[359px]:w-auto max-[359px]:min-w-0 max-[359px]:flex-1 sm:order-none sm:ml-auto sm:w-auto">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={query}
            onChange={e => {
              // A new search starts in its own order.
              if (!query) setListSort(null);
              setQuery(e.target.value);
              setSelected(new Set());
            }}
            onKeyDown={e => e.key === 'Escape' && setQuery('')}
            placeholder={t('Rechercher (noms et contenu)')}
            aria-label={t('Rechercher dans mes fichiers')}
            className="field h-8 w-full text-ellipsis pl-8 pr-7 sm:w-52 xl:w-72"
          />
          {query && (
            <button className="hit absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-stone-500 hover:text-ink" onClick={() => setQuery('')} title={t('Effacer')} aria-label={t('Effacer')}>
              <X size={13} />
            </button>
          )}
        </label>
        <div className="ml-auto flex items-center gap-1.5 pointer-coarse:gap-3 max-[359px]:order-last max-[359px]:ml-0 max-[359px]:gap-1 sm:ml-0">
          {/* List view: its column headers sort on a computer; a phone hides the date column, so the button stays. */}
          {!q && (
            <button
              className={cx('icon-btn', view === 'list' && 'sm:hidden')}
              title={t('Trier')}
              aria-label={activeSort ? (activeSort.asc ? t('Trier (actuellement par {col}, ordre croissant)', { col: SORT_NAMES[activeSort.key] }) : t('Trier (actuellement par {col}, ordre décroissant)', { col: SORT_NAMES[activeSort.key] })) : t('Trier')}
              aria-haspopup="menu"
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect();
                setSortMenu({ x: r.right - 208, y: r.bottom + 6 });
              }}
            >
              <ArrowUpDown size={16} />
            </button>
          )}
          <button
            className="icon-btn"
            title={view === 'grid' ? t('Affichage liste') : t('Affichage grille')} aria-label={view === 'grid' ? t('Affichage liste') : t('Affichage grille')}
            onClick={() => setView(v => {
              const n = v === 'grid' ? 'list' : 'grid';
              try { localStorage.setItem('cop:drive-view', n); } catch { /* ignore */ }
              return n;
            })}
          >
            {view === 'grid' ? <List size={16} /> : <LayoutGrid size={16} />}
          </button>
        </div>
      </div>

      {/* Phones: the space used above the files (on a computer it sits at the end of the row below); in that row when
          it has nothing else to show. */}
      {!rowEmpty && (
        <div className="sm:hidden">
          <StorageGauge />
        </div>
      )}

      {/* Breadcrumb / selection bar. The row always keeps its height, so that the selection bar showing up moves nothing
          (on a phone it pushed the files down under the finger: the end of a long press then hit the item above). Phones
          at the root: the space used fills it meanwhile. */}
      <div className={cx('flex min-h-10 items-center gap-1 text-[13px] pointer-coarse:min-h-12', !bar && rowEmpty && 'short:min-h-0')}>
        {bar ? (
          <div className="drive-selbar enter flex h-10 w-full min-w-0 items-center gap-0.5 overflow-hidden rounded-lg bg-inverse px-1 text-on-inverse shadow-pop pointer-coarse:h-12">
            <button className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md hover:bg-on-inverse/10 sm:h-8 sm:w-8 pointer-coarse:h-10 sm:pointer-coarse:w-10" onClick={() => setSelected(new Set())} title={t('Désélectionner (Échap)')} aria-label={t('Désélectionner (Échap)')}>
              <X size={16} />
            </button>
            <span className="shrink-0 whitespace-nowrap pr-1 font-semibold">
              {selectedIds.length}
              <span className="max-sm:sr-only"> {tn(selectedIds.length, 'sélectionné', 'sélectionnés')}</span>
            </span>
            <span className="mx-1 h-5 w-px shrink-0 bg-on-inverse/20 max-sm:hidden" />
            {/* The actions share the rest of the bar evenly. Phones and tablets: the icon over a short word. */}
            <div className="flex h-full min-w-0 flex-1 items-center justify-evenly py-1 sm:gap-0.5">
              {(
                [
                  // One item: « Ouvrir », first (a double tap on the item opens it too).
                  ...(single ? [{ icon: single.kind === 'folder' ? FolderOpen : Eye, label: t('Ouvrir'), title: single.kind === 'folder' ? t('Ouvrir') : t('Ouvrir l’aperçu'), fn: () => openItem(single), open: true }] : []),
                  // Phones: the less frequent ones go in « Plus » (9 buttons overflowed the bar).
                  { icon: Copy, label: t('Copier'), fn: () => copy(selectedIds), more: true },
                  { icon: Scissors, label: t('Couper'), fn: () => cut(selectedIds), more: true },
                  { icon: CopyPlus, label: t('Dupliquer'), fn: () => void duplicate(selectedIds), more: true },
                  { icon: FolderInput, label: t('Déplacer'), fn: () => setMoveIds(selectedIds) },
                  ...(single ? [{ icon: Pencil, label: t('Renommer'), fn: () => void rename(single), phoneMore: true }] : []),
                  single?.kind === 'file'
                    ? { icon: Download, label: t('Télécharger'), fn: () => downloadItem(single), more: true }
                    : { icon: FolderDown, label: t('Télécharger'), title: t('Télécharger (.zip)'), fn: () => void downloadZip(items, selectedIds, single?.name ?? `Kompaly ${t('Fichiers')}`), more: true },
                  { icon: Tag, label: t('Étiquettes'), fn: () => setTagIds(selectedIds), ...(single && { phoneMore: true }) },
                  ...(selectedFolders.length === selectedIds.length ? [{ icon: Palette, label: t('Couleur'), fn: (e: React.MouseEvent) => setColorMenu(under(e)), phoneMore: true }] : []),
                  { icon: Trash2, label: t('Corbeille||barre de sélection'), title: t('Mettre à la corbeille'), fn: () => void remove(selectedIds) },
                ] as { icon: typeof Copy; label: string; title?: string; fn: (e: React.MouseEvent) => void; more?: boolean; phoneMore?: boolean; open?: boolean }[]
              ).map(a => (
                <button
                  key={a.label + (a.title ?? '')}
                  onClick={a.fn}
                  className={cx(
                    'flex h-full min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-[3px] rounded-md hover:bg-on-inverse/10 sm:flex-auto sm:basis-auto sm:px-1 lg:flex-row lg:gap-1.5 lg:px-2',
                    a.open ? 'drive-open bg-on-inverse font-semibold text-inverse hover:bg-on-inverse hover:opacity-90' : 'text-on-inverse/85 hover:text-on-inverse',
                    (a.more || a.phoneMore) && 'max-sm:hidden',
                  )}
                  title={a.title ?? a.label}
                  aria-label={a.title ?? a.label}
                >
                  <a.icon size={16} className="shrink-0" aria-hidden />
                  {/* Computers: the less frequent ones show their icon alone below 1536 px (German labels overflowed the bar at 1280). */}
                  <span className={cx('max-w-full truncate text-[10.5px] font-medium leading-[1.2] tracking-[-0.01em] lg:text-[13px] lg:leading-normal lg:tracking-normal', a.more && 'lg:max-2xl:hidden')}>{a.label}</span>
                </button>
              ))}
              <button
                onClick={e => setMenu({ ...under(e), target: selectedIds[0], bar: true })}
                className="flex h-full min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-[3px] rounded-md text-on-inverse/85 hover:bg-on-inverse/10 sm:hidden"
                title={t('Plus d’actions')}
                aria-label={t('Plus d’actions')}
                aria-haspopup="menu"
              >
                <MoreHorizontal size={16} aria-hidden />
                <span className="max-w-full truncate text-[10.5px] font-medium leading-[1.2] tracking-[-0.01em]">{t('Plus')}</span>
              </button>
            </div>
          </div>
        ) : filtering ? (
          // No result: the empty state below says it (once).
          visible.length > 0 && <p className="truncate px-1.5 font-medium text-stone-500">
            {q ? tn(visible.length, '{n} résultat pour « {q} »', '{n} résultats pour « {q} »', { q }) : tn(visible.length, '{n} résultat', '{n} résultats')}
            {activeTag && ` ${t('avec l’étiquette « {tag} »', { tag: activeTag })}`}
          </p>
        ) : tabAll ? (
          <>
            {/* Only inside a folder: at the root the « Mon Drive » tab and the title already say where we are
                (and everything shown is already at the root, so it is no use as a drop target there). */}
            {breadcrumb.length > 0 && (
              <button
                onClick={() => openFolder(null)}
                {...folderDropProps(null, 'crumb-root')}
                data-drop-key="crumb-root"
                data-drop-target=""
                className={cx('rounded-md px-1.5 py-1 font-medium text-stone-500 transition-colors hover:bg-stone-100 pointer-coarse:py-3', dropTarget === 'crumb-root' && 'bg-brand-50 text-brand-700')}
              >
                {t('Mes fichiers')}
              </button>
            )}
            {breadcrumb.map(b => (
              <span key={b.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight size={14} className="shrink-0 text-stone-300" />
                <button
                  onClick={() => openFolder(b.id)}
                  {...folderDropProps(b.id, `crumb-${b.id}`)}
                  data-drop-key={`crumb-${b.id}`}
                  data-drop-target={b.id}
                  className={cx(
                    'max-w-48 truncate rounded-md px-1.5 py-1 font-medium transition-colors hover:bg-stone-100 pointer-coarse:py-3',
                    b.id === parentId ? 'text-ink' : 'text-stone-500',
                    dropTarget === `crumb-${b.id}` && 'bg-brand-50 text-brand-700',
                  )}
                >
                  {b.name}
                </button>
              </span>
            ))}
            {clipboard?.ids.length ? (
              <button className="btn-ghost ml-auto h-8 text-[12px]" onClick={() => void paste(parentId)}>
                <ClipboardPaste size={14} /> {t('Coller ici ({n})', { n: clipboard.ids.length })}
              </button>
            ) : null}
          </>
        ) : null}
        {!bar && rowEmpty && (
          <div className="min-w-0 sm:hidden short:hidden [&>*]:mb-0">
            <StorageGauge />
          </div>
        )}
        {!bar && (
          <div className={cx('hidden min-w-0 shrink-0 sm:block short:hidden', !(tabAll && clipboard?.ids.length) && 'ml-auto')}>
            <StorageGauge inline />
          </div>
        )}
      </div>

      {/* Label filter */}
      {allTags.length > 0 && <TagFilter tags={allTags} active={activeTag} onPick={tag => { setTagFilter(activeTag === tag ? null : tag); setSelected(new Set()); }} />}

      {/* Content */}
      <div
        ref={listRef}
        className={cx(
          'relative -mx-[9px] mt-2 min-h-0 flex-1 overflow-y-auto rounded-xl border p-2 pb-room transition-colors',
          dropTarget === 'here' ? 'drive-drop-here border-dashed border-brand-500 bg-brand-50/50' : 'border-transparent',
        )}
        onClick={() => setSelected(new Set())}
        onContextMenu={e => {
          e.preventDefault();
          setSelected(new Set());
          setMenu({ x: e.clientX, y: e.clientY, target: null });
        }}
      >
        {showPending && <PendingUploads where={here} />}
        {visible.length === 0 ? (
          showPending ? null : busy && !filtering ? (
            <Skeleton shape={view === 'grid' ? 'tiles' : 'list'} className="mx-auto max-w-[420px] py-10" />
          ) : filtering ? (
            // The search field and the labels stay above, as typed: one click to undo each.
            <EmptyState
              className="py-16"
              tone="search"
              title={q ? t('Aucun résultat pour « {q} »', { q }) : t('Aucun résultat')}
              action={activeTag ? { label: t('Retirer les filtres'), icon: Tag, onClick: () => setTagFilter(null) } : undefined}
            />
          ) : tab === 'starred' ? (
            <EmptyState
              className="py-16"
              icon={Star}
              title={t('Aucun favori')}
              text={
                <>
                  {/* Fingers can't right-click: the « ⋯ » of each item. */}
                  <span className="pointer-coarse:hidden">{t('Ajoute un favori avec un clic droit sur un élément.')}</span>
                  <span className="hidden pointer-coarse:inline">{t('Ajoute un favori avec le bouton ⋯ d’un élément.')}</span>
                </>
              }
              preview={view === 'grid' ? 'tiles' : 'list'}
            />
          ) : tab === 'recent' ? (
            <EmptyState className="py-16" icon={Clock} title={t('Aucun fichier récent')} preview="list" />
          ) : (
            <EmptyState
              className="py-16"
              icon={FolderOpen}
              title={parentId ? t('Ce dossier est vide') : t('Aucun fichier pour l’instant.')}
              // Fingers can't drop files on the page; everyone gets its own « Importer » button (the floating « + » alone
              // wasn't found).
              text={<span className="pointer-coarse:hidden">{t('Dépose des fichiers ici, ou :')}</span>}
              action={{ label: t('Importer des fichiers'), icon: Upload, onClick: () => fileInput.current?.click() }}
              preview={view === 'grid' ? 'tiles' : 'list'}
            />
          )
        ) : view === 'grid' && !q ? (
          <div role="listbox" aria-label={t('Contenu du dossier')} aria-multiselectable="true" className="grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-1.5">
            {visible.slice(0, shown).map(item => {
              const sel = selected.has(item.id);
              return (
                <div
                  key={item.id}
                  {...itemProps(item)}
                  className={cx(
                    'group relative flex cursor-default select-none flex-col items-center rounded-lg px-2 pb-2.5 pt-3.5 text-center transition-colors',
                    sel ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-stone-100/70',
                    dropTarget === item.id && 'bg-brand-50 ring-2 ring-brand-500',
                    (cutIds.has(item.id) || dragged.has(item.id)) && 'opacity-40',
                  )}
                  title={item.name}
                >
                  {touchMode && selectedIds.length > 0 && <span className="absolute left-2 top-2">{tick(sel)}</span>}
                  {moreButton(item, sel, 'absolute right-1 top-1')}
                  <span data-thumb className="flex h-16 w-full items-center justify-center">
                    <FileThumb key={thumbKey(item)} item={item} className="h-16 w-24" icon={<FileIcon category={categoryOf(item)} size={56} ext={extOf(item)} color={folderColor(item)} />} />
                  </span>
                  <p className="mt-2 line-clamp-2 w-full break-words text-[12.5px] font-medium leading-tight">{item.name}</p>
                  <p className="tabular mt-0.5 flex items-center gap-1 text-[11px] text-stone-500">
                    {item.starred && <Star size={11} className="shrink-0 fill-amber-400 text-amber-400" aria-label={t('Favori')} />}
                    {item.kind === 'folder' ? childCount(item.id) : formatBytes(item.size)}
                  </p>
                  {item.tags?.length ? (
                    <div className="mt-1.5 flex max-w-full flex-wrap justify-center gap-1">
                      {item.tags.slice(0, 2).map(tag => <TagPill key={tag} tag={tag} />)}
                      {item.tags.length > 2 && <span className="text-[10.5px] text-stone-500">+{item.tags.length - 2}</span>}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className={cx('grid grid-cols-[minmax(0,1fr)_64px_36px] gap-3 border-b border-stone-100 py-2 pl-4 pr-1.5 text-[12px] font-medium text-stone-500 sm:grid-cols-[minmax(0,1fr)_110px_80px_36px]', listCols)}>
              {sortBtn('name')}
              {!tabAll && <span className="hidden md:block">{t('Emplacement')}</span>}
              <span className="hidden sm:block">{sortBtn('date')}</span>
              {sortBtn('size')}
              <span />
            </div>
            <div role="listbox" aria-label={t('Contenu du dossier')} aria-multiselectable="true">
            {visible.slice(0, shown).map(item => {
              const sel = selected.has(item.id);
              return (
                <div
                  key={item.id}
                  {...itemProps(item)}
                  className={cx(
                    'group grid min-h-11 cursor-default select-none grid-cols-[minmax(0,1fr)_64px_36px] items-center gap-3 border-b border-stone-100 pl-4 pr-1.5 text-[13px] transition-colors last:border-0 sm:grid-cols-[minmax(0,1fr)_110px_80px_36px]',
                    listCols,
                    snippetOf(item) && 'py-2',
                    sel ? 'bg-brand-50' : 'hover:bg-stone-50',
                    dropTarget === item.id && 'bg-brand-50 ring-2 ring-inset ring-brand-500',
                    (cutIds.has(item.id) || dragged.has(item.id)) && 'opacity-40',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {tick(sel)}
                    <span data-thumb className="flex shrink-0">
                      <FileThumb key={thumbKey(item)} item={item} className="h-[26px] w-[26px] rounded-[5px]" icon={<FileIcon category={categoryOf(item)} size={26} ext={extOf(item)} color={folderColor(item)} />} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="max-w-full shrink-0 truncate font-medium">{q ? <Highlighted text={item.name} query={q} /> : item.name}</span>
                        {item.starred && <Star size={11} className="shrink-0 fill-amber-400 text-amber-400" />}
                        {/* The labels give way to the name: those that don't fit go to a hidden second line (never cut in half). */}
                        {item.tags?.length ? <span className="hidden h-[18px] min-w-0 shrink-[999] flex-wrap items-center gap-1 overflow-hidden sm:flex" title={item.tags.join(', ')}>{item.tags.map(tag => <TagPill key={tag} tag={tag} />)}</span> : null}
                      </span>
                      {!snippetOf(item) && <span className="block text-[11.5px] text-stone-500 sm:hidden">{relativeTime(item.updatedAt)}</span>}
                      {snippetOf(item) && (
                        <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-stone-500">
                          <Highlighted text={snippetOf(item)!} query={q} />
                        </span>
                      )}
                    </span>
                  </span>
                  {!tabAll && <span className="hidden truncate text-[12px] text-stone-500 md:block">{[t('Mes fichiers'), ...pathOf(items, item.parentId).map(p => p.name)].join(' / ')}</span>}
                  <span className="hidden text-[12px] text-stone-500 sm:block">{relativeTime(item.updatedAt)}</span>
                  <span className="tabular text-[12px] text-stone-500">{item.kind === 'folder' ? (folderSize(items, item.id) ? formatBytes(folderSize(items, item.id)) : '') : formatBytes(item.size)}</span>
                  {moreButton(item, sel)}
                </div>
              );
            })}
            </div>
          </div>
        )}

        {dropTarget === 'here' && (
          <div className="drive-drop-label pointer-events-none sticky bottom-4 mx-auto mt-4 w-fit rounded-lg bg-inverse px-3.5 py-2 text-[13px] font-medium text-on-inverse shadow-pop">
            {t('Déposer dans « {name} »', { name: current?.name ?? t('Mes fichiers') })}
          </div>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={shownMenu} onClose={() => setMenu(null)} />}
      {colorMenu && selectedFolders.length > 0 && (
        <ContextMenu
          x={colorMenu.x}
          y={colorMenu.y}
          label={t('Couleur du dossier')}
          onClose={() => setColorMenu(null)}
          items={[{
            label: t('Couleur du dossier'),
            onClick: () => {},
            content: (
              <FolderColorPicker
                value={selectedFolders.every(f => (f.color ?? null) === (selectedFolders[0].color ?? null)) ? (selectedFolders[0].color ?? null) : undefined}
                onPick={key => {
                  for (const f of selectedFolders) useDrive.getState().update(f.id, { color: key ?? undefined });
                  setColorMenu(null);
                }}
              />
            ),
          }]}
        />
      )}
      {sortMenu && (
        <ContextMenu
          x={sortMenu.x}
          y={sortMenu.y}
          onClose={() => setSortMenu(null)}
          items={(Object.keys(SORT_LABELS) as SortKey[]).map(key => {
            const on = activeSort?.key === key;
            return {
              label: on ? (activeSort?.asc ? t('{col} (croissant)', { col: SORT_LABELS[key] }) : t('{col} (décroissant)', { col: SORT_LABELS[key] })) : SORT_LABELS[key],
              icon: on ? activeSort?.asc ? <ArrowUp size={15} /> : <ArrowDown size={15} /> : undefined,
              onClick: () => changeSort(key),
            };
          })}
        />
      )}
      {previewItem && (
        <PreviewModal
          item={previewItem}
          onClose={closePreview}
          page={Number(params.get('page')) || undefined}
          actions={previewActions(previewItem)}
          onPrev={previewAt > 0 ? () => showFile(previewFiles[previewAt - 1]) : undefined}
          onNext={previewAt >= 0 && previewAt < previewFiles.length - 1 ? () => showFile(previewFiles[previewAt + 1]) : undefined}
          notes={linkedNotes}
        />
      )}
      {tagIds && <TagDialog ids={tagIds} onClose={() => setTagIds(null)} />}
      {shareItem && <ShareDialog item={shareItem} onClose={() => setShareItem(null)} />}
      <ShareToGroupDialog items={groupShare} onClose={() => setGroupShare(null)} />
      {photoSheet && <PhotoSheetDialog folderId={tabAll ? parentId : null} onClose={() => setPhotoSheet(false)} />}
      {moveIds && (
        <MoveDialog
          ids={moveIds}
          onClose={() => setMoveIds(null)}
          onMove={target => {
            moveTo(moveIds, target);
            setMoveIds(null);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

/** Its own component: the percentages change often, the rest of the page stays still. Each file can be paused or cancelled. */
function PendingUploads({ where }: { where: string }) {
  const pending = useUploads(useShallow(s => s.items.filter(u => notOver(u) && u.where === where)));
  const offline = useUploads(s => s.offline);
  return (
    <ul aria-label={t('Import…')} className="card mb-2 overflow-hidden">
      {/* Once for the list (each line keeps its percent): it goes on by itself once the network is back. */}
      {offline && pending.some(u => u.status === 'active') && (
        <li className="flex min-h-9 items-center gap-2 border-b border-stone-100 px-4 text-[12.5px] font-medium text-stone-500">
          <WifiOff size={14} aria-hidden />
          {t('En attente du réseau')}
        </li>
      )}
      {pending.map(u => (
        <li key={u.id} className="flex min-h-11 items-center gap-2.5 border-b border-stone-100 pl-4 pr-2 text-[13px] last:border-0">
          {/* Greyed: not in the folder yet. The buttons stay clear. */}
          <span className="flex min-w-0 flex-1 items-center gap-2.5 opacity-60">
            <FileIcon category={categoryOf({ kind: 'file', name: u.name })} size={26} ext={u.name.split('.').pop()} />
            <span className="min-w-0 flex-1 truncate font-medium">{u.name}</span>
            <span className="tabular shrink-0 text-[12px] text-stone-500">{u.status === 'paused' ? t('En pause') : u.waiting ? t('En attente') : `${u.size ? Math.floor((u.loaded / u.size) * 100) : 0}\u00a0%`}</span>
          </span>
          <span className="flex shrink-0 items-center">
            <FileButtons u={u} onCancel={b => keepFocus(b.closest('li'), document.getElementById('contenu'))} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The labels to filter with: one row, never scrolled sideways. Those that don't fit wait behind « +N »,
 * which shows them all (wrapped); the one chosen always stays in view.
 */
function TagFilter({ tags, active, onPick }: { tags: string[]; active: string | null; onPick: (tag: string) => void }) {
  const [all, setAll] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(tags.length);
  useLayoutEffect(() => {
    const el = box.current;
    const r = ruler.current;
    if (!el || !r) return;
    const measure = () => {
      const pills = [...r.children] as HTMLElement[];
      const more = pills.pop()!.offsetWidth;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      // The label icon (and its margin), then the pills.
      const icon = el.firstElementChild as HTMLElement;
      const room = el.clientWidth - icon.offsetWidth - (parseFloat(getComputedStyle(icon).marginRight) || 0);
      const widths = pills.map(p => p.offsetWidth + gap);
      if (widths.reduce((a, b) => a + b, 0) <= room) return setFit(tags.length);
      let used = more + gap;
      let n = 0;
      while (n < widths.length && used + widths[n] <= room) used += widths[n++];
      setFit(Math.max(1, n));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // The row, and the pills themselves (their font arriving changes their width).
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(r);
    return () => ro.disconnect();
  }, [tags, active]);
  const folded = !all && fit < tags.length;
  // The one chosen, when it would wait behind « +N »: in place of the last one shown.
  const first = tags.slice(0, fit);
  const shown = !folded ? tags : !active || first.includes(active) ? first : [...first.slice(0, -1), active];
  const moreClass = 'hit inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-full border border-stone-200 bg-surface px-2.5 text-[12px] font-medium text-stone-600 transition-colors hover:border-stone-300 hover:text-ink pointer-coarse:h-9';
  return (
    <div ref={box} className={cx('relative flex items-center gap-1.5 pb-0.5 pt-2', all && 'flex-wrap')}>
      <Tag size={13} className="mr-0.5 shrink-0 text-stone-400" />
      {shown.map(tag => (
        <TagPill key={tag} tag={tag} size="md" active={active === tag} onClick={() => onPick(tag)} />
      ))}
      {folded ? (
        <button className={moreClass} onClick={() => setAll(true)} aria-expanded={false} title={t('Afficher toutes les étiquettes')} aria-label={t('Afficher toutes les étiquettes')}>
          +{tags.length - shown.length}
        </button>
      ) : (
        all && fit < tags.length && (
          <button className={moreClass} onClick={() => setAll(false)} aria-expanded title={t('Afficher moins d’étiquettes')} aria-label={t('Afficher moins d’étiquettes')}>
            <ChevronUp size={13} />
          </button>
        )
      )}
      {/* Each pill measured once laid out, unseen. */}
      <div aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
        <div ref={ruler} className="flex w-max gap-1.5 whitespace-nowrap">
          {tags.map(tag => (
            <TagPill key={tag} tag={tag} size="md" active={active === tag} onClick={() => {}} />
          ))}
          <span className={moreClass}>+{tags.length}</span>
        </div>
      </div>
    </div>
  );
}
