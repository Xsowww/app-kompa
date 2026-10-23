// Cloud mode: keeps Supabase in sync with the app's stores.
// The stores stay the source of truth for the UI (instant, works offline for a moment);
// every change is diffed and pushed in small batches, and retried if the network fails.

import { cleanReminders } from './reminders';
import { supabase } from './supabase';
import { useCalendar, type CalendarEvent } from '../store/calendar';
import { useNotes, type Note, type NoteFolder } from '../store/notes';
import { cleanPeriods } from './periods';
import { cleanKeywords } from './keywords';
import { folderColorKey, useDrive, type DriveItem } from '../store/drive';
import { useSettings, DEFAULT_SETTINGS, type Settings } from '../store/settings';
import { useUi } from '../store/ui';
import { useTodos, type Todo } from '../store/todos';
import { useFocusLog, type FocusSession } from '../store/focusLog';
import { t } from '../i18n';
import { userStorage, SYNC_CURSOR } from './userStorage';
import { mergeRows } from './syncMerge';

type Row = Record<string, unknown>;
type Table = 'events' | 'note_folders' | 'notes' | 'drive_items' | 'todos' | 'focus_sessions';

// ── Row mapping (app shape ⇄ database columns) ─────────────────────────────

const eventToRow = (e: CalendarEvent): Row => ({
  id: e.id,
  title: e.title,
  date: e.date,
  start_time: e.start ?? null,
  end_time: e.end ?? null,
  category: e.category,
  done: e.done,
  details: e.details ?? null,
  important: !!e.important,
  reminders: e.reminders ?? null,
  external_id: e.externalId ?? null,
  created_at: e.createdAt,
  deleted_at: e.deletedAt ?? null,
});
const rowToEvent = (r: Row): CalendarEvent => ({
  id: r.id as string,
  title: r.title as string,
  date: r.date as string,
  start: (r.start_time as string) ?? undefined,
  end: (r.end_time as string) ?? undefined,
  category: r.category as CalendarEvent['category'],
  done: r.done as boolean,
  details: (r.details as string) ?? undefined,
  important: r.important === true || undefined,
  reminders: cleanReminders(r.reminders),
  externalId: (r.external_id as string) ?? undefined,
  createdAt: r.created_at as string,
  deletedAt: (r.deleted_at as string) ?? undefined,
});

const folderToRow = (f: NoteFolder): Row => ({ id: f.id, name: f.name, parent_id: f.parentId, created_at: f.createdAt, deleted_at: f.deletedAt ?? null, color: f.color ?? null });
const rowToFolder = (r: Row): NoteFolder => ({
  id: r.id as string,
  name: r.name as string,
  parentId: (r.parent_id as string) ?? null,
  createdAt: r.created_at as string,
  deletedAt: (r.deleted_at as string) ?? undefined,
  color: folderColorKey(r.color),
});

const noteToRow = (n: Note): Row => ({
  id: n.id,
  title: n.title,
  content: n.content,
  folder_id: n.folderId,
  pinned: !!n.pinned,
  links: n.links ?? [],
  created_at: n.createdAt,
  updated_at: n.updatedAt,
  deleted_at: n.deletedAt ?? null,
});
const rowToNote = (r: Row): Note => ({
  id: r.id as string,
  title: r.title as string,
  content: r.content as string,
  folderId: (r.folder_id as string) ?? null,
  pinned: r.pinned as boolean,
  links: Array.isArray(r.links) && r.links.length ? (r.links as Note['links']) : undefined,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  deletedAt: (r.deleted_at as string) ?? undefined,
});

