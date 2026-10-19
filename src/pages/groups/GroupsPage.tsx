import { useContext, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, CloudOff, Copy, ImagePlus, Link2, LogIn, NotebookText, Paperclip, Plus, Settings2, Users } from 'lucide-react';
import { imageToAvatar } from '../../lib/backup';
import { useAuth } from '../../store/auth';
import { useGroups, watchFocus } from '../../store/groups';
import { useGroupActivity, totalUnread } from '../../store/groupActivity';
import { toast } from '../../store/ui';
import { Modal } from '../../components/Overlays';
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

type Tab = 'notes' | 'fichiers' | 'revisions' | 'membres';
const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'notes', label: 'Notes', icon: NotebookText },
  { id: 'fichiers', label: 'Fichiers', icon: Paperclip },
  { id: 'revisions', label: 'Révisions', icon: CalendarClock },
  { id: 'membres', label: 'Membres', icon: Users },
];


export function GroupForm({ group, onDone }: { group?: Group; onDone: (g?: Group) => void }) {
  const w = useGroupWords();
  const kind = useContext(KindContext);
  const [name, setName] = useState(group?.name ?? '');
  const [color, setColor] = useState<string>(group?.color ?? GROUP_COLORS[0]);
  const [photo, setPhoto] = useState<string | null>(group?.photo ?? null);
  const [busy, setBusy] = useState(false);
  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      setPhoto(await imageToAvatar(f, 256));
    } catch {
      toast('Image illisible : essaie une photo JPEG ou PNG.', 'error');
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
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
      <h3 className="text-[15px] font-semibold">{group ? `Paramètres ${w.of}` : `Créer ${w.a}`}</h3>
      <label className="eyebrow mt-4 block" htmlFor="group-name">Nom</label>
      <input id="group-name" autoFocus value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder={w.namePlaceholder} className="field mt-1.5 w-full" />
      <p className="eyebrow mt-4">Photo</p>
      <div className="mt-2 flex items-center gap-3">
        <GroupBadge group={{ name: name || '?', color, photo }} size={52} />
        <label className="btn-secondary h-9 cursor-pointer focus-within:ring-2 focus-within:ring-focus">
          <ImagePlus size={15} aria-hidden /> {photo ? 'Changer' : 'Ajouter une photo'}
          <input type="file" accept="image/*" className="sr-only" onChange={e => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {photo && (
          <button type="button" className="btn-ghost h-9" onClick={() => setPhoto(null)}>
            Retirer
          </button>
        )}
      </div>
      <p className="eyebrow mt-4">{photo ? 'Couleur (sans photo)' : 'Couleur'}</p>
      <div className="mt-2">
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onDone()}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={!name.trim() || busy}>{group ? 'Enregistrer' : `Créer ${w.the}`}</button>
      </div>
    </form>
  );
}

function JoinForm({ onDone }: { onDone: () => void }) {
  const w = useGroupWords();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const id = await joinGroup(clean);
      if (!id) {
        setError(`${w.none} avec ce code : vérifie-le.`);
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
      <h3 className="text-[15px] font-semibold">Rejoindre {w.a}</h3>
      <p className="mt-1 text-[13px] text-stone-500">Le code à 6 caractères reçu d’un membre.</p>
      <input
        autoFocus
        value={code}
        maxLength={8}
        onChange={e => setCode(e.target.value)}
        placeholder="ABC234"
        aria-label="Code d’invitation"
        autoCapitalize="characters"
        spellCheck={false}
        className="field mt-4 h-11 w-full text-center font-mono text-[18px] tracking-[0.3em] uppercase"
      />
      {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onDone()}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={clean.length !== 6 || busy}>Rejoindre</button>
      </div>
    </form>
  );
}

