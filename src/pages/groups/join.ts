import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { fetchGroups, groupError, joinAgenda, joinGroup, type GroupKind } from '../../lib/groups';
import { cloudEnabled } from '../../lib/supabase';
import { useGroups } from '../../store/groups';
import { toast } from '../../store/ui';
import { t } from '../../i18n';

// Joining a group (code or link) or a shared calendar (link): a window says which one, with « Y aller » to open it
// and « Terminer » to stay on the page underneath.

export interface Joined {
  kind: GroupKind;
  id: string;
  name: string;
  already: boolean;
}

export const useJoined = create<{ joined: Joined | null }>(() => ({ joined: null }));
export const showJoined = (joined: Joined) => useJoined.setState({ joined });

/** Joins with a link's secret, then says so in the window (or why not, in a message). */
async function joinAndAnnounce(kind: GroupKind, secret: string) {
  try {
    const before = await fetchGroups().catch(() => []);
    const id = kind === 'agenda' ? await joinAgenda(secret) : await joinGroup(secret);
    if (!id) {
      toast(t('Ce lien d’invitation ne marche plus : demandes-en un nouveau.'), 'error');
      return;
    }
    const after = await fetchGroups().catch(() => before);
    // The groups screens show it at once (they load their list when they open, else).
    if (useGroups.getState().loaded) void useGroups.getState().loadGroups();
    showJoined({ kind, id, name: after.find(g => g.id === id)?.name ?? '', already: before.some(g => g.id === id) });
  } catch (e) {
    toast(groupError(e), 'error');
  }
}

const handled = new Set<string>();

/**
 * Invitation links (/groupes?rejoindre=CODE, /agendas?invitation=…), also when opened signed out (kept until
 * after sign-in, App › RequireAuth): joined here, the link's parameter taken off the address.
 */
export function useInvitations(pending: string | null) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!cloudEnabled) return;
    const take = (query: string) => {
      const p = new URLSearchParams(query);
      const token = p.get('invitation');
      const code = p.get('rejoindre');
      const secret = token ?? code;
      if (!secret || handled.has(secret)) return false;
      handled.add(secret); // once, even when React runs the effect twice
      void joinAndAnnounce(token ? 'agenda' : 'groupe', secret);
      return true;
    };
    if (pending) take(pending.slice(pending.indexOf('?')));
    const p = new URLSearchParams(search);
    if (!p.has('rejoindre') && !p.has('invitation')) return;
    take(search);
    p.delete('rejoindre');
    p.delete('invitation');
    navigate({ pathname, search: p.toString() ? `?${p}` : '' }, { replace: true });
  }, [pending, pathname, search, navigate]);
}
