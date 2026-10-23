import { LoadFailed } from './shared';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { useCallback, useRef, useState } from 'react';
import { Download, Flag, FolderDown, Monitor, MoreHorizontal, Paperclip, Trash2 } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { ReportDialog } from '../../components/FeedbackDialogs';
import { useGroups } from '../../store/groups';
import { categoryOf, useDrive, type DriveItem } from '../../store/drive';
import { confirmAction, toast } from '../../store/ui';
import FileIcon from '../../components/FileIcon';
import { ContextMenu, type MenuItem } from '../../components/Overlays';
import PreviewModal from '../drive/PreviewModal';
import { downloadItem } from '../drive/download';
import { deleteFile, downloadFile, groupError, type Group, type GroupFile } from '../../lib/groups';
import { cx, formatBytes, relativeTime } from '../../lib/utils';
import { shareFiles, useGroupWords, useMemberName, useRights } from './util';
import { useCreateActions } from '../../store/create';
import { PlusHint } from '../../components/CreateButton';
import { t, tn } from '../../i18n';

/** Un fichier du groupe vu comme un élément du Drive (pour l'aperçu et le téléchargement). */
const asItem = (f: GroupFile): DriveItem => ({ id: f.id, name: f.name, kind: 'file', parentId: null, mime: f.mime ?? undefined, size: f.size, createdAt: f.createdAt, updatedAt: f.createdAt });

export default function GroupFiles({ group }: { group: Group }) {
  const w = useGroupWords();
  const files = useGroups(s => s.files[group.id]);
  const failed = useGroups(s => s.loadFailed[`${group.id}:files`]);
  const nameOf = useMemberName(group.id);
  const { canEdit } = useRights(group);
  const [preview, setPreview] = useState<GroupFile | null>(null);
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
      await useDrive.getState().uploadFiles([new File([blob], f.name, { type: f.mime ?? blob.type })], null);
      toast(t('« {name} » copié dans ton Drive', { name: f.name }), 'success');
    } catch (e) {
      toast(groupError(e), 'error');
    }
  };

  const remove = async (f: GroupFile) => {
    if (!(await confirmAction(t('Supprimer « {name} » ?', { name: f.name }), t('Il disparaît pour tous les membres {of}.', { of: w.of })))) return;
    try {
      await deleteFile(f);
      await useGroups.getState().refresh(group.id, ['files']);
      toast(t('Fichier supprimé'), 'success');
    } catch (e) {
      toast(groupError(e), 'error');
    }
  };

  // Phones: only « Télécharger » stays beside the name, the rest goes in « Plus d’actions » (4 icons cut the name short).
  const moreItems = (f: GroupFile): MenuItem[] => [
    { label: t('Copier dans mon Drive'), icon: <FolderDown size={15} />, onClick: () => void toDrive(f) },
    ...(f.createdBy !== me ? [{ label: t('Signaler'), icon: <Flag size={15} />, onClick: () => setReporting(f) }] : []),
    ...(canEdit ? [{ label: t('Supprimer'), icon: <Trash2 size={15} />, danger: true, onClick: () => void remove(f) }] : []),
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
        <p className="eyebrow pb-3">{tn(files.length, '{n} fichier partagé', '{n} fichiers partagés')}</p>
      )}
      <div className={cx('min-h-0 flex-1 overflow-y-auto rounded-xl pb-room', over && 'outline-2 outline-dashed outline-stone-300')}>
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
        {files && files.length > 0 && (
          <div className="card divide-y divide-stone-100 overflow-hidden">
            {files.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setPreview(f)} title={t('Aperçu de {name}', { name: f.name })}>
                  <FileIcon category={categoryOf({ kind: 'file', mime: f.mime ?? undefined, name: f.name })} size={32} ext={f.name.split('.').pop()} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{f.name}</span>
                    <span className="block truncate text-[12px] text-stone-500">
                      {formatBytes(f.size)} · {t('partagé par {name} {when}', { name: nameOf(f.createdBy), when: relativeTime(f.createdAt) })}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button className="icon-btn" title={t('Télécharger')} aria-label={t('Télécharger {name}', { name: f.name })} onClick={() => downloadItem(f, getUrl)}>
                    <Download size={15} />
                  </button>
                  <button className="icon-btn max-sm:hidden" title={t('Copier dans mon Drive')} aria-label={t('Copier {name} dans mon Drive', { name: f.name })} onClick={() => void toDrive(f)}>
                    <FolderDown size={15} />
                  </button>
                  {f.createdBy !== me && (
                    <button className="icon-btn max-sm:hidden" title={t('Signaler')} aria-label={t('Signaler {name}', { name: f.name })} onClick={() => setReporting(f)}>
                      <Flag size={15} />
                    </button>
                  )}
                  {canEdit && (
                    <button className="icon-btn hover:text-red-600 max-sm:hidden" title={t('Supprimer')} aria-label={t('Supprimer {name}', { name: f.name })} onClick={() => void remove(f)}>
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
      {preview && <PreviewModal item={asItem(preview)} getUrl={getUrl} when={t('partagé par {name} {when}', { name: nameOf(preview.createdBy), when: relativeTime(preview.createdAt) })} onClose={() => setPreview(null)} />}
    </div>
  );
}
