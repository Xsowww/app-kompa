import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronRight, ClipboardPaste, Copy, CopyPlus, Download, Eye, FolderInput, FolderPlus, FolderUp, HardDrive, LayoutGrid,
  List, Pencil, Scissors, Star, Trash2, Upload, Clock, ArrowUpDown, ArrowUp, ArrowDown, X, MousePointer2, Search, Tag, Link2, Check, Palette,
  MoreHorizontal, ClipboardList, BookOpenCheck, FolderOpen, WifiOff, FolderDown, ScanText,
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
import StorageGauge from './StorageGauge';
import { downloadItem, downloadZip } from './download';
import PhotoSheetDialog from './PhotoSheetDialog';
import { usePhotoReady } from './photoReady';
import MoveDialog from './MoveDialog';
import ShareDialog from './ShareDialog';
import TagDialog, { TagPill } from './TagDialog';
import { filesFromDrop, filesFromInput, uploadPending } from './upload';
import { isMenuKey, keepFocus, menuPoint } from '../../lib/a11y';
import { isTrashedDriveItem } from '../../lib/trash';
import { StorageError } from '../../lib/blobStore';
import { cloudEnabled } from '../../lib/supabase';
import { useProgressive } from '../../lib/useProgressive';
import { useShallow } from 'zustand/react/shallow';
import { driveWhere, isUploadAbort, notOver, useUploads } from '../../store/uploads';
import { useCreateActions } from '../../store/create';
import { t, tn, locale } from '../../i18n';

type Tab = 'all' | 'starred' | 'recent';
type SortKey = 'name' | 'date' | 'size';
type Sort = { key: SortKey; asc: boolean };
const SORT_LABELS: Record<SortKey, string> = { name: t('Nom'), date: t('Modifié'), size: t('Taille') };
/** The same, inside a sentence (« Trier par nom »). */
const SORT_NAMES: Record<SortKey, string> = { name: t('nom'), date: t('modifié'), size: t('taille') };

const DRAG_MIME = 'application/x-cop-drive';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

const folderColor = (item: DriveItem) => (item.color ? FOLDER_COLORS[item.color]?.color : undefined);

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