const itemToRow = (i: DriveItem): Row => ({
  id: i.id,
  name: i.name,
  kind: i.kind,
  parent_id: i.parentId,
  mime: i.mime ?? null,
  size: i.size ?? null,
  starred: !!i.starred,
  color: i.color ?? null,
  tags: i.tags ?? [],
  created_at: i.createdAt,
  updated_at: i.updatedAt,
  deleted_at: i.deletedAt ?? null,
});
const rowToItem = (r: Row): DriveItem => ({
  id: r.id as string,
  name: r.name as string,
  kind: r.kind as DriveItem['kind'],
  parentId: (r.parent_id as string) ?? null,
  mime: (r.mime as string) ?? undefined,
  size: r.size == null ? undefined : Number(r.size),
  starred: r.starred as boolean,
  color: (r.color as string) ?? undefined,
  tags: Array.isArray(r.tags) && r.tags.length ? (r.tags as string[]) : undefined,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  deletedAt: (r.deleted_at as string) ?? undefined,
});

const todoToRow = (t: Todo): Row => ({
  id: t.id,
  title: t.title,
  done: t.done,
  due: t.due ?? null,
  due_time: t.time ?? null,
  reminders: t.reminders ?? null,
  created_at: t.createdAt,
  done_at: t.doneAt ?? null,
});
const rowToTodo = (r: Row): Todo => ({
  id: r.id as string,
  title: r.title as string,
  done: r.done as boolean,
  due: (r.due as string) ?? undefined,
  time: (r.due_time as string) ?? undefined,
  reminders: cleanReminders(r.reminders),
  createdAt: r.created_at as string,
  doneAt: (r.done_at as string) ?? undefined,
});

const focusToRow = (f: FocusSession): Row => ({ id: f.id, subject: f.subject, minutes: f.minutes, started_at: f.startedAt });
const rowToFocus = (r: Row): FocusSession => ({ id: r.id as string, subject: (r.subject as string) ?? '', minutes: Number(r.minutes), startedAt: r.started_at as string });

const isTrashed = (r: Row) => r.deleted_at != null;

// Tables whose rows carry the time of the local change (the server keeps the newest version).
// Notes and Drive items have it in the app already.
const STAMPED = new Set<Table>(['events', 'todos', 'note_folders']);
/** Tables without the column yet (migration 2026-10-15b not applied): sent without it, as before. */
const noStamp = new Set<Table>();
const unstamped = (rows: Row[]) => rows.map(({ updated_at: _u, ...r }) => r);
const missingStamp = (e: { code?: string; message?: string } | null) => e?.code === 'PGRST204' && !!e.message?.includes('updated_at');
const missingColumn = (e: { code?: string; message?: string } | null, col: string) => e?.code === 'PGRST204' && !!e.message?.includes(col);
// Columns added by later migrations: a server without them yet gets the rows without them (kept on this device).
const OPTIONAL: Partial<Record<Table, string[]>> = { events: ['important', 'reminders'], todos: ['due_time', 'reminders'], note_folders: ['color'] };
const absent = new Map<Table, Set<string>>();
const withoutAbsent = (table: Table, rows: Row[]) => {
  const cols = absent.get(table);
  return cols?.size ? rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.has(k)))) : rows;
};

// ── Pending changes ─────────────────────────────────────────────────────────

// Parents must exist before their children: folders first, Drive items by depth.
const ORDER: Table[] = ['note_folders', 'notes', 'drive_items', 'events', 'todos', 'focus_sessions'];
const pending = Object.fromEntries(ORDER.map(t => [t, { upserts: new Map<string, Row>(), deletes: new Set<string>() }])) as Record<
  Table,
  { upserts: Map<string, Row>; deletes: Set<string> }
>;
/** Settings changed here and not sent yet ('*': all of them, queue saved by an older version). */
const profileKeys = new Set<string>();
let pulling = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let warned = false;
let warnedDrop = false;
let unsubscribers: (() => void)[] = [];
let currentUser: string | null = null;
/** Bumped by every local change: a refresh that raced with one is thrown away. */
let changes = 0;
let lastPull = 0;

const hasPending = () => profileKeys.size > 0 || ORDER.some(t => pending[t].upserts.size || pending[t].deletes.size);

// The queue is mirrored in localStorage, so a change made just before closing the tab
// is sent on the next visit instead of being overwritten by the older cloud copy.
// One key per tab: two tabs used offline don't overwrite each other's queue; the next
// start adopts every queue left behind.
const TAB = Math.random().toString(36).slice(2, 10);
const queuePrefix = (userId: string) => `cop:${userId}:sync-queue`;
const queueKey = (userId: string) => `${queuePrefix(userId)}:${TAB}`;
let adopted: string[] = [];

