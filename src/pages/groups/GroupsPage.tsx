import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, CloudOff, Copy, ImagePlus, Link2, LogIn, NotebookText, Paperclip, Plus, Settings2, Users } from 'lucide-react';
import { imageToAvatar } from '../../lib/backup';
import { useAuth } from '../../store/auth';
import { prefetchGroup, useGroups, watchFocus } from '../../store/groups';
import { useGroupActivity, totalUnread } from '../../store/groupActivity';
import { toast } from '../../store/ui';
import { Modal } from '../../components/Overlays';
import { FieldError } from '../../components/Field';
import { cloudEnabled } from '../../lib/supabase';
import { GROUP_COLORS, copyCode, copyInviteLink, createGroup, groupError, joinGroup, updateGroup, type Group } from '../../lib/groups';
import { cx } from '../../lib/utils';
import { ColorPicker, GroupBadge } from './shared';
import { KindContext, groupColor, useGroupWords, useRights } from './util';
import GroupNotes from './GroupNotes';
import GroupEvents from './GroupEvents';
import GroupMembers from './GroupMembers';
import GroupFiles from './GroupFiles';
import ShareButton from './GroupShare';
import { showJoined } from './join';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { t, tn, locale } from '../../i18n';

type Tab = 'notes' | 'fichiers' | 'revisions' | 'membres';
const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'notes', label: t('Notes'), icon: NotebookText },
  { id: 'fichiers', label: t('Fichiers'), icon: Paperclip },
  { id: 'revisions', label: t('Révisions'), icon: CalendarClock },
  { id: 'membres', label: t('Membres'), icon: Users },
];


export function GroupForm({ group, onDone }: { group?: Group; onDone: (g?: Group) => void }) {
  const w = useGroupWords();
  const kind = useContext(KindContext);
  const [name, setName] = useState(group?.name ?? '');
  const [color, setColor] = useState<string>(group?.color ?? GROUP_COLORS[0]);
  const [photo, setPhoto] = useState<string | null>(group?.photo ?? null);
  const [busy, setBusy] = useState(false);
  // The name is required: said under it when emptied and left, or at the submit (the focus goes back to it).
  const [nameError, setNameError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      setPhoto(await imageToAvatar(f, 256));
    } catch {
      toast(t('Image illisible : essaie une photo JPEG ou PNG.'), 'error');
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t('Donne un nom.'));
      return nameRef.current?.focus();
    }
    setBusy(true);
    try {
      if (group) {
        await updateGroup(group.id, { name: name.trim(), color, ...(photo !== group.photo && { photo }) });
        await useGroups.getState().loadGroups();
        onDone(group);
      } else {
        const g = await createGroup(name.trim(), color, kind);
        // Created first, then its photo: a refused photo (server not up to date) doesn't lose the group.
        if (photo) await updateGroup(g.id, { photo }).catch(err => toast(groupError(err), 'error'));
        await useGroups.getState().loadGroups();
        toast(w.created, 'success');
        onDone(g);
      }
    } catch (err) {
      toast(groupError(err), 'error');
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <h3 className="text-[15px] font-semibold">{group ? t('Paramètres {of}', { of: w.of }) : t('Créer {a}', { a: w.a })}</h3>
      <label className="eyebrow mt-4 block" htmlFor="group-name">{t('Nom')}</label>
      <input
        ref={nameRef}
        id="group-name"
        autoFocus
        value={name}
        maxLength={60}
        onChange={e => (setName(e.target.value), e.target.value.trim() && setNameError(''))}
        onBlur={() => name && !name.trim() && setNameError(t('Donne un nom.'))}
        aria-invalid={nameError ? true : undefined}
        aria-describedby={nameError ? 'group-name-err' : undefined}
        placeholder={w.namePlaceholder}
        className="field mt-1.5 w-full"
      />
      <FieldError id="group-name-err">{nameError}</FieldError>
      <p className="eyebrow mt-4">{t('Photo')}</p>
      <div className="mt-2 flex items-center gap-3">
        <GroupBadge group={{ name: name || '?', color, photo }} size={52} />
        <label className="btn-secondary h-9 cursor-pointer focus-within:ring-2 focus-within:ring-focus">
          <ImagePlus size={15} aria-hidden /> {photo ? t('Changer') : t('Ajouter une photo')}
          <input type="file" accept="image/*" className="sr-only" onChange={e => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {photo && (
          <button type="button" className="btn-ghost h-9" onClick={() => setPhoto(null)}>
            {t('Retirer')}
          </button>
        )}
      </div>
      <p className="eyebrow mt-4">{photo ? t('Couleur (sans photo)') : t('Couleur')}</p>
      <div className="mt-2">
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onDone()}>{t('Annuler')}</button>
        <button type="submit" className="btn-primary" disabled={busy}>{group ? t('Enregistrer||sauver') : t('Créer {the}', { the: w.the })}</button>
      </div>
    </form>
  );
}

