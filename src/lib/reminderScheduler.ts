// Reminders of events and tasks, while the app is open and when it is closed.
//
// - Online: the upcoming reminders are sent to the server (RPC replace_my_reminders), which sends them as
//   push notifications at the right time (server/push.mjs → public/sw.js), even with the site closed.
// - In the app: the next day's reminders are also timed here. Page in view: a card in the app (ReminderAlerts);
//   page in the background: a system notification. When the server's push reaches this device, it shows first
//   and the app's own timer, a little later, sees it is done.
// - Shared calendars: the database prepares their reminders for each member (migration 2026-10-27); the app
//   reads the next day's ones (RPC my_shared_reminders) and times them the same way.
// Every reminder has a key (lib/reminders): shown once, whichever way it came. Several due at the same moment
// (a morning's tasks at 9:00): one notification for all (lib/notifyGroups, as the server does).
// « Plus tard » and « Fait » (the card in the app, the system notification's buttons): lib/reminderActions; what
// « Plus tard » puts off is in the settings (reminderSnoozes, on every device), planned here again with the rest.

import { eventReminders, upcomingReminders, taskDigests, type DueReminder, type ReminderSource } from './reminders';
import { reminderAction } from './reminderActions';
import { useCalendar } from '../store/calendar';
import { useTodos } from '../store/todos';
import { useSettings, getSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { supabase } from './supabase';
import { chime, canNotify, showSystemNotification } from './notify';
import { pushActive, refreshDevice } from './push';
import { goTo } from '../copilot/actions';
import { useAgendaNews, viewingAgenda } from '../store/agendaNews';
import { useAuth } from '../store/auth';
import { useGroups } from '../store/groups';
import { savedAccount, savedAccounts } from './accounts';
import { groupByMoment, mergeNotifications } from './notifyGroups.mjs';
import { locale, t } from '../i18n';

/** Push on this device: the server's notification comes first; the app shows it only if it didn't come. */
const FALLBACK_DELAY = 45_000;
/** Timers for the next day; planned again every hour, at every change and when the page comes back. */
const LOCAL_HORIZON = 26 * 3_600_000;
/** Later than that (computer asleep…), a reminder is no longer useful. */
const TOO_LATE = 30 * 60_000;

let userId: string | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
let push = false;
let lastSent = '';
let serverReady = true;
/** The next day's reminders of my shared calendars, as the database prepared them. */
let shared: DueReminder[] = [];
let sharedReady = true;

// ── Already shown (shared by the tabs, per account) ─────────────────────────
const shownKey = () => `cop:${userId}:reminders-shown`;
function readShown(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(shownKey()) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
const wasShown = (key: string) => readShown().includes(key);
function markShown(key: string) {
  try {
    localStorage.setItem(shownKey(), JSON.stringify([...readShown().filter(k => k !== key), key].slice(-300)));
  } catch {
    /* private mode: a second tab may show it again */
  }
}

// ── What to remind ──────────────────────────────────────────────────────────
function sources(): ReminderSource[] {
  const { defaultReminders: defaults, reminderSnoozes } = getSettings();
  const snoozes = new Map<string, string[]>();
  for (const z of reminderSnoozes ?? []) snoozes.set(z.item, [...(snoozes.get(z.item) ?? []), z.at]);
  return [
    ...useCalendar.getState().events.map(e => ({
      kind: 'event' as const,
      id: e.id,
      title: e.title,
      date: e.date,
      time: e.start,
      end: e.end,
      done: e.done,
      // Events made before reminders existed: the usual reminder, if they have a time.
      reminders: eventReminders(e, defaults),
      snoozes: snoozes.get(`event:${e.id}`),
    })),
    ...useTodos.getState().todos.map(t => ({ kind: 'task' as const, id: t.id, title: t.title, date: t.due, time: t.time, done: t.done, reminders: t.reminders, snoozes: snoozes.get(`task:${t.id}`) })),
  ];
}

// ── Showing one ─────────────────────────────────────────────────────────────
function showInApp(r: { key: string; title: string; body: string; url: string; keys?: string[] }) {
  useUi.getState().showAlert({ key: r.key, title: r.title, body: r.body, url: r.url, keys: r.keys, at: Date.now() });
  if (getSettings().reminderSound) chime();
}

function fire(group: DueReminder[]) {
  const due = group.filter(x => !wasShown(x.key) && Date.now() - x.fireAt.getTime() <= TOO_LATE);
  if (!due.length) return;
  due.forEach(x => markShown(x.key));
  const r = mergeNotifications(due);
  if (document.visibilityState === 'visible' || !canNotify()) showInApp(r);
  else {
    // Same last line as the server's notifications when this device holds several accounts (public/sw.js).
    const account = savedAccounts().length > 1 && userId ? accountLabels()[userId] : undefined;
    void showSystemNotification(r.title, account ? `${r.body}\n${t('Compte {account}', { account })}` : r.body, r.key, r.url, r.keys).then(ok => ok || showInApp(r));
  }
}

// ── Planning ────────────────────────────────────────────────────────────────
async function sendToServer(list: DueReminder[]) {
  if (!supabase || !serverReady) return;
  const items = list.slice(0, 300).map(r => ({ key: r.key, fire_at: r.fireAt.toISOString(), title: r.title, body: r.body, url: r.url }));
  const payload = JSON.stringify(items);
  if (payload === lastSent) return;
  const { error } = await supabase.rpc('replace_my_reminders', { p_items: items });
  if (!error) lastSent = payload;
  // Server without the 2026-10-17 migration: reminders only in the app, nothing more to send.
  else if (error.code === 'PGRST202' || error.message.includes('replace_my_reminders')) serverReady = false;
}

async function loadShared() {
  const id = userId;
  if (!supabase || !sharedReady || !id) return;
  const { data, error } = await supabase.rpc('my_shared_reminders');
  if (userId !== id) return; // signed out or another account meanwhile
  // Server without the 2026-10-27 migration: no reminders on shared calendars yet.
  if (error) return void (error.code === 'PGRST202' && (sharedReady = false));
  const rows = (Array.isArray(data) ? data : []) as { key: string; fire_at: string; title: string; body: string; url: string }[];
  shared = rows.map(r => ({ key: r.key, fireAt: new Date(r.fire_at), title: r.title, body: r.body ?? '', url: r.url || '/' })).filter(r => !Number.isNaN(r.fireAt.getTime()));
}

let sharedTimer: ReturnType<typeof setTimeout> | undefined;
/** Read again a little after a shared calendar changed (the database prepares its reminders first). */
const loadSharedSoon = () => {
  clearTimeout(sharedTimer);
  sharedTimer = setTimeout(() => void loadShared().then(plan, () => undefined), 3000);
};

function plan() {
  timers.forEach(clearTimeout);
  timers = [];
  if (!userId) return;
  const now = Date.now();
  // Plus, with « Point du matin » on, one summary of the day's tasks at 8:00 (which takes the place of their 9:00 reminder).
  const digests = getSettings().morningBrief ? taskDigests(useTodos.getState().todos, new Date(now)) : [];
  const digestDays = new Set(digests.map(d => d.key.slice(d.key.lastIndexOf(':') + 1)));
  const list = [...upcomingReminders(sources(), new Date(now), 35, digestDays), ...digests];
  void sendToServer(list).catch(() => undefined); // offline: sent again at the next change or hour
  const delay = push ? FALLBACK_DELAY : 0;
  const next = [...list, ...shared]
    .filter(r => r.fireAt.getTime() - now + delay <= LOCAL_HORIZON && !wasShown(r.key))
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  for (const group of groupByMoment(next)) {
    timers.push(setTimeout(() => fire(group), Math.max(0, group[0].fireAt.getTime() - now + delay)));
  }
}

let planTimer: ReturnType<typeof setTimeout> | undefined;
const planSoon = () => {
  clearTimeout(planTimer);
  planTimer = setTimeout(plan, 1500);
};

// ── Messages from the service worker (public/sw.js) ─────────────────────────
interface PushedReminder {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  /** Several reminders sent as one (server/push.mjs): all of them. */
  keys?: string[];
  user?: string;
  test?: boolean;
}
function onWorkerMessage(e: MessageEvent) {
  const d = e.data as { type?: string; url?: string; user?: string; reminder?: PushedReminder; mayShow?: boolean; action?: string; keys?: unknown } | null;
  if (d?.type === 'kompaly-open' && d.url) {
    openFor(d.url, d.user);
    return;
  }
  // « Plus tard » or « Fait » tapped on a notification: done here, without bringing the page forward.
  if (d?.type === 'kompaly-action') {
    e.ports[0]?.postMessage('done');
    const keys = Array.isArray(d.keys) ? d.keys.map(String) : [];
    // Another account's reminder: that account opens and does it (from the address, followNotificationAction).
    if (d.user && d.user !== userId) openFor(withAction(d.url || '/', d.action ?? '', keys), d.user);
    else reminderAction(d.action === 'fait' ? 'done' : 'later', keys);
    return;
  }
  if (d?.type !== 'kompaly-reminder' || !d.reminder) return;
  const r = d.reminder;
  const reply = (v: 'shown' | 'no') => e.ports[0]?.postMessage(v);
  if (!userId || (r.user && r.user !== userId)) return reply('no'); // another account's reminder: the system shows it
  const key = r.tag || `push:${Date.now()}`;
  const keys = Array.isArray(r.keys) && r.keys.length ? r.keys.map(String) : [key];
  const seen = !r.test && keys.every(wasShown);
  if (!r.test) keys.forEach(markShown);
  // A shared calendar's news: the badge follows; nothing to announce when that calendar is on screen (seen live).
  const agenda = key.startsWith('agenda') || key.startsWith('periode') ? /[?&]g=([0-9a-f-]{36})/.exec(r.url ?? '')?.[1] : undefined;
  if (agenda) {
    setTimeout(() => void useAgendaNews.getState().refresh(), 1500);
    if (agenda === viewingAgenda()) return reply('shown');
  }
  if (d.mayShow && document.visibilityState === 'visible') {
    if (!seen) showInApp({ key, title: r.title || 'Kompaly', body: r.body || '', url: r.url || '/', keys });
    return reply('shown');
  }
  reply('no');
}

/**
 * A notification was tapped: its page, in the account it belongs to (two accounts on one phone:
 * the « travail » account's news opens the « travail » account).
 */
function openFor(to: string, user?: string) {
  const url = pagePath(to);
  if (!user || user === userId || !savedAccount(user)) return goTo(url);
  void useAuth
    .getState()
    .switchAccount(user, url)
    .then(r => {
      if (r !== 'credentials') return;
      const account = accountLabels()[user];
      useUi
        .getState()
        .toast(
          account
            ? t('Cette notification vient du compte {account} : reconnecte-toi à ce compte pour la voir.', { account })
            : t('Cette notification vient du compte enregistré sur cet appareil : reconnecte-toi à ce compte pour la voir.'),
          'info',
        );
    });
}

/** How each account of this device is named in its notifications: its first name, or its e-mail when two share a name. */
function accountLabels(): Record<string, string> {
  const list = savedAccounts();
  const names = list.map(a => a.name.trim().toLowerCase());
  return Object.fromEntries(list.map(a => [a.id, names.filter(n => n === a.name.trim().toLowerCase()).length > 1 || !a.name.trim() ? a.email : a.name.trim()]));
}

/**
 * Tells the service worker this device's accounts (with two or more, each notification says which one it is for),
 * and the words of its buttons in the site's language (the server's notifications come without them).
 */
async function shareAccounts() {
  const reg = await navigator.serviceWorker?.ready.catch(() => null);
  const labels = accountLabels();
  reg?.active?.postMessage({
    type: 'kompaly-accounts',
    accounts: Object.entries(labels).map(([id, label]) => ({ id, label, line: t('Compte {account}', { account: label }) })),
    lang: locale(),
    buttons: { voir: t('Voir'), ok: t('OK'), later: t('Plus tard'), done: t('Fait||coché') },
  });
}

/**
 * A page of Kompaly as the app's navigation takes it: its path. A whole address (an older service worker sends
 * « https://kompaly.com/calendrier?… ») was read as a page name, hence « page introuvable »; another site's: the home.
 */
export function pagePath(url: string, origin = location.origin) {
  try {
    const u = new URL(url, origin);
    return u.origin === origin ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}

/** The address that does « Plus tard » or « Fait » once open (`action`, `cles`): read by followNotificationAction. */
function withAction(url: string, action: string, keys: string[]) {
  const u = new URL(url, location.origin);
  u.searchParams.set('action', action);
  u.searchParams.set('cles', keys.join(','));
  return u.pathname + u.search + u.hash;
}

/** Opened from a notification of another account (no Kompaly tab was open): switch to it. */
function followNotificationAccount() {
  const params = new URLSearchParams(location.search);
  const target = params.get('compte');
  if (!target) return;
  params.delete('compte');
  const url = location.pathname + (params.size ? `?${params}` : '') + location.hash;
  history.replaceState(history.state, '', url);
  if (target === userId) return false;
  openFor(url, target);
  return true;
}

/** Opened by « Plus tard » or « Fait » of a notification while no Kompaly page was open (public/sw.js): done now. */
function followNotificationAction() {
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  if (action !== 'plus-tard' && action !== 'fait') return;
  const keys = (params.get('cles') ?? '').split(',').filter(Boolean);
  params.delete('action');
  params.delete('cles');
  history.replaceState(history.state, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
  reminderAction(action === 'fait' ? 'done' : 'later', keys);
}

/** What the service worker showed while no Kompaly page was open (public/sw.js): not shown again here. */
async function shownByWorker() {
  const res = await (await caches.open('kompaly-meta')).match('/__kompaly/vus');
  const list = res ? ((await res.json()) as { user?: string; keys?: string[] }[]) : [];
  for (const x of Array.isArray(list) ? list : []) if (x.user === userId && Array.isArray(x.keys)) x.keys.forEach(k => !wasShown(k) && markShown(k));
}

/** Starts the reminders of the signed-in account; returns the function that stops them. */
export function startReminders(id: string): () => void {
  userId = id;
  lastSent = '';
  serverReady = true;
  shared = [];
  sharedReady = true;
  const unsubs = [
    useGroups.subscribe((s, p) => s.events !== p.events && loadSharedSoon()),
    useCalendar.subscribe((s, p) => s.events !== p.events && planSoon()),
    useTodos.subscribe((s, p) => s.todos !== p.todos && planSoon()),
    useSettings.subscribe((s, p) => (s.defaultReminders !== p.defaultReminders || s.morningBrief !== p.morningBrief || s.reminderSnoozes !== p.reminderSnoozes) && planSoon()),
  ];
  const hourly = setInterval(loadSharedSoon, 3_600_000); // then plan()
  const onVisible = () => document.visibilityState === 'visible' && loadSharedSoon();
  document.addEventListener('visibilitychange', onVisible);
  navigator.serviceWorker?.addEventListener('message', onWorkerMessage);
  if (!followNotificationAccount()) followNotificationAction();
  void shareAccounts().catch(() => undefined);
  void (async () => {
    await refreshDevice().catch(() => undefined);
    push = await pushActive().catch(() => false);
    if (push) await shownByWorker().catch(() => undefined);
    await loadShared().catch(() => undefined);
    if (userId === id) plan();
  })();
  return () => {
    unsubs.forEach(u => u());
    clearInterval(hourly);
    clearTimeout(planTimer);
    clearTimeout(sharedTimer);
    shared = [];
    document.removeEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
    timers.forEach(clearTimeout);
    timers = [];
    userId = null;
  };
}

/** After notifications were turned on or off on this device (Profil › Notifications). */
export async function devicePushChanged() {
  push = await pushActive().catch(() => false);
  plan();
}
