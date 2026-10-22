import { LoadFailed } from './shared';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilePlus2, FileText } from 'lucide-react';
import { useGroups } from '../../store/groups';
import { toast } from '../../store/ui';
import { createNote, groupError, summary, type Group, type GroupNote } from '../../lib/groups';
import { cx, relativeTime } from '../../lib/utils';
import { useMemberName, useRights } from './util';
import GroupNoteEditor from './GroupNoteEditor';
import { t, tn } from '../../i18n';

export default function GroupNotes({ group }: { group: Group }) {
  const [params, setParams] = useSearchParams();
  const notes = useGroups(s => s.notes[group.id]);
  const failed = useGroups(s => s.loadFailed[`${group.id}:notes`]);
  const nameOf = useMemberName(group.id);
  const { canEdit } = useRights(group);
  const [creating, setCreating] = useState(false);
  // Pendant la création (aller-retour réseau), le titre se tape déjà : il est repris par l'éditeur.
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const [fresh, setFresh] = useState<GroupNote>();
  const openId = params.get('note');
  // The draft title stays on screen until the note is really open (the URL change can come a frame later).
  const [lastOpen, setLastOpen] = useState(openId);
  if (openId !== lastOpen) {
    setLastOpen(openId);
    if (openId) setCreating(false);
    else setFresh(undefined); // reopened later, the note is loaded again (others may have edited it)
  }

  const open = (id: string | null) => setParams(id ? { g: group.id, note: id } : { g: group.id });

  const newNote = async () => {
    setCreating(true);
    setDraft('');
    draftRef.current = '';
    try {
      const n = await createNote(group.id);
      useGroups.getState().upsertNote(summary(n));
      setFresh(n);
      open(n.id);
    } catch (e) {
      toast(groupError(e), 'error');
      setCreating(false);
    }
  };

  if (openId) {
    return (
      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <GroupNoteEditor key={openId} noteId={openId} readOnly={!canEdit} onClose={() => open(null)} fresh={fresh && { note: fresh, title: draftRef }} />
      </div>
    );
  }

  if (creating) {
    return (
      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-5 md:px-10" aria-busy="true">
        <input
          autoFocus
          value={draft}
          onChange={e => {
            setDraft(e.target.value);
            draftRef.current = e.target.value;
          }}
          onKeyDown={e => e.key === 'Enter' && e.preventDefault()}
          placeholder={t('Sans titre')}
          aria-label={t('Titre de la note')}
          maxLength={200}
          className="ml-9 w-[calc(100%-36px)] bg-transparent text-[24px] font-semibold tracking-[-0.02em] outline-none placeholder:text-stone-400"
        />
        <p className="ml-9 mt-0.5 text-[12px] text-stone-500">{t('Création de la note…')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        {!notes && failed ? (
          <LoadFailed groupId={group.id} part="notes" className="mr-auto" />
        ) : (
          <p className="eyebrow mr-auto">{notes?.length === 0 ? '' : notes ? tn(notes.length, '{n} note partagée', '{n} notes partagées') : t('Chargement…')}</p>
        )}
        {canEdit && (
          <button className="btn-primary h-8 px-3" disabled={creating} onClick={() => void newNote()}>
            <FilePlus2 size={14} /> {t('Nouvelle note')}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-16 lg:pb-14">
        {notes && notes.length === 0 && (
          <div className="card flex flex-col items-center px-6 py-12 text-center">
            <FileText size={26} strokeWidth={1.5} className="text-stone-300" />
            <p className="mt-3 text-[14px] font-medium">{t('Aucune note pour l’instant.')}</p>
          </div>
        )}
        {notes && notes.length > 0 && (
          <div className="card divide-y divide-stone-100 overflow-hidden">
            {notes.map(n => (
              <button key={n.id} onClick={() => open(n.id)} className={cx('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-stone-50')}>
                <FileText size={16} className="shrink-0 text-stone-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{n.title}</span>
                  <span className="block truncate text-[12px] text-stone-500">
                    {t('Modifiée par {name} {when}', { name: nameOf(n.updatedBy), when: relativeTime(n.updatedAt) })}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