function JoinForm({ onDone }: { onDone: () => void }) {
  const w = useGroupWords();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The pasted invitation link (or « Code : ABC234 ») works too: its code is taken from it.
  const clean = (code.match(/rejoindre=([A-Za-z0-9]{6})/i)?.[1] ?? code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-6);
  const inputRef = useRef<HTMLInputElement>(null);
  const short = t('Le code contient 6 caractères.');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // A code too short: said under the field, the focus back in it.
    if (clean.length !== 6) {
      setError(short);
      return inputRef.current?.focus();
    }
    setBusy(true);
    setError('');
    try {
      const id = await joinGroup(clean);
      if (!id) {
        setError(t('{none} avec ce code : vérifie-le.', { none: w.none }));
        setBusy(false);
        return;
      }
      const already = useGroups.getState().groups.some(g => g.id === id);
      await useGroups.getState().loadGroups();
      showJoined({ kind: 'groupe', id, name: useGroups.getState().groups.find(g => g.id === id)?.name ?? '', already });
      onDone();
    } catch (err) {
      setError(groupError(err));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <h3 className="text-[15px] font-semibold">{t('Rejoindre {a}', { a: w.a })}</h3>
      <p className="mt-1 text-[13px] text-stone-500">{t('Le code à 6 caractères reçu d’un membre.')}</p>
      <input
        ref={inputRef}
        autoFocus
        value={code}
        onChange={e => (setCode(e.target.value), setError(''))}
        onBlur={() => code.trim() && clean.length !== 6 && setError(short)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'join-code-err' : undefined}
        placeholder="ABC234"
        aria-label={t('Code d’invitation')}
        autoCapitalize="characters"
        spellCheck={false}
        className="field mt-4 h-11 w-full text-center font-mono text-[18px] tracking-[0.3em] uppercase"
      />
      <FieldError id="join-code-err">{error}</FieldError>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onDone()}>{t('Annuler')}</button>
        <button type="submit" className="btn-primary" disabled={busy}>{t('Rejoindre')}</button>
      </div>
    </form>
  );
}

