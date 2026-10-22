import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { fetchGroups, sessionUserId, type Group } from '../lib/groups';
import { canNotify, notify } from '../lib/notify';
import { pushActive } from '../lib/push';
import { getSettings, useSettings } from './settings';
import { toast } from './ui';
import { goTo } from '../copilot/actions';
import { groupWords } from '../lib/usage';
import { t, tn } from '../i18n';

// Pastilles et notifications « du nouveau dans tes groupes » : ce que les AUTRES membres ont ajouté
// ou modifié depuis ta dernière visite de l'onglet concerné. Tout passe par un recomptage depuis la
// base : déclenché en direct par le temps réel (limité à tes groupes) quand il fonctionne, toutes les
// 30 s sinon (réseaux qui bloquent les WebSockets), et toutes les 5 min par sécurité.
// Une notification part quand un compteur augmente.

export type ActivityTab = 'notes' | 'fichiers' | 'revisions';
type Counts = Partial<Record<ActivityTab, number>>;

const TABLES: { table: string; tab: ActivityTab; at: string; by: string; count?: (n: number) => string }[] = [
  { table: 'group_notes', tab: 'notes', at: 'updated_at', by: 'updated_by', count: n => tn(n, '{n} note', '{n} notes') },
  { table: 'group_files', tab: 'fichiers', at: 'created_at', by: 'created_by', count: n => tn(n, '{n} fichier', '{n} fichiers') },
  { table: 'group_events', tab: 'revisions', at: 'created_at', by: 'created_by' },
];
const POLL_MS = 30_000;
/** Realtime connected: the count only runs every 10 polls (5 min), as a safety net. */
const POLLS_WHEN_LIVE = 10;
/** Older changes aren't news anymore, and never re-read a whole group history. */
const MAX_AGE_MS = 7 * 864e5;

interface ActivityState {
  unread: Record<string, Counts>;
  /** Recompte depuis la base et prévient de ce qui est nouveau depuis le dernier comptage. */
  count: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
  /** L'étudiant regarde cet onglet : plus rien de nouveau dedans. */
  markSeen: (groupId: string, tab: string) => void;
}

const key = (gid: string, tab: string) => `${gid}:${tab}`;
const seenAt = (gid: string, tab: string) => getSettings().groupsSeen[key(gid, tab)];

export const totalUnread = (c: Counts = {}) => (c.notes ?? 0) + (c.fichiers ?? 0) + (c.revisions ?? 0);

let channel: RealtimeChannel | null = null;
let channelKey = '';
let live = false;
let started = false;
/** Bumped by each start/stop: a start still counting when stopped gives up. */
let generation = 0;
let poll: ReturnType<typeof setInterval> | undefined;
let soon: ReturnType<typeof setTimeout> | undefined;
let names: Record<string, string> = {};
let counted = false; // le premier comptage ne notifie pas (ce qui attendait déjà est juste affiché)
const recount = () => void useGroupActivity.getState().count();

/** Realtime limited to the student's groups (rebuilt when they join or leave one). */
function listen(groupIds: string[]) {
  const key = [...groupIds].sort().join(',');
  if (!supabase || key === channelKey) return;
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  channelKey = key;
  live = false;
  if (!key) return;
  const ch = supabase.channel(`groupes-activite-${Date.now()}`); // new name: the old channel may still be closing
  for (const t of TABLES) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: t.table, filter: `group_id=in.(${key})` }, () => {
      clearTimeout(soon);
      soon = setTimeout(recount, 1500); // une rafale de sauvegardes = un seul recomptage
    });
  }
  ch.subscribe(status => {
    if (channel === ch) live = status === 'SUBSCRIBED';
  });
  channel = ch;
}

function watching(gid: string, tab: ActivityTab) {
  const q = new URLSearchParams(location.search);
  return !document.hidden && location.pathname === '/groupes' && q.get('g') === gid && (q.get('onglet') ?? 'notes') === tab;
}

function announce(gid: string, more: Counts) {
  if (!getSettings().groupNews) return; // turned off in Profil › Notifications (the badges stay)
  const w = groupWords(getSettings().usage);
  const name = names[gid] ?? w.yours;
  // The meetings are « révisions », « réunions » or « rendez-vous » depending on the account.
  const label = (x: (typeof TABLES)[number], n: number) => x.count?.(n) ?? `${n} ${n === 1 ? w.meet.one : w.meet.many}`;
  const parts = TABLES.filter(x => more[x.tab]).map(x => label(x, more[x.tab]!));
  const first = TABLES.find(x => more[x.tab])!.tab;
  const to = `/groupes?g=${gid}${first === 'notes' ? '' : `&onglet=${first}`}`;
  toast(t('Du nouveau dans « {name} » : {parts}', { name, parts: parts.join(', ') }), 'info', { label: t('Voir'), run: () => goTo(to) });
  notify(t('Du nouveau dans « {name} »', { name }), parts.join(', '));
}

