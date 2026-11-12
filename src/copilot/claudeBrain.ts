// AI mode: the conversation goes through our server (/api/copilot, see server/copilot.mjs),
// which holds the API key, Kompaly's personality and picks the AI provider (Claude, Gemini,
// Groq…). The server always answers in the Anthropic message shape, so this file doesn't
// care which provider is behind. Tools run here, on the student's data.

import type Anthropic from '@anthropic-ai/sdk';
import { create } from 'zustand';
import { fmt, todayKey } from '../lib/dates';
import { lang, t } from '../i18n';
import { useCopilot, type CopilotLink, type CopilotOffer } from '../store/copilot';
import { useCalendar, CATEGORIES, CATEGORY_LABELS, guessCategory, type CalendarEvent, type EventCategory } from '../store/calendar';
import { normalize, uid } from '../lib/utils';
import { eventReminders, reminderLabel } from '../lib/reminders';
import { confirmSaved, retrySaving, type SavedTable } from './saveCheck';
import * as shared from './sharedTools';
import { useGroups } from '../store/groups';
import type { Usage } from '../lib/usage';
import { useTodos } from '../store/todos';
import { useNotes } from '../store/notes';
import { getSettings } from '../store/settings';

/** Who Kompaly is talking to (welcome questionnaire). The category names in the calendar follow the same choice. */
const USAGE_CONTEXT: Record<string, string> = {
  etudes: 'ses études',
  travail: 'son travail (parle de réunions, devis, échéances, pas de cours ni de révisions)',
  perso: 'sa vie perso (pas de vocabulaire scolaire)',
};

/** The category ids of add_event and the names the person sees (« cours » is « Réunion » at work). */
const categoryContext = (usage: Usage) =>
  `Catégories du calendrier (valeur de « category » dans add_event = nom affiché) : ${Object.entries(CATEGORY_LABELS[usage] ?? CATEGORY_LABELS.etudes)
    .map(([id, label]) => `${id} = ${label}`)
    .join(', ')}. « perso » = vie privée uniquement.`;
import { accessToken } from '../lib/supabase';
import {
  search, analyzeCalendar, eventsBetween, addEvents, createNote, createDriveFolder, listDriveFolder, readNote, overview,
  linkToNote, linkToDriveFolder, linkToDay, describeEvent, findExam, planRevisions, hasRevisionPlan, revisionSessions, alreadyPlanned, openNoteLabel, appendToNote, updateEvent, goTo,
  findItem, linkToItem, itemName, hitLabel, itemLabel, renameItem, moveItem, setStar, setFolderColor, listTrash, restoreFromTrash,
  searchNotes, listTodos, addTodo, completeTodo, startFocus, stopFocus, updateSettings, setReminders,
} from './actions';
import { REPEATS, type Repeat } from '../lib/repeat';
import { asyncOffers, offerLog, pendingChanges, runOffer } from './offers';
import { deleteOffer, mergeOffers } from './offerMerge';
import { readFileText } from './fileText';
import type { BotReply } from './localBrain';
import { aiPausedUntil, pauseAi, QUOTA_KEY, quotaFullUntil } from './aiPause';

type Block = Anthropic.Beta.BetaContentBlock;
type Param = Anthropic.Beta.BetaMessageParam;

export class CopilotApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export { aiPausedUntil } from './aiPause';

/** Personality and preferences, sent with every request (the server builds the prompt). */
function persona() {
  const { persona, personaNotes } = getSettings();
  // With a shared calendar or a group, the tools that work in them come too (server/copilotPrompt › toolsFor).
  return { persona, personaNotes: personaNotes.slice(0, 600), lang, shared: useGroups.getState().groups.length > 0 };
}

/** Questions asked to the AI today, as the server counts them (the bar in Kompaly's panel). Kept for the day on this device. */
export interface AiQuota {
  used: number;
  max: number;
  day: string;
}
function storedQuota(): AiQuota | null {
  try {
    const q = JSON.parse(localStorage.getItem(QUOTA_KEY) ?? 'null') as AiQuota | null;
    return q && q.day === todayKey() ? q : null;
  } catch {
    return null;
  }
}
export const useAiQuota = create<{ quota: AiQuota | null }>(() => ({ quota: storedQuota() }));
function keepQuota(q: unknown) {
  if (!q || typeof q !== 'object') return;
  const { used, max } = q as { used?: unknown; max?: unknown };
  if (typeof used !== 'number' || typeof max !== 'number' || max <= 0) return;
  const quota = { used, max, day: todayKey() };
  useAiQuota.setState({ quota });
  try {
    localStorage.setItem(QUOTA_KEY, JSON.stringify(quota));
  } catch {
    /* private mode: shown until the page closes */
  }
  // The last question of the day answered: simple mode from now on, said by the header (aiPause) and the chat.
  if (used >= max) pauseAi(Math.max(60, Math.round((quotaFullUntil() - Date.now()) / 1000)), 'mine');
}

