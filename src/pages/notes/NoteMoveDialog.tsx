import { useState } from 'react';
import { FolderOpen, NotebookPen } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { useNotes, folderDescendants } from '../../store/notes';
import { cx } from '../../lib/utils';
import { folderIconStyle } from '../../store/drive';

/** What to move: a note, or a folder (never into itself or one of its sub-folders). */
export type NoteMoveTarget = { kind: 'note'; id: string; name: string; from: string | null } | { kind: 'folder'; id: string; name: string; from: string | null };

/** « Déplacer vers… » for notes and folders: the keyboard and touch way to do what drag & drop does. */
export default function NoteMoveDialog({ target, onClose }: { target: NoteMoveTarget; onClose: () => void }) {
  const folders = useNotes(s => s.folders);
  const [dest, setDest] = useState<string | null>(target.from);
  const forbidden = new Set(target.kind === 'folder' ? folderDescendants(folders, target.id) : []);

  const level = (parent: string | null, depth: number): React.ReactNode =>
    folders
      .filter(f => f.parentId === parent && !forbidden.has(f.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map(f => (
        <div key={f.id}>
          <Choice selected={dest === f.id} depth={depth} onClick={() => setDest(f.id)}>
            <FolderOpen size={15} className={cx('shrink-0', !f.color && 'text-stone-500')} style={folderIconStyle(f.color)} />
            <span className="truncate">{f.name}</span>
          </Choice>
          {level(f.id, depth + 1)}
        </div>
      ));

  const move = () => {
    if (target.kind === 'note') useNotes.getState().updateNote(target.id, { folderId: dest });
    else useNotes.getState().moveFolder(target.id, dest);
    onClose();
  };

  return (
    <Modal open onClose={onClose} width={420}>
      <h3 className="truncate text-[15px] font-semibold">Déplacer « {target.name} »</h3>
      <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-stone-200 p-1">
        <Choice selected={dest === null} depth={0} onClick={() => setDest(null)}>
          <NotebookPen size={15} className="shrink-0 text-stone-500" />
          <span className="font-medium">Sans dossier</span>
        </Choice>
        {level(null, 1)}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          Annuler
        </button>
        <button className="btn-primary" disabled={dest === target.from} onClick={move}>
          Déplacer ici
        </button>
      </div>
    </Modal>
  );
}

function Choice({ selected, depth, onClick, children }: { selected: boolean; depth: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx('flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-[13px]', selected ? 'bg-brand-50 font-medium text-brand-700' : 'hover:bg-stone-100')}
      style={{ paddingLeft: 8 + depth * 18 }}
    >
      {children}
    </button>
  );
}