function saveQueue() {
  if (!currentUser) return;
  try {
    if (!hasPending()) {
      localStorage.removeItem(queueKey(currentUser));
      adopted.forEach(k => localStorage.removeItem(k));
      adopted = [];
      return;
    }
    const data = Object.fromEntries(ORDER.map(t => [t, { upserts: [...pending[t].upserts.values()], deletes: [...pending[t].deletes] }]));
    localStorage.setItem(queueKey(currentUser), JSON.stringify({ tables: data, profileKeys: [...profileKeys] }));
    // Their content is in this tab's queue now: left behind, they would be sent again on a later visit.
    adopted.filter(k => k !== queueKey(currentUser!)).forEach(k => localStorage.removeItem(k));
    adopted = [];
  } catch {
    /* storage full or unavailable: the in-memory queue still works */
  }
}

function loadQueue(userId: string) {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(queuePrefix(userId))) continue; // this tab's own key too (loaded again after a sign-in step)
    adopted.push(key);
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '') as {
        tables: Record<Table, { upserts: Row[]; deletes: string[] }>;
        profileKeys?: string[];
        profileDirty?: boolean;
      };
      for (const t of ORDER) {
        for (const r of saved.tables[t]?.upserts ?? []) pending[t].upserts.set(r.id as string, r);
        for (const id of saved.tables[t]?.deletes ?? []) pending[t].deletes.add(id);
      }
      for (const k of saved.profileKeys ?? (saved.profileDirty ? ['*'] : [])) profileKeys.add(k);
    } catch {
      /* corrupted queue: ignore */
    }
  }
}

function schedule(delay = 700) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), delay);
}

function depthOf(items: DriveItem[], id: string) {
  let d = 0;
  let cur = items.find(i => i.id === id);
  while (cur?.parentId && d < 50) {
    const parent = cur.parentId;
    cur = items.find(i => i.id === parent);
    d++;
  }
  return d;
}

function folderDepth(folders: NoteFolder[], id: string) {
  let d = 0;
  let cur = folders.find(f => f.id === id);
  while (cur?.parentId && d < 50) {
    const parent = cur.parentId;
    cur = folders.find(f => f.id === parent);
    d++;
  }
  return d;
}

/**
 * Errors that a retry won't fix (Postgres data, constraint or permission errors, PostgREST
 * request errors) — as opposed to network failures, which are retried.
 */
const permanent = (e: { code?: string } | null) => /^(22|23|42|PGRST)/.test(e?.code ?? '');

/** Column pointing to a parent that may have been deleted on another device. */
const PARENT: Partial<Record<Table, string>> = { drive_items: 'parent_id', notes: 'folder_id', note_folders: 'parent_id' };

/**
 * Sends rows; a batch refused for good is retried row by row so that one bad row never
 * blocks all the others. A row whose parent folder was deleted elsewhere goes to the root;
 * a row still refused is dropped (and logged) instead of being retried forever.
 */
let warnedCategories = false;

