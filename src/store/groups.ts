import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { addDays } from 'date-fns';
import { toKey, todayKey } from '../lib/dates';
import * as api from '../lib/groups';
import type { Attendance, Group, GroupEvent, GroupFile, GroupMember, GroupNoteSummary } from '../lib/groups';
import type { Period } from '../lib/periods';

// Groupes de travail (en ligne seulement). Rien n'est gardé dans le navigateur : tout est relu
// depuis Supabase à l'ouverture, en direct (Realtime) et quand l'onglet reprend la main.

interface GroupsState {
  groups: Group[];
  loaded: boolean;
  failed: boolean;
  activeId: string | null;
  members: Record<string, GroupMember[]>;
  notes: Record<string, GroupNoteSummary[]>;
  events: Record<string, GroupEvent[]>;
  /** A shared calendar's periods (« En entreprise »…), read with its events. */
  periods: Record<string, Period[]>;
  attendance: Record<string, Attendance[]>;
  files: Record<string, GroupFile[]>;
  /** Code d'invitation (null : pas le droit d'inviter). Lu à part, jamais dans la table groups. */
  codes: Record<string, string | null>;
  /** « groupId:part » whose last read failed (no connection…): the tab offers « Réessayer » instead of loading forever. */
  loadFailed: Record<string, true>;
  loadGroups: () => Promise<void>;
  /** Ouvre un groupe : charge son contenu et écoute les changements des autres membres. */
  open: (id: string | null) => void;
  refresh: (id: string, parts?: Part[]) => Promise<void>;
  upsertNote: (n: GroupNoteSummary) => void;
  dropNote: (groupId: string, id: string) => void;
  /** Leaving the Groups / Agendas page: no group open, no more live updates. What was read stays (the search finds it). */
  leave: () => void;
  /** Vide tout (déconnexion, changement de compte). */
  reset: () => void;
}

type Part = 'members' | 'notes' | 'events' | 'files';

let channel: RealtimeChannel | null = null;
let channelGroup: string | null = null;
const timers: Partial<Record<string, ReturnType<typeof setTimeout>>> = {};
/** The primary key of a deleted row (all Realtime sends for a DELETE). */
const oldOf = (p: { old: unknown }) => (p.old ?? {}) as Record<string, string | undefined>;

