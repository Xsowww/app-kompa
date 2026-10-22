import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, FileText, Folder, ListFilter, MoreHorizontal, RotateCcw, Trash2, X } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { parseISO } from 'date-fns';
import { categoryOf, FOLDER_COLORS, folderIconStyle, type DriveItem } from '../../store/drive';
import { catOf } from '../../store/calendar';
import { confirmAction, toast, useUi } from '../../store/ui';
import { ContextMenu, Modal, type MenuItem } from '../../components/Overlays';
import FileIcon from '../../components/FileIcon';
import PreviewModal from '../drive/PreviewModal';
import { cx } from '../../lib/utils';
import { fmt } from '../../lib/dates';
import { isMenuKey, menuPoint } from '../../lib/a11y';
import {
  useTrash, daysLeft, folderContent, restoreTrash, purgeTrash, emptyAllTrash, TRASH_TYPES, type TrashEntry, type TrashType,
} from '../../lib/trash';
import { TRASH_DAYS } from '../../store/drive';
import { t, tn } from '../../i18n';

/** `?type=` values (French, like the other URLs) ⇄ trash types. */
const PARAM: Record<TrashType, string> = { notes: 'notes', drive: 'drive', calendar: 'calendrier' };
const fromParam = (v: string | null): TrashType | null => (Object.keys(PARAM) as TrashType[]).find(k => PARAM[k] === v) ?? null;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
// fmt: « 1er nov. », as everywhere else (the file preview says « supprimé le 1er nov. à 10:05 »).
// Heavy (Tiptap): only loaded when a trashed note is previewed.
const NoteEditor = lazy(() => import('../notes/NoteEditor'));
const deletedOn = (iso: string) => (iso ? fmt(new Date(iso), 'd MMM') : '');
const deletedOnLong = (iso: string) => (iso ? fmt(new Date(iso), t("d MMM 'à' HH:mm")) : '');
const leftShort = (d: number) => (d <= 0 ? t('aujourd’hui') : t('dans {n} j', { n: d }));

const folderColor = (item: DriveItem) => (item.color ? FOLDER_COLORS[item.color]?.color : undefined);

function EntryIcon({ entry, size = 28 }: { entry: TrashEntry; size?: number }) {
  if (entry.kind === 'drive') {
    const it = entry.item;
    return <FileIcon category={categoryOf(it)} size={size} ext={it.kind === 'file' ? it.name.split('.').pop() : undefined} color={folderColor(it)} />;
  }
  const box = 'flex shrink-0 items-center justify-center rounded-md bg-stone-100 text-stone-500';
  if (entry.kind === 'event') {
    return (
      <span className={box} style={{ width: size, height: size }} aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: catOf(entry.event.category).color }} />
      </span>
    );
  }
  const Icon = entry.kind === 'noteFolder' ? Folder : FileText;
  return (
    <span className={box} style={{ width: size, height: size }} aria-hidden>
      {/* A coloured notes folder keeps its colour here, like in the notes. */}
      <Icon size={Math.round(size * 0.52)} style={entry.kind === 'noteFolder' ? folderIconStyle(entry.folder.color) : undefined} />
    </span>
  );
}

function kindLabel(e: TrashEntry) {
  if (e.kind === 'note') return t('Note');
  if (e.kind === 'noteFolder') return t('Dossier de notes');
  if (e.kind === 'event') return t('Événement');
  return e.item.kind === 'folder' ? t('Dossier du Drive') : t('Fichier du Drive');
}

