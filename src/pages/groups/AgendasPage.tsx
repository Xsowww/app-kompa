import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarRange, CloudOff, Link2, Plus, Settings2, Users } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { prefetchGroup, useGroups, watchFocus } from '../../store/groups';
import { Modal } from '../../components/Overlays';
import { cloudEnabled } from '../../lib/supabase';
import { copyInviteLink, setGroupSpace } from '../../lib/groups';
import { cx } from '../../lib/utils';
import { GroupBadge } from './shared';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { KindContext } from './util';
import { GroupForm } from './GroupsPage';
import GroupMembers from './GroupMembers';
import SharedCalendar from './SharedCalendar';
import { setViewingAgenda, useAgendaNews } from '../../store/agendaNews';
import { t, tn, locale } from '../../i18n';

// « Agendas partagés » : calendars shared with others (groups of the 'agenda' kind, lib/groups). Joined only by
// their link (/agendas?invitation=…), shown with the same day / week / month views as my own calendar.

const LAST = 'cop-agenda';

export default function AgendasPage() {
  useEffect(() => {
    setGroupSpace('agenda');
    return () => setGroupSpace('groupe');
  }, []);
  return <KindContext.Provider value="agenda">{cloudEnabled ? <Agendas /> : <Offline />}</KindContext.Provider>;
}

function Offline() {
  return (
    <div className="flex h-full flex-col px-4 pb-10 md:px-8">
      <h1 className="pb-4 pt-2 text-[24px] font-semibold tracking-[-0.02em]">{t('Agendas partagés')}</h1>
      <EmptyState className="flex-1 justify-center" icon={CloudOff} title={t('Disponible dans la version en ligne')} text={t('Ici, tes données restent dans ce navigateur.')} />
    </div>
  );
}