export const useGroups = create<GroupsState>((set, get) => {
  /** Regroupe les rafales d'événements Realtime en une seule relecture. */
  const soon = (gid: string, part: Part | 'groups') => {
    const k = gid + part;
    clearTimeout(timers[k]);
    timers[k] = setTimeout(() => {
      if (part === 'groups') void get().loadGroups();
      else if (get().activeId === gid) void get().refresh(gid, [part]);
    }, 250);
  };

  const subscribe = (gid: string | null) => {
    if (!supabase || channelGroup === gid) return;
    if (channel) void supabase.removeChannel(channel);
    channel = null;
    channelGroup = gid;
    if (!gid) return;
    const f = `group_id=eq.${gid}`;
    channel = supabase
      .channel(`groupe-${gid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_notes', filter: f }, () => soon(gid, 'notes'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_events', filter: f }, () => soon(gid, 'events'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_event_attendees', filter: f }, () => soon(gid, 'events'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_periods', filter: f }, () => soon(gid, 'events'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_files', filter: f }, () => soon(gid, 'files'))
      // Droits changés, arrivée, départ : membres + code d'invitation. (La table groups n'est pas
      // diffusée en direct, pour ne pas exposer le code : la liste est relue ici et au retour sur l'onglet.)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: f }, () => (soon(gid, 'members'), soon(gid, 'groups')))
      // Les suppressions ne sont pas filtrables côté Realtime : on reçoit seulement des identifiants.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_notes' }, p => {
        const id = String((p.old as { id?: string }).id ?? '');
        if (get().notes[gid]?.some(n => n.id === id)) get().dropNote(gid, id);
      })
      // Every deletion of the whole site arrives here: only those touching this group cause a reload.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_events' }, p => {
        if (get().events[gid]?.some(e => e.id === oldOf(p).id)) soon(gid, 'events');
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_periods' }, p => {
        if (get().periods[gid]?.some(x => x.id === oldOf(p).id)) soon(gid, 'events');
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_event_attendees' }, p => {
        if (get().events[gid]?.some(e => e.id === oldOf(p).event_id)) soon(gid, 'events');
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_files' }, p => {
        if (get().files[gid]?.some(f => f.id === oldOf(p).id)) soon(gid, 'files');
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_members' }, p => {
        if (oldOf(p).group_id !== gid) return;
        soon(gid, 'members');
        soon(gid, 'groups');
      })
      .subscribe();
  };

  return {
    groups: [],
    loaded: false,
    failed: false,
    activeId: null,
    members: {},
    notes: {},
    events: {},
    periods: {},
    attendance: {},
    files: {},
    codes: {},
    loadFailed: {},

    async loadGroups() {
      try {
        const groups = await api.fetchGroups();
        set({ groups, loaded: true, failed: false });
        void api.purgeDeletedGroups().catch(() => undefined);
      } catch {
        set({ loaded: true, failed: true });
      }
    },

    open(id) {
      set({ activeId: id });
      subscribe(id);
      if (id) void get().refresh(id);
    },

    async refresh(id, parts) {
      // A shared calendar: its link token instead of a code, a year of past events (month view), no notes or files.
      const agenda = get().groups.find(g => g.id === id)?.kind === 'agenda';
      parts ??= agenda ? ['members', 'events'] : ['members', 'notes', 'events', 'files'];
      const jobs: Promise<unknown>[] = [];
      if (parts.includes('members'))
        jobs.push(
          api.fetchMembers(id).then(m => set(s => ({ members: { ...s.members, [id]: m } }))),
          (agenda ? api.fetchAgendaToken(id) : api.fetchInviteCode(id)).then(c => set(s => ({ codes: { ...s.codes, [id]: c } }))),
        );
      if (parts.includes('files')) jobs.push(api.fetchFiles(id).then(f => set(s => ({ files: { ...s.files, [id]: f } }))));
      if (parts.includes('notes')) jobs.push(api.fetchNotes(id).then(n => set(s => ({ notes: { ...s.notes, [id]: n } }))));
      if (parts.includes('events'))
        jobs.push(
          api.fetchEvents(id, agenda ? toKey(addDays(new Date(), -366)) : todayKey()).then(r => set(s => ({ events: { ...s.events, [id]: r.events }, attendance: { ...s.attendance, [id]: r.attendance } }))),
          ...(agenda ? [api.fetchPeriods(id).then(p => set(s => ({ periods: { ...s.periods, [id]: p } })))] : []),
        );
      // Each part remembers whether its last read failed.
      const mark = (part: Part, ok: boolean) =>
        set(s => {
          const k = `${id}:${part}`;
          if (ok === !s.loadFailed[k]) return s;
          const loadFailed = { ...s.loadFailed };
          if (ok) delete loadFailed[k];
          else loadFailed[k] = true;
          return { loadFailed };
        });
      const res = await Promise.allSettled(jobs);
      const order = (['members', 'files', 'notes', 'events'] as Part[]).filter(p => parts.includes(p));
      let i = 0;
      for (const part of order) {
        const n = part === 'members' ? 2 : part === 'events' && agenda ? 2 : 1;
        mark(part, res.slice(i, i + n).every(r => r.status === 'fulfilled'));
        i += n;
      }
      // Plus membre (retiré par le propriétaire, groupe supprimé) : la liste des groupes le dira.
      if (res.some(r => r.status === 'rejected')) void get().loadGroups();
    },

    upsertNote(n) {
      set(s => {
        const list = (s.notes[n.groupId] ?? []).filter(x => x.id !== n.id);
        return { notes: { ...s.notes, [n.groupId]: [n, ...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) } };
      });
    },

    dropNote(groupId, id) {
      set(s => ({ notes: { ...s.notes, [groupId]: (s.notes[groupId] ?? []).filter(n => n.id !== id) } }));
    },

    leave() {
      subscribe(null);
      set({ activeId: null });
    },

    reset() {
      subscribe(null);
      set({ groups: [], loaded: false, failed: false, activeId: null, members: {}, notes: {}, events: {}, periods: {}, attendance: {}, files: {}, codes: {}, loadFailed: {} });
    },
  };
});

/** The list, read early (app opened): the Groups and Agendas pages then show it at once. */
export function prefetchGroups() {
  const { loaded, loadGroups } = useGroups.getState();
  if (!loaded && supabase) void loadGroups();
}

const prefetched = new Set<string>();
/** A group's content, read when the pointer reaches it: it opens already filled. */
export function prefetchGroup(id: string) {
  const s = useGroups.getState();
  if (!supabase || prefetched.has(id) || s.activeId === id || s.members[id]) return;
  prefetched.add(id);
  void s.refresh(id);
}

/** Relit tout quand on revient sur l'onglet (au cas où le temps réel a décroché). */
export function watchFocus(): () => void {
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    const { activeId, loadGroups, refresh } = useGroups.getState();
    void loadGroups();
    if (activeId) void refresh(activeId);
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}
