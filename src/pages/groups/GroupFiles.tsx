import { useCallback, useRef, useState } from 'react';
import { Download, Eye, Flag, FolderDown, Paperclip, Trash2 } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { ReportDialog } from '../../components/FeedbackDialogs';
import { useGroups } from '../../store/groups';
import { categoryOf, useDrive, type DriveItem } from '../../store/drive';
import { confirmAction, toast } from '../../store/ui';
import FileIcon from '../../components/FileIcon';
import PreviewModal from '../drive/PreviewModal';
import { downloadItem } from '../drive/download';
import { deleteFile, downloadFile, groupError, type Group, type GroupFile } from '../../lib/groups';
import { cx, formatBytes, relativeTime } from '../../lib/utils';
import { shareFiles, useGroupWords, useMemberName, useRights } from './util';

/** Un fichier du groupe vu comme un élément du Drive (pour l'aperçu et le téléchargement). */
const asItem = (f: GroupFile): DriveItem => ({ id: f.id, name: f.name, kind: 'file', parentId: null, mime: f.mime ?? undefined, size: f.size, createdAt: f.createdAt, updatedAt: f.createdAt });

export default function GroupFiles({ group }: { group: Group }) {
  const w = useGroupWords();
  const files = useGroups(s => s.files[group.id]);
  const nameOf = useMemberName(group.id);
  const { canEdit } = useRights(group);
  const [preview, setPreview] = useState<GroupFile | null>(null);
  const [reporting, setReporting] = useState<GroupFile | null>(null);
  const me = useAuth(s => s.user?.id);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

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
      toast(`« ${f.name} » copié dans ton Drive`, 'success');
    } catch (e) {
      toast(groupError(e), 'error');
    }
  };

  const remove = async (f: GroupFile) => {
    if (!(await confirmAction(`Supprimer « ${f.name} » ?`, `Il disparaît pour tous les membres ${w.of}.`))) return;
    try {
      await deleteFile(f);
      await useGroups.getState().refresh(group.id, ['files']);
      toast('Fichier supprimé', 'success');
    } catch (e) {
      toast(groupError(e), 'error');
    }
  };

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
      <p className="eyebrow pb-3">{files ? `${files.length} fichier${files.length > 1 ? 's' : ''} partagé${files.length > 1 ? 's' : ''}` : 'Chargement…'}</p>
      <div className={cx('min-h-0 flex-1 overflow-y-auto rounded-xl pb-16 lg:pb-14', over && 'outline-2 outline-dashed outline-stone-300')}>
        {files && files.length === 0 && (
          <div className="card flex flex-col items-center px-6 py-12 text-center">
            <Paperclip size={26} strokeWidth={1.5} className="text-stone-300" />
            <p className="mt-3 text-[14px] font-medium">Aucun fichier pour l’instant.</p>
            {canEdit && (
              <button className="btn-secondary mt-4 h-8 px-3" onClick={() => input.current?.click()} title="Ou dépose-les ici">
                <Paperclip size={14} /> Ajouter un fichier
              </button>
            )}
          </div>
        )}
        {files && files.length > 0 && (
          <div className="card divide-y divide-stone-100 overflow-hidden">
            {files.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setPreview(f)} title={`Aperçu de ${f.name}`}>
                  <FileIcon category={categoryOf({ kind: 'file', mime: f.mime ?? undefined, name: f.name })} size={32} ext={f.name.split('.').pop()} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{f.name}</span>
                    <span className="block truncate text-[12px] text-stone-500">
                      {formatBytes(f.size)} · partagé par {nameOf(f.createdBy)} {relativeTime(f.createdAt)}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button className="icon-btn hidden sm:flex" title="Aperçu" aria-label={`Aperçu de ${f.name}`} onClick={() => setPreview(f)}>
                    <Eye size={15} />
                  </button>
                  <button className="icon-btn" title="Télécharger" aria-label={`Télécharger ${f.name}`} onClick={() => downloadItem(f, getUrl)}>
                    <Download size={15} />
                  </button>
                  <button className="icon-btn" title="Copier dans mon Drive" aria-label={`Copier ${f.name} dans mon Drive`} onClick={() => void toDrive(f)}>
                    <FolderDown size={15} />
                  </button>
                  {f.createdBy !== me && (
                    <button className="icon-btn" title="Signaler" aria-label={`Signaler ${f.name}`} onClick={() => setReporting(f)}>
                      <Flag size={15} />
                    </button>
                  )}
                  {canEdit && (
                    <button className="icon-btn hover:text-red-600" title="Supprimer" aria-label={`Supprimer ${f.name}`} onClick={() => void remove(f)}>
                      <Trash2 size={15} />
                    </button>
                  )}
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
      {preview && <PreviewModal item={asItem(preview)} getUrl={getUrl} onClose={() => setPreview(null)} />}
    </div>
  );
}
