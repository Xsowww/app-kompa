import { ListTools, LoadFailed } from './shared';
import { sortFiles, type FileSort } from './logic';
import { removeWithUndo, usePendingRemovals } from './pending';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Download, Flag, FolderDown, Monitor, MoreHorizontal, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { ReportDialog } from '../../components/FeedbackDialogs';
import { useGroups } from '../../store/groups';
import { categoryOf, useDrive, type DriveItem } from '../../store/drive';
import { askText, toast } from '../../store/ui';
import FileIcon from '../../components/FileIcon';
import { ContextMenu, type MenuItem } from '../../components/Overlays';
import PreviewModal from '../drive/PreviewModal';
import { downloadItem } from '../drive/download';
import { deleteFile, downloadFile, groupError, renameFile, type Group, type GroupFile } from '../../lib/groups';
import { cx, formatBytes, relativeWhen } from '../../lib/utils';
import { useBackClose } from '../../lib/backClose';
import { shareFiles, useFinitions, useMemberName, useRememberedSort, useRights } from './util';
import { useCreateActions } from '../../store/create';
import { PlusHint } from '../../components/CreateButton';
import { t, tn } from '../../i18n';

/** Un fichier du groupe vu comme un élément du Drive (pour l'aperçu et le téléchargement). */
const asItem = (f: GroupFile): DriveItem => ({ id: f.id, name: f.name, kind: 'file', parentId: null, mime: f.mime ?? undefined, size: f.size, createdAt: f.createdAt, updatedAt: f.createdAt });