export const useGroupActivity = create<ActivityState>((set, get) => ({
  unread: {},

  async count() {
    if (!supabase) return;
    const me = await sessionUserId().catch(() => null);
    if (!me) return;
    // Sa propre liste : celle du store est vidée et rechargée par la page Groupes à chaque visite.
    let groups: Group[];
    try {
      groups = (await fetchGroups()).filter(g => g.kind === 'groupe'); // shared calendars notify by push
    } catch {
      return; // réseau coupé : on garde l'affichage actuel
    }
    names = Object.fromEntries(groups.map(g => [g.id, g.name]));
    if (started) listen(groups.map(g => g.id));

    // Groupe jamais visité sur ce compte : on part de maintenant (pas d'avalanche de vieilles pastilles).
    const now = new Date().toISOString();
    const missing = Object.fromEntries(
      groups.flatMap(g => TABLES.map(t => key(g.id, t.tab))).filter(k => !getSettings().groupsSeen[k]).map(k => [k, now]),
    );
    if (Object.keys(missing).length) useSettings.getState().set({ groupsSeen: { ...getSettings().groupsSeen, ...missing } });

    const unread: Record<string, Counts> = {};
    const results = await Promise.all(
      TABLES.map(async t => {
        const oldest = groups.map(g => seenAt(g.id, t.tab)).sort()[0];
        if (!oldest) return true;
        const floor = new Date(Date.now() - MAX_AGE_MS).toISOString();
        const since = oldest > floor ? oldest : floor;
        const { data, error } = await supabase!.from(t.table).select(`group_id, ${t.at}`).gt(t.at, since).neq(t.by, me);
        for (const r of (data ?? []) as unknown as Record<string, string>[]) {
          if (r[t.at] <= (seenAt(r.group_id, t.tab) ?? now)) continue;
          unread[r.group_id] = { ...unread[r.group_id], [t.tab]: (unread[r.group_id]?.[t.tab] ?? 0) + 1 };
        }
        return !error;
      }),
    );
    if (results.includes(false)) return; // réseau coupé : on garde l'affichage actuel

    // Ce que l'étudiant regarde en ce moment est vu, pas nouveau.
    for (const [gid, c] of Object.entries(unread)) {
      for (const t of TABLES) {
        if (!c[t.tab] || !watching(gid, t.tab)) continue;
        c[t.tab] = 0;
        get().markSeen(gid, t.tab);
      }
    }

    // New files and meetings: a device that gets the server's notifications already heard of them (the
    // badges are enough). Notes stay announced: the server only tells of new ones, not of changes.
    if (counted) {
      const told = (await pushActive()) ? new Set<ActivityTab>(['fichiers', 'revisions']) : new Set<ActivityTab>();
      const before = get().unread;
      for (const [gid, c] of Object.entries(unread)) {
        const more: Counts = {};
        for (const t of TABLES) if (!told.has(t.tab) && (c[t.tab] ?? 0) > (before[gid]?.[t.tab] ?? 0)) more[t.tab] = (c[t.tab] ?? 0) - (before[gid]?.[t.tab] ?? 0);
        if (Object.keys(more).length) announce(gid, more);
      }
    }
    counted = true;
    set({ unread });
  },

  async start() {
    if (!supabase || started) return;
    started = true;
    const run = ++generation;
    await get().count(); // also opens the Realtime channel on the student's groups
    if (run !== generation) return; // stopped (sign-out, account switch) meanwhile
    let ticks = 0;
    poll = setInterval(() => {
      if (document.hidden && !canNotify()) return;
      if (live && ++ticks % POLLS_WHEN_LIVE) return;
      recount();
    }, POLL_MS);
    addEventListener('focus', recount);
  },

  stop() {
    started = false;
    generation++;
    removeEventListener('focus', recount);
    clearInterval(poll);
    clearTimeout(soon);
    if (channel && supabase) void supabase.removeChannel(channel);
    channel = null;
    channelKey = '';
    live = false;
    counted = false;
    set({ unread: {} });
  },

  markSeen(gid, tab) {
    if (!TABLES.some(t => t.tab === tab)) return;
    useSettings.getState().set({ groupsSeen: { ...getSettings().groupsSeen, [key(gid, tab)]: new Date().toISOString() } });
    if (get().unread[gid]?.[tab as ActivityTab]) set(s => ({ unread: { ...s.unread, [gid]: { ...s.unread[gid], [tab]: 0 } } }));
  },
}));
