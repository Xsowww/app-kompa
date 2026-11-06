// « Déplacer vers… » in the window of an event: to a shared calendar, a team, or back to my calendar
// (store/moveEvent, the same function Kompaly uses). Online only: without the cloud there is nowhere else to go.

import { useEffect, useState } from 'react';
import { ArrowRightLeft, CalendarDays, Users } from 'lucide-react';
import { Popover } from '../../components/Pickers';
import { useGroups } from '../../store/groups';
import { useAuth } from '../../store/auth';
import { cloudEnabled } from '../../lib/supabase';
import { toast } from '../../store/ui';
import { moveEventToAgenda, PERSO } from '../../store/moveEvent';
import { agendaTargets } from '../groups/agendaTarget';
import type { Group, GroupRole } from '../../lib/groups';
import { askSeriesScope, type CalendarSource } from './source';
import type { CalendarEvent } from '../../store/calendar';
import { t, tn } from '../../i18n';

/** Where an event can go: a shared calendar I can add to, or one of my teams. */
const moveTargets = (groups: Group[], roles: Record<string, GroupRole>, me: string | undefined): Group[] => [...agendaTargets(groups, roles, me), ...groups.filter(g => g.kind !== 'agenda')];

export default function MoveTo({ event, source, onMoved }: { event: CalendarEvent; source: CalendarSource; onMoved: () => void }) {
  const from = source.shared?.group.id ?? null;
  const groups = useGroups(s => s.groups);
  const roles = useGroups(s => s.myRoles);
  const loaded = useGroups(s => s.loaded);
  const me = useAuth(s => s.user?.id);
  useEffect(() => {
    if (cloudEnabled && !loaded) void useGroups.getState().loadGroups();
  }, [loaded]);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = cloudEnabled ? moveTargets(groups, roles, me).filter(g => g.id !== from) : [];
  if (!cloudEnabled || (!targets.length && !from)) return null;

  const go = async (to: string | null) => {
    setMenu(null);
    const scope = await askSeriesScope(event, 'edit', source.events);
    if (!scope) return;
    setBusy(true);
    const agenda = to ? (groups.find(g => g.id === to)?.name ?? '') : t('Mon agenda');
    const run = async () => {
      try {
        const r = await moveEventToAgenda(event.id, from ? { kind: 'group', groupId: from } : PERSO, to ? { kind: 'group', groupId: to } : PERSO, { series: scope === 'next' });
        const n = r.moved.length;
        toast(n > 1 ? tn(n, '{n} événement déplacé vers « {agenda} »', '{n} événements déplacés vers « {agenda} »', { agenda }) : t('Déplacé vers « {agenda} » : {title}', { agenda, title: event.title }), 'success');
        onMoved();
      } catch (e) {
        toast(t('Pas déplacé : {why}', { why: e instanceof Error ? e.message : String(e) }), 'error', { label: t('Réessayer'), run: () => void run() });
      }
    };
    await run();
    setBusy(false);
  };

  const item = 'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-stone-100 focus-visible:bg-stone-100 pointer-coarse:py-3';
  return (
    <>
      <button
        type="button"
        className="btn-ghost w-10 px-0"
        title={t('Déplacer vers…')}
        aria-label={t('Déplacer vers…')}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        disabled={busy}
        onClick={e => setMenu(menu ? null : e.currentTarget)}
      >
        <ArrowRightLeft size={15} />
      </button>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} label={t('Déplacer vers…')} className="p-1">
          <div role="menu" aria-label={t('Déplacer vers…')} className="min-w-56 max-w-[min(320px,calc(100vw-24px))]">
            <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-stone-500">{t('Déplacer vers…')}</p>
            {from && (
              <button type="button" role="menuitem" autoFocus className={item} onClick={() => void go(null)}>
                <CalendarDays size={15} className="shrink-0 text-stone-400" aria-hidden /> {t('Mon agenda')}
              </button>
            )}
            {targets.map((g, i) => (
              <button key={g.id} type="button" role="menuitem" autoFocus={!from && i === 0} className={item} onClick={() => void go(g.id)}>
                {g.kind === 'agenda' ? <CalendarDays size={15} className="shrink-0 text-stone-400" aria-hidden /> : <Users size={15} className="shrink-0 text-stone-400" aria-hidden />}
                <span className="min-w-0 truncate">{g.name}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