async function upsertRows(table: Table, rows: Row[]) {
  if (noStamp.has(table)) rows = unstamped(rows);
  rows = withoutAbsent(table, rows);
  let { error } = await supabase!.from(table).upsert(rows);
  if (STAMPED.has(table) && missingStamp(error)) {
    noStamp.add(table);
    rows = unstamped(rows);
    ({ error } = await supabase!.from(table).upsert(rows));
  }
  // Server without a recent column yet (« important », reminders…): the row is kept, without it online.
  for (let i = 0; i < 3; i++) {
    const col = OPTIONAL[table]?.find(c => missingColumn(error, c));
    if (!col) break;
    absent.set(table, new Set([...(absent.get(table) ?? []), col]));
    rows = withoutAbsent(table, rows);
    ({ error } = await supabase!.from(table).upsert(rows));
  }
  if (!error) return 0;
  if (!permanent(error)) throw error;
  let dropped = 0;
  for (const r of rows) {
    let { error: e } = await supabase!.from(table).upsert(r);
    const parent = PARENT[table];
    if (e?.code === '23503' && parent && r[parent]) ({ error: e } = await supabase!.from(table).upsert({ ...r, [parent]: null }));
    // Server not yet updated for the student's own categories (migration 2026-10-15): keep the event, as Perso online.
    if (e?.code === '23514' && table === 'events' && String(r.category).startsWith('c-')) {
      ({ error: e } = await supabase!.from(table).upsert({ ...r, category: 'perso' }));
      if (!e && !warnedCategories) {
        warnedCategories = true;
        useUi.getState().toast(t('Les catégories personnelles ne sont pas encore activées sur le serveur : cet événement est enregistré en ligne comme « Perso ».'), 'error');
      }
    }
    if (e && !permanent(e)) throw e;
    if (e) {
      console.error('[sync] ligne refusée', table, r.id, e);
      dropped++;
    }
  }
  return dropped;
}

/** One send at a time; a caller arriving during a send waits for it instead of returning at once. */
let running: Promise<void> | null = null;
function flush() {
  running ??= send().finally(() => (running = null));
  return running;
}

async function send() {
  if (!supabase || !currentUser) return;
  try {
    // Never send this account's changes with another account's session (switched in another tab).
    const { data: s } = await supabase.auth.getSession();
    if (s.session?.user.id !== currentUser) {
      if (s.session) location.reload();
      return;
    }
    for (const table of ORDER) {
      const p = pending[table];
      if (p.upserts.size) {
        let rows = [...p.upserts.values()];
        if (table === 'drive_items') {
          const items = [...useDrive.getState().items, ...useDrive.getState().trash];
          rows = rows.sort((a, b) => depthOf(items, a.id as string) - depthOf(items, b.id as string));
        }
        if (table === 'note_folders') {
          const folders = [...useNotes.getState().folders, ...useNotes.getState().trashFolders];
          rows = rows.sort((a, b) => folderDepth(folders, a.id as string) - folderDepth(folders, b.id as string));
        }
        if ((await upsertRows(table, rows)) && !warnedDrop) {
          warnedDrop = true;
          useUi.getState().toast(t('Un élément n’a pas pu être enregistré en ligne (il a peut-être été supprimé sur un autre appareil).'), 'error');
        }
        for (const r of rows) if (p.upserts.get(r.id as string) === r) p.upserts.delete(r.id as string);
      }
      // By 200: emptying a big trash in one request made an address too long for the server.
      while (p.deletes.size) {
        const ids = [...p.deletes].slice(0, 200);
        const { error } = await supabase.from(table).delete().in('id', ids);
        if (error && !permanent(error)) throw error;
        if (error) console.error('[sync] suppression refusée', table, error);
        ids.forEach(id => p.deletes.delete(id));
      }
    }
    if (profileKeys.size) await sendSettings(currentUser);
    warned = false;
    saveQueue();
  } catch (e) {
    console.error('[sync]', e);
    if (!warned) {
      warned = true;
      useUi.getState().toast(t('Synchronisation impossible pour le moment, nouvel essai automatique…'), 'error');
    }
    schedule(8000);
  } finally {
    if (hasPending() && !warned) schedule();
  }
}

let noMerge = false; // server without merge_settings (migration 2026-10-15b): the whole object, as before

/**
 * Sends only the settings changed on this device, merged on the server with the others: a device
 * that hasn't seen a category created on another one doesn't erase it by saving its theme.
 */
async function sendSettings(user: string) {
  const { set: _set, reset: _reset, ...all } = useSettings.getState();
  const keys = profileKeys.has('*') || noMerge ? Object.keys(all) : [...profileKeys];
  const patch = Object.fromEntries(keys.filter(k => k in all).map(k => [k, all[k as keyof typeof all]]));
  let { error } = noMerge ? { error: null } : await supabase!.rpc('merge_settings', { patch });
  if (error?.code === 'PGRST202') noMerge = true;
  if (noMerge) ({ error } = await supabase!.from('profiles').update({ settings: all }).eq('id', user));
  if (error) throw error;
  // A setting changed again during the send stays to send.
  const now = useSettings.getState() as unknown as Record<string, unknown>;
  for (const k of [...profileKeys]) if (k === '*' || now[k] === patch[k]) profileKeys.delete(k);
}