function Intro({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const w = useGroupWords();
  return (
    <div className="mx-auto flex max-w-[480px] flex-col py-10 md:py-16">
      <h2 className="text-[18px] font-semibold tracking-[-0.01em]">{w.introTitle}</h2>
      <p className="mt-1.5 text-[13px] text-stone-500">{w.introText}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={onCreate}><Plus size={15} /> Créer {w.a}</button>
        <button className="btn-secondary" onClick={onJoin}><LogIn size={15} /> J’ai un code</button>
      </div>
    </div>
  );
}

function OfflineNotice() {
  const w = useGroupWords();
  return (
    <div className="flex h-full flex-col px-4 pb-10 md:px-8">
      <h1 className="pb-4 pt-2 text-[24px] font-semibold tracking-[-0.02em]">{w.Groups}</h1>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <CloudOff size={26} strokeWidth={1.5} className="text-stone-300" />
        <p className="mt-3 text-[14px] font-medium">Disponible dans la version en ligne</p>
        <p className="mt-1 max-w-sm text-[13px] text-stone-500">Ici, tes données restent dans ce navigateur.</p>
      </div>
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
  const tab = (tabs.find(t => t.id === params.get('onglet'))?.id ?? tabs[0].id) as Tab;
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

  const go = (id: string | null, t: Tab = tabs[0].id) => setParams(id ? (t === tabs[0].id ? { g: id } : { g: id, onglet: t }) : {});

  const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return (
    <div className="flex h-full gap-4 px-4 pb-4 md:px-8">
      {/* A group open on a phone hides the list and its title: the page keeps one for screen readers. */}
      {active && <h1 className="sr-only md:hidden">{w.Groups}</h1>}
      {/* Liste des groupes */}
      <aside className={cx('w-full shrink-0 flex-col md:flex md:w-[248px]', active ? 'hidden' : 'flex')}>
        <div className="flex items-center gap-1.5 pb-4 pt-2">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{w.Groups}</h1>
          <button className="icon-btn ml-auto" title="Rejoindre avec un code" aria-label="Rejoindre avec un code" onClick={() => setDialog('join')}>
            <LogIn size={16} />
          </button>
          <button className="btn-primary h-8 px-3" onClick={() => setDialog('create')}>
            <Plus size={14} /> Créer
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!loaded && <p className="p-4 text-[13px] text-stone-500">Chargement…</p>}
          {loaded && failed && (
            <div className="p-4 text-[13px] text-stone-500">
              Impossible de charger tes {w.groups}.{' '}
              <button className="font-medium text-ink underline underline-offset-2" onClick={() => void useGroups.getState().loadGroups()}>Réessayer</button>
            </div>
          )}
          {sorted.map(g => (
            <button
              key={g.id}
              onClick={() => go(g.id)}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-lg border px-2 py-2 text-left transition-colors',
                g.id === active?.id ? 'border-stone-200 bg-surface shadow-card' : 'border-transparent hover:bg-stone-100',
              )}
            >
              <GroupBadge group={g} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{g.name}</span>
                <span className="block text-[11px] text-stone-500">{g.ownerId === userId ? (w.a.startsWith('une ') ? 'Tu l’as créée' : 'Tu l’as créé') : 'Membre'}</span>
              </span>
              {totalUnread(unread[g.id]) > 0 && g.id !== active?.id && (
                <span className="rounded-full bg-brand-solid px-1.5 text-[11px] font-semibold leading-[18px] text-on-brand tabular" aria-label={`${totalUnread(unread[g.id])} nouveautés`}>
                  {totalUnread(unread[g.id])}
                </span>
              )}
            </button>
          ))}
          {loaded && !failed && groups.length === 0 && (
            <>
              <p className="hidden px-2 py-3 text-[13px] text-stone-500 md:block">{w.none} pour l’instant.</p>
              <div className="card px-5 md:hidden">
                <Intro onCreate={() => setDialog('create')} onJoin={() => setDialog('join')} />
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Groupe ouvert */}
      <section className={cx('min-w-0 flex-1 flex-col md:mt-2', active ? 'flex' : 'hidden md:flex')}>
        {active ? (
          <>
            <div className="flex items-center gap-2 pb-3 sm:gap-3">
              <button className="icon-btn md:hidden" onClick={() => go(null)} title="Retour" aria-label="Retour">
                <ArrowLeft size={17} />
              </button>
              {/* Smallest phones: no room for the badge, the name and the code come first. */}
              <span className="flex shrink-0 max-[359px]:hidden"><GroupBadge group={active} size={34} /></span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[18px] font-semibold tracking-[-0.01em]">{active.name}</h2>
                {code && (
                  <button
                    className="group/code hit-sm flex max-w-full items-center gap-1.5 text-[12px] text-stone-500 hover:text-ink"
                    title="Copier le code d’invitation"
                    onClick={() => void copyCode(code)}
                  >
                    Code <span className="font-mono font-medium tracking-wider text-stone-700">{code}</span>
                    <Copy size={12} className="text-stone-400 group-hover/code:text-ink" />
                  </button>
                )}
              </div>
              {code && (
                <button className="btn-secondary h-8 px-2.5 sm:px-3" onClick={() => void copyInviteLink(code, 'groupe')} title="Copier le lien d’invitation">
                  <Link2 size={14} /> <span className="max-sm:sr-only">Inviter</span>
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
                <button className="icon-btn" title={`Paramètres ${w.of}`} aria-label={`Paramètres ${w.of}`} onClick={() => setDialog('settings')}>
                  <Settings2 size={16} />
                </button>
              )}
            </div>
            <div className="flex gap-1 overflow-x-auto border-b border-stone-200" role="tablist">
              {tabs.map(t => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  // On a phone the row scrolls: the chosen tab is brought fully into view.
                  ref={tab === t.id ? el => el?.scrollIntoView({ inline: 'nearest', block: 'nearest' }) : undefined}
                  onClick={() => go(active.id, t.id)}
                  className={cx(
                    '-mb-px flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium transition-[color]',
                    tab === t.id ? 'text-ink' : 'border-transparent text-stone-500 hover:text-ink',
                  )}
                  style={tab === t.id ? { borderColor: groupColor(active) } : undefined}
                >
                  <t.icon size={15} strokeWidth={1.9} />
                  {t.id === 'revisions' ? w.meet.Tab : t.label}
                  {tab !== t.id && (unread[active.id]?.[t.id as 'notes'] ?? 0) > 0 && <span className="h-1.5 w-1.5 rounded-full bg-brand-solid" aria-label="nouveau" />}
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
          <div className="card flex-1 overflow-y-auto px-6">
            <Intro onCreate={() => setDialog('create')} onJoin={() => setDialog('join')} />
          </div>
        ) : (
          <div className="card flex flex-1 flex-col items-center justify-center p-8 text-center">
            <Users size={28} strokeWidth={1.5} className="text-stone-300" />
            <p className="mt-3 text-[14px] font-medium">Choisis {w.a}</p>
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