/** `stop`: « Arrêter » pressed in the panel (the request is dropped, said as 'aborted', not as a timeout). */
async function post<T>(path: string, body: unknown, timeoutMs = 90_000, stop?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onStop = () => ctrl.abort();
  stop?.addEventListener('abort', onStop, { once: true });
  try {
    if (stop?.aborted) throw new CopilotApiError('aborted');
    // « Mode simple uniquement »: nothing leaves for the AI (the server refuses it too).
    if (getSettings().simpleOnly) throw new CopilotApiError('simple_only');
    const token = await accessToken();
    const res = await fetch(`/api/copilot/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...(body as object), simpleOnly: getSettings().simpleOnly }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    keepQuota(data.quota);
    if (!res.ok) {
      // Quota of the free AI reached: simple mode until the provider accepts requests again.
      if (['rate_limited', 'daily_limit', 'site_limit'].includes(data.error)) pauseAi(Number(data.retryAfter) || 60, data.error === 'daily_limit' ? 'mine' : 'limit');
      throw new CopilotApiError(data.error ?? `http_${res.status}`);
    }
    return data as T;
  } catch (e) {
    if (e instanceof CopilotApiError) throw e;
    if (stop?.aborted) throw new CopilotApiError('aborted');
    throw new CopilotApiError((e as Error).name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
    stop?.removeEventListener('abort', onStop);
  }
}

/** Stopped with « Arrêter »: nothing to apologise for, and no pause of the AI. */
export function wasStopped(e: unknown) {
  const cause = e instanceof PartlyDone ? e.reason : e;
  return cause instanceof CopilotApiError && cause.code === 'aborted';
}

/** A failure worth a « Réessayer » (a network or server hiccup), not a limit, a question too long, nor half done (it would be done twice). */
export function canRetry(e: unknown) {
  if (e instanceof PartlyDone) return false;
  const code = e instanceof CopilotApiError ? e.code : 'unknown';
  return !['aborted', 'rate_limited', 'daily_limit', 'site_limit', 'too_large', 'bad_key', 'simple_only'].includes(code);
}

export interface AiStatus {
  enabled: boolean;
  provider?: string;
  label?: string;
  model?: string;
}

let lastStatus: AiStatus = { enabled: false };

export async function checkAiStatus(): Promise<AiStatus> {
  try {
    const res = await fetch('/api/copilot/status');
    const data = res.ok ? await res.json() : {};
    lastStatus = { enabled: Boolean(data.enabled), provider: data.provider, label: data.label, model: data.model };
  } catch {
    lastStatus = { enabled: false };
  }
  return lastStatus;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);

/** Deletions wait for the student: a tool call (maybe triggered by text hidden in a file) never deletes by itself. */
const awaitingClick = (what: string) => ({
  awaiting_confirmation: what,
  note: "Rien n'est fait : un bouton de confirmation est affiché sous ta réponse. Demande-lui de cliquer (ou de répondre « oui »). Ne dis pas que c'est fait.",
});

// Once a file or a note has been read, its text could carry orders (« rename this file… ») the AI might follow.
// From then on, changes to what already exists wait for a click too, like deletions. Adding stays direct.
const READS = new Set(['read_file', 'read_note', 'search_notes', 'search_site']);
const CHANGES = new Set(['update_event', 'append_to_note', 'rename_item', 'move_item', 'star_file', 'set_folder_color', 'restore_from_trash', 'complete_todo', 'update_settings', 'set_reminders', 'move_event']);
/** Changes that go to a shared calendar's server (or move between calendars): run after the click, then read back. */
const isSharedChange = (name: string, input: Record<string, unknown>) => name === 'move_event' || (name === 'update_event' && !!(str(input.agenda) || shared.groupOfEvent(str(input.event_id))));
const hasReadContent = () => history.some(m => m.role === 'assistant' && Array.isArray(m.content) && m.content.some(b => b.type === 'tool_use' && READS.has(b.name)));

/** The button for a change asked after a reading: what it does, in the student's words. */
function changeLabel(name: string, input: Record<string, unknown>): string {
  const item = findItem(str(input.id));
  const named = item ? itemName(item) : '';
  const ev = useCalendar.getState().events.find(e => e.id === str(input.event_id));
  const todo = useTodos.getState().todos.find(x => x.id === str(input.todo_id));
  const note = useNotes.getState().notes.find(n => n.id === str(input.note_id));
  if (name === 'rename_item' && named) return t('Renommer « {name} » en « {to} »', { name: named, to: str(input.new_name) });
  if (name === 'move_item' && named) return t('Déplacer « {name} »', { name: named });
  if (name === 'update_event' && ev) return t('Modifier « {title} »', { title: ev.title });
  if (name === 'move_event') return ev ? t('Déplacer « {title} » vers « {to} »', { title: ev.title, to: str(input.to) }) : t('Déplacer vers « {to} »', { to: str(input.to) });
  if (name === 'append_to_note' && note) return t('Ajouter du texte à « {title} »', { title: note.title });
  if (name === 'complete_todo' && todo) return t('Cocher « {title} »', { title: todo.title });
  if (name === 'set_reminders' && (ev || todo)) return t('Régler les rappels de « {title} »', { title: ev?.title ?? todo!.title });
  if (name === 'restore_from_trash') return t('Restaurer depuis la corbeille');
  if (name === 'update_settings') return t('Changer les réglages');
  return t('Oui, fais-le');
}

// ── Saved for real? ─────────────────────────────────────────────────────────
/** What a tool wrote to the person's own space: checked on the server before the AI (or a button) says « done ». */
interface Write {
  table: SavedTable;
  ids: string[];
  /** The tool's result, completed with the check (« enregistre »). */
  out?: Record<string, unknown>;
}
let writes: Write[] = [];
const wrote = (table: SavedTable, ids: string[], out?: unknown) => {
  const w: Write = { table, ids: ids.filter(Boolean), out: out && typeof out === 'object' ? (out as Record<string, unknown>) : undefined };
  if (w.ids.length) writes.push(w);
  return out;
};

/** Sends and reads back every write, table by table. Returns those the server refused, and whether it was offline. */
async function verify(list: Write[]): Promise<{ refused: Write[]; offline: boolean }> {
  const refused: Write[] = [];
  let offline = false;
  const tables = [...new Set(list.map(w => w.table))];
  await Promise.all(
    tables.map(async table => {
      const mine = list.filter(w => w.table === table);
      const check = await confirmSaved(table, [...new Set(mine.flatMap(w => w.ids))]);
      for (const w of mine) {
        const missing = check.missing?.filter(id => w.ids.includes(id)) ?? [];
        if (check.ok || (!check.offline && !missing.length)) {
          if (w.out) w.out.enregistre = true;
        } else if (check.offline) {
          offline = true;
          if (w.out) w.out.hors_ligne = "pas de réseau : gardé sur cet appareil, envoyé dès que le réseau revient";
        } else {
          refused.push({ ...w, ids: missing });
          if (w.out) {
            w.out.enregistre = false;
            if (check.why) w.out.raison = check.why;
          }
        }
      }
    }),
  );
  return { refused, offline };
}

const retrySave = (list: Write[]): CopilotOffer => ({
  label: t('Réessayer l’enregistrement'),
  kind: 'retry_save',
  payload: { writes: JSON.stringify(list.map(({ table, ids }) => ({ table, ids }))) },
});
const NOT_SAVED = () => t('Pas enregistré en ligne : le serveur l’a refusé. Ça reste seulement sur cet appareil (tes autres appareils ne le verront pas).');

asyncOffers.retry_save = async p => {
  const list = JSON.parse(p.writes ?? '[]') as Write[];
  // What the server refused is kept by the sync (lib/cloudSync): sent again, then checked like the first time.
  await retrySaving();
  const { refused, offline } = await verify(list);
  if (refused.length) return { text: t('Le serveur le refuse encore. Ça reste seulement sur cet appareil : réessaie plus tard, ou écris-nous si ça dure.'), offers: [retrySave(refused)] };
  if (offline) return { text: t('Toujours pas de réseau : c’est gardé sur cet appareil et partira dès qu’il revient.') };
  return { text: t('C’est enregistré en ligne.') };
};

/** A change confirmed with its button: done, then checked like the AI's own. */
asyncOffers.confirm_change = async p => {
  const before = writes.length;
  const r = runOffer({ label: '', kind: 'confirm_change', payload: p });
  const { refused } = await verify(writes.splice(before));
  return refused.length ? { text: NOT_SAVED(), offers: [retrySave(refused)] } : r;
};

/** A change of a shared calendar confirmed with its button (after a reading): sent, read back. */
asyncOffers.confirm_shared = async p => {
  try {
    const out = (await sharedChange(p.name ?? '', JSON.parse(p.input ?? '{}') as Record<string, unknown>, [])) as { message?: string };
    return { text: out.message ?? t('C’est fait.') };
  } catch (e) {
    return { text: t('Ça n’a pas marché : {reason}', { reason: (e as Error).message }) };
  }
};

/** What the personal calendar holds for an event, as the AI must say it (its reminders as they will ring). */
function eventFacts(ev: CalendarEvent) {
  const reminders = eventReminders(ev, getSettings().defaultReminders ?? []);
  return {
    id: ev.id,
    created: describeEvent(ev),
    agenda: 'agenda perso',
    ...(ev.place && { lieu: ev.place }),
    rappels: reminders.length ? reminders.map(n => reminderLabel(n, !!ev.start, ev.date, ev.start)) : 'aucun',
  };
}

/** update_event, move_event on a shared calendar (or between calendars): the server answers, then it is read back. */
async function sharedChange(name: string, input: Record<string, unknown>, links: CopilotLink[]): Promise<unknown> {
  if (name === 'move_event') {
    const res = await shared.moveTo(str(input.event_id), str(input.to), input.series === true);
    const where = res.target ? `${res.target.kind === 'agenda' ? 'agenda partagé' : 'groupe'} « ${res.target.name} »` : 'agenda perso';
    const first = res.first as { date: string; id: string; title: string };
    if (res.target) links.push({ label: t('Voir « {name} »', { name: res.target.name }), to: res.target.kind === 'agenda' ? `/agendas?g=${res.target.id}&jour=${first.date}&evt=${first.id}` : `/groupes?g=${res.target.id}&onglet=revisions` });
    else links.push({ label: t('Voir le jour'), to: linkToDay(first.date, first.id) });
    return {
      deplace: first.title,
      vers: where,
      occurrences: res.count,
      enregistre: true,
      message: t('« {title} » est maintenant dans {where}.', { title: first.title, where: res.target ? t('« {name} »', { name: res.target.name }) : t('ton agenda perso') }),
    };
  }
  const groupId = str(input.agenda) ? (await shared.findAgenda(str(input.agenda)))?.id : shared.groupOfEvent(str(input.event_id));
  if (!groupId) throw new Error('événement introuvable (list_events avec agenda)');
  const out = await shared.updateShared(groupId, str(input.event_id), {
    ...(str(input.title) && { title: str(input.title) }),
    ...(str(input.date) && { date: str(input.date) }),
    ...(str(input.start) && { start: str(input.start) }),
    ...(str(input.end) && { end: str(input.end) }),
    ...(typeof input.place === 'string' && { place: str(input.place) || null }),
  });
  return { updated: out, enregistre: true, message: t('C’est modifié dans « {name} ».', { name: out.agenda }) };
}

pendingChanges.apply = (name, input) => {
  if (!CHANGES.has(name)) return { text: t('Je ne peux plus le faire, redemande-le-moi.') };
  const links: CopilotLink[] = [];
  try {
    change(name, input, links);
    return { text: t('C’est fait.'), links };
  } catch (e) {
    return { text: t('Ça n’a pas marché : {reason}', { reason: (e as Error).message }) };
  }
};

/** The changes to what already exists: run at once, or after the student's click (confirm_change). */
function change(name: string, input: Record<string, unknown>, links: CopilotLink[]): unknown {
  switch (name) {
    case 'update_event': {
      const ev = updateEvent(str(input.event_id), {
        title: str(input.title) || undefined,
        date: str(input.date) || undefined,
        start: str(input.start) || undefined,
        end: str(input.end) || undefined,
        place: typeof input.place === 'string' ? str(input.place) : undefined,
        important: typeof input.important === 'boolean' ? input.important : undefined,
      });
      if (!ev) throw new Error('événement introuvable');
      links.push({ label: t('Voir le jour'), to: linkToDay(ev.date, ev.id) });
      const { created, ...facts } = eventFacts(ev);
      return wrote('events', [ev.id], { updated: created, ...facts });
    }
    case 'append_to_note': {
      const n = appendToNote(str(input.note_id), typeof input.content === 'string' ? input.content : '');
      if (!n) throw new Error('note introuvable');
      links.push({ label: hitLabel('note', n.title), to: linkToNote(n.id) });
      return wrote('notes', [n.id], { updated: n.title });
    }
    case 'rename_item': {
      const s = renameItem(str(input.id), str(input.new_name));
      if (!s) throw new Error('élément introuvable ou nom vide');
      links.push({ label: itemLabel(s), to: linkToItem(s) });
      return { renamed: itemName(s) };
    }
    case 'move_item': {
      const res = moveItem(str(input.id), str(input.folder) || undefined);
      if ('error' in res) throw new Error(res.error);
      links.push({ label: itemLabel(res.moved), to: linkToItem(res.moved) });
      return { moved: itemName(res.moved), to: res.to };
    }
    case 'star_file': {
      const it = setStar(str(input.id), input.starred !== false);
      if (!it) throw new Error('fichier ou dossier du Drive introuvable');
      return { item: it.name, starred: input.starred !== false };
    }
    case 'set_folder_color': {
      const f = setFolderColor(str(input.folder), str(input.color));
      if (!f) throw new Error('dossier du Drive ou couleur introuvable');
      links.push({ label: hitLabel('dossier', f.name), to: linkToDriveFolder(f.id) });
      return { folder: f.name, color: str(input.color) };
    }
    case 'restore_from_trash': {
      const res = restoreFromTrash(ids(input.ids));
      if (!res.restored.length) throw new Error('rien trouvé dans la corbeille avec ces id');
      links.push(...res.links);
      return { restored: res.restored, missing: res.missing };
    }
    case 'complete_todo': {
      const todo = completeTodo(str(input.todo_id), input.done !== false);
      if (!todo) throw new Error('tâche introuvable');
      return wrote('todos', [todo.id], { todo: todo.title, done: input.done !== false });
    }
    case 'set_reminders': {
      const res = setReminders({
        eventId: str(input.event_id) || undefined,
        todoId: str(input.todo_id) || undefined,
        minutesBefore: input.minutes_before,
        at: input.at,
        replace: input.replace === true,
        series: input.series === true,
      });
      const ev = useCalendar.getState().events.find(e => e.id === str(input.event_id));
      links.push(ev ? { label: t('Voir le jour'), to: linkToDay(ev.date, ev.id) } : { label: t('Voir mes tâches'), to: `/taches?tache=${encodeURIComponent(str(input.todo_id))}` });
      const ids = ev ? [ev.id, ...(input.series === true && ev.series ? useCalendar.getState().events.filter(e => e.series === ev.series && e.date > ev.date).map(e => e.id) : [])] : [str(input.todo_id)];
      return wrote(ev ? 'events' : 'todos', ids, res);
    }
    case 'update_settings': {
      const changed = updateSettings({
        accent: str(input.accent) || undefined,
        theme: str(input.theme) || undefined,
        reduceMotion: typeof input.reduce_motion === 'boolean' ? input.reduce_motion : undefined,
        chattiness: str(input.chattiness) || undefined,
      });
      if (!changed) throw new Error('aucun réglage valide fourni');
      links.push({ label: t('Réglages'), to: '/profil?onglet=apparence' });
      return { changed };
    }
    default:
      throw new Error(`outil inconnu : ${name}`);
  }
}

async function runTool(name: string, input: Record<string, unknown>, links: CopilotLink[], offers: CopilotOffer[]): Promise<unknown> {
  if ('_invalid_arguments' in input) throw new Error('arguments illisibles (JSON invalide), réessaie avec des arguments JSON valides');
  if (isSharedChange(name, input)) return sharedChange(name, input, links);
  if (CHANGES.has(name)) return change(name, input, links);
  switch (name) {
    case 'search_site': {
      const hits = search(str(input.query), 10);
      links.push(...hits.slice(0, 3).map(h => ({ label: hitLabel(h.type, h.title), to: h.to })));
      return hits.map(({ to: _to, ...h }) => h);
    }
    case 'search_notes': {
      const hits = searchNotes(str(input.query));
      links.push(...hits.slice(0, 3).map(h => ({ label: hitLabel('note', h.title), to: linkToNote(h.id) })));
      return hits.length ? hits : { result: 'aucune note ne contient ce texte' };
    }
    case 'get_overview':
      return overview();
    case 'read_note':
      return readNote(str(input.note_id)) ?? { error: 'note introuvable' };
    case 'read_file': {
      const res = await readFileText(str(input.file_id));
      const s = findItem(str(input.file_id));
      if (!('error' in res) && s) links.push({ label: itemLabel(s), to: linkToItem(s) });
      return res;
    }
    case 'list_drive_folder': {
      const res = listDriveFolder(str(input.folder) || undefined);
      if (res) links.push({ label: hitLabel('dossier', res.folder), to: res.link });
      return res ?? { error: 'dossier introuvable' };
    }
    case 'analyze_calendar': {
      const a = analyzeCalendar();
      links.push({ label: t('Ouvrir le calendrier'), to: '/calendrier' });
      const ev = (list: typeof a.today) => list.map(e => ({ id: e.id, desc: describeEvent(e) }));
      return { ...a, today: ev(a.today), exams: ev(a.exams), nextDeadlines: ev(a.nextDeadlines) };
    }
    case 'list_events': {
      if (str(input.agenda)) {
        const g = await shared.findAgenda(str(input.agenda));
        if (g) return shared.listShared(g, { from: str(input.from), to: str(input.to), title: str(input.title) });
      }
      // By title (« tous mes Yoga »): every occurrence, whatever the date; else the dates given.
      const q = normalize(str(input.title));
      const list = q
        ? useCalendar.getState().events.filter(e => !e.deletedAt && normalize(e.title).includes(q) && (!str(input.from) || e.date >= str(input.from)) && (!str(input.to) || e.date <= str(input.to))).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 300)
        : eventsBetween(str(input.from), str(input.to));
      // Only what is set (an empty field costs tokens at every step of the conversation).
      return list.map(e => ({ id: e.id, title: e.title, date: e.date, ...(e.start && { start: e.start }), ...(e.end && { end: e.end }), category: e.category, ...(e.place && { place: e.place }), ...(e.series && { series: true }) }));
    }
    case 'add_event': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) || !str(input.title)) throw new Error('title et date (YYYY-MM-DD) requis');
      const picked = str(input.category) in CATEGORIES ? (str(input.category) as EventCategory) : undefined;
      const repeatKey = REPEATS.some(r => r.key === str(input.repeat)) ? (str(input.repeat) as Repeat) : undefined;
      // In a shared calendar or a group: written on its server, read back from it.
      const agenda = str(input.agenda) ? await shared.findAgenda(str(input.agenda)) : null;
      if (agenda) {
        const res = await shared.addShared(agenda, {
          title: str(input.title),
          date: str(input.date),
          start: str(input.start) || undefined,
          end: str(input.end) || undefined,
          place: str(input.place) || undefined,
          category: picked,
          endDate: str(input.end_date) || undefined,
          repeat: repeatKey,
          until: str(input.until) || undefined,
        });
        links.push({ label: t('Voir « {name} »', { name: agenda.name }), to: agenda.kind === 'agenda' ? `/agendas?g=${agenda.id}&jour=${res.first.date}&evt=${res.first.id}` : `/groupes?g=${agenda.id}&onglet=revisions` });
        const facts = shared.describeShared(res.first, agenda);
        return { created: `${facts.titre} — ${facts.quand}`, ...facts, enregistre: true, ...(res.count > 1 && (repeatKey ? { occurrences: res.count, last_one: res.last } : { last_day: res.last })) };
      }
      // « perso » is the AI's default when unsure: a title that clearly says more (« Point d'équipe » → Réunion) wins.
      const guessed = guessCategory(str(input.title), !!str(input.start));
      const repeat = repeatKey;
      // Over several days (end_date) or repeated (repeat, until): one event a day or per time, linked (lib/repeat).
      const { first: ev, count, last, endless } = addEvents({
        title: str(input.title),
        date: str(input.date),
        start: str(input.start) || undefined,
        end: str(input.end) || undefined,
        category: !picked || (picked === 'perso' && guessed !== 'perso') ? guessed : picked,
        important: input.important === true || undefined,
        place: str(input.place) || undefined,
        endDate: str(input.end_date) || undefined,
        repeat,
        until: str(input.until) || undefined,
      });
      links.push({ label: t('Voir le jour'), to: linkToDay(ev.date, ev.id) });
      // Read back from the store: what is really there (title, day, place, reminders), then checked on the server.
      const saved = useCalendar.getState().events.find(e => e.id === ev.id) ?? ev;
      const ids = ev.series ? useCalendar.getState().events.filter(e => e.series === ev.series).map(e => e.id) : [ev.id];
      return wrote('events', ids, { ...eventFacts(saved), ...(endless ? { chaque_annee_sans_fin: true } : count > 1 && (repeat ? { occurrences: count, last_one: last } : { last_day: last })) });
    }
    case 'delete_event': {
      // One call for several (event_ids): one button « Supprimer les N événements » (offerMerge also groups separate calls).
      const wanted = [...ids(input.event_ids), ...(str(input.event_id) ? [str(input.event_id)] : [])];
      const found = useCalendar.getState().events.filter(e => wanted.includes(e.id) && !e.deletedAt);
      if (!found.length) throw new Error('événement introuvable (il faut son id exact, voir list_events)');
      offers.push(deleteOffer('event', found.map(e => e.id), found.map(e => e.title)));
      return { ...awaitingClick(found.map(describeEvent).join(' ; ')), ...(found.length < wanted.length && { not_found: wanted.length - found.length }) };
    }
    case 'plan_revisions': {
      const exam = findExam(str(input.exam));
      if (!exam) throw new Error('examen introuvable');
      if (hasRevisionPlan(exam)) {
        const done = alreadyPlanned(exam);
        links.push(...done.links);
        return { exam: describeEvent(exam), already_planned: true, sessions: revisionSessions(exam).map(describeEvent) };
      }
      const res = planRevisions(exam.id, typeof input.sessions === 'number' ? input.sessions : 3)!;
      if (res.created.length) links.push({ label: t('Voir le planning'), to: linkToDay(res.created[0].date) });
      if (res.note) links.push({ label: openNoteLabel(), to: linkToNote(res.note.id) });
      if (res.note) wrote('notes', [res.note.id]);
      return wrote('events', res.created.map(e => e.id), {
        exam: describeEvent(exam),
        sessions: res.created.map(describeEvent),
        note: res.note?.title,
        ...(res.created.length ? {} : { warning: "aucune séance créée : l'examen est passé ou trop proche" }),
      });
    }
    case 'create_note': {
      const n = createNote(str(input.title) || 'Note', typeof input.content === 'string' ? input.content : '', str(input.folder) || undefined);
      links.push({ label: hitLabel('note', n.title), to: linkToNote(n.id) });
      return wrote('notes', [n.id], { created: n.title, id: n.id });
    }
    case 'create_folder': {
      if (input.space === 'notes') {
        const f = useNotes.getState().createFolder(str(input.name), null);
        links.push({ label: hitLabel('dossier de notes', f.name), to: `/notes?dossier=${f.id}` });
        return { created: f.name, id: f.id };
      }
      const f = createDriveFolder(str(input.name), str(input.parent) || undefined);
      links.push({ label: hitLabel('dossier', f.name), to: linkToDriveFolder(f.id) });
      return { created: f.name, id: f.id };
    }
    case 'trash_items': {
      const found = ids(input.ids).flatMap(id => {
        const s = findItem(id);
        return s && s.item.id === id ? [s] : [];
      });
      if (!found.length) throw new Error('aucun élément avec ces id exacts (trouve-les avec list_drive_folder ou search_site)');
      const names = found.map(itemName);
      offers.push(deleteOffer('items', found.map(s => s.item.id), names));
      return awaitingClick(names.join(', '));
    }
    case 'list_trash': {
      const list = listTrash();
      links.push({ label: t('Corbeille'), to: '/corbeille' });
      return list.length ? list : { result: 'la corbeille est vide' };
    }
    case 'list_todos': {
      const list = listTodos(input.include_done === true);
      return list.length ? list : { result: 'aucune tâche' };
    }
    case 'add_todo': {
      if (!str(input.title)) throw new Error('title requis');
      const todo = addTodo(str(input.title), str(input.due) || undefined, str(input.time) || undefined, str(input.repeat) || undefined);
      const reminders = todo.due ? (todo.reminders ?? []) : [];
      return wrote('todos', [todo.id], {
        created: todo.title,
        id: todo.id,
        due: todo.due,
        ...(todo.time && { time: todo.time }),
        ...(todo.repeat && { repeat: todo.repeat }),
        rappels: reminders.length ? reminders.map(n => reminderLabel(n, !!todo.time, todo.due, todo.time)) : 'aucun',
      });
    }
    case 'delete_todo': {
      const wanted = [...ids(input.todo_ids), ...(str(input.todo_id) ? [str(input.todo_id)] : [])];
      const found = useTodos.getState().todos.filter(x => wanted.includes(x.id) && !x.deletedAt);
      if (!found.length) throw new Error('tâche introuvable (il faut son id exact, voir list_todos)');
      offers.push(deleteOffer('todo', found.map(x => x.id), found.map(x => x.title)));
      return awaitingClick(found.map(x => x.title).join(' ; '));
    }
    case 'choose_agenda': {
      const groups = (await shared.myGroups()).filter(g => g.kind === 'agenda' || g.kind === 'groupe');
      if (!groups.length) return { result: "il n'a aucun agenda partagé ni groupe : ajoute dans son agenda perso sans redemander" };
      const request = str(input.request) || t('Ajoute-le');
      const choice = (label: string, name: string): CopilotOffer => ({ label, kind: 'ask', payload: { prompt: t('{request}, dans l’agenda « {name} ».', { request: request.replace(/[.!]+$/, ''), name }) } });
      offers.push(choice(t('Mon agenda perso'), 'perso'), ...groups.slice(0, 6).map(g => choice(g.name, g.name)));
      return { awaiting_choice: 'des boutons « Dans quel agenda ? » sont affichés', note: 'Rien n’est créé. Demande-lui en une phrase dans quel agenda le mettre, sans lister les agendas (les boutons le font).' };
    }
    case 'list_group_files': {
      const { group, files } = await shared.groupFiles(str(input.group));
      links.push({ label: t('Voir « {name} »', { name: group.name }), to: `/groupes?g=${group.id}&onglet=fichiers` });
      return files.length ? files.slice(0, 100).map(f => ({ id: f.id, name: f.name, size: f.size })) : { result: `aucun fichier partagé dans « ${group.name} »` };
    }
    case 'read_group_file': {
      const r = await shared.readGroupFile(str(input.group), str(input.file_id));
      return 'error' in r ? r : r.res;
    }
    case 'share_note_to_group': {
      const r = await shared.shareNote(str(input.note_id), str(input.group));
      links.push({ label: t('Voir « {name} »', { name: r.group.name }), to: `/groupes?g=${r.group.id}&onglet=notes&note=${r.note.id}` });
      return { shared: r.note.title, group: r.group.name, enregistre: true };
    }
    case 'start_focus':
      return { started: startFocus(str(input.subject)) };
    case 'stop_focus':
      return stopFocus() ?? { result: 'aucune session en cours' };
    case 'open_page':
      goTo(str(input.path) || '/');
      return { opened: str(input.path) };
    default:
      throw new Error(`outil inconnu : ${name}`);
  }
}

let history: Param[] = [];
export const resetClaudeHistory = () => {
  history = [];
};

const PAGES: Record<string, string> = {
  '/': 'Accueil', '/drive': 'Fichiers', '/calendrier': 'Calendrier', '/taches': 'Tâches', '/notes': 'Notes', '/enregistrer': 'Enregistrer',
  '/groupes': 'Groupes', '/agendas': 'Agendas partagés', '/corbeille': 'Corbeille', '/profil': 'Profil et réglages',
};

/** Facts from the app that the AI can't see otherwise, prepended to each user turn. */
function contextBlock(): string {
  const now = new Date();
  const msgs = useCopilot.getState().messages;
  const lastUser = msgs.map(m => m.role).lastIndexOf('user', msgs.length - 2);
  const recentProactive = msgs.slice(lastUser + 1, -1).filter(m => m.role === 'bot' && m.proactive).map(m => `« ${m.text} »`);
  const lines = [
    `Date : ${fmt(now, "EEEE d MMMM yyyy 'à' HH:mm")} (${todayKey()})`,
    `Page ouverte : ${PAGES[location.pathname] ?? location.pathname}`,
  ];
  const { school, program, year, usage, needs } = getSettings();
  const profile = [year, program, school].filter(Boolean).join(', ');
  lines.push(`Utilise Kompaly pour : ${USAGE_CONTEXT[usage] ?? USAGE_CONTEXT.etudes}${profile ? ` (${profile})` : ''}`);
  lines.push(categoryContext(usage));
  if (needs.length) lines.push(`Ce dont il/elle a le plus besoin : ${needs.join(', ')}`);
  if (recentProactive.length) lines.push(`Tu lui as dit récemment, de toi-même : ${recentProactive.join(' ')}`);
  if (offerLog.length) lines.push(`Boutons utilisés depuis : ${offerLog.splice(0).join(' | ')}`);
  const agendas = shared.agendasLine();
  if (agendas) lines.push(agendas);
  if (history.length === 0) {
    // Not what was typed and answered in simple mode (on the device): it never leaves it, even later.
    const earlier = msgs.slice(-9, -1).filter(m => !m.proactive && !m.local);
    if (earlier.length) lines.push(`Fin de votre conversation précédente : ${earlier.map(m => `${m.role === 'user' ? 'Lui' : 'Toi'}: ${m.text}`).join(' | ').slice(0, 1500)}`);
  }
  return `[Contexte]\n${lines.join('\n')}`;
}

/** Questions kept in the browser (the server trims further to what the AI accepts). */
const KEEP_QUESTIONS = 20;

/** The AI stopped halfway: what it had already done (and its links), with the error that stopped it. */
export class PartlyDone extends Error {
  readonly reason: unknown;
  readonly links: CopilotLink[];
  constructor(reason: unknown, links: CopilotLink[]) {
    super((reason as Error)?.message ?? String(reason));
    this.reason = reason;
    this.links = links;
  }
}

/** Read-only tools: several asked at once run together (the writes, one after the other, in order). */
const READ_ONLY = new Set(['search_site', 'search_notes', 'get_overview', 'read_note', 'read_file', 'list_drive_folder', 'analyze_calendar', 'list_events', 'list_trash', 'list_todos', 'list_group_files', 'read_group_file']);

/** Says it plainly when the server refused what the AI may have announced as done. */
const SAYS_FAILED = /pas (?:été )?enregistr|n'?a pas (?:pu|été)|refus|échou|pas pu/i;

export async function claudeReply(text: string, userName: string, stop?: AbortSignal): Promise<BotReply> {
  const links: CopilotLink[] = [];
  const offers: CopilotOffer[] = [];
  // One id for the question and the steps after its tools: the server gives the question back if a step fails.
  const turn = uid();
  writes = [];
  let refusedAll: Write[] = [];
  const starts = history.flatMap((m, i) => (m.role === 'user' && Array.isArray(m.content) && m.content.some(b => b.type === 'text') ? [i] : []));
  if (starts.length >= KEEP_QUESTIONS) history = history.slice(starts[starts.length - KEEP_QUESTIONS + 1]);
  const before = history.length;
  let acted = false; // a tool already changed something: on a later error the simple mode must not do it again
  history.push({ role: 'user', content: [{ type: 'text', text: contextBlock() }, { type: 'text', text }] });
  try {
    for (let step = 0; step < 10; step++) {
      const res = await post<{ content: Block[]; stop_reason: string }>('chat', { messages: history, userName, turn, ...persona() }, undefined, stop);
      history.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
      if (res.stop_reason === 'refusal') return { text: t('Là je préfère ne pas m’aventurer. On parle d’autre chose ?') };
      if (res.stop_reason === 'pause_turn') continue;

      const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0) {
        const answer = res.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim();
        const unique = links.filter((l, i) => links.findIndex(x => x.to === l.to) === i).slice(0, 4);
        // Refused by the server: said by the app itself if the AI didn't (never « ajouté » alone), with « Réessayer ».
        if (refusedAll.length) offers.unshift(retrySave(refusedAll));
        const honest = refusedAll.length && answer && !SAYS_FAILED.test(answer) ? `${answer}\n\n⚠️ ${NOT_SAVED()}` : answer;
        if (answer) return { text: honest, links: unique, offers: mergeOffers(offers) };
        // An empty answer: say so honestly (« done » only when a tool did act), and keep a readable turn in the
        // history, or every next question would be refused for this empty message.
        const said = refusedAll.length ? NOT_SAVED() : offers.length ? t('Tu confirmes ?') : acted ? t('C’est fait.') : t('Je n’ai pas de réponse cette fois. Tu peux reformuler ?');
        history[history.length - 1] = { role: 'assistant', content: [{ type: 'text', text: said }] };
        return { text: said, links: unique, offers: mergeOffers(offers) };
      }
      // Reads run together; writes one after the other, in the order asked. Nothing is said to the AI before the
      // writes are read back from the server (verify): it describes what is saved, or says it isn't.
      const gated = hasReadContent();
      let chain: Promise<unknown> = Promise.resolve();
      const outcomes = toolUses.map(tu => {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        if (CHANGES.has(tu.name) && gated) {
          offers.push({ label: changeLabel(tu.name, input), kind: isSharedChange(tu.name, input) ? 'confirm_shared' : 'confirm_change', payload: { name: tu.name, input: JSON.stringify(input) } });
          return Promise.resolve({ out: awaitingClick(changeLabel(tu.name, input)) as unknown, error: null as string | null });
        }
        acted = true;
        const run = () => runTool(tu.name, input, links, offers).then(out => ({ out, error: null as string | null }), (e: unknown) => ({ out: null as unknown, error: (e as Error).message }));
        if (READ_ONLY.has(tu.name)) return run();
        const p = chain.then(run);
        chain = p;
        return p;
      });
      const done = await Promise.all(outcomes);
      const { refused } = await verify(writes.splice(0));
      refusedAll = [...refusedAll, ...refused];
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((tu, i) => {
        const { out, error } = done[i];
        if (error !== null) return { type: 'tool_result', tool_use_id: tu.id, content: error, is_error: true };
        if (refused.some(w => w.out === out))
          return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `PAS ENREGISTRÉ : le serveur l'a refusé, ça reste seulement sur cet appareil (ses autres appareils ne le verront pas). Dis-le-lui clairement, sans dire que c'est ajouté ou fait ; un bouton « Réessayer l'enregistrement » s'affiche. Ce qui avait été fait ici : ${JSON.stringify(out)}` };
        return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) };
      });
      history.push({ role: 'user', content: results });
      // Stopped while the tools ran: no next call (what they did stays done).
      if (stop?.aborted) throw new CopilotApiError('aborted');
    }
    if (refusedAll.length) return { text: NOT_SAVED(), links, offers: mergeOffers([retrySave(refusedAll), ...offers]) };
    return { text: t('J’ai fait plusieurs choses, jette un œil.'), links, offers: mergeOffers(offers) };
  } catch (e) {
    history = history.slice(0, before); // keep the conversation valid for the next try
    throw acted ? new PartlyDone(e, links.filter((l, i) => links.findIndex(x => x.to === l.to) === i).slice(0, 4)) : e;
  }
}

export function describeApiError(e: unknown): string {
  const code = e instanceof CopilotApiError ? e.code : 'unknown';
  if (code === 'rate_limited') {
    const until = aiPausedUntil();
    // The same length as the countdown in the header (« IA dans 1:59 » → two minutes).
    const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
    const pause = minutes === 1 ? t('une minute') : minutes === 2 ? t('deux minutes') : minutes === 3 ? t('trois minutes') : t('{n} minutes', { n: minutes });
    return until - Date.now() > 10 * 60_000
      ? t('L’IA gratuite a atteint sa limite : jusqu’à {time}, je comprends seulement tes phrases simples.', { time: fmt(new Date(until), t("HH'h'mm")) })
      : t('L’IA gratuite est très demandée : je comprends seulement tes phrases simples pendant {pause}.', { pause: until ? pause : t('un instant') });
  }
  if (code === 'daily_limit') return t('Tu as utilisé tes questions à l’IA du jour : jusqu’à minuit, je comprends seulement tes phrases simples.');
  if (code === 'site_limit') return t('L’IA gratuite a atteint sa limite du jour : jusqu’à minuit, je comprends seulement tes phrases simples.');
  if (code === 'simple_only') return t('« Ne jamais utiliser l’IA » est activé (Réglages › Kompaly) : je réponds sans IA.');
  if (code === 'too_large') return t('C’est trop long pour l’IA d’un coup : demande une partie précise ou ouvre une nouvelle conversation.');
  // The AI doesn't answer: simple mode for a while instead of the same apology at every message.
  if (code === 'bad_key') {
    pauseAi(30 * 60, 'error');
    return t('L’IA n’est pas disponible pour le moment : je comprends seulement tes phrases simples.');
  }
  pauseAi(2 * 60, 'error');
  if (code === 'timeout') return t('L’IA met trop de temps à répondre : je comprends seulement tes phrases simples pendant deux minutes.');
  if (code === 'network') return t('J’ai perdu la connexion à l’IA : je comprends seulement tes phrases simples pendant deux minutes.');
  return t('L’IA a un souci technique : je comprends seulement tes phrases simples pendant deux minutes.');
}
