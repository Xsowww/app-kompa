// « S'abonner à un emploi du temps par lien » : a calendar link (.ics from Moodle, Hyperplanning, ADE, Google Agenda…)
// read again every few hours. Its events are ordinary events marked `feed:<feed id>:<UID>` (externalId); each one's
// id is made from that mark, so two devices refreshing the same link make the same event, never a twin.
// The server downloads the link (server/icsFeed.mjs): other sites don't let a page read them.

import { timetableCategory, useCalendar, type CalendarEvent } from '../store/calendar';
import { getSettings, useSettings } from '../store/settings';
import { parseIcs, type IcsEvent } from './ics';
import { accessToken } from './supabase';
import { fmtDay, fromKey, todayKey } from './dates';
import { nowIso, uid } from './utils';
import { t } from '../i18n';

export interface IcsFeed {
  id: string;
  url: string;
  name: string;
  /** Last time it was read (ISO). */
  lastSync?: string;
  /** Asked for a link with only past events (last year's timetable): its past is added too. */
  pastToo?: boolean;
  /** Last failure, said in the list (the code from the server). */
  error?: string;
}

/** Read again after this long (on opening the app, or coming back to it). */
const EVERY_MS = 3 * 3600_000;
export const MAX_FEEDS = 10;

export class FeedError extends Error {
  code: string;
  /** « no_upcoming »: the day of the link's last event. */
  last?: string;
  constructor(code: string, last?: string) {
    super(code);
    this.code = code;
    this.last = last;
  }
}

/** What to say about a failure. */
export function feedErrorText(code: string, last?: string): string {
  if (code === 'no_upcoming')
    return last
      ? t('Aucun cours à venir dans ce lien : le dernier date du {day}. C’est sans doute le lien de l’an dernier : prends celui de cette année.', { day: fmtDay(fromKey(last), 'd MMMM') })
      : t('Aucun cours à venir dans ce lien.');
  if (code === 'bad_url') return t('Ce lien n’est pas valide : copie le lien d’abonnement complet (il commence par https:// ou webcal://).');
  if (code === 'not_ics') return t('Ce lien ne mène pas à un calendrier (.ics).');
  if (code === 'empty') return t('Aucun événement dans ce calendrier.');
  if (code === 'http_401' || code === 'http_403') return t('Le site refuse l’accès : vérifie que c’est bien le lien d’abonnement (privé) et qu’il est encore valable.');
  if (code === 'http_404' || code === 'not_found') return t('Ce lien n’existe pas ou plus : récupère-en un nouveau.');
  if (code === 'too_large') return t('Calendrier trop gros (plus de 5 Mo).');
  if (code === 'rate_limited') return t('Trop de mises à jour d’un coup : réessaie dans une minute.');
  return t('Le calendrier ne répond pas pour l’instant : nouvel essai plus tard.');
}

