// The « + » form's « Agenda » choice, the app side: which shared calendars a new event can go to, and adding it there.
import { useEffect, useMemo } from 'react';
import { createEvent, createEvents, groupError, type Group } from '../../lib/groups';
import { cloudEnabled } from '../../lib/supabase';
import { useGroups } from '../../store/groups';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/ui';
import type { NewEvent } from '../../store/calendar';
import { agendaTargets, toAgendaRows } from './agendaTarget';
import { t } from '../../i18n';

const NONE: Group[] = [];

/** My shared calendars a new event can go to (none without the cloud, or when not `enabled`). */
export function useAgendaTargets(enabled: boolean): Group[] {
  const groups = useGroups(s => s.groups);
  const roles = useGroups(s => s.myRoles);
  const loaded = useGroups(s => s.loaded);
  const me = useAuth(s => s.user?.id);
  useEffect(() => {
    if (enabled && cloudEnabled && !loaded) void useGroups.getState().loadGroups();
  }, [enabled, loaded]);
  return useMemo(() => (enabled && cloudEnabled ? agendaTargets(groups, roles, me) : NONE), [enabled, groups, roles, me]);
}

/** Adds the form's events to a shared calendar (every member sees them); a refusal is said, with « Réessayer ». */
export function addToAgenda(agenda: Group, list: NewEvent[]) {
  const rows = toAgendaRows(list, agenda);
  if (!rows.length) return;
  const send = () =>
    void (rows.length > 1 ? createEvents(agenda.id, rows) : createEvent(agenda.id, rows[0]))
      .then(() => useGroups.getState().refresh(agenda.id, ['events']))
      .catch(e =>
        toast(t('« {title} » n’a pas été ajouté à « {agenda} » : {why}', { title: rows[0].title, agenda: agenda.name, why: groupError(e) }), 'error', {
          label: t('Réessayer'),
          run: send,
        }),
      );
  send();
}
