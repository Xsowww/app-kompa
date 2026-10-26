// AI mode: the conversation goes through our server (/api/copilot, see server/copilot.mjs),
// which holds the API key, Kompaly's personality and picks the AI provider (Claude, Gemini,
// Groq…). The server always answers in the Anthropic message shape, so this file doesn't
// care which provider is behind. Tools run here, on the student's data.

import type Anthropic from '@anthropic-ai/sdk';
import { fmt, todayKey } from '../lib/dates';
import { lang, t, tn } from '../i18n';
import { useCopilot, type CopilotLink, type CopilotOffer } from '../store/copilot';
import { useCalendar, CATEGORIES, CATEGORY_LABELS, guessCategory, type EventCategory } from '../store/calendar';
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
  search, analyzeCalendar, eventsBetween, addEvent, createNote, createDriveFolder, listDriveFolder, readNote, overview,
  linkToNote, linkToDriveFolder, linkToDay, describeEvent, findExam, planRevisions, hasRevisionPlan, revisionSessions, alreadyPlanned, openNoteLabel, appendToNote, updateEvent, goTo,
  findItem, linkToItem, itemName, renameItem, moveItem, setStar, setFolderColor, listTrash, restoreFromTrash,
  searchNotes, listTodos, addTodo, completeTodo, startFocus, stopFocus, updateSettings,
} from './actions';
import { offerLog, pendingChanges } from './offers';
import { readFileText } from './fileText';
import type { BotReply } from './localBrain';
import { aiPausedUntil, pauseAi } from './aiPause';

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
  return { persona, personaNotes: personaNotes.slice(0, 600), lang };
}

