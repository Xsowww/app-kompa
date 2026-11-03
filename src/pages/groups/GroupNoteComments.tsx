import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MessageSquare, Send, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { addComment, deleteComment, fetchComments, groupError, type GroupNote, type NoteComment } from '../../lib/groups';
import { useAuth } from '../../store/auth';
import { useGroups } from '../../store/groups';
import { toast } from '../../store/ui';
import { cx, relativeTime } from '../../lib/utils';
import { MemberDot } from './shared';
import { useMemberName, useMemberOf } from './util';
import { insertMention, mentionAt, mentionsIn } from './logic';
import { t, tn } from '../../i18n';

/** The text of a comment, the members it names (« @Léa ») stressed. */
function Body({ text, names }: { text: string; names: string[] }) {
  if (!names.length) return <>{text}</>;
  const re = new RegExp(`(@(?:${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'gu');
  return <>{text.split(re).map((part, i) => (i % 2 ? <span key={i} className="font-medium text-brand-600">{part}</span> : part))}</>;
}

/**
 * Comments under a shared note: every member reads and writes them (a reader too: it doesn't change the note), « @ »
 * names a member, who gets a notification (the database checks they belong to the group). Hidden on a server
 * without them (migration 2026-11-03).
 */
export default function GroupNoteComments({ note }: { note: Pick<GroupNote, 'id' | 'groupId'> }) {
  const me = useAuth(s => s.user?.id);
  const members = useGroups(s => s.members[note.groupId]);
  const ownerId = useGroups(s => s.groups.find(g => g.id === note.groupId)?.ownerId);
  const nameOf = useMemberName(note.groupId);
  const memberOf = useMemberOf(note.groupId);
  const [list, setList] = useState<NoteComment[] | null | undefined>(undefined);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [hidden, setHidden] = useState(false); // the list of names closed with Échap
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const shown = useRef<string[]>([]);
  useEffect(() => {
    shown.current = list?.map(c => c.id) ?? [];
  }, [list]);

  useEffect(() => {
    let alive = true;
    const read = () =>
      void fetchComments(note.id).then(
        l => alive && setList(l),
        () => alive && setList(l => l ?? []),
      );
    read();
    if (!supabase) return;
    // The others' comments live (a deletion only gives its id: read again when it is one of these).
    let soon: ReturnType<typeof setTimeout> | undefined;
    const later = () => (clearTimeout(soon), (soon = setTimeout(read, 300)));
    const ch = supabase
      .channel(`commentaires-${note.id}-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_note_comments', filter: `note_id=eq.${note.id}` }, later)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_note_comments' }, p => {
        if (shown.current.includes(String((p.old as { id?: string }).id))) later();
      })
      .subscribe();
    return () => {
      alive = false;
      clearTimeout(soon);
      void supabase!.removeChannel(ch);
    };
  }, [note.id]);

  const others = (members ?? []).filter(m => m.userId !== me);
  const at = mentionAt(text, caret);
  const choices = at && !hidden ? others.filter(m => m.name.toLowerCase().startsWith(at.query.toLowerCase())).slice(0, 6) : [];

  if (list === null) return null; // a server without comments yet
  const names = (members ?? []).map(m => m.name);

  const choose = (name: string) => {
    if (!at) return;
    const next = insertMention(text, at, name);
    setText(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => input.current?.setSelectionRange(next.caret, next.caret));
  };

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const c = await addComment(note, text, mentionsIn(text, others));
      setList(l => [...(l ?? []).filter(x => x.id !== c.id), c]);
      setText('');
      setCaret(0);
    } catch (e) {
      toast(groupError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: NoteComment) => {
    try {
      await deleteComment(c.id);
      setList(l => l?.filter(x => x.id !== c.id));
    } catch (e) {
      toast(groupError(e), 'error');
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (choices.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'ArrowDown') setPick(i => (i + 1) % choices.length);
      else if (e.key === 'ArrowUp') setPick(i => (i - 1 + choices.length) % choices.length);
      else if (e.key === 'Escape') setHidden(true);
      else choose(choices[Math.min(pick, choices.length - 1)].name);
      return;
    }
    // Entrée sends (Maj + Entrée: a new line), as in a chat.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    // Clicks here stay here (the area around the note puts the cursor in it).
    <section className="mt-10 border-t border-stone-100 pt-5" aria-label={t('Commentaires')} onClick={e => e.stopPropagation()}>
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-stone-600">
        <MessageSquare size={14} aria-hidden /> {list?.length ? tn(list.length, '{n} commentaire', '{n} commentaires') : t('Commentaires')}
      </h3>
      <ul className="mt-3 flex flex-col gap-3">
        {list?.map(c => (
          <li key={c.id} className="group/c flex items-start gap-2.5">
            <MemberDot userId={c.createdBy ?? c.id} name={nameOf(c.createdBy, t('Toi'))} photo={memberOf(c.createdBy)?.photo} color={memberOf(c.createdBy)?.color} size={26} className="mt-0.5 ring-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-stone-500">
                <span className="font-medium text-ink">{nameOf(c.createdBy, t('Toi'))}</span> · {relativeTime(c.createdAt)}
              </p>
              <p className="whitespace-pre-line text-[13.5px] [overflow-wrap:anywhere]">
                <Body text={c.body} names={names} />
              </p>
            </div>
            {(c.createdBy === me || ownerId === me) && (
              <button className="icon-btn opacity-60 hover:text-red-600 hover:opacity-100" title={t('Supprimer le commentaire')} aria-label={t('Supprimer le commentaire')} onClick={() => void remove(c)}>
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="relative mt-3 flex items-end gap-2">
        <textarea
          ref={input}
          value={text}
          rows={1}
          maxLength={2000}
          onChange={e => (setText(e.target.value), setCaret(e.target.selectionStart), setPick(0), setHidden(false))}
          onSelect={e => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKey}
          placeholder={t('Ajouter un commentaire (@ pour citer quelqu’un)')}
          aria-label={t('Ajouter un commentaire')}
          className="field h-auto max-h-32 min-h-10 flex-1 resize-none py-2 text-[13.5px] [field-sizing:content]"
        />
        <button className="btn-primary h-10 px-3" disabled={!text.trim() || busy} onClick={() => void send()} title={t('Envoyer')} aria-label={t('Envoyer le commentaire')}>
          <Send size={15} />
        </button>
        {choices.length > 0 && (
          <ul className="absolute bottom-full left-0 z-10 mb-1 w-56 overflow-hidden rounded-xl border border-stone-200 bg-surface py-1 shadow-pop" role="listbox" aria-label={t('Membres à citer')}>
            {choices.map((m, i) => (
              <li key={m.userId} role="option" aria-selected={i === pick}>
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => choose(m.name)}
                  className={cx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]', i === pick ? 'bg-stone-100' : 'hover:bg-stone-50')}
                >
                  <MemberDot userId={m.userId} name={m.name} photo={m.photo} color={m.color} size={20} className="ring-0" />
                  <span className="truncate">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
