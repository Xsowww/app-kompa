// Kompaly in the shared calendars and the groups (test n°3: he could only add to « perso », said « c'est dans
// Famille » when it wasn't, and couldn't read a team's files). Everything here goes straight to the server
// (lib/groups) and is read back from it: the AI is told what the calendar really holds, or why it was refused.

import { useGroups } from '../store/groups';
import { useAuth } from '../store/auth';
import * as api from '../lib/groups';
import type { Group, GroupEvent, NewGroupEvent } from '../lib/groups';
import { cloudEnabled } from '../lib/supabase';
import { normalize } from '../lib/utils';
import { newSeries } from '../lib/seriesId';
import { fmtDay, fromKey, todayKey, validKey } from '../lib/dates';
import { defaultUntil, repeatDays, shiftKey, spanDays, type Repeat } from '../lib/repeat';
import { reminderLabel } from '../lib/reminders';
import { catOf, CATEGORIES, guessCategory } from '../store/calendar';
import { moveEventToAgenda, PERSO, type AgendaRef } from '../store/moveEvent';
import { useNotes } from '../store/notes';
import { blobText, MAX_FILE_CHARS } from './fileText';
import { hourLabel } from './actions';
import { t } from '../i18n';

/** « perso », « mon agenda », nothing: the person's own calendar. */
const PERSONAL = /^(?:|perso|personnel|prive|moi|mon agenda|mon calendrier|agenda perso|calendrier perso|mon agenda perso|mes evenements)$/;

/** My shared calendars and groups (read once, then as the Groups pages keep them). */
export async function myGroups(): Promise<Group[]> {
  if (!cloudEnabled) return [];
  const s = useGroups.getState();
  if (!s.loaded || s.failed) await s.loadGroups();
  return useGroups.getState().groups;
}

/** What the AI is told in its [Contexte]: names, kinds and whether I may change them. */
export function agendasLine(): string {
  const { groups, myRoles, loaded } = useGroups.getState();
  if (!loaded || !groups.length) return '';
  const me = useAuth.getState().user?.id;
  const list = groups.slice(0, 12).map(g => `« ${g.name} » (${g.kind === 'agenda' ? 'agenda partagé' : 'groupe'}${g.ownerId !== me && myRoles[g.id] === 'lecteur' ? ', lecteur seulement' : ''})`);
  return `Agendas partagés et groupes : ${list.join(', ')}. Son agenda perso s'appelle « perso ».`;
}