export async function downloadFeed(url: string): Promise<string> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(`/api/ics?url=${encodeURIComponent(url)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new FeedError('network');
  }
  if (!res.ok) throw new FeedError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `http_${res.status}`);
  return res.text();
}

/**
 * A short name to show: Hyperplanning's « HYP - NOM Prénom 01/01/2000 (12345 - Ville | DCGA MAST1) » becomes
 * « Hyperplanning · DCGA MAST1 » (no birth date on every class).
 */
export function feedLabel(name: string): string {
  const hp = /^HYP\s*-.*\(([^()]*)\)\s*$/i.exec(name);
  if (!hp) return name;
  const group = hp[1].replace(/^\s*\d+\s*-\s*/, '').split('|').pop()!.trim();
  return group ? `Hyperplanning · ${group}` : 'Hyperplanning';
}

/** The calendar's own name (X-WR-CALNAME), else the site's. */
export function feedName(text: string, url: string): string {
  // Folded lines joined first; « … - du 01 septembre 2025 au 11 octobre 2026 » (Hyperplanning) left out.
  const own = /^X-WR-CALNAME[^:]*:(.+)$/im
    .exec(text.replace(/\r?\n[ \t]/g, ''))?.[1]
    ?.replace(/\\([,;])/g, '$1')
    .replace(/\s+-\s+du\s+\d.*$/i, '')
    .trim();
  if (own) return feedLabel(own).slice(0, 60);
  try {
    return new URL(url.replace(/^webcals?:/i, 'https:')).hostname.replace(/^www\./, '');
  } catch {
    return t('Emploi du temps');
  }
}

/** A UUID made from a text (same text, same id): SHA-256, shaped as a version-5-like UUID. */
export async function stableId(text: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const feedMark = (feedId: string) => `feed:${feedId}:`;

export interface FeedPlan {
  add: CalendarEvent[];
  updates: { id: string; patch: Pick<CalendarEvent, 'title' | 'date' | 'start' | 'end' | 'details'> & Partial<Pick<CalendarEvent, 'category'>> }[];
  remove: string[];
}

/**
 * What a new read of the link changes. New events from today on are added (not the past of the timetable);
 * known ones take the link's title, day, times and details (category, « fait », reminders stay as the student set
 * them); the ones the link no longer has go, from today on. One deleted by the student (in the trash) stays deleted.
 * Pure: tested in tests/icsFeeds.test.ts.
 */
export function planFeed(feedId: string, items: (IcsEvent & { id: string })[], events: CalendarEvent[], trash: CalendarEvent[], today: string, now = nowIso(), pastToo = false): FeedPlan {
  const mark = feedMark(feedId);
  const mine = new Map(events.filter(e => e.externalId?.startsWith(mark)).map(e => [e.id, e]));
  const taken = new Set([...events, ...trash].map(e => e.id));
  const seen = new Set<string>();
  const plan: FeedPlan = { add: [], updates: [], remove: [] };
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    const old = mine.get(it.id);
    if (old) {
      const patch: FeedPlan['updates'][number]['patch'] = { title: it.title, date: it.date, start: it.start, end: it.end, details: it.details };
      // Left « Perso » by an older guess: a class now (a category chosen by the student is kept).
      const category = timetableCategory(it.title, !!it.start);
      if (old.category === 'perso' && category !== 'perso') patch.category = category;
      if ((Object.keys(patch) as (keyof typeof patch)[]).some(k => (old[k] ?? undefined) !== (patch[k] ?? undefined))) plan.updates.push({ id: it.id, patch });
    } else if (!taken.has(it.id) && (pastToo || it.date >= today)) {
      plan.add.push({ id: it.id, title: it.title, date: it.date, start: it.start, end: it.end, details: it.details, externalId: mark + it.externalId, category: timetableCategory(it.title, !!it.start), done: false, createdAt: now });
    }
  }
  for (const e of mine.values()) if (!seen.has(e.id) && e.date >= today) plan.remove.push(e.id);
  return plan;
}

function apply(plan: FeedPlan) {
  if (!plan.add.length && !plan.updates.length && !plan.remove.length) return;
  const gone = new Set(plan.remove);
  const patches = new Map(plan.updates.map(u => [u.id, u.patch]));
  useCalendar.setState(s => ({
    events: [...s.events.filter(e => !gone.has(e.id)).map(e => (patches.has(e.id) ? { ...e, ...patches.get(e.id) } : e)), ...plan.add],
  }));
}

/** Reads one link and puts the calendar in step. */
export async function syncFeed(feed: IcsFeed, text?: string): Promise<FeedPlan> {
  const body = text ?? (await downloadFeed(feed.url));
  const parsed = parseIcs(body);
  const items = await Promise.all(parsed.map(async e => ({ ...e, id: await stableId(feedMark(feed.id) + e.externalId) })));
  const { events, trash } = useCalendar.getState();
  const plan = planFeed(feed.id, items, events, trash, todayKey(), nowIso(), feed.pastToo);
  apply(plan);
  return plan;
}

const saveFeed = (id: string, patch: Partial<IcsFeed>) =>
  useSettings.getState().set({ icsFeeds: (getSettings().icsFeeds ?? []).map(f => (f.id === id ? { ...f, ...patch } : f)) });

/** Subscribes: reads the link once (refused if it isn't a calendar), then keeps it. */
/** `pastToo`: also the past events (asked after « no_upcoming »). */
export async function subscribe(url: string, pastToo = false): Promise<{ feed: IcsFeed; plan: FeedPlan }> {
  const clean = url.trim().replace(/^webcals?:\/\//i, 'https://');
  const text = await downloadFeed(clean);
  const all = parseIcs(text);
  if (!all.length) throw new FeedError('empty');
  // Only the past (last year's timetable): said, instead of following a link that adds nothing.
  if (!pastToo && !all.some(e => e.date >= todayKey())) throw new FeedError('no_upcoming', all[all.length - 1].date);
  const feed: IcsFeed = { id: uid().slice(0, 12).replace(/[^a-z0-9]/gi, '0'), url: clean, name: feedName(text, clean), lastSync: nowIso(), ...(pastToo && { pastToo }) };
  useSettings.getState().set({ icsFeeds: [...(getSettings().icsFeeds ?? []), feed] });
  return { feed, plan: await syncFeed(feed, text) };
}

/** Unsubscribes: everything that came from this link goes (past, to come, in the trash); nothing else is touched. */
export function unsubscribe(id: string): number {
  const mark = feedMark(id);
  const ours = (e: CalendarEvent) => !!e.externalId?.startsWith(mark);
  const n = useCalendar.getState().events.filter(ours).length;
  useCalendar.setState(s => ({ events: s.events.filter(e => !ours(e)), trash: s.trash.filter(e => !ours(e)) }));
  useSettings.getState().set({ icsFeeds: (getSettings().icsFeeds ?? []).filter(f => f.id !== id) });
  return n;
}

/** The link an event came from, if any (its name is shown on the event). */
export const feedOf = (e: Pick<CalendarEvent, 'externalId'>, feeds: IcsFeed[]) => (e.externalId?.startsWith('feed:') ? feeds.find(f => e.externalId!.startsWith(feedMark(f.id))) : undefined);

let running: Promise<void> | null = null;
/** Reads again the links not read for a while (`force`: all of them now). */
export function refreshFeeds(force = false): Promise<void> {
  return (running ??= (async () => {
    for (const f of getSettings().icsFeeds ?? []) {
      if (!force && f.lastSync && Date.now() - Date.parse(f.lastSync) < EVERY_MS) continue;
      try {
        await syncFeed(f);
        saveFeed(f.id, { lastSync: nowIso(), error: undefined });
      } catch (e) {
        saveFeed(f.id, { error: e instanceof FeedError ? e.code : 'unreachable' });
      }
    }
  })().finally(() => (running = null)));
}

/** On opening the app and coming back to it: the links due are read again. */
export function startFeedRefresh(): () => void {
  const run = () => document.visibilityState === 'visible' && void refreshFeeds();
  const first = setTimeout(run, 4000); // after the account's own data
  document.addEventListener('visibilitychange', run);
  return () => {
    clearTimeout(first);
    document.removeEventListener('visibilitychange', run);
  };
}