const CANT_COPY_INTO_ITSELF = t('Impossible de copier un dossier dans lui-même ou dans un de ses sous-dossiers');
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
  // Item holding the list's single Tab stop (arrows move it).
  const [focusId, setFocusId] = useState<string | null>(null);
  // Last pointer was a finger: a tap adds to the selection instead of replacing it.
  const [touchMode, setTouchMode] = useState(false);
  // An item is being dragged: keep the breadcrumb (drop targets) instead of the selection bar.
  const [dragging, setDragging] = useState(false);
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

  /** A menu opened from a button of the selection bar: under the button, not over it (and the bar). */
  const under = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.bottom + 6) };
  };

  // ── Selection ─────────────────────────────────────────────────────────────
  const onItemClick = (e: React.MouseEvent, item: DriveItem) => {
    e.stopPropagation();
    if (e.shiftKey && anchor) {
      const a = visible.findIndex(i => i.id === anchor);
      const b = visible.findIndex(i => i.id === item.id);
      const [from, to] = a < b ? [a, b] : [b, a];
      setSelected(new Set(visible.slice(from, to + 1).map(i => i.id)));
      return;
    }
    // On a phone, once something is selected, each tap adds or removes an item (selection mode).
    if (e.metaKey || e.ctrlKey || (touchMode && selectedIds.length > 0)) {
      setSelected(s => {
        const n = new Set(s);
        if (n.has(item.id)) n.delete(item.id);
        else n.add(item.id);
        return n;
      });
    } else {
      setSelected(new Set([item.id]));
    }
    setAnchor(item.id);
  };

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, [contenteditable="true"], [role="menu"]') || previewItem || moveIds || tagIds || shareItem || useUi.getState().dialog) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'a') {
        e.preventDefault();
        setSelected(new Set(visible.map(i => i.id)));
      } else if (mod && k === 'c') copy(selectedIds);
      else if (mod && k === 'x') cut(selectedIds);
      else if (mod && k === 'v' && tab === 'all') void paste(parentId);
      else if (mod && k === 'd') {
        e.preventDefault();
        void duplicate(selectedIds);
      } else if (e.key === 'Delete' || (e.key === 'Backspace' && (isMac || mod))) {
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
  }, [visible, selectedIds, single, parentId, tab, current, previewItem, moveIds, tagIds, shareItem, copy, cut, paste, duplicate, remove, rename, openItem, openFolder]);

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent, item: DriveItem) => {
    const ids = selected.has(item.id) ? selectedIds : [item.id];
    if (!selected.has(item.id)) setSelected(new Set([item.id]));
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'copyMove';
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
  const listCols = tabAll ? 'md:grid-cols-[minmax(0,1fr)_130px_90px]' : 'md:grid-cols-[minmax(0,1fr)_200px_130px_90px]';

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
        ...(items.length ? [{ label: t('Tout télécharger (.zip)'), icon: <FolderDown size={15} />, onClick: () => void downloadZip(items, items.filter(i => !i.parentId).map(i => i.id), 'Kompaly Drive') }] : []),
      ];
    }
    const ids = selectedIds.length ? selectedIds : [menu.target];
    const item = items.find(i => i.id === menu.target);
    // Everything but what the phone selection bar shows next to « Plus d’actions ».
    const full = !menu.bar;
    const one = ids.length === 1 && item;
    const targets = items.filter(i => ids.includes(i.id));
    const allFolders = targets.length > 0 && targets.every(i => i.kind === 'folder');
    const palette: MenuItem[] = allFolders && full
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
      ...(one ? [{ label: item.kind === 'folder' ? t('Ouvrir') : t('Aperçu||d’un fichier'), icon: <Eye size={15} />, shortcut: t('Entrée'), onClick: () => openItem(item) }] : []),
      ...(one && item.kind === 'file'
        ? [{ label: t('Télécharger'), icon: <Download size={15} />, onClick: () => downloadItem(item) }]
        : [{ label: t('Télécharger (.zip)'), icon: <FolderDown size={15} />, onClick: () => void downloadZip(items, ids, one ? item.name : 'Kompaly Drive') }]),
      ...(one ? [{ label: '', divider: true, onClick: () => {} }] : []),
      { label: t('Copier'), icon: <Copy size={15} />, shortcut: `${MOD}C`, onClick: () => copy(ids) },
      { label: t('Couper'), icon: <Scissors size={15} />, shortcut: `${MOD}X`, onClick: () => cut(ids) },
      ...(one && item.kind === 'folder' ? [{ label: t('Coller dans ce dossier'), icon: <ClipboardPaste size={15} />, disabled: !clipboard?.ids.length, onClick: () => void paste(item.id) }] : []),
      { label: t('Dupliquer'), icon: <CopyPlus size={15} />, shortcut: `${MOD}D`, onClick: () => void duplicate(ids) },
      ...(full ? [{ label: t('Déplacer vers…'), icon: <FolderInput size={15} />, onClick: () => setMoveIds(ids) }] : []),
      ...(one && full ? [{ label: t('Renommer'), icon: <Pencil size={15} />, shortcut: 'F2', onClick: () => void rename(item) }] : []),
      ...(one ? [{ label: item.starred ? t('Retirer des favoris') : t('Ajouter aux favoris'), icon: <Star size={15} />, onClick: () => useDrive.getState().toggleStar(item.id) }] : []),
      ...(full ? [{ label: t('Étiquettes…'), icon: <Tag size={15} />, onClick: () => setTagIds(ids) }] : []),
      // Links only exist online: no dead-end entry in the local version.
      ...(one && item.kind === 'file' && cloudEnabled ? [{ label: t('Partager le lien…'), icon: <Link2 size={15} />, onClick: () => setShareItem(item) }] : []),
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
            { label: t('Mettre à la corbeille'), icon: <Trash2 size={15} />, shortcut: t('Suppr'), danger: true, onClick: () => void remove(ids) },
          ]
        : []),
    ];
    return list;
  }, [menu, selectedIds, items, clipboard, tabAll, parentId, visible, newFolder, paste, openItem, copy, cut, duplicate, rename, remove, making, rec, photoReady]);
  // No keyboard shortcuts on a phone.
  const shownMenu = touchMode ? menuItems.map(i => ({ ...i, shortcut: undefined })) : menuItems;

  const cutIds = clipboard?.mode === 'cut' ? new Set(clipboard.ids) : new Set<string>();

  const itemProps = (item: DriveItem) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => onDragStart(e, item),
    // Dropped outside any target (or cancelled): no highlight left behind.
    onDragEnd: () => {
      setDragging(false);
      setDropTarget(null);
      dragDepth.current = 0;
    },
    onClick: (e: React.MouseEvent) => onItemClick(e, item),
    onDoubleClick: () => openItem(item),
    onContextMenu: (e: React.MouseEvent) => onItemContext(e, item),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => onItemKey(e, item),
    onFocus: () => setFocusId(item.id),
    tabIndex: item.id === activeId ? 0 : -1,
    'aria-selected': selected.has(item.id),
    'data-id': item.id,
    role: 'option',
    ...(item.kind === 'folder' ? folderDropProps(item.id, item.id) : {}),
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

  // Content matches only (a name match speaks for itself).
  const snippetOf = (item: DriveItem) => (q && !fold(item.name).includes(fold(q)) ? contentHits.get(item.id)?.snippet : undefined);

  const extOf = (item: DriveItem) => (item.kind === 'file' ? item.name.split('.').pop() : undefined);
  const bar = !dragging && (selectedIds.length > 1 || (selectedIds.length === 1 && !previewItem));

  return (
    <div
      className="flex h-full flex-col px-4 pb-4 md:px-8"
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3 pb-4 pt-2">
        <h1 className="mr-3 text-[24px] font-semibold tracking-[-0.02em]">{t('Drive')}</h1>
        <div className="flex h-10 items-center rounded-lg bg-stone-100 p-0.5 text-[13px] sm:h-8 pointer-coarse:h-10">
          {([
            ['all', t('Mon Drive'), HardDrive],
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
              className={cx('hit flex h-9 min-w-10 items-center justify-center gap-1.5 rounded-md px-2.5 font-medium transition-colors sm:h-7 sm:min-w-0 pointer-coarse:h-9 pointer-coarse:min-w-11', tab === k ? 'bg-surface text-ink shadow-card' : 'text-stone-500 hover:text-ink')}
            >
              <Icon size={13} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
        {/* Phones: the search fills its own row under the title, the views and the tools, from margin to margin.
            Computers: at the right of the row, before sort and view, as high as them. */}
        <label className="relative order-last w-full sm:order-none sm:ml-auto sm:w-auto">
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
            aria-label={t('Rechercher dans le Drive')}
            className="field h-8 w-full text-ellipsis pl-8 pr-7 sm:w-52 xl:w-72"
          />
          {query && (
            <button className="hit absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-stone-500 hover:text-ink" onClick={() => setQuery('')} title={t('Effacer')} aria-label={t('Effacer')}>
              <X size={13} />
            </button>
          )}
        </label>
        <div className="ml-auto flex items-center gap-1.5 pointer-coarse:gap-3 sm:ml-0">
          {view === 'grid' && !q && (
            <button
              className="icon-btn"
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

      <StorageGauge />

      {/* Breadcrumb / selection bar */}
      <div className="flex h-10 items-center gap-1 text-[13px]">
        {bar ? (
          <div className="enter flex h-10 w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-inverse px-1.5 text-on-inverse shadow-pop">
            <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-on-inverse/10 sm:h-8 sm:w-8 pointer-coarse:h-9 pointer-coarse:w-9" onClick={() => setSelected(new Set())} title={t('Désélectionner (Échap)')} aria-label={t('Désélectionner (Échap)')}>
              <X size={15} />
            </button>
            <span className="mr-2 whitespace-nowrap px-1 font-medium">
              {selectedIds.length}
              <span className="max-sm:sr-only"> {tn(selectedIds.length, 'sélectionné', 'sélectionnés')}</span>
            </span>
            <span className="mr-1 h-4 w-px bg-on-inverse/20" />
            {[
              // Phones: the less frequent ones go in « Plus d’actions » (9 buttons overflowed the bar).
              { icon: Copy, label: t('Copier'), fn: () => copy(selectedIds), more: true },
              { icon: Scissors, label: t('Couper'), fn: () => cut(selectedIds), more: true },
              { icon: CopyPlus, label: t('Dupliquer'), fn: () => void duplicate(selectedIds), more: true },
              { icon: FolderInput, label: t('Déplacer'), fn: () => setMoveIds(selectedIds) },
              ...(single ? [{ icon: Pencil, label: t('Renommer'), fn: () => void rename(single) }] : []),
              single?.kind === 'file'
                ? { icon: Download, label: t('Télécharger'), fn: () => downloadItem(single), more: true }
                : { icon: FolderDown, label: t('Télécharger (.zip)'), fn: () => void downloadZip(items, selectedIds, single?.name ?? 'Kompaly Drive'), more: true },
              { icon: Tag, label: t('Étiquettes'), fn: () => setTagIds(selectedIds) },
              ...(selectedFolders.length === selectedIds.length ? [{ icon: Palette, label: t('Couleur'), fn: (e: React.MouseEvent) => setColorMenu(under(e)) }] : []),
              { icon: Trash2, label: t('Corbeille||barre de sélection'), fn: () => void remove(selectedIds) },
            ].map(a => (
              <button
                key={a.label}
                onClick={a.fn}
                className={cx(
                  'flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-on-inverse/85 pointer-coarse:h-9 pointer-coarse:min-w-9 hover:bg-on-inverse/10 hover:text-on-inverse',
                  'more' in a && 'max-sm:hidden',
                )}
                title={a.label}
                aria-label={a.label}
              >
                {/* The less frequent ones: their icon alone below 1536 px (German labels overflowed the bar at 1280). */}
                <a.icon size={14} /> <span className={'more' in a ? 'hidden 2xl:inline' : 'hidden lg:inline'}>{a.label}</span>
              </button>
            ))}
            <button
              onClick={e => setMenu({ ...under(e), target: selectedIds[0], bar: true })}
              className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-on-inverse/85 hover:bg-on-inverse/10 sm:hidden"
              title={t('Plus d’actions')}
              aria-label={t('Plus d’actions')}
              aria-haspopup="menu"
            >
              <MoreHorizontal size={15} />
            </button>
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
                className={cx('rounded-md px-1.5 py-1 font-medium text-stone-500 transition-colors hover:bg-stone-100 pointer-coarse:py-3', dropTarget === 'crumb-root' && 'bg-brand-50 text-brand-700')}
              >
                {t('Mon Drive')}
              </button>
            )}
            {breadcrumb.map(b => (
              <span key={b.id} className="flex min-w-0 items-center gap-1">
                <ChevronRight size={14} className="shrink-0 text-stone-300" />
                <button
                  onClick={() => openFolder(b.id)}
                  {...folderDropProps(b.id, `crumb-${b.id}`)}
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
      </div>

      {/* Label filter */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 pt-2">
          <Tag size={13} className="mr-0.5 shrink-0 text-stone-400" />
          {allTags.map(tag => (
            <TagPill key={tag} tag={tag} size="md" active={activeTag === tag} onClick={() => { setTagFilter(activeTag === tag ? null : tag); setSelected(new Set()); }} />
          ))}
        </div>
      )}

      {/* Content */}
      <div
        className={cx(
          'relative -mx-[9px] mt-2 min-h-0 flex-1 overflow-y-auto rounded-xl border p-2 pb-room transition-colors',
          dropTarget === 'here' ? 'border-dashed border-brand-500 bg-brand-50/50' : 'border-transparent',
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
                  {/* Fingers can't right-click (a long press opens the menu). */}
                  <span className="pointer-coarse:hidden">{t('Ajoute un favori avec un clic droit sur un élément.')}</span>
                  <span className="hidden pointer-coarse:inline">{t('Ajoute un favori en appuyant longuement sur un élément.')}</span>
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
              // Fingers can't drop files on the page: the « + » button for them.
              text={<><span className="pointer-coarse:hidden">{t('Dépose des fichiers ici.')}</span><span className="hidden pointer-coarse:inline">{t('Touche + pour commencer.')}</span></>}
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
                    cutIds.has(item.id) && 'opacity-40',
                  )}
                  title={item.name}
                >
                  {item.starred && <Star size={11} className="absolute right-2.5 top-2.5 fill-amber-400 text-amber-400" />}
                  {touchMode && selectedIds.length > 0 && <span className="absolute left-2 top-2">{tick(sel)}</span>}
                  <FileIcon category={categoryOf(item)} size={56} ext={extOf(item)} color={folderColor(item)} />
                  <p className="mt-2 line-clamp-2 w-full break-words text-[12.5px] font-medium leading-tight">{item.name}</p>
                  <p className="tabular mt-0.5 text-[11px] text-stone-500">
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
            <div className={cx('grid grid-cols-[minmax(0,1fr)_64px] gap-3 border-b border-stone-100 px-4 py-2 text-[12px] font-medium text-stone-500 sm:grid-cols-[minmax(0,1fr)_110px_80px]', listCols)}>
              {sortBtn('name')}
              {!tabAll && <span className="hidden md:block">{t('Emplacement')}</span>}
              <span className="hidden sm:block">{sortBtn('date')}</span>
              {sortBtn('size')}
            </div>
            <div role="listbox" aria-label={t('Contenu du dossier')} aria-multiselectable="true">
            {visible.slice(0, shown).map(item => {
              const sel = selected.has(item.id);
              return (
                <div
                  key={item.id}
                  {...itemProps(item)}
                  className={cx(
                    'grid min-h-11 cursor-default select-none grid-cols-[minmax(0,1fr)_64px] items-center gap-3 border-b border-stone-100 px-4 text-[13px] transition-colors last:border-0 sm:grid-cols-[minmax(0,1fr)_110px_80px]',
                    listCols,
                    snippetOf(item) && 'py-2',
                    sel ? 'bg-brand-50' : 'hover:bg-stone-50',
                    dropTarget === item.id && 'bg-brand-50 ring-2 ring-inset ring-brand-500',
                    cutIds.has(item.id) && 'opacity-40',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {tick(sel)}
                    <FileIcon category={categoryOf(item)} size={26} ext={extOf(item)} color={folderColor(item)} />
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium">{q ? <Highlighted text={item.name} query={q} /> : item.name}</span>
                        {item.starred && <Star size={11} className="shrink-0 fill-amber-400 text-amber-400" />}
                        {item.tags?.length ? <span className="hidden shrink-0 items-center gap-1 sm:flex">{item.tags.map(tag => <TagPill key={tag} tag={tag} />)}</span> : null}
                      </span>
                      {snippetOf(item) && (
                        <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-stone-500">
                          <Highlighted text={snippetOf(item)!} query={q} />
                        </span>
                      )}
                    </span>
                  </span>
                  {!tabAll && <span className="hidden truncate text-[12px] text-stone-500 md:block">{[t('Mon Drive'), ...pathOf(items, item.parentId).map(p => p.name)].join(' / ')}</span>}
                  <span className="hidden text-[12px] text-stone-500 sm:block">{relativeTime(item.updatedAt)}</span>
                  <span className="tabular text-[12px] text-stone-500">{item.kind === 'folder' ? (folderSize(items, item.id) ? formatBytes(folderSize(items, item.id)) : '') : formatBytes(item.size)}</span>
                </div>
              );
            })}
            </div>
          </div>
        )}

        {dropTarget === 'here' && (
          <div className="pointer-events-none sticky bottom-4 mx-auto mt-4 w-fit rounded-lg bg-inverse px-3.5 py-2 text-[13px] font-medium text-on-inverse shadow-pop">
            {t('Déposer dans « {name} »', { name: current?.name ?? t('Mon Drive') })}
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
      {previewItem && <PreviewModal item={previewItem} onClose={closePreview} page={Number(params.get('page')) || undefined} />}
      {tagIds && <TagDialog ids={tagIds} onClose={() => setTagIds(null)} />}
      {shareItem && <ShareDialog item={shareItem} onClose={() => setShareItem(null)} />}
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
            <span className="tabular shrink-0 text-[12px] text-stone-500">{u.status === 'paused' ? t('En pause') : `${u.size ? Math.floor((u.loaded / u.size) * 100) : 0}\u00a0%`}</span>
          </span>
          <span className="flex shrink-0 items-center">
            <FileButtons u={u} onCancel={b => keepFocus(b.closest('li'), document.getElementById('contenu'))} />
          </span>
        </li>
      ))}
    </ul>
  );
}