function Agendas() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const userId = useAuth(s => s.user?.id);
  const { groups: all, loaded, failed } = useGroups();
  const agendas = all.filter(g => g.kind === 'agenda').sort((a, b) => a.name.localeCompare(b.name, locale()));
  const [dialog, setDialog] = useState<'create' | 'settings' | 'members' | null>(null);

  // Which one: ?g=…, else the last one opened here, else the first.
  const wanted = params.get('g') ?? (() => {
    try {
      return localStorage.getItem(LAST);
    } catch {
      return null;
    }
  })();
  const active = agendas.find(g => g.id === wanted) ?? agendas[0] ?? null;
  const token = useGroups(s => (active ? s.codes[active.id] : null));
  const members = useGroups(s => (active ? s.members[active.id] : undefined));
  const news = useAgendaNews(s => s.news);

  // The calendar on screen: its changes are seen live (no badge, no card) — again each time the tab comes back.
  useEffect(() => {
    const id = active?.id ?? null;
    setViewingAgenda(id);
    const onVisible = () => document.visibilityState === 'visible' && setViewingAgenda(id);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      setViewingAgenda(null);
    };
  }, [active?.id]);

  useEffect(() => {
    useGroups.getState().reset();
    void useGroups.getState().loadGroups();
    return () => useGroups.getState().reset();
  }, [userId]);
  useEffect(() => watchFocus(), []);
  useEffect(() => {
    useGroups.getState().open(active?.id ?? null);
    if (active)
      try {
        localStorage.setItem(LAST, active.id);
      } catch {
        /* private mode: the first one opens next time */
      }
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A work group's id here (old link): to its space.
  const group = all.find(g => g.id === params.get('g') && g.kind === 'groupe');
  useEffect(() => {
    if (group) navigate(`/groupes?g=${group.id}`, { replace: true });
  }, [group, navigate]);

  const open = (id: string) => setParams({ g: id });

  return (
    <div className="flex h-full flex-col">
      {/* Title, the shared calendars (scroll sideways on a phone), « Nouveau » */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-3 pt-2 md:px-8">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{t('Agendas partagés')}</h1>
        <button className="btn-primary ml-auto h-8 px-3" onClick={() => setDialog('create')}>
          <Plus size={14} /> {t('Nouveau')}
        </button>
        {agendas.length > 0 && (
          <div className="-mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 pb-1 md:-mx-8 md:w-[calc(100%+4rem)] md:px-8" role="tablist" aria-label={t('Agendas partagés')}>
            {agendas.map(g => (
              <button
                key={g.id}
                role="tab"
                aria-selected={g.id === active?.id}
                onClick={() => open(g.id)}
                onPointerEnter={() => prefetchGroup(g.id)}
                className={cx(
                  'flex h-9 shrink-0 items-center gap-2 rounded-full border pl-1 pr-3 text-[13px] font-medium transition-colors',
                  g.id === active?.id ? 'border-stone-300 bg-surface text-ink shadow-card' : 'border-stone-200 text-stone-600 hover:bg-stone-100',
                )}
              >
                <GroupBadge group={g} size={26} />
                <span className="max-w-[160px] truncate">{g.name}</span>
                {g.id !== active?.id && (news[g.id] ?? 0) > 0 && (
                  <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-[18px] text-white tabular" aria-label={tn(news[g.id], '{n} nouveauté', '{n} nouveautés')}>
                    {news[g.id]}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {!loaded ? (
        <div className="px-4 md:px-8">
          <Skeleton shape="slots" className="card mx-auto mt-4 max-w-[520px] p-5" />
        </div>
      ) : failed ? (
        <div className="px-4 md:px-8">
          <EmptyState className="card mx-auto mt-4 max-w-[520px]" tone="error" title={t('Impossible de charger tes agendas.')} onRetry={() => void useGroups.getState().loadGroups()} />
        </div>
      ) : !active ? (
        <div className="px-4 md:px-8">
          <EmptyState
            className="card mx-auto mt-4 max-w-[520px]"
            icon={CalendarRange}
            title={t('{none} pour l’instant.', { none: t('Aucun agenda partagé') })}
            text={t('Un calendrier commun, séparé du tien. On le rejoint avec son lien d’invitation.')}
            action={{ label: t('Créer un agenda partagé'), icon: Plus, onClick: () => setDialog('create') }}
            preview="slots"
          />
        </div>
      ) : (
        <>
          {/* The open one: who is in it, invite, settings */}
          <div className="flex shrink-0 items-center gap-1.5 px-4 pb-1 sm:gap-2 md:px-8">
            <p className="mr-auto min-w-0 truncate text-[13px] text-stone-500">
              {members ? tn(members.length, '{n} membre', '{n} membres') : ' '}
              {active.ownerId === userId ? ` · ${t('tu l’as créé')}` : ''}
            </p>
            {/* Phones: icons only, the row stays on one line */}
            <button className="btn-secondary h-8 px-2.5 sm:px-3" onClick={() => setDialog('members')} title={t('Membres')}>
              <Users size={14} /> <span className="max-sm:sr-only">{t('Membres')}</span>
            </button>
            {token && (
              <button className="btn-secondary h-8 px-2.5 sm:px-3" onClick={() => void copyInviteLink(token, 'agenda')} title={t('Copier le lien d’invitation')}>
                <Link2 size={14} /> <span className="max-sm:sr-only">{t('Inviter')}</span>
              </button>
            )}
            {active.ownerId === userId && (
              <button className="icon-btn" title={t('Paramètres de l’agenda')} aria-label={t('Paramètres de l’agenda')} onClick={() => setDialog('settings')}>
                <Settings2 size={16} />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 px-4 md:px-8">
            <SharedCalendar key={active.id} group={active} />
          </div>
        </>
      )}

      <Modal open={dialog === 'create' || dialog === 'settings'} onClose={() => setDialog(null)}>
        {(dialog === 'create' || dialog === 'settings') && (
          <GroupForm
            group={dialog === 'settings' ? (active ?? undefined) : undefined}
            onDone={g => {
              setDialog(null);
              if (g && dialog === 'create') open(g.id);
            }}
          />
        )}
      </Modal>
      <Modal open={dialog === 'members' && !!active} onClose={() => setDialog(null)} width={560}>
        {dialog === 'members' && active && (
          <div className="flex max-h-[70vh] flex-col">
            <h3 className="mb-3 text-[15px] font-semibold">{t('Membres de « {name} »', { name: active.name })}</h3>
            <GroupMembers group={active} onLeft={() => setDialog(null)} />
          </div>
        )}
      </Modal>
    </div>
  );
}