/** Records the difference between two versions of a list (immutable updates → reference check). */
function diff<T extends { id: string }>(table: Table, cur: T[], prev: T[], toRow: (x: T) => Row) {
  if (pulling || cur === prev) return;
  const stamp = new Date().toISOString();
  const before = new Map(prev.map(x => [x.id, x]));
  const now = new Set<string>();
  let found = false;
  for (const x of cur) {
    now.add(x.id);
    const old = before.get(x.id);
    if (old !== x) {
      const row = toRow(x);
      // A new copy of the same thing (reloaded from storage…): nothing to send.
      if (old && JSON.stringify(toRow(old)) === JSON.stringify(row)) continue;
      found = true;
      if (STAMPED.has(table)) row.updated_at = stamp;
      pending[table].upserts.set(x.id, row);
      pending[table].deletes.delete(x.id);
    }
  }
  for (const id of before.keys()) {
    if (!now.has(id)) {
      found = true;
      pending[table].upserts.delete(id);
      pending[table].deletes.add(id);
    }
  }
  if (!found) return;
  changes++;
  saveQueue();
  schedule();
}

/**
 * Store updates that aren't changes made here (another tab of this account saved them, and sends them
 * itself): nothing goes out. Sending them again would stamp an older copy as the newest one.
 */
export function quietly(fn: () => void) {
  const was = pulling;
  pulling = true;
  try {
    fn();
  } finally {
    pulling = was;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface CloudProfile {
  name: string;
  onboarded: boolean;
}

/** Sends changes left over from a previous visit (tab closed before they were sent). */
export async function pushLeftovers(userId: string) {
  currentUser = userId;
  loadQueue(userId);
  if (!(await flushNow())) throw new Error('leftover changes could not be sent');
}

const PAGE = 1000; // Supabase answers at most 1 000 rows per request by default

/**
 * Every row of a table (changed since `since`), page by page (a year of timetable easily passes 1 000 events).
 * By key, not by position: a row deleted elsewhere during the download would shift the pages and skip one.
 */
async function selectAll(table: Table | 'sync_deletions', since?: string) {
  const key = table === 'sync_deletions' ? 'row_id' : 'id';
  const rows: Row[] = [];
  for (let last: string | null = null; ; ) {
    let q = supabase!.from(table).select('*');
    if (since) q = q.gt(table === 'sync_deletions' ? 'deleted_at' : 'synced_at', since);
    if (last) q = q.gt(key, last);
    const { data, error } = await q.order(key).limit(PAGE);
    if (error) return { data: null, error };
    rows.push(...data);
    const next = data[data.length - 1]?.[key] as string | undefined;
    // A server that didn't apply the key filter would answer the same page forever.
    if (data.length < PAGE || !next || next === last) return { data: rows, error: null };
    last = next;
  }
}

const loadProfile = (userId: string) => supabase!.from('profiles').select('*').eq('id', userId).maybeSingle(); // '*': tolerate older schemas

async function fetchAll(userId: string) {
  if (!supabase) throw new Error('cloud disabled');
  const [events, folders, notes, items, profile, todos, focus] = await Promise.all([
    selectAll('events'),
    selectAll('note_folders'),
    selectAll('notes'),
    selectAll('drive_items'),
    loadProfile(userId),
    selectAll('todos'),
    selectAll('focus_sessions'),
  ]);
  const err = events.error ?? folders.error ?? notes.error ?? items.error ?? profile.error;
  if (err) throw err;
  return { events, folders, notes, items, profile, todos, focus };
}

type Profile = Awaited<ReturnType<typeof loadProfile>>;

function applySettings(profile: Profile) {
  const saved = (profile.data?.settings ?? {}) as Partial<Settings>;
  const known = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
  useSettings.setState(Object.fromEntries(known.filter(k => k in saved).map(k => [k, k === 'periods' ? cleanPeriods(saved[k]) : k === 'courseKeywords' ? cleanKeywords(saved[k]) : saved[k]])) as Partial<Settings>);
}

function apply({ events, folders, notes, items, profile, todos, focus }: Awaited<ReturnType<typeof fetchAll>>) {
  pulling = true;
  try {
    const f = folders.data ?? [];
    const n = notes.data ?? [];
    const i = items.data ?? [];
    const ev = events.data ?? [];
    useCalendar.setState({ events: ev.filter(r => !isTrashed(r)).map(rowToEvent), trash: ev.filter(isTrashed).map(rowToEvent) });
    useNotes.setState({
      folders: f.filter(r => !isTrashed(r)).map(rowToFolder),
      notes: n.filter(r => !isTrashed(r)).map(rowToNote),
      trashFolders: f.filter(isTrashed).map(rowToFolder),
      trashNotes: n.filter(isTrashed).map(rowToNote),
    });
    useDrive.setState({ items: i.filter(r => !isTrashed(r)).map(rowToItem), trash: i.filter(isTrashed).map(rowToItem) });
    // Tables added later: an older database without them keeps the local copy.
    if (!todos.error) useTodos.setState({ todos: (todos.data ?? []).map(rowToTodo) });
    if (!focus.error) useFocusLog.setState({ sessions: (focus.data ?? []).map(rowToFocus) });
    applySettings(profile);
  } finally {
    pulling = false;
  }
}

// ── Light refresh: only what changed since the last download ─────────────────
// Every row carries the server's time of its last change (synced_at) and a deleted row leaves its id
// for 30 days (sync_deletions, migration 2026-10-29). The copy on this device plus what changed since
// is the account: no need to download it all again at each visit and every 2 minutes.

/** A row written just before the newest one seen may be saved just after: the last 2 minutes are read again. */
const OVERLAP = 2 * 60_000;
/** The whole account again once a day, in case the copy on this device went wrong. */
const FULL_EVERY = 24 * 3600_000;
/** `at`: newest server time seen (ms). `full`: last whole download (this device's clock). */
type Cursor = { at: number; full: number };
let noDelta = false; // server without the migration: whole downloads, as before

const readCursor = (): Cursor | null => {
  const c = (userStorage.getItem(SYNC_CURSOR) as { state?: Cursor } | null)?.state;
  return c && Number.isFinite(c.at) && Number.isFinite(c.full) ? c : null;
};
const saveCursor = (c: Cursor) => userStorage.setItem(SYNC_CURSOR, { state: c });

const newest = (rows: Row[] | null | undefined, col: string, at = 0) =>
  (rows ?? []).reduce((m, r) => Math.max(m, Date.parse(String(r[col] ?? '')) || 0), at);

const DELTA_TABLES = ['events', 'note_folders', 'notes', 'drive_items', 'todos', 'focus_sessions'] as const;

async function fetchChanges(userId: string, since: string) {
  const [profile, gone, ...tables] = await Promise.all([loadProfile(userId), selectAll('sync_deletions', since), ...DELTA_TABLES.map(t => selectAll(t, since))]);
  const err = profile.error ?? gone.error ?? tables.find(r => r.error)?.error;
  if (err) throw err;
  return { profile, gone: gone.data!, rows: Object.fromEntries(DELTA_TABLES.map((t, i) => [t, tables[i].data!])) as Record<Table, Row[]> };
}
type Changes = Awaited<ReturnType<typeof fetchChanges>>;

function applyChanges({ profile, gone, rows }: Changes) {
  const deleted = Object.fromEntries(DELTA_TABLES.map(t => [t, new Map<string, number>()])) as Record<Table, Map<string, number>>;
  for (const g of gone) deleted[g.tbl as Table]?.set(g.row_id as string, Date.parse(String(g.deleted_at)) || 0);
  const touched = (t: Table) => rows[t].length > 0 || deleted[t].size > 0;
  pulling = true;
  try {
    if (touched('events')) {
      const s = useCalendar.getState();
      const [events, trash] = mergeRows([s.events, s.trash], rows.events, deleted.events, rowToEvent, isTrashed);
      useCalendar.setState({ events, trash });
    }
    if (touched('note_folders')) {
      const s = useNotes.getState();
      const [folders, trashFolders] = mergeRows([s.folders, s.trashFolders], rows.note_folders, deleted.note_folders, rowToFolder, isTrashed);
      useNotes.setState({ folders, trashFolders });
    }
    if (touched('notes')) {
      const s = useNotes.getState();
      const [notes, trashNotes] = mergeRows([s.notes, s.trashNotes], rows.notes, deleted.notes, rowToNote, isTrashed);
      useNotes.setState({ notes, trashNotes });
    }
    if (touched('drive_items')) {
      const s = useDrive.getState();
      const [items, trash] = mergeRows([s.items, s.trash], rows.drive_items, deleted.drive_items, rowToItem, isTrashed);
      useDrive.setState({ items, trash });
    }
    if (touched('todos')) useTodos.setState({ todos: mergeRows([useTodos.getState().todos], rows.todos, deleted.todos, rowToTodo, () => false)[0] });
    if (touched('focus_sessions'))
      useFocusLog.setState({ sessions: mergeRows([useFocusLog.getState().sessions], rows.focus_sessions, deleted.focus_sessions, rowToFocus, () => false)[0] });
    applySettings(profile);
  } finally {
    pulling = false;
  }
}

/**
 * Brings this device up to date: only the changes when its copy is recent, the whole account otherwise.
 * `onlyIf` is checked just before the result is applied (a refresh that raced with a local change is thrown away).
 */
async function download(userId: string, onlyIf: () => boolean = () => true) {
  const c = readCursor();
  const age = c ? Date.now() - c.full : -1; // < 0: the device's clock went back, so a whole download
  if (c && !noDelta && age >= 0 && age < FULL_EVERY) {
    try {
      const d = await fetchChanges(userId, new Date(Math.max(0, c.at - OVERLAP)).toISOString());
      if (!onlyIf()) return null;
      applyChanges(d);
      const at = DELTA_TABLES.reduce((m, t) => newest(d.rows[t], 'synced_at', m), newest(d.gone, 'deleted_at', c.at));
      saveCursor({ at, full: c.full });
      return { profile: d.profile, delta: true };
    } catch (e) {
      // Server not migrated yet (unknown column or table): whole downloads from now on. Network: tried again later.
      if (!permanent(e as { code?: string })) throw e;
      noDelta = true;
    }
  }
  const started = Date.now();
  const d = await fetchAll(userId);
  if (!onlyIf()) return null;
  apply(d);
  const at = [d.events, d.folders, d.notes, d.items, d.todos, d.focus].reduce((m, r) => newest(r.data, 'synced_at', m), 0);
  // No synced_at in the rows (server not migrated, or nothing in the account): no cursor, the next download is whole too.
  if (at) saveCursor({ at, full: started });
  return { profile: d.profile, data: d, delta: false };
}

/** Downloads the signed-in user's account (only what changed when this device has a recent copy). */
export async function pullAll(userId: string): Promise<CloudProfile> {
  const { profile } = (await download(userId))!;
  useDrive.setState({ clipboard: null });
  lastPull = Date.now();
  // Databases created before the "onboarded" column existed: onboarded as soon as there is any data.
  const hasData = !!(
    useCalendar.getState().events.length ||
    useNotes.getState().notes.length ||
    useDrive.getState().items.length ||
    useNotes.getState().folders.length ||
    useTodos.getState().todos.length
  );
  const onboarded = typeof profile.data?.onboarded === 'boolean' ? profile.data.onboarded || hasData : hasData;
  return { name: profile.data?.name ?? '', onboarded };
}

/**
 * Fetches what other devices changed. Skipped while local changes wait to be sent, and
 * thrown away if the student changed something during the download (it would undo it).
 */
async function refresh() {
  const user = currentUser;
  if (!user || hasPending() || document.hidden || Date.now() - lastPull < 30_000) return;
  lastPull = Date.now();
  const mark = changes;
  await download(user, () => currentUser === user && changes === mark && !hasPending()).catch(() => null);
}

/** Starts pushing every change of the stores to Supabase. */
export function startSync(userId: string) {
  // Same account (start after a failed first send): keep what waits and retry it shortly.
  if (currentUser === userId) detach();
  else stopSync();
  currentUser = userId;
  if (hasPending()) schedule(8000);
  unsubscribers = [
    useCalendar.subscribe((s, p) => {
      if (s.events !== p.events || s.trash !== p.trash) diff('events', [...s.events, ...s.trash], [...p.events, ...p.trash], eventToRow);
    }),
    useNotes.subscribe((s, p) => {
      if (s.folders !== p.folders || s.trashFolders !== p.trashFolders)
        diff('note_folders', [...s.folders, ...s.trashFolders], [...p.folders, ...p.trashFolders], folderToRow);
      if (s.notes !== p.notes || s.trashNotes !== p.trashNotes) diff('notes', [...s.notes, ...s.trashNotes], [...p.notes, ...p.trashNotes], noteToRow);
    }),
    useDrive.subscribe((s, p) => {
      if (s.items !== p.items || s.trash !== p.trash) diff('drive_items', [...s.items, ...s.trash], [...p.items, ...p.trash], itemToRow);
    }),
    useTodos.subscribe((s, p) => diff('todos', s.todos, p.todos, todoToRow)),
    useFocusLog.subscribe((s, p) => diff('focus_sessions', s.sessions, p.sessions, focusToRow)),
    useSettings.subscribe((s, p) => {
      if (pulling) return;
      const changed = Object.keys(s).filter(k => typeof s[k as keyof Settings] !== 'function' && s[k as keyof Settings] !== p[k as keyof Settings]);
      if (!changed.length) return;
      changes++;
      changed.forEach(k => profileKeys.add(k));
      saveQueue();
      schedule(1200);
    }),
  ];
  const onLeave = () => {
    if (hasPending()) void flush();
  };
  window.addEventListener('pagehide', onLeave);
  // Changes made on another device: fetched when coming back to the tab or the window, when the
  // network returns, and every 2 minutes for a window left open (a visible tab never "comes back").
  const onBack = () => void refresh();
  document.addEventListener('visibilitychange', onBack);
  window.addEventListener('focus', onBack);
  window.addEventListener('online', onBack);
  const timer = setInterval(onBack, 120_000);
  unsubscribers.push(
    () => window.removeEventListener('pagehide', onLeave),
    () => document.removeEventListener('visibilitychange', onBack),
    () => window.removeEventListener('focus', onBack),
    () => window.removeEventListener('online', onBack),
    () => clearInterval(timer),
  );
}

function detach() {
  unsubscribers.forEach(u => u());
  unsubscribers = [];
}

export function stopSync() {
  detach();
  saveQueue(); // keep unsent changes for the next visit
  adopted = [];
  currentUser = null;
  clearTimeout(flushTimer);
  for (const t of ORDER) {
    pending[t].upserts.clear();
    pending[t].deletes.clear();
  }
  profileKeys.clear();
}

/** Sends what is waiting (before signing out, for instance); true when nothing is left to send. */
export async function flushNow() {
  clearTimeout(flushTimer);
  // Twice: a send already running when we arrive may not include the latest changes.
  for (let i = 0; i < 2 && hasPending(); i++) await flush();
  return !hasPending();
}

/** Throws when the change didn't reach the server (network), so the caller can try again. */
export async function updateCloudProfile(userId: string, patch: { name?: string; onboarded?: boolean }) {
  if (!supabase) return;
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  // Older schema without the "onboarded" column: keep the name update at least.
  if (error && 'onboarded' in patch && patch.name) await supabase.from('profiles').update({ name: patch.name }).eq('id', userId);
  if (error && !permanent(error)) throw error;
}