export default function GroupFiles({ group }: { group: Group }) {
  const all = useGroups(s => s.files[group.id]);
  // A file just deleted (its « Annuler » still on screen) is already gone from the list.
  const pending = usePendingRemovals(s => s.ids);
  const files = useMemo(() => all?.filter(f => !pending.includes(f.id)), [all, pending]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useRememberedSort<FileSort>('cop-groupe-fichiers-tri', ['recents', 'nom', 'taille']);
  const shown = useMemo(() => sortFiles(files ?? [], sort, query), [files, sort, query]);
  const failed = useGroups(s => s.loadFailed[`${group.id}:files`]);
  const nameOf = useMemberName(group.id);
  const { canEdit } = useRights(group);
  const [preview, setPreview] = useState<GroupFile | null>(null);
  useBackClose(!!preview, () => setPreview(null)); // the phone's Back closes the preview (Drive's and the trash's are in the address)
  const [reporting, setReporting] = useState<GroupFile | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const me = useAuth(s => s.user?.id);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The « + » button (the sharing lines follow it, GroupShare); a drop on the list works too.
  useCreateActions(canEdit ? [{ label: t('Ajouter un fichier'), icon: <Monitor />, onClick: () => input.current?.click() }] : []);

  // Contenu d'un fichier du groupe, en URL locale (aperçu, téléchargement).
  const getUrl = useCallback(
    async (id: string) => {
      const f = useGroups.getState().files[group.id]?.find(x => x.id === id);
      if (!f) return null;
      try {
        return URL.createObjectURL(await downloadFile(f));
      } catch {
        return null;
      }
    },
    [group.id],
  );

  const toDrive = async (f: GroupFile) => {
    try {
      const blob = await downloadFile(f);
      const [item] = await useDrive.getState().uploadFiles([new File([blob], f.name, { type: f.mime ?? blob.type })], null);
      // Cancelled on the upload card: nothing to say.
      if (item) toast(t('« {name} » copié dans tes fichiers', { name: f.name }), 'success');
    } catch (e) {
      toast(groupError(e), 'error');
    }
  };

  // For every member, for good: « Annuler » in the message rather than a question first. As the database: its author or the owner.
  const canDelete = (f: GroupFile) => canEdit && (f.createdBy === me || group.ownerId === me);
  // Renaming needs migration 2026-11-03 (before it, a shared file isn't renamed).
  const canRename = useFinitions() && canEdit;
  const remove = (f: GroupFile) =>
    removeWithUndo(
      [f.id],
      t('« {name} » supprimé', { name: f.name }),
      async () => {
        await deleteFile(f);
        await useGroups.getState().refresh(group.id, ['files']);
      },
      { table: 'group_files', ids: [f.id], paths: [`${f.groupId}/${f.id}`] },
    );

  const rename = async (f: GroupFile) => {
    const name = await askText(t('Renommer le fichier'), f.name, t('Renommer'), { fileName: true, maxLength: 255 });
    if (!name?.trim() || name.trim() === f.name) return;
    try {
      await renameFile(f, name);
      await useGroups.getState().refresh(group.id, ['files']);
    } catch (e) {
      toast(groupError(e), 'error');
    }
  };

  // Phones: only « Télécharger » stays beside the name, the rest goes in « Plus d’actions » (4 icons cut the name short).
  const moreItems = (f: GroupFile): MenuItem[] => [
    { label: t('Copier dans mes fichiers'), icon: <FolderDown size={15} />, onClick: () => void toDrive(f) },
    ...(canRename ? [{ label: t('Renommer'), icon: <Pencil size={15} />, onClick: () => void rename(f) }] : []),
    ...(f.createdBy !== me ? [{ label: t('Signaler'), icon: <Flag size={15} />, onClick: () => setReporting(f) }] : []),
    ...(canDelete(f) ? [{ label: t('Supprimer'), icon: <Trash2 size={15} />, danger: true, onClick: () => remove(f) }] : []),
  ];

  const drop = (e: React.DragEvent) => {
    if (!canEdit || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setOver(false);
    const list = [...e.dataTransfer.files];
    if (list.length) void shareFiles(group, list.map(f => ({ blob: f, name: f.name })));
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={e => {
        if (!canEdit || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={drop}
    >
      {files && files.length > 0 && (
        // Adding: the « + » button, or a drop here.
        <ListTools
          count={tn(files.length, '{n} fichier partagé', '{n} fichiers partagés')}
          query={query}
          onQuery={setQuery}
          placeholder={t('Rechercher un fichier')}
          sort={sort}
          onSort={setSort}
          sorts={[
            { value: 'recents', label: t('Partagés récemment') },
            { value: 'nom', label: t('Nom (A → Z)') },
            { value: 'taille', label: t('Taille') },
          ]}
        />
      )}
      <div className={cx('shadow-room min-h-0 flex-1 overflow-y-auto rounded-xl pb-room', over && 'outline-2 outline-dashed outline-stone-300')}>
        {!files && (failed ? <LoadFailed groupId={group.id} part="files" className="card" /> : <Skeleton className="card p-3" />)}
        {files && files.length === 0 && (
          <EmptyState
            className="card"
            icon={Paperclip}
            title={t('Aucun fichier pour l’instant.')}
            text={canEdit ? <PlusHint /> : undefined}
            preview="list"
          />
        )}
        {files && files.length > 0 && shown.length === 0 && <p className="card p-6 text-center text-[13px] text-stone-500">{t('Aucun fichier trouvé')}</p>}
        {shown.length > 0 && (
          <div className="card divide-y divide-stone-100 overflow-hidden">
            {shown.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setPreview(f)} title={t('Aperçu de {name}', { name: f.name })}>
                  <FileIcon category={categoryOf({ kind: 'file', mime: f.mime ?? undefined, name: f.name })} size={32} ext={f.name.split('.').pop()} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{f.name}</span>
                    <span className="block truncate text-[12px] text-stone-500">
                      {formatBytes(f.size)} · {t('partagé par {name} {when}', { name: nameOf(f.createdBy), when: relativeWhen(f.createdAt) })}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button className="icon-btn" title={t('Télécharger')} aria-label={t('Télécharger {name}', { name: f.name })} onClick={() => downloadItem(f, getUrl)}>
                    <Download size={15} />
                  </button>
                  <button className="icon-btn max-sm:hidden" title={t('Copier dans mes fichiers')} aria-label={t('Copier {name} dans mes fichiers', { name: f.name })} onClick={() => void toDrive(f)}>
                    <FolderDown size={15} />
                  </button>
                  {f.createdBy !== me && (
                    <button className="icon-btn max-sm:hidden" title={t('Signaler')} aria-label={t('Signaler {name}', { name: f.name })} onClick={() => setReporting(f)}>
                      <Flag size={15} />
                    </button>
                  )}
                  {canRename && (
                    <button className="icon-btn max-sm:hidden" title={t('Renommer')} aria-label={t('Renommer {name}', { name: f.name })} onClick={() => void rename(f)}>
                      <Pencil size={15} />
                    </button>
                  )}
                  {canDelete(f) && (
                    <button className="icon-btn hover:text-red-600 max-sm:hidden" title={t('Supprimer')} aria-label={t('Supprimer {name}', { name: f.name })} onClick={() => remove(f)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                  <button
                    className="icon-btn sm:hidden"
                    title={t('Plus d’actions')}
                    aria-label={t('Plus d’actions pour «\u00a0{name}\u00a0»', { name: f.name })}
                    aria-haspopup="menu"
                    onClick={e => {
                      // Under the button, right-aligned (clientX is 0 from the keyboard).
                      const r = e.currentTarget.getBoundingClientRect();
                      setMenu({ x: r.right - 208, y: r.bottom + 4, items: moreItems(f) });
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={e => {
          const list = [...(e.target.files ?? [])];
          e.target.value = '';
          if (list.length) void shareFiles(group, list.map(f => ({ blob: f, name: f.name })));
        }}
      />
      <ReportDialog target={reporting && { kind: 'file', id: reporting.id, title: reporting.name }} onClose={() => setReporting(null)} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {preview && <PreviewModal item={asItem(preview)} getUrl={getUrl} when={t('partagé par {name} {when}', { name: nameOf(preview.createdBy), when: relativeWhen(preview.createdAt) })} onClose={() => setPreview(null)} />}
    </div>
  );
}