/** Read-only look at a deleted thing, with Restore / Delete for good. */
function PreviewDialog({ entry, onClose, onRestore, onPurge }: { entry: TrashEntry; onClose: () => void; onRestore: () => void; onPurge: () => void }) {
  const content = useMemo(() => folderContent(entry), [entry]);
  const isFolder = entry.kind === 'noteFolder' || (entry.kind === 'drive' && entry.item.kind === 'folder');
  return (
    // 560: the date and both buttons on one line (at 520 « Restaurer » fell alone on a second line).
    <Modal open onClose={onClose} width={entry.kind === 'note' ? 720 : 560}>
      <div className="flex items-start gap-3">
        <EntryIcon entry={entry} size={34} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{entry.name}</h2>
          <p className="mt-0.5 truncate text-[12px] text-stone-500">
            {kindLabel(entry)} · {entry.kind === 'event' ? t('Calendrier') : entry.place}
          </p>
        </div>
        <button className="icon-btn -mr-1.5 -mt-1" onClick={onClose} title={t('Fermer (Échap)')} aria-label={t('Fermer')}>
          <X size={16} />
        </button>
      </div>

      <div className="mt-4">
        {entry.kind === 'note' ? (
          <div className="-mx-5 flex max-h-[55vh] flex-col border-y border-stone-100 [&_.prose-note]:min-h-0">
            <Suspense fallback={<div className="min-h-24" />}>
              <NoteEditor note={entry.note} readOnly inset="px-5 py-5" />
            </Suspense>
          </div>
        ) : entry.kind === 'event' ? (
          <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-stone-500">{t('Date')}</dt>
            <dd className="first-letter:uppercase">{fmt(parseISO(entry.event.date), 'EEEE d MMMM yyyy')}</dd>
            <dt className="text-stone-500">{t('Heure')}</dt>
            <dd className="tabular">{entry.event.start ? `${entry.event.start}${entry.event.end ? ` – ${entry.event.end}` : ''}` : t('Toute la journée')}</dd>
            <dt className="text-stone-500">{t('Catégorie')}</dt>
            <dd className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: catOf(entry.event.category).color }} aria-hidden />
              {catOf(entry.event.category).label}
              {entry.event.done && <span className="text-stone-500"> · {t('fait')}</span>}
            </dd>
            {entry.event.details && (
              <>
                <dt className="text-stone-500">{t('Détails')}</dt>
                <dd className="whitespace-pre-wrap text-stone-700">{entry.event.details}</dd>
              </>
            )}
          </dl>
        ) : isFolder ? (
          content.length ? (
            <ul className="max-h-[45vh] overflow-y-auto rounded-lg border border-stone-100 py-1" aria-label={t('Contenu du dossier')}>
              {content.map(c => (
                <li key={c.id} className="flex h-8 items-center gap-2 pr-3 text-[13px]" style={{ paddingLeft: 12 + c.depth * 18 }}>
                  {c.item ? (
                    <FileIcon category={categoryOf(c.item)} size={20} ext={c.item.kind === 'file' ? c.item.name.split('.').pop() : undefined} color={folderColor(c.item)} />
                  ) : c.folder ? (
                    <Folder size={15} className="shrink-0 text-stone-400" aria-hidden />
                  ) : (
                    <FileText size={15} className="shrink-0 text-stone-400" aria-hidden />
                  )}
                  <span className="truncate">{c.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-stone-500">{t('Dossier vide.')}</p>
          )
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto whitespace-nowrap text-[12px] text-stone-500">{t('Supprimé le {date}', { date: deletedOnLong(entry.deletedAt) })}</p>
        <button className="btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700" onClick={onPurge}>
          {t('Supprimer définitivement')}
        </button>
        <button className="btn-primary" onClick={onRestore}>
          <RotateCcw size={14} /> {t('Restaurer')}
        </button>
      </div>
    </Modal>
  );
}

export default function TrashPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const all = useTrash();
  const filter = fromParam(params.get('type'));
  const previewId = params.get('apercu');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  // `row`: opened from the ⋯ of a row, whose tap already opens the preview.
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[]; row?: boolean } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const refocusAt = useRef<number | null>(null);

  const counts = useMemo(() => {
    const c: Record<TrashType, number> = { notes: 0, drive: 0, calendar: 0 };
    for (const e of all) c[e.type]++;
    return c;
  }, [all]);
  const visible = useMemo(() => (filter ? all.filter(e => e.type === filter) : all), [all, filter]);
  const selectedIds = useMemo(() => visible.filter(e => selected.has(e.id)).map(e => e.id), [visible, selected]);
  const preview = previewId ? all.find(e => e.id === previewId) : undefined;

  const setFilter = (type: TrashType | null) => {
    setSelected(new Set());
    setParams(p => {
      const n = new URLSearchParams(p);
      if (type) n.set('type', PARAM[type]);
      else n.delete('type');
      n.delete('apercu');
      return n;
    });
  };

  const openPreview = useCallback(
    (id: string | null) =>
      setParams(p => {
        const n = new URLSearchParams(p);
        if (id) n.set('apercu', id);
        else n.delete('apercu');
        return n;
      }),
    [setParams],
  );

  // After a row disappears, keep the keyboard focus nearby.
  const rememberFocus = (ids: string[]) => {
    const idx = visible.findIndex(e => ids.includes(e.id));
    refocusAt.current = idx < 0 ? null : idx;
  };
  useEffect(() => {
    if (refocusAt.current === null) return;
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-row-main]');
    const i = refocusAt.current;
    refocusAt.current = null;
    if (rows?.length) rows[Math.min(i, rows.length - 1)].focus();
    else titleRef.current?.focus();
  }, [visible]);

  const restore = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      rememberFocus(ids);
      const r = restoreTrash(ids);
      setSelected(new Set());
      if (previewId && ids.includes(previewId)) openPreview(null);
      if (!r.names.length) return;
      const n = r.names.length;
      const name = r.names[0];
      const text = r.orphan
        ? n > 1
          ? tn(n, '{n} élément restauré à la racine (dossier d’origine supprimé)', '{n} éléments restaurés à la racine (dossier d’origine supprimé)')
          : t('« {name} » restauré à la racine (dossier d’origine supprimé)', { name })
        : n > 1
          ? tn(n, '{n} élément restauré', '{n} éléments restaurés')
          : t('« {name} » restauré', { name });
      const href = n === 1 ? r.href : null;
      toast(text, 'success', href ? { label: t('Ouvrir'), run: () => navigate(href) } : undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, previewId, openPreview, navigate],
  );

  const purge = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const first = all.find(e => e.id === ids[0]);
      const ok = await confirmAction(
        ids.length === 1 ? t('Supprimer « {name} » définitivement ?', { name: first?.name ?? '' }) : tn(ids.length, 'Supprimer {n} élément définitivement ?', 'Supprimer {n} éléments définitivement ?'),
        ids.length === 1 ? t('Impossible de le récupérer ensuite.') : t('Impossible de les récupérer ensuite.'),
        t('Supprimer définitivement'),
      );
      if (!ok) return;
      rememberFocus(ids);
      purgeTrash(ids);
      setSelected(new Set());
      if (previewId && ids.includes(previewId)) openPreview(null);
      toast(t('Supprimé définitivement'), 'success');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, visible, previewId, openPreview],
  );

  const emptyAll = async () => {
    if (!all.length) return;
    const ok = await confirmAction(t('Vider la corbeille ?'), tn(all.length, '{n} élément sera supprimé définitivement.', '{n} éléments seront supprimés définitivement.'), t('Vider la corbeille'));
    if (!ok) return;
    emptyAllTrash();
    setSelected(new Set());
    titleRef.current?.focus();
    toast(t('Corbeille vidée'), 'success');
  };

  const toggle = (id: string) =>
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const onRowClick = (e: React.MouseEvent, entry: TrashEntry) => {
    if (e.shiftKey && anchor) {
      const a = visible.findIndex(x => x.id === anchor);
      const b = visible.findIndex(x => x.id === entry.id);
      const [from, to] = a < b ? [a, b] : [b, a];
      setSelected(new Set(visible.slice(from, to + 1).map(x => x.id)));
      return;
    }
    setAnchor(entry.id);
    if (e.metaKey || e.ctrlKey) toggle(entry.id);
    else openPreview(entry.id);
  };

  const targetsOf = (id: string) => (selected.has(id) && selectedIds.length > 1 ? selectedIds : [id]);

  // No keyboard shortcuts in the menu on a touch screen (as in the Drive).
  const keys = !window.matchMedia('(pointer: coarse)').matches;
  const menuItems = (ids: string[], row?: boolean): MenuItem[] => [
    ...(ids.length === 1 && !row ? [{ label: t('Aperçu||d’un fichier'), icon: <Eye size={15} />, shortcut: keys ? t('Entrée') : undefined, onClick: () => openPreview(ids[0]) }] : []),
    { label: ids.length > 1 ? t('Restaurer ({n})', { n: ids.length }) : t('Restaurer'), icon: <RotateCcw size={15} />, onClick: () => restore(ids) },
    { label: '', divider: true, onClick: () => {} },
    { label: ids.length > 1 ? t('Supprimer définitivement ({n})', { n: ids.length }) : t('Supprimer définitivement'), icon: <Trash2 size={15} />, shortcut: keys ? t('Suppr') : undefined, danger: true, onClick: () => void purge(ids) },
  ];

  const onListKey = (e: React.KeyboardEvent) => {
    if (useUi.getState().dialog) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    const id = row?.dataset.id;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(visible.map(x => x.id)));
    } else if (e.key === 'Escape' && selected.size) {
      e.preventDefault();
      setSelected(new Set());
    } else if (!id) return;
    else if (isMenuKey(e)) {
      e.preventDefault();
      setMenu({ ...menuPoint(e), ids: targetsOf(id) });
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && (isMac || mod))) {
      e.preventDefault();
      void purge(targetsOf(id));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row-main]') ?? [])];
      const i = rows.findIndex(r => r.closest('[data-id]') === row);
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    }
  };

  const chip = (key: TrashType | null, label: string, n: number) => (
    <button
      key={key ?? 'all'}
      onClick={() => setFilter(key)}
      aria-pressed={filter === key}
      className={cx(
        'flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors pointer-coarse:h-9',
        filter === key ? 'border-stone-300 bg-surface text-ink shadow-card' : 'border-transparent text-stone-500 hover:bg-stone-100 hover:text-ink',
      )}
    >
      {label}
      {n > 0 && <span className="tabular text-stone-500">{n}</span>}
    </button>
  );

  return (
    <div className="h-full overflow-y-auto px-4 pb-room md:px-8">
      <div className="mx-auto max-w-[1180px]">
        <div className="flex flex-wrap items-start gap-3 pb-4 pt-2">
          <div className="min-w-0 flex-1">
            <h1 ref={titleRef} tabIndex={-1} className="text-[24px] font-semibold tracking-[-0.02em] outline-none">
              {t('Corbeille')}
            </h1>
            {/* Balanced lines: on a phone, beside « Vider la corbeille », « jours. » no longer wraps alone. */}
            <p className="mt-0.5 text-balance text-[13px] text-stone-500">{t('Suppression définitive après {n} jours.', { n: TRASH_DAYS })}</p>
          </div>
          {all.length > 0 && (
            <button className="btn-ghost mt-1 h-8 text-[12px] text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => void emptyAll()}>
              <Trash2 size={14} /> {t('Vider la corbeille')}
            </button>
          )}
        </div>

        {all.length > 0 && (
          <div role="group" aria-label={t('Filtrer')} className="-mx-1 mb-3 flex flex-wrap items-center gap-1">
            {chip(null, t('Tout'), 0)}
            {TRASH_TYPES.map(type => chip(type.key, type.label, counts[type.key]))}
          </div>
        )}

        {selectedIds.length > 0 && (
          <div className="enter mb-2 flex h-10 items-center gap-0.5 overflow-x-auto rounded-lg bg-inverse px-1.5 text-[13px] text-on-inverse shadow-pop">
            <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-on-inverse/10 sm:h-8 sm:w-8" onClick={() => setSelected(new Set())} title={t('Désélectionner (Échap)')} aria-label={t('Désélectionner')}>
              <X size={15} />
            </button>
            {/* On a phone the count stands alone, so both buttons fit (the count is in the bar already). */}
            <span className="mr-2 whitespace-nowrap px-1 font-medium" aria-live="polite">
              {selectedIds.length}
              <span className="max-sm:sr-only"> {tn(selectedIds.length, 'sélectionné', 'sélectionnés')}</span>
            </span>
            <span className="mr-1 h-4 w-px shrink-0 bg-on-inverse/20" />
            <button className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-on-inverse/85 hover:bg-on-inverse/10 hover:text-on-inverse sm:h-8" onClick={() => restore(selectedIds)}>
              <RotateCcw size={14} /> {t('Restaurer')}<span className="max-sm:hidden"> ({selectedIds.length})</span>
            </button>
            <button className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-on-inverse/85 hover:bg-on-inverse/10 hover:text-on-inverse sm:h-8" onClick={() => void purge(selectedIds)}>
              <Trash2 size={14} /> <span className="sm:hidden">{t('Supprimer')}</span>
              <span className="hidden sm:inline">{t('Supprimer définitivement ({n})', { n: selectedIds.length })}</span>
            </button>
          </div>
        )}

        {visible.length === 0 ? (
          all.length ? (
            <EmptyState className="py-16" tone="search" icon={ListFilter} title={t('Rien ici pour ce filtre.')} action={{ label: t('Retirer les filtres'), onClick: () => setFilter(null) }} />
          ) : (
            // Nothing to start here: no button, just what will be listed.
            <EmptyState className="py-16" icon={Trash2} title={t('La corbeille est vide.')} preview="list" />
          )
        ) : (
          <ul ref={listRef} className="card overflow-hidden" aria-label={t('Éléments supprimés')} onKeyDown={onListKey}>
            {visible.map(entry => {
              const sel = selected.has(entry.id);
              const left = daysLeft(entry.deletedAt);
              const descId = `corbeille-${entry.id}`;
              return (
                <li
                  key={entry.id}
                  data-id={entry.id}
                  className={cx('group relative flex min-h-[56px] items-center gap-3 border-b border-stone-100 pl-3 pr-2 transition-colors last:border-0 md:pl-4', sel ? 'bg-brand-50' : 'hover:bg-stone-50')}
                  onContextMenu={e => {
                    e.preventDefault();
                    setMenu({ ...menuPoint(e), ids: targetsOf(entry.id) });
                  }}
                >
                  {/* The label widens the box's tap area on touch screens (check-hit); the box itself doesn't change. */}
                  <label className="check-hit relative z-10 flex shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => {
                        toggle(entry.id);
                        setAnchor(entry.id);
                      }}
                      aria-label={t('Sélectionner « {name} »', { name: entry.name })}
                      className="h-4 w-4 cursor-pointer accent-[var(--color-ink)]"
                    />
                  </label>
                  <button
                    data-row-main
                    onClick={e => onRowClick(e, entry)}
                    aria-describedby={descId}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left outline-none after:absolute after:inset-0 after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-focus"
                  >
                    <EntryIcon entry={entry} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{entry.name}</span>
                      <span id={descId} className="block truncate text-[12px] text-stone-500">
                        <span className={cx(entry.placeGone && 'italic')}>{entry.place}</span>
                        <span className="sr-only">
                          {' '}
                          · {t('supprimé le {date}', { date: deletedOn(entry.deletedAt) })} · {left <= 0 ? t('effacé aujourd’hui') : tn(left, 'effacé dans {n} jour', 'effacé dans {n} jours')}
                        </span>
                      </span>
                    </span>
                    <span className="tabular hidden w-[120px] shrink-0 text-[12px] text-stone-500 md:block" aria-hidden>
                      {t('Supprimé le {date}', { date: deletedOn(entry.deletedAt) })}
                    </span>
                    <span
                      className={cx('tabular w-[64px] shrink-0 text-right text-[12px]', left <= 3 ? 'font-medium text-red-600' : 'text-stone-500')}
                      title={left <= 0 ? t('Supprimé définitivement aujourd’hui') : tn(left, 'Supprimé définitivement dans {n} jour', 'Supprimé définitivement dans {n} jours')}
                      aria-hidden
                    >
                      {leftShort(left)}
                    </span>
                  </button>
                  <span className="relative z-10 flex shrink-0 items-center md:w-[72px] md:justify-end">
                    {/* Touch screens (no hover): shown, they were invisible yet tappable on a tablet. */}
                    <span className="hidden items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:flex [@media(hover:none)]:opacity-100">
                      <button className="icon-btn" tabIndex={-1} onClick={() => restore(targetsOf(entry.id))} title={t('Restaurer')} aria-label={t('Restaurer « {name} »', { name: entry.name })}>
                        <RotateCcw size={15} />
                      </button>
                      <button
                        className="icon-btn hover:bg-red-50 hover:text-red-600"
                        tabIndex={-1}
                        onClick={() => void purge(targetsOf(entry.id))}
                        title={t('Supprimer définitivement')}
                        aria-label={t('Supprimer « {name} » définitivement', { name: entry.name })}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                    <button
                      className="icon-btn md:hidden"
                      onClick={e => setMenu({ ...menuPoint(e), ids: targetsOf(entry.id), row: true })}
                      aria-label={t('Actions pour « {name} »', { name: entry.name })}
                      aria-haspopup="menu"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.ids, menu.row)} onClose={() => setMenu(null)} />}
      {preview &&
        (preview.kind === 'drive' && preview.item.kind === 'file' ? (
          <PreviewModal
            item={preview.item}
            onClose={() => openPreview(null)}
            actions={
              <>
                <button onClick={() => restore([preview.id])} className="btn h-8 bg-white/10 text-white hover:bg-white/20 max-sm:w-9 max-sm:px-0" aria-label={t('Restaurer')}>
                  <RotateCcw size={15} /> <span className="hidden sm:inline">{t('Restaurer')}</span>
                </button>
                <button onClick={() => void purge([preview.id])} className="btn h-8 bg-white/10 text-white hover:bg-red-500/80 max-sm:w-9 max-sm:px-0" aria-label={t('Supprimer définitivement')}>
                  <Trash2 size={15} /> <span className="hidden sm:inline">{t('Supprimer')}</span>
                </button>
              </>
            }
          />
        ) : (
          <PreviewDialog entry={preview} onClose={() => openPreview(null)} onRestore={() => restore([preview.id])} onPurge={() => void purge([preview.id])} />
        ))}
    </div>
  );
}