/** No group yet: what one holds, « Créer » first (joining with a code stays beside it, quieter). */
function Intro({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const w = useGroupWords();
  return (
    <EmptyState
      className="mx-auto max-w-[480px] md:py-16"
      icon={Users}
      title={t('{none} pour l’instant.', { none: w.none })}
      text={w.introText}
      action={{ label: t('Créer {a}', { a: w.a }), icon: Plus, onClick: onCreate }}
      secondary={{ label: t('J’ai un code'), icon: LogIn, onClick: onJoin }}
      preview="people"
    />
  );
}

function OfflineNotice() {
  const w = useGroupWords();
  return (
    <div className="flex h-full flex-col px-4 pb-10 md:px-8">
      <h1 className="pb-4 pt-2 text-[24px] font-semibold tracking-[-0.02em]">{w.Groups}</h1>
      <EmptyState className="flex-1 justify-center" icon={CloudOff} title={t('Disponible dans la version en ligne')} text={t('Ici, tes données restent dans ce navigateur.')} />
    </div>
  );
}

export default function GroupsPage() {
  if (!cloudEnabled) return <OfflineNotice />;
  return <Groups />;
}

function Groups() {
  const w = useGroupWords();
  const [params, setParams] = useSearchParams();
  const userId = useAuth(s => s.user?.id);
  const navigate = useNavigate();
  const { groups: all, loaded, failed } = useGroups();
  // Work groups and shared calendars share their machinery, never their screen (shared calendars: AgendasPage).
  const groups = all.filter(g => g.kind === 'groupe');
  const tabs = TABS;
  const [dialog, setDialog] = useState<'create' | 'join' | 'settings' | null>(null);

  const gid = params.get('g');
  const tab = (tabs.find(x => x.id === params.get('onglet'))?.id ?? tabs[0].id) as Tab;
  const unread = useGroupActivity(s => s.unread);
  const tabNews = gid ? (unread[gid]?.[tab as 'notes'] ?? 0) : 0;
  useEffect(() => {
    if (gid) useGroupActivity.getState().markSeen(gid, tab);
  }, [gid, tab, tabNews]);
  const active = groups.find(g => g.id === gid) ?? null;
  const code = useGroups(s => (active ? s.codes[active.id] : null));
  const rights = useRights(active ?? { id: '', ownerId: null });

  useEffect(() => {
    useGroups.getState().reset();
    void useGroups.getState().loadGroups();
    return () => useGroups.getState().reset();
  }, [userId]);
  useEffect(() => watchFocus(), []);

  useEffect(() => {
    useGroups.getState().open(active?.id ?? null);
  }, [active?.id]);

  // Groupe quitté / supprimé par quelqu'un d'autre : retour à la liste. Un agenda ouvert depuis les groupes
  // (ou l'inverse, après un code) : dans son espace.
  const elsewhere = all.find(g => g.id === gid && g.kind === 'agenda');
  useEffect(() => {
    if (elsewhere) navigate(`/agendas?g=${elsewhere.id}`, { replace: true });
    else if (loaded && gid && !active) setParams({}, { replace: true });
  }, [loaded, gid, active, elsewhere, navigate, setParams]);

  const go = (id: string | null, to: Tab = tabs[0].id) => setParams(id ? (to === tabs[0].id ? { g: id } : { g: id, onglet: to }) : {});

  const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name, locale()));

  return (
    <div className="flex h-full gap-4 px-4 pb-4 md:px-8">
      {/* A group open on a phone hides the list and its title: the page keeps one for screen readers. */}
      {active && <h1 className="sr-only md:hidden">{w.Groups}</h1>}
      {/* Liste des groupes */}
      <aside className={cx('w-full shrink-0 flex-col md:flex md:w-[248px]', active ? 'hidden' : 'flex')}>
        <div className="flex items-center gap-1.5 pb-4 pt-2">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{w.Groups}</h1>
          <button className="icon-btn ml-auto" title={t('Rejoindre avec un code')} aria-label={t('Rejoindre avec un code')} onClick={() => setDialog('join')}>
            <LogIn size={16} />
          </button>
          <button className="btn-primary h-8 px-3" onClick={() => setDialog('create')}>
            <Plus size={14} /> {t('Créer')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-room">
          {!loaded && <Skeleton shape="people" className="p-1" />}
          {loaded && failed && (
            <EmptyState size="sm" tone="error" title={t('Impossible de charger tes {groups}.', { groups: w.groups })} onRetry={() => void useGroups.getState().loadGroups()} />
          )}
          {sorted.map(g => (
            <button
              key={g.id}
              onClick={() => go(g.id)}
              onPointerEnter={() => prefetchGroup(g.id)}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-lg border px-2 py-2 text-left transition-colors',
                g.id === active?.id ? 'border-stone-200 bg-surface shadow-card' : 'border-transparent hover:bg-stone-100',
              )}
            >
              <GroupBadge group={g} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{g.name}</span>
                <span className="block text-[11px] text-stone-500">{g.ownerId === userId ? (w.a === t('une équipe') ? t('Tu l’as créée') : t('Tu l’as créé')) : t('Membre')}</span>
              </span>
              {totalUnread(unread[g.id]) > 0 && g.id !== active?.id && (
                <span className="rounded-full bg-brand-solid px-1.5 text-[11px] font-semibold leading-[18px] text-on-brand tabular" aria-label={tn(totalUnread(unread[g.id]), '{n} nouveauté', '{n} nouveautés')}>
                  {totalUnread(unread[g.id])}
                </span>
              )}
            </button>
          ))}
          {loaded && !failed && groups.length === 0 && (
            // Computers: said once, in the panel beside the list.
            <div className="card md:hidden">
              <Intro onCreate={() => setDialog('create')} onJoin={() => setDialog('join')} />
            </div>
          )}
        </div>
      </aside>

      {/* Groupe ouvert */}
      <section className={cx('min-w-0 flex-1 flex-col md:mt-2', active ? 'flex' : 'hidden md:flex')}>
        {active ? (
          <>
            <div className="flex items-center gap-2 pb-3 sm:gap-3">
              <button className="icon-btn md:hidden" onClick={() => go(null)} title={t('Retour')} aria-label={t('Retour')}>
                <ArrowLeft size={17} />
              </button>
              {/* Smallest phones: no room for the badge, the name and the code come first. */}
              <span className="flex shrink-0 max-[359px]:hidden"><GroupBadge group={active} size={34} /></span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[18px] font-semibold tracking-[-0.01em]">{active.name}</h2>
                {code && (
                  <button
                    className="group/code hit-sm flex max-w-full items-center gap-1.5 text-[12px] text-stone-500 hover:text-ink"
                    title={t('Copier le code d’invitation')}
                    onClick={() => void copyCode(code)}
                  >
                    {t('Code')} <span className="font-mono font-medium tracking-wider text-stone-700">{code}</span>
                    <Copy size={12} className="text-stone-400 group-hover/code:text-ink" />
                  </button>
                )}
              </div>
              {code && (
                <button className="btn-secondary h-8 px-2.5 sm:px-3" onClick={() => void copyInviteLink(code, 'groupe')} title={t('Copier le lien d’invitation')}>
                  <Link2 size={14} /> <span className="max-sm:sr-only">{t('Inviter')}</span>
                </button>
              )}
              {rights.canEdit && (
                <ShareButton
                  group={active}
                  onNote={id => setParams({ g: active.id, note: id })}
                  onFiles={() => go(active.id, 'fichiers')}
                />
              )}
              {active.ownerId === userId && (
                <button className="icon-btn" title={t('Paramètres {of}', { of: w.of })} aria-label={t('Paramètres {of}', { of: w.of })} onClick={() => setDialog('settings')}>
                  <Settings2 size={16} />
                </button>
              )}
            </div>
            <div className="flex gap-1 overflow-x-auto border-b border-stone-200" role="tablist">
              {tabs.map(x => (
                <button
                  key={x.id}
                  role="tab"
                  aria-selected={tab === x.id}
                  // On a phone the row scrolls: the chosen tab is brought fully into view.
                  ref={tab === x.id ? el => el?.scrollIntoView({ inline: 'nearest', block: 'nearest' }) : undefined}
                  onClick={() => go(active.id, x.id)}
                  className={cx(
                    '-mb-px flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2 text-[13px] sm:px-2.5 font-medium transition-[color]',
                    tab === x.id ? 'text-ink' : 'border-transparent text-stone-500 hover:text-ink',
                  )}
                  style={tab === x.id ? { borderColor: groupColor(active) } : undefined}
                >
                  <x.icon size={15} strokeWidth={1.9} className="max-[400px]:hidden" />
                  {x.id === 'revisions' ? w.meet.Tab : x.label}
                  {tab !== x.id && (unread[active.id]?.[x.id as 'notes'] ?? 0) > 0 && <span className="h-1.5 w-1.5 rounded-full bg-brand-solid" aria-label={t('nouveau')} />}
                </button>
              ))}
            </div>
            <div className="flex min-h-0 flex-1 flex-col pt-4">
              {tab === 'notes' && <GroupNotes key={active.id} group={active} />}
              {tab === 'fichiers' && <GroupFiles key={active.id} group={active} />}
              {tab === 'revisions' && <GroupEvents key={active.id} group={active} />}
              {tab === 'membres' && <GroupMembers key={active.id} group={active} onLeft={() => go(null)} />}
            </div>
          </>
        ) : loaded && groups.length === 0 && !failed ? (
          <div className="card flex-1 overflow-y-auto pb-room">
            <Intro onCreate={() => setDialog('create')} onJoin={() => setDialog('join')} />
          </div>
        ) : (
          // Still loading, or not read (said in the list): no « Choisis… » yet.
          <div className="card flex flex-1 flex-col items-center justify-center p-8 text-center">
            {loaded && !failed && (
              <>
                <Users size={28} strokeWidth={1.5} className="text-stone-300" />
                <p className="mt-3 text-[14px] font-medium">{t('Choisis {a}', { a: w.a })}</p>
              </>
            )}
          </div>
        )}
      </section>

      <Modal open={dialog === 'create' || dialog === 'settings'} onClose={() => setDialog(null)}>
        {(dialog === 'create' || dialog === 'settings') && (
          <GroupForm
            group={dialog === 'settings' ? (active ?? undefined) : undefined}
            onDone={g => {
              setDialog(null);
              if (g && dialog === 'create') go(g.id);
            }}
          />
        )}
      </Modal>
      <Modal open={dialog === 'join'} onClose={() => setDialog(null)}>
        {dialog === 'join' && (
          <JoinForm
            onDone={() => setDialog(null)}
          />
        )}
      </Modal>
    </div>
  );
}
