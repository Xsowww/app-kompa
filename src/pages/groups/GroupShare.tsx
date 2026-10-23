import { useMemo, useRef, useState } from 'react';
import { FileText, HardDrive, Monitor, Search } from 'lucide-react';
import { useGroups } from '../../store/groups';
import { useNotes } from '../../store/notes';
import { categoryOf, pathOf, useDrive } from '../../store/drive';
import { toast } from '../../store/ui';
import { Modal } from '../../components/Overlays';
import { useCreateActions } from '../../store/create';
import FileIcon from '../../components/FileIcon';
import { blobStore } from '../../lib/blobStore';
import { blobKey } from '../../lib/userStorage';
import { MAX_GROUP_FILE, createNote, groupError, summary, type Group } from '../../lib/groups';
import { groupWordsNow, shareFiles } from './util';
import { cx, formatBytes, normalize, noteText } from '../../lib/utils';
import { t } from '../../i18n';

/** « Une de mes notes » : copie une note personnelle dans le groupe. */
function NotePicker({ group, onPicked, onClose }: { group: Group; onPicked: (id: string) => void; onClose: () => void }) {
  const notes = useNotes(s => s.notes);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const nq = normalize(q);
  const list = useMemo(
    () => [...notes].filter(n => !nq || normalize(n.title).includes(nq)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50),
    [notes, nq],
  );
  const pick = async (id: string) => {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    setBusy(id);
    try {
      const copy = await createNote(group.id, n.title, n.content);
      useGroups.getState().upsertNote(summary(copy));
      toast(t('Note partagée avec {group}', { group: groupWordsNow().the }), 'success');
      onPicked(copy.id);
    } catch (e) {
      toast(groupError(e), 'error');
      setBusy(null);
    }
  };
  return (
    <div>
      <h3 className="text-[15px] font-semibold">{t('Partager une de mes notes')}</h3>
      <p className="mt-1 text-[13px] text-stone-500">{t('Une copie est ajoutée à « {name} » ; ta note reste privée.', { name: group.name })}</p>
      <div className="relative mt-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('Rechercher une note')} aria-label={t('Rechercher une note')} className="field w-full pl-8" />
      </div>
      <div className="mt-2 max-h-[320px] overflow-y-auto">
        {list.length === 0 && <p className="p-6 text-center text-[13px] text-stone-500">{notes.length ? t('Aucune note trouvée') : t('Tu n’as pas encore de note.')}</p>}
        {list.map(n => (
          <button
            key={n.id}
            disabled={busy !== null}
            onClick={() => void pick(n.id)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-stone-50 disabled:opacity-50"
          >
            <FileText size={15} className="shrink-0 text-stone-400" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{n.title}</span>
              <span className="block truncate text-[12px] text-stone-500">{noteText(n).slice(0, 120) || t('Note vide')}</span>
            </span>
            {busy === n.id && <span className="text-[12px] text-stone-500">{t('Copie…')}</span>}
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-secondary" onClick={onClose}>{t('Fermer')}</button>
      </div>
    </div>
  );
}

/** « Un fichier de mon Drive » : liste à plat (avec le dossier), recherche, plusieurs à la fois. */
function DrivePicker({ group, onDone, onClose }: { group: Group; onDone: () => void; onClose: () => void }) {
  const items = useDrive(s => s.items);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const nq = normalize(q);
  const files = useMemo(
    () =>
      items
        .filter(i => i.kind === 'file')
        .map(i => ({ item: i, where: pathOf(items, i.parentId).map(p => p.name).join(' / ') || t('Mon Drive') }))
        .filter(({ item, where }) => !nq || normalize(item.name).includes(nq) || normalize(where).includes(nq))
        .sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt))
        .slice(0, 200),
    [items, nq],
  );
  const toggle = (id: string) =>
    setPicked(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const share = async () => {
    setBusy(true);
    const chosen = items.filter(i => picked.has(i.id));
    const ok = await shareFiles(group, chosen.map(i => ({ name: i.name, blob: () => blobStore.get(blobKey(i.id)) })));
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <div>
      <h3 className="text-[15px] font-semibold">{t('Partager depuis mon Drive')}</h3>
      <p className="mt-1 text-[13px] text-stone-500">{t('Une copie est ajoutée à « {name} » ; tes fichiers restent privés.', { name: group.name })}</p>
      <div className="relative mt-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('Rechercher un fichier ou un dossier')} aria-label={t('Rechercher dans mon Drive')} className="field w-full pl-8" />
      </div>
      <div className="mt-2 max-h-[320px] overflow-y-auto" role="group" aria-label={t('Fichiers de mon Drive')}>
        {files.length === 0 && <p className="p-6 text-center text-[13px] text-stone-500">{items.some(i => i.kind === 'file') ? t('Aucun fichier trouvé') : t('Ton Drive est vide.')}</p>}
        {files.map(({ item, where }) => {
          const tooBig = (item.size ?? 0) > MAX_GROUP_FILE;
          const on = picked.has(item.id);
          return (
            <label
              key={item.id}
              className={cx('flex items-center gap-2.5 rounded-lg px-2.5 py-1.5', tooBig ? 'opacity-50' : 'cursor-pointer hover:bg-stone-50', on && 'bg-stone-50')}
            >
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--color-ink)]" checked={on} disabled={tooBig || busy} onChange={() => toggle(item.id)} />
              <FileIcon category={categoryOf(item)} size={26} ext={item.name.split('.').pop()} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{item.name}</span>
                <span className="block truncate text-[12px] text-stone-500">
                  {where} · {tooBig ? t('trop lourd (plus de 50 Mo)') : formatBytes(item.size)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>{t('Annuler')}</button>
        <button className="btn-primary" disabled={!picked.size || busy} onClick={() => void share()}>
          {busy ? t('Partage…') : picked.size > 1 ? t('Partager {n} fichiers', { n: picked.size }) : t('Partager')}
        </button>
      </div>
    </div>
  );
}

/**
 * Sharing into the group, in the « + » button (after the open tab's own line): one of my notes, files of my Drive,
 * files of the device. `device` false: the « Fichiers » tab already has that line.
 */
export default function ShareActions({ group, onNote, onFiles, device }: { group: Group; onNote: (id: string) => void; onFiles: () => void; device: boolean }) {
  const [dialog, setDialog] = useState<'note' | 'drive' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useCreateActions(
    [
      { label: t('Partager une de mes notes'), icon: <FileText />, onClick: () => setDialog('note') },
      { label: t('Partager depuis mon Drive'), icon: <HardDrive />, onClick: () => setDialog('drive') },
      ...(device ? [{ label: t('Ajouter un fichier'), icon: <Monitor />, onClick: () => input.current?.click() }] : []),
    ],
    1,
  );
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={e => {
          const list = [...(e.target.files ?? [])];
          e.target.value = '';
          if (list.length) void shareFiles(group, list.map(f => ({ blob: f, name: f.name }))).then(ok => ok && onFiles());
        }}
      />
      <Modal open={dialog === 'note'} onClose={() => setDialog(null)} width={480}>
        {dialog === 'note' && (
          <NotePicker
            group={group}
            onClose={() => setDialog(null)}
            onPicked={id => {
              setDialog(null);
              onNote(id);
            }}
          />
        )}
      </Modal>
      <Modal open={dialog === 'drive'} onClose={() => setDialog(null)} width={520}>
        {dialog === 'drive' && (
          <DrivePicker
            group={group}
            onClose={() => setDialog(null)}
            onDone={() => {
              setDialog(null);
              onFiles();
            }}
          />
        )}
      </Modal>
    </>
  );
}
