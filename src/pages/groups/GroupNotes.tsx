import { LoadFailed } from './shared';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilePlus2, FileText } from 'lucide-react';
import { useGroups } from '../../store/groups';
import { toast } from '../../store/ui';
import { createNote, groupError, summary, type Group, type GroupNote } from '../../lib/groups';
import { cx, relativeTime } from '../../lib/utils';
import { useMemberName, useRights } from './util';
import { useCreateActions, useNarrow } from '../../store/create';
import { PlusHint } from '../../components/CreateButton';
import { t, tn } from '../../i18n';

// Heavy (Tiptap): only loaded when a shared note is opened.
const loadEditor = () => import('./GroupNoteEditor');
const GroupNoteEditor = lazy(loadEditor);

export default function GroupNotes({ group }: { group: Group }) {
  const [params, setParams] = useSearchParams();
  const notes = useGroups(s => s.notes[group.id]);
  const failed = useGroups(s => s.loadFailed[`${group.id}:notes`]);
  const nameOf = useMemberName(group.id);
  const { canEdit } = useRights(group);
  // Fetch the editor while the list is idle, so opening a note stays instant.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    const id = idle(() => void loadEditor(), { timeout: 3000 });
    return () => cancel(id as number);
  }, []);
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
  // The « + » button (the sharing lines follow it, GroupShare).
  // Not over a note open on a phone (it fills the screen).
  const narrow = useNarrow();
  useCreateActions(canEdit && !(openId && narrow) ? [{ label: t('Nouvelle note'), icon: <FilePlus2 />, onClick: () => void newNote() }] : []);

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
        <Suspense fallback={<div className="flex-1" />}>
          <GroupNoteEditor key={openId} noteId={openId} readOnly={!canEdit} onClose={() => open(null)} fresh={fresh && { note: fresh, title: draftRef }} />
        </Suspense>
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
          className="ml-9 w-[calc(100%-36px)] bg-transparent text-[24px] font-semibold tracking-[-0.02em] outline-none placeholder:text-stone-500"
        />
        <p className="ml-9 mt-0.5 text-[12px] text-stone-500">{t('Création de la note…')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Empty, loading or failed: the state below says it. Adding: the « + » button. */}
      {notes && notes.length > 0 && <p className="eyebrow pb-3">{tn(notes.length, '{n} note partagée', '{n} notes partagées')}</p>}

      <div className="shadow-room min-h-0 flex-1 overflow-y-auto pb-room">
        {!notes && (failed ? <LoadFailed groupId={group.id} part="notes" className="card" /> : <Skeleton className="card p-3" />)}
        {notes && notes.length === 0 && (
          <EmptyState
            className="card"
            icon={FileText}
            title={t('Aucune note pour l’instant.')}
            text={canEdit ? <PlusHint /> : undefined}
            preview="list"
          />
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