async function post<T>(path: string, body: unknown, timeoutMs = 90_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const token = await accessToken();
    const res = await fetch(`/api/copilot/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Quota of the free AI reached: simple mode until the provider accepts requests again.
      if (['rate_limited', 'daily_limit', 'site_limit'].includes(data.error)) pauseAi(Number(data.retryAfter) || 60, data.error === 'daily_limit' ? 'mine' : 'limit');
      throw new CopilotApiError(data.error ?? `http_${res.status}`);
    }
    return data as T;
  } catch (e) {
    if (e instanceof CopilotApiError) throw e;
    throw new CopilotApiError((e as Error).name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
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
const CHANGES = new Set(['update_event', 'append_to_note', 'rename_item', 'move_item', 'star_file', 'set_folder_color', 'restore_from_trash', 'complete_todo', 'update_settings']);
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
  if (name === 'append_to_note' && note) return t('Ajouter du texte à « {title} »', { title: note.title });
  if (name === 'complete_todo' && todo) return t('Cocher « {title} »', { title: todo.title });
  if (name === 'restore_from_trash') return t('Restaurer depuis la corbeille');
  if (name === 'update_settings') return t('Changer les réglages');
  return t('Oui, fais-le');
}

pendingChanges.apply = (name, input) => {
  if (!CHANGES.has(name)) return { text: t('Je ne peux plus le faire, redemande-le-moi.') };
  const links: CopilotLink[] = [];
  void runTool(name, input, links, []);
  return { text: t('C’est fait.'), links };
};

async function runTool(name: string, input: Record<string, unknown>, links: CopilotLink[], offers: CopilotOffer[]): Promise<unknown> {
  if ('_invalid_arguments' in input) throw new Error('arguments illisibles (JSON invalide), réessaie avec des arguments JSON valides');
  switch (name) {
    case 'search_site': {
      const hits = search(str(input.query), 10);
      links.push(...hits.slice(0, 3).map(h => ({ label: h.title, to: h.to })));
      return hits.map(({ to: _to, ...h }) => h);
    }
    case 'search_notes': {
      const hits = searchNotes(str(input.query));
      links.push(...hits.slice(0, 3).map(h => ({ label: h.title, to: linkToNote(h.id) })));
      return hits.length ? hits : { result: 'aucune note ne contient ce texte' };
    }
    case 'get_overview':
      return overview();
    case 'read_note':
      return readNote(str(input.note_id)) ?? { error: 'note introuvable' };
    case 'read_file': {
      const res = await readFileText(str(input.file_id));
      const s = findItem(str(input.file_id));
      if (!('error' in res) && s) links.push({ label: t('Ouvrir « {name} »', { name: itemName(s) }), to: linkToItem(s) });
      return res;
    }
    case 'list_drive_folder': {
      const res = listDriveFolder(str(input.folder) || undefined);
      if (res) links.push({ label: res.folder, to: res.link });
      return res ?? { error: 'dossier introuvable' };
    }
    case 'analyze_calendar': {
      const a = analyzeCalendar();
      links.push({ label: t('Calendrier'), to: '/calendrier' });
      const ev = (list: typeof a.today) => list.map(e => ({ id: e.id, desc: describeEvent(e) }));
      return { ...a, today: ev(a.today), exams: ev(a.exams), lateHomework: ev(a.lateHomework), nextDeadlines: ev(a.nextDeadlines) };
    }
    case 'list_events':
      return eventsBetween(str(input.from), str(input.to)).map(e => ({ id: e.id, title: e.title, date: e.date, start: e.start, end: e.end, category: e.category, done: e.done }));
    case 'add_event': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) || !str(input.title)) throw new Error('title et date (YYYY-MM-DD) requis');
      const picked = str(input.category) in CATEGORIES ? (str(input.category) as EventCategory) : undefined;
      // « perso » is the AI's default when unsure: a title that clearly says more (« Point d'équipe » → Réunion) wins.
      const guessed = guessCategory(str(input.title), !!str(input.start));
      const ev = addEvent({
        title: str(input.title),
        date: str(input.date),
        start: str(input.start) || undefined,
        end: str(input.end) || undefined,
        category: !picked || (picked === 'perso' && guessed !== 'perso') ? guessed : picked,
        important: input.important === true || undefined,
      });
      links.push({ label: t('Voir le jour'), to: linkToDay(ev.date, ev.id) });
      return { created: describeEvent(ev), id: ev.id };
    }
    case 'update_event': {
      const ev = updateEvent(str(input.event_id), {
        title: str(input.title) || undefined,
        date: str(input.date) || undefined,
        start: str(input.start) || undefined,
        end: str(input.end) || undefined,
        done: typeof input.done === 'boolean' ? input.done : undefined,
        important: typeof input.important === 'boolean' ? input.important : undefined,
      });
      if (!ev) throw new Error('événement introuvable');
      links.push({ label: t('Voir le jour'), to: linkToDay(ev.date, ev.id) });
      return { updated: describeEvent(ev) };
    }
    case 'delete_event': {
      const ev = useCalendar.getState().events.find(e => e.id === str(input.event_id));
      if (!ev) throw new Error('événement introuvable (il faut son id exact, voir list_events)');
      offers.push({ label: t('Supprimer « {title} »', { title: ev.title }), kind: 'confirm_delete', payload: { what: 'event', ids: ev.id } });
      return awaitingClick(describeEvent(ev));
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
      return {
        exam: describeEvent(exam),
        sessions: res.created.map(describeEvent),
        note: res.note?.title,
        ...(res.created.length ? {} : { warning: "aucune séance créée : l'examen est passé ou trop proche" }),
      };
    }
    case 'create_note': {
      const n = createNote(str(input.title) || 'Note', typeof input.content === 'string' ? input.content : '', str(input.folder) || undefined);
      links.push({ label: t('Ouvrir « {name} »', { name: n.title }), to: linkToNote(n.id) });
      return { created: n.title, id: n.id };
    }
    case 'append_to_note': {
      const n = appendToNote(str(input.note_id), typeof input.content === 'string' ? input.content : '');
      if (!n) throw new Error('note introuvable');
      links.push({ label: t('Ouvrir « {name} »', { name: n.title }), to: linkToNote(n.id) });
      return { updated: n.title };
    }
    case 'create_folder': {
      if (input.space === 'notes') {
        const f = useNotes.getState().createFolder(str(input.name), null);
        links.push({ label: f.name, to: `/notes?dossier=${f.id}` });
        return { created: f.name, id: f.id };
      }
      const f = createDriveFolder(str(input.name), str(input.parent) || undefined);
      links.push({ label: f.name, to: linkToDriveFolder(f.id) });
      return { created: f.name, id: f.id };
    }
    case 'rename_item': {
      const s = renameItem(str(input.id), str(input.new_name));
      if (!s) throw new Error('élément introuvable ou nom vide');
      links.push({ label: itemName(s), to: linkToItem(s) });
      return { renamed: itemName(s) };
    }
    case 'move_item': {
      const res = moveItem(str(input.id), str(input.folder) || undefined);
      if ('error' in res) throw new Error(res.error);
      links.push({ label: itemName(res.moved), to: linkToItem(res.moved) });
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
      links.push({ label: f.name, to: linkToDriveFolder(f.id) });
      return { folder: f.name, color: str(input.color) };
    }
    case 'trash_items': {
      const found = ids(input.ids).flatMap(id => {
        const s = findItem(id);
        return s && s.item.id === id ? [s] : [];
      });
      if (!found.length) throw new Error('aucun élément avec ces id exacts (trouve-les avec list_drive_folder ou search_site)');
      const names = found.map(itemName);
      offers.push({
        label: found.length === 1 ? t('Mettre « {name} » à la corbeille', { name: names[0] }) : tn(found.length, 'Mettre {n} élément à la corbeille', 'Mettre {n} éléments à la corbeille'),
        kind: 'confirm_delete',
        payload: { what: 'items', ids: found.map(s => s.item.id).join(',') },
      });
      return awaitingClick(names.join(', '));
    }
    case 'list_trash': {
      const list = listTrash();
      links.push({ label: t('Corbeille'), to: '/corbeille' });
      return list.length ? list : { result: 'la corbeille est vide' };
    }
    case 'restore_from_trash': {
      const res = restoreFromTrash(ids(input.ids));
      if (!res.restored.length) throw new Error('rien trouvé dans la corbeille avec ces id');
      links.push(...res.links);
      return { restored: res.restored, missing: res.missing };
    }
    case 'list_todos': {
      const list = listTodos(input.include_done === true);
      return list.length ? list : { result: 'aucune tâche' };
    }
    case 'add_todo': {
      if (!str(input.title)) throw new Error('title requis');
      const todo = addTodo(str(input.title), str(input.due) || undefined);
      return { created: todo.title, id: todo.id, due: todo.due };
    }
    case 'complete_todo': {
      const todo = completeTodo(str(input.todo_id), input.done !== false);
      if (!todo) throw new Error('tâche introuvable');
      return { todo: todo.title, done: input.done !== false };
    }
    case 'delete_todo': {
      const todo = useTodos.getState().todos.find(x => x.id === str(input.todo_id));
      if (!todo) throw new Error('tâche introuvable (il faut son id exact, voir list_todos)');
      offers.push({ label: t('Supprimer « {title} »', { title: todo.title }), kind: 'confirm_delete', payload: { what: 'todo', ids: todo.id } });
      return awaitingClick(todo.title);
    }
    case 'start_focus':
      return { started: startFocus(str(input.subject)) };
    case 'stop_focus':
      return stopFocus() ?? { result: 'aucune session en cours' };
    case 'update_settings': {
      const changed = updateSettings({
        accent: str(input.accent) || undefined,
        theme: str(input.theme) || undefined,
        reduceMotion: typeof input.reduce_motion === 'boolean' ? input.reduce_motion : undefined,
        chattiness: str(input.chattiness) || undefined,
      });
      if (!changed) throw new Error('aucun réglage valide fourni');
      links.push({ label: t('Réglages'), to: '/profil' });
      return { changed };
    }
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
  '/': 'Accueil', '/drive': 'Drive', '/calendrier': 'Calendrier', '/taches': 'Tâches', '/notes': 'Notes', '/enregistrer': 'Enregistrer',
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
  if (history.length === 0) {
    const earlier = msgs.slice(-9, -1).filter(m => !m.proactive);
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

export async function claudeReply(text: string, userName: string): Promise<BotReply> {
  const links: CopilotLink[] = [];
  const offers: CopilotOffer[] = [];
  const starts = history.flatMap((m, i) => (m.role === 'user' && Array.isArray(m.content) && m.content.some(b => b.type === 'text') ? [i] : []));
  if (starts.length >= KEEP_QUESTIONS) history = history.slice(starts[starts.length - KEEP_QUESTIONS + 1]);
  const before = history.length;
  let acted = false; // a tool already changed something: on a later error the simple mode must not do it again
  history.push({ role: 'user', content: [{ type: 'text', text: contextBlock() }, { type: 'text', text }] });
  try {
    for (let step = 0; step < 10; step++) {
      const res = await post<{ content: Block[]; stop_reason: string }>('chat', { messages: history, userName, ...persona() });
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
        if (answer) return { text: answer, links: unique, offers };
        // An empty answer: say so honestly (« done » only when a tool did act), and keep a readable turn in the
        // history, or every next question would be refused for this empty message.
        const said = offers.length ? t('Tu confirmes ?') : acted ? t('C’est fait.') : t('Je n’ai pas de réponse cette fois. Tu peux reformuler ?');
        history[history.length - 1] = { role: 'assistant', content: [{ type: 'text', text: said }] };
        return { text: said, links: unique, offers };
      }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        if (CHANGES.has(tu.name) && hasReadContent()) {
          offers.push({ label: changeLabel(tu.name, input), kind: 'confirm_change', payload: { name: tu.name, input: JSON.stringify(input) } });
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(awaitingClick(changeLabel(tu.name, input))) });
          continue;
        }
        acted = true;
        try {
          const out = await runTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, links, offers);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: (e as Error).message, is_error: true });
        }
      }
      history.push({ role: 'user', content: results });
    }
    return { text: t('J’ai fait plusieurs choses, jette un œil.'), links, offers };
  } catch (e) {
    history = history.slice(0, before); // keep the conversation valid for the next try
    throw acted ? new PartlyDone(e, links.filter((l, i) => links.findIndex(x => x.to === l.to) === i).slice(0, 4)) : e;
  }
}

export type NudgeKind = 'remark' | 'brief' | 'review';
const NUDGE_MAX: Record<NudgeKind, number> = { remark: 320, brief: 520, review: 640 };

/** Lets the AI phrase a proactive remark in Kompaly's voice. Returns null on any problem. */
export async function aiNudge(situation: Record<string, unknown>, userName: string, kind: NudgeKind = 'remark'): Promise<string | null> {
  if (aiPausedUntil()) return null;
  try {
    const res = await post<{ text: string }>(
      'nudge',
      { situation: { ...situation, maintenant: fmt(new Date(), "EEEE d MMMM 'à' HH:mm") }, userName, kind, ...persona() },
      kind === 'remark' ? 9000 : 15000,
    );
    const text = res.text?.trim();
    return text && text.length <= NUDGE_MAX[kind] ? text : null;
  } catch {
    return null;
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
      ? t('L’IA gratuite a atteint sa limite : je passe en mode simple jusqu’à {time}.', { time: fmt(new Date(until), t("HH'h'mm")) })
      : t('L’IA gratuite est très demandée : je passe en mode simple {pause}.', { pause: until ? pause : t('un instant') });
  }
  if (code === 'daily_limit') return t('Tu as utilisé tes questions à l’IA du jour : je passe en mode simple jusqu’à minuit.');
  if (code === 'site_limit') return t('L’IA gratuite a atteint sa limite du jour : je passe en mode simple jusqu’à minuit.');
  if (code === 'too_large') return t('C’est trop long pour l’IA d’un coup : demande une partie précise ou ouvre une nouvelle conversation.');
  // The AI doesn't answer: simple mode for a while instead of the same apology at every message.
  if (code === 'bad_key') {
    pauseAi(30 * 60, 'error');
    return t('Ma clé d’accès à l’IA ne marche pas (à vérifier sur le serveur) : je passe en mode simple.');
  }
  pauseAi(2 * 60, 'error');
  if (code === 'timeout') return t('L’IA met trop de temps à répondre : je passe en mode simple deux minutes.');
  if (code === 'network') return t('J’ai perdu la connexion à l’IA : je passe en mode simple deux minutes.');
  return t('L’IA a un souci technique : je passe en mode simple deux minutes.');
}