/** null: the personal calendar; a group; or an Error when the name matches none. */
export async function findAgenda(name: string): Promise<Group | null> {
  const q = normalize(name).replace(/^(?:l'|le |la |les |agenda |groupe |calendrier |equipe )+/, '').trim();
  if (PERSONAL.test(normalize(name).trim()) || PERSONAL.test(q)) return null;
  if (!cloudEnabled) throw new Error('les agendas partagés et les groupes demandent un compte en ligne : ici, seul son agenda perso existe');
  const groups = await myGroups();
  const found = groups.find(g => g.id === name) ?? groups.find(g => normalize(g.name) === q) ?? groups.find(g => normalize(g.name).includes(q) || q.includes(normalize(g.name)));
  if (!found) throw new Error(`aucun agenda partagé ni groupe nommé « ${name} » (les siens : ${groups.map(g => g.name).join(', ') || 'aucun'})`);
  return found;
}

const canWrite = (g: Group) => g.ownerId === useAuth.getState().user?.id || useGroups.getState().myRoles[g.id] !== 'lecteur';
const where = (g: Group | null) => (g ? `${g.kind === 'agenda' ? 'agenda partagé' : 'groupe'} « ${g.name} »` : 'agenda perso');

/** A shared event as the AI reads it back: what the members see. */
export function describeShared(e: GroupEvent, g: Group) {
  const time = e.start ? ` ${t('à {time}', { time: `${hourLabel(e.start)}${e.end ? `–${hourLabel(e.end)}` : ''}` })}` : '';
  return {
    id: e.id,
    titre: e.title,
    quand: `${fmtDay(fromKey(e.date), 'EEEE d MMM')}${time}`,
    date: e.date,
    agenda: where(g),
    ...(e.place && { lieu: e.place }),
    ...(e.category && { categorie: catOf(e.category as never).label }),
    rappels: e.reminders.length ? e.reminders.map(n => reminderLabel(n, !!e.start, e.date, e.start ?? undefined)) : 'aucun',
  };
}

/** Group events already listed (list_events with « agenda »): update_event and move_event find them by id. */
const seen = new Map<string, string>(); // event id → group id
export const groupOfEvent = (id: string) => seen.get(id) ?? Object.entries(useGroups.getState().events).find(([, list]) => list.some(e => e.id === id))?.[0];

async function eventsOf(g: Group, from: string): Promise<GroupEvent[]> {
  const list = (await api.fetchEvents(g.id, from)).events;
  for (const e of list) seen.set(e.id, g.id);
  return list;
}

export async function listShared(g: Group, input: { from?: string; to?: string; title?: string }) {
  const q = normalize(input.title ?? '');
  const from = validKey(input.from) ?? (q ? shiftKey(todayKey(), -366) : todayKey());
  const list = (await eventsOf(g, from)).filter(e => (!input.to || e.date <= input.to) && (!q || normalize(e.title).includes(q))).slice(0, 200);
  return list.length ? list.map(e => describeShared(e, g)) : { result: `aucun événement dans ${where(g)} pour ces dates` };
}

export interface SharedAdd {
  title: string;
  date: string;
  start?: string;
  end?: string;
  place?: string;
  category?: string;
  endDate?: string;
  repeat?: Repeat;
  until?: string;
}

/** Adds to a shared calendar or a group (one event, the days of one, or a repeat), read back as the server saved it. */
export async function addShared(g: Group, input: SharedAdd) {
  if (!canWrite(g)) throw new Error(`il est seulement lecteur dans ${where(g)} : il ne peut rien y ajouter`);
  const overnight = !input.endDate && !input.repeat && !!input.start && !!input.end && input.end < input.start;
  const endDate = overnight ? shiftKey(input.date, 1) : validKey(input.endDate);
  const category = input.category && (input.category in CATEGORIES || g.categories.some(c => c.id === input.category)) ? input.category : guessCategory(input.title, !!input.start, g.categories);
  const base = { title: input.title, place: input.place || null, category: g.kind === 'agenda' ? category : null, details: null, people: [], reminders: [] };
  let rows: NewGroupEvent[];
  if (endDate && endDate > input.date) {
    const series = newSeries(true);
    rows = spanDays(input.date, endDate, input.start, input.end).map(d => ({ ...base, date: d.date, start: d.start ?? null, end: d.end ?? null, series }));
  } else if (input.repeat) {
    const until = validKey(input.until) && input.until! >= input.date ? input.until! : defaultUntil(input.date, input.repeat);
    const days = repeatDays(input.date, input.repeat, until).days;
    const series = newSeries();
    rows = (days.length ? days : [input.date]).map(date => ({ ...base, date, start: input.start || null, end: input.start && input.end ? input.end : null, series }));
  } else rows = [{ ...base, date: input.date, start: input.start || null, end: input.start && input.end ? input.end : null }];
  let saved: GroupEvent[];
  try {
    saved = rows.length > 1 ? await api.createEvents(g.id, rows) : [await api.createEvent(g.id, rows[0])];
  } catch (e) {
    throw new Error(`pas enregistré dans ${where(g)} : ${api.groupError(e)}`);
  }
  if (!saved.length) throw new Error(`pas enregistré dans ${where(g)} : le serveur n'a rien renvoyé`);
  for (const e of saved) seen.set(e.id, g.id);
  void useGroups.getState().refresh(g.id, ['events']);
  const sorted = [...saved].sort((a, b) => a.date.localeCompare(b.date));
  return { first: sorted[0], count: sorted.length, last: sorted.at(-1)!.date };
}

/** Changes a shared event and reads it back. */
export async function updateShared(groupId: string, id: string, patch: Partial<NewGroupEvent>) {
  const g = (await myGroups()).find(x => x.id === groupId);
  if (!g) throw new Error('agenda partagé introuvable');
  if (!canWrite(g)) throw new Error(`il est seulement lecteur dans ${where(g)} : il ne peut rien y changer`);
  try {
    await api.updateEvent(id, patch);
  } catch (e) {
    throw new Error(`pas modifié : ${api.groupError(e)}`);
  }
  const back = (await eventsOf(g, shiftKey(todayKey(), -366))).find(e => e.id === id);
  if (!back) throw new Error('modifié, mais je ne le retrouve pas en le relisant');
  void useGroups.getState().refresh(g.id, ['events']);
  return describeShared(back, g);
}

/** move_event: from wherever the event is to the calendar named `to`. */
export async function moveTo(eventId: string, to: string, series: boolean) {
  const target = await findAgenda(to);
  const fromGroup = groupOfEvent(eventId);
  const from: AgendaRef = fromGroup ? { kind: 'group', groupId: fromGroup } : PERSO;
  const dest: AgendaRef = target ? { kind: 'group', groupId: target.id } : PERSO;
  if (target && !canWrite(target)) throw new Error(`il est seulement lecteur dans ${where(target)}`);
  const res = await moveEventToAgenda(eventId, from, dest, { series });
  const first = res.moved[0];
  for (const e of res.moved) if (target) seen.set(e.id, target.id);
  else seen.delete(e.id);
  return { first, count: res.moved.length, target };
}

/** A group's shared files. */
export async function groupFiles(name: string) {
  const g = await findAgenda(name);
  if (!g) throw new Error('donne le nom du groupe');
  const files = await api.fetchFiles(g.id);
  return { group: g, files };
}

/** The text of a group's shared file. */
export async function readGroupFile(name: string, fileId: string) {
  const { group, files } = await groupFiles(name);
  const f = files.find(x => x.id === fileId) ?? files.find(x => normalize(x.name) === normalize(fileId));
  if (!f) return { error: `fichier introuvable dans le groupe « ${group.name} » (voir list_group_files)` };
  const blob = await api.downloadFile(f);
  return { group, file: f, res: await blobText(blob, f.name, f.mime ?? '', MAX_FILE_CHARS) };
}

/** share_note_to_group: a copy of one of my notes in a group's notes. */
export async function shareNote(noteId: string, name: string) {
  const note = useNotes.getState().notes.find(n => n.id === noteId);
  if (!note) throw new Error('note introuvable (id exact : search_site)');
  const g = await findAgenda(name);
  if (!g) throw new Error('donne le nom du groupe');
  if (g.kind !== 'groupe') throw new Error('un agenda partagé n’a pas de notes : seulement les groupes');
  if (!canWrite(g)) throw new Error(`il est seulement lecteur dans ${where(g)}`);
  try {
    const shared = await api.createNote(g.id, note.title, note.content);
    void useGroups.getState().refresh(g.id, ['notes']);
    return { group: g, note: shared };
  } catch (e) {
    throw new Error(`pas partagée : ${api.groupError(e)}`);
  }
}
