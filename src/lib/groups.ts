import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { toast } from '../store/ui';
import { getSettings } from '../store/settings';
import { AGENDA_WORDS, groupWords } from './usage';
import { cleanPeriod, type Period } from './periods';

let space: GroupKind = 'groupe';
/** The screens in use (/groupes or /agendas): messages speak of « ce groupe » or « cet agenda ». */
export const setGroupSpace = (kind: GroupKind) => void (space = kind);
const words = () => (space === 'agenda' ? AGENDA_WORDS : groupWords(getSettings().usage));
import { QUOTA, StorageError, quotaLabel } from './blobStore';

// Groupes de travail : uniquement en ligne. Appels directs à Supabase (tables group_* et
// fonctions de supabase/migrations/2026-10-13_groupes.sql), indépendants de cloudSync.

export const GROUP_COLORS = ['#e8613c', '#3b6fd8', '#2f9e6b', '#7a5ad6', '#d48a17', '#1f8a8a'] as const;

export interface Group {
  id: string;
  name: string;
  color: string | null;
  /** Small square picture (data URL) shown instead of the initial; null: the initial on the colour. */
  photo: string | null;
  ownerId: string | null;
  createdAt: string;
  /** 'agenda' : an « agenda partagé » (own space, /agendas); 'groupe' : a work group (/groupes). */
  kind: GroupKind;
}
export type GroupKind = 'groupe' | 'agenda';

export interface GroupMember {
  userId: string;
  name: string;
  joinedAt: string;
  isOwner: boolean;
  role: GroupRole;
  canInvite: boolean;
}

/** Lecteur : lit tout, dit s'il vient. Éditeur : ajoute, modifie, supprime. Le propriétaire a tout. */
export type GroupRole = 'lecteur' | 'editeur';

export interface GroupFile {
  id: string;
  groupId: string;
  name: string;
  mime: string | null;
  size: number;
  createdBy: string | null;
  createdAt: string;
}

/** Taille maximale d'un fichier partagé (aussi imposée par le bucket « groups »). */
export const MAX_GROUP_FILE = 50 * 1024 * 1024;

export interface GroupNote {
  id: string;
  groupId: string;
  title: string;
  content: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Note dans la liste (sans son contenu, chargé à l'ouverture). */
export type GroupNoteSummary = Omit<GroupNote, 'content'>;

export interface GroupEvent {
  id: string;
  groupId: string;
  title: string;
  date: string; // YYYY-MM-DD
  start: string | null;
  end: string | null;
  place: string | null;
  /** Shared calendars: a built-in category (cours, examen…) and notes. */
  category: string | null;
  details: string | null;
  createdBy: string | null;
  createdAt: string;
  /** Shared calendars: the members it is about (« pour qui »); empty: everyone. */
  people: string[];
}

export interface Attendance {
  eventId: string;
  userId: string;
}

export type NewGroupEvent = Pick<GroupEvent, 'title' | 'date' | 'start' | 'end' | 'place'> & Partial<Pick<GroupEvent, 'category' | 'details' | 'people'>>;

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));

const toGroup = (r: Row): Group => ({
  id: String(r.id),
  name: String(r.name),
  color: s(r.color),
  photo: typeof r.photo === 'string' && r.photo.startsWith('data:image/') ? r.photo : null,
  ownerId: s(r.owner_id),
  createdAt: String(r.created_at),
  kind: r.kind === 'agenda' ? 'agenda' : 'groupe',
});

export const toNote = (r: Row): GroupNote => ({
  id: String(r.id),
  groupId: String(r.group_id),
  title: String(r.title ?? 'Sans titre'),
  content: String(r.content ?? ''),
  createdBy: s(r.created_by),
  updatedBy: s(r.updated_by),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export const toEvent = (r: Row): GroupEvent => ({
  id: String(r.id),
  groupId: String(r.group_id),
  title: String(r.title),
  date: String(r.date),
  start: s(r.start_time),
  end: s(r.end_time),
  place: s(r.place),
  category: s(r.category),
  details: s(r.details),
  createdBy: s(r.created_by),
  createdAt: String(r.created_at),
  people: Array.isArray(r.people) ? r.people.map(String) : [],
});

function db(): SupabaseClient {
  if (!supabase) throw new Error(`Les ${words().groups} nécessitent la version en ligne.`);
  return supabase;
}

/** A refusal the app words itself (« Seul le propriétaire… »): shown as it is. */
export class Refused extends Error {}

/** Message lisible pour une erreur Supabase / réseau. */
export function groupError(e: unknown): string {
  const w = words();
  if (e instanceof StorageError || e instanceof Refused) return e.message;
  const msg = String((e as { message?: string })?.message ?? e ?? '');
  if (/too many attempts/i.test(msg)) return 'Trop de codes essayés. Réessaie dans un quart d’heure.';
  if (/group full/i.test(msg)) return `Plus de place : 50 membres au maximum dans ${w.this}.`;
  if (/too many groups/i.test(msg)) return `Tu fais déjà partie de 30 ${w.groups}, c’est le maximum.`;
  if (/too large|exceeded the maximum|payload too large|413/i.test(msg)) return 'Fichier trop lourd : 50 Mo au maximum.';
  if (/photo/i.test(msg) && /column|schema cache/i.test(msg)) return 'Les photos ne sont pas encore activées sur le serveur (migration 2026-10-19 à lancer).';
  if (/group_periods|42P01|PGRST205/.test(msg)) return 'Les périodes ne sont pas encore activées sur le serveur (migration 2026-10-20 à lancer).';
  if (/too many periods/i.test(msg)) return 'Trop de périodes dans cet agenda (300 au maximum).';
  if (/mfa required/i.test(msg)) return 'Confirme d’abord ta connexion avec le code de ton téléphone.';
  if (/forbidden|row-level security|permission denied/i.test(msg)) return `Tu n’as pas le droit de faire ça dans ${w.this}.`;
  if (/fetch|network/i.test(msg)) return 'Pas de connexion. Réessaie dans un instant.';
  return 'Une erreur est survenue. Réessaie.';
}

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

/** The database silently skips rows it doesn't allow: say so instead of pretending it worked. */
function changed(res: { data: unknown; error: unknown }, refused: string) {
  const rows = check(res) as unknown[] | null;
  if (!rows || rows.length === 0) throw new Refused(refused);
}

/** The account actually signed in (the one the database sees), not the one a stale tab displays. */
export async function sessionUserId(): Promise<string> {
  const { data } = await db().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Ta session a expiré. Reconnecte-toi.');
  return id;
}

// ── Groupes et membres ────────────────────────────────────────────────────
export async function fetchGroups(): Promise<Group[]> {
  // Jamais « * » : le code d'invitation n'est pas lisible dans la table (voir group_invite_code).
  // Newest columns first; a server without a recent migration (no « photo », 2026-10-19; no « kind », 2026-10-18)
  // answers 42703 (no such column) or 42501 (column not readable yet) and the next, older list is tried.
  for (const cols of ['id, name, color, photo, owner_id, created_at, kind', 'id, name, color, owner_id, created_at, kind', 'id, name, color, owner_id, created_at']) {
    const res = await db().from('groups').select(cols).order('created_at');
    if (res.error?.code === '42703' || res.error?.code === '42501') continue;
    return (check(res) as unknown as Row[]).map(toGroup);
  }
  return [];
}

export async function createGroup(name: string, color: string | null, kind: GroupKind = 'groupe'): Promise<Group> {
  const row = check(await db().rpc('create_group', { p_name: name, p_color: color, ...(kind === 'agenda' && { p_kind: kind }) }));
  return toGroup(row as Row);
}

/** The link that makes someone join (after signing in): a group by its code, a shared calendar by its secret token. */
export const inviteLink = (secret: string, kind: GroupKind) =>
  kind === 'agenda' ? `${location.origin}/agendas?invitation=${secret}` : `${location.origin}/groupes?rejoindre=${secret}`;

export async function copyInviteLink(secret: string, kind: GroupKind) {
  const link = inviteLink(secret, kind);
  try {
    await navigator.clipboard.writeText(link);
    toast('Lien d’invitation copié : envoie-le à qui tu veux', 'success');
  } catch {
    toast(`Lien d’invitation : ${link}`);
  }
}

/** A shared calendar's link token (null: not allowed to invite). Never in the groups table's readable columns. */
export async function fetchAgendaToken(id: string): Promise<string | null> {
  const t = check(await db().rpc('agenda_invite_token', { p_group: id }));
  return typeof t === 'string' ? t : null;
}

export async function regenerateAgendaToken(id: string): Promise<string> {
  return String(check(await db().rpc('regenerate_agenda_token', { p_group: id })));
}

/** Joins a shared calendar from its link; null when the link no longer works. */
export async function joinAgenda(token: string): Promise<string | null> {
  const id = check(await db().rpc('join_agenda', { p_token: token }));
  return id ? String(id) : null;
}

/** Renvoie l'identifiant du groupe rejoint, ou null si le code n'existe pas. */
export async function joinGroup(code: string): Promise<string | null> {
  const id = check(await db().rpc('join_group', { p_code: code }));
  return id ? String(id) : null;
}

export async function updateGroup(id: string, patch: { name?: string; color?: string | null; photo?: string | null }) {
  changed(await db().from('groups').update(patch).eq('id', id).select('id'), `Seul le propriétaire peut modifier ${words().this}.`);
}

export async function deleteGroup(id: string) {
  // Le groupe d'abord : s'il reste (coupure, refus), ses fichiers restent aussi. Ensuite celui qui l'a supprimé
  // garde le droit d'effacer ses fichiers (table deleted_groups, migration 2026-10-18e).
  changed(await db().from('groups').delete().eq('id', id).select('id'), `Seul le propriétaire peut supprimer ${words().this}.`);
  await purgeFiles(id);
}

/** Le code d'invitation, ou null si l'on n'a pas le droit d'inviter. */
export async function fetchInviteCode(id: string): Promise<string | null> {
  const code = check(await db().rpc('group_invite_code', { p_group: id }));
  return code ? String(code) : null;
}

/** Droits d'un membre (propriétaire seulement). */
export async function setMemberRights(groupId: string, userId: string, role: GroupRole, canInvite: boolean) {
  check(await db().rpc('set_member_rights', { p_group: groupId, p_member: userId, p_role: role, p_can_invite: canInvite }));
}

export async function regenerateCode(id: string): Promise<string> {
  return String(check(await db().rpc('regenerate_group_code', { p_group: id })));
}

export async function fetchMembers(groupId: string): Promise<GroupMember[]> {
  const rows = check(await db().rpc('group_member_list', { p_group: groupId }));
  return ((rows ?? []) as Row[]).map(r => ({
    userId: String(r.user_id),
    name: String(r.name),
    joinedAt: String(r.joined_at),
    isOwner: r.is_owner === true,
    role: r.role === 'lecteur' ? 'lecteur' : 'editeur',
    canInvite: r.can_invite === true,
  }));
}

/** Retirer un membre (propriétaire seulement). */
export async function removeMember(groupId: string, userId: string) {
  changed(
    await db().from('group_members').delete().eq('group_id', groupId).eq('user_id', userId).select('user_id'),
    'Seul le propriétaire peut retirer un membre.',
  );
}

/** Quitter le groupe avec le compte réellement connecté (`last` : le groupe disparaîtra avec ses fichiers). */
export async function leaveGroup(groupId: string, last = false) {
  const me = await sessionUserId();
  changed(await db().from('group_members').delete().eq('group_id', groupId).eq('user_id', me).select('user_id'), `Tu ne fais plus partie de ${words().this}.`);
  if (last) await purgeFiles(groupId);
}

// ── Notes partagées ───────────────────────────────────────────────────────
export async function fetchNotes(groupId: string): Promise<GroupNoteSummary[]> {
  const rows = check(
    await db().from('group_notes').select('id, group_id, title, created_by, updated_by, created_at, updated_at').eq('group_id', groupId).order('updated_at', { ascending: false }),
  );
  return (rows as Row[]).map(r => summary(toNote(r)));
}

export function summary({ content: _c, ...rest }: GroupNote): GroupNoteSummary {
  return rest;
}

export async function fetchNote(id: string): Promise<GroupNote | null> {
  const row = check(await db().from('group_notes').select('*').eq('id', id).maybeSingle());
  return row ? toNote(row as Row) : null;
}

export async function createNote(groupId: string, title = 'Sans titre', content = ''): Promise<GroupNote> {
  const row = check(await db().from('group_notes').insert({ group_id: groupId, title, content }).select('*').single());
  return toNote(row as Row);
}

/**
 * Enregistre seulement si personne n'a modifié la note depuis `base` (date connue côté client).
 * Renvoie la note enregistrée, ou null si la version en ligne est plus récente (conflit).
 * Sans `base`, écrase quoi qu'il arrive (« garder ma version »).
 */
export async function saveNote(id: string, patch: { title?: string; content?: string }, base: string | null): Promise<GroupNote | null> {
  let q = db().from('group_notes').update(patch).eq('id', id);
  if (base) q = q.eq('updated_at', base);
  const rows = check(await q.select('*'));
  const row = (rows as Row[])[0];
  return row ? toNote(row) : null;
}

export async function deleteNote(id: string) {
  changed(await db().from('group_notes').delete().eq('id', id).select('id'), 'Cette note n’existe plus ou tu n’y as plus accès.');
}

// ── Révisions en commun ───────────────────────────────────────────────────
export async function fetchEvents(groupId: string, fromDate: string): Promise<{ events: GroupEvent[]; attendance: Attendance[] }> {
  const [ev, at] = await Promise.all([
    db().from('group_events').select('*').eq('group_id', groupId).gte('date', fromDate).order('date').order('start_time', { nullsFirst: true }),
    db().from('group_event_attendees').select('event_id, user_id').eq('group_id', groupId),
  ]);
  return {
    events: (check(ev) as Row[]).map(toEvent),
    attendance: (check(at) as Row[]).map(r => ({ eventId: String(r.event_id), userId: String(r.user_id) })),
  };
}

/** « Pour qui » needs the column of migration 2026-10-24: without it, a clear message rather than the server's. */
const PEOPLE_MISSING = 'Choisir pour qui est un événement demande une mise à jour du serveur (migration 2026-10-24). En attendant, laisse « Tout le monde ».';
const noPeopleColumn = (e: { code?: string; message?: string } | null) => e?.code === 'PGRST204' && /people/.test(e.message ?? '');

export async function createEvent(groupId: string, e: NewGroupEvent): Promise<GroupEvent> {
  const res = await db()
    .from('group_events')
    // « people » only when chosen: a server without the column still takes the others.
    .insert({ group_id: groupId, title: e.title, date: e.date, start_time: e.start, end_time: e.end, place: e.place, ...(e.category !== undefined && { category: e.category }), ...(e.details !== undefined && { details: e.details }), ...(e.people?.length && { people: e.people }) })
    .select('*')
    .single();
  if (noPeopleColumn(res.error)) throw new Refused(PEOPLE_MISSING);
  return toEvent(check(res) as Row);
}

/** Shared calendars: any editor changes any event (the database checks it). */
// ── Périodes d'un agenda partagé (« En entreprise », « Vacances »…) ─────────────
const toPeriod = (r: Row): Period | null => cleanPeriod({ id: String(r.id), title: r.title, start: r.start_date, end: r.end_date, color: r.color, people: r.people, skip: r.skip });

/** A shared calendar's periods; none on a server without the table yet (migration 2026-10-20). */
export async function fetchPeriods(groupId: string): Promise<Period[]> {
  const read = (cols: string) => db().from('group_periods').select(cols).eq('group_id', groupId).order('start_date');
  let res = await read('id, title, start_date, end_date, color, people, skip');
  // Table made before the skipped days (migration 2026-10-23), or before « pour qui »: the periods without them.
  if (res.error?.code === '42703') res = await read('id, title, start_date, end_date, color, people');
  if (res.error?.code === '42703') res = await read('id, title, start_date, end_date, color');
  if (res.error && /group_periods|42P01|PGRST205/.test(`${res.error.code} ${res.error.message}`)) return [];
  return (check(res) as unknown as Row[]).map(toPeriod).filter((p): p is Period => !!p);
}

/** Adds or changes periods (several at once: a repeated one). */
export async function savePeriods(groupId: string, list: Period[]) {
  const rows = list.map(p => ({ id: p.id, group_id: groupId, title: p.title, start_date: p.start, end_date: p.end, color: p.color, people: p.people ?? [], skip: p.skip ?? [] }));
  let res = await db().from('group_periods').upsert(rows);
  // Table made before the skipped days: a period in one piece is saved without them; one in pieces can't be.
  if (res.error?.code === 'PGRST204' && /skip/.test(res.error.message)) {
    if (list.some(p => p.skip?.length)) throw new Refused('Une période en plusieurs morceaux demande une mise à jour du serveur (migration 2026-10-23). En attendant, choisis des jours qui se suivent.');
    res = await db().from('group_periods').upsert(rows.map(({ skip: _s, ...r }) => r));
  }
  // Table made before « pour qui »: saved for everyone rather than refused.
  if (res.error?.code === 'PGRST204' && /people/.test(res.error.message)) res = await db().from('group_periods').upsert(rows.map(({ people: _p, skip: _s, ...r }) => r));
  check(res);
}

export async function deletePeriod(id: string) {
  changed(await db().from('group_periods').delete().eq('id', id).select('id'), 'Tu n’as pas le droit de modifier les périodes de cet agenda.');
}

export async function updateEvent(id: string, patch: Partial<NewGroupEvent>) {
  const row: Row = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.date !== undefined) row.date = patch.date;
  if (patch.start !== undefined) row.start_time = patch.start;
  if (patch.end !== undefined) row.end_time = patch.end;
  if (patch.place !== undefined) row.place = patch.place;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.details !== undefined) row.details = patch.details;
  if (patch.people !== undefined) row.people = patch.people;
  let res = await db().from('group_events').update(row).eq('id', id).select('id');
  if (noPeopleColumn(res.error)) {
    if (patch.people?.length) throw new Refused(PEOPLE_MISSING);
    delete row.people;
    res = await db().from('group_events').update(row).eq('id', id).select('id');
  }
  changed(res, 'Tu peux seulement consulter cet agenda.');
}

export async function deleteEvent(id: string) {
  changed(await db().from('group_events').delete().eq('id', id).select('id'), 'Seul l’auteur de la séance ou le propriétaire peut l’annuler.');
}

export async function setAttendance(groupId: string, eventId: string, coming: boolean) {
  const me = await sessionUserId();
  if (coming) check(await db().from('group_event_attendees').upsert({ group_id: groupId, event_id: eventId, user_id: me }, { ignoreDuplicates: true }));
  else check(await db().from('group_event_attendees').delete().eq('event_id', eventId).eq('user_id', me));
}

export async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    toast('Code copié', 'success');
  } catch {
    toast(`Code d’invitation : ${code}`);
  }
}

// ── Fichiers partagés (table group_files + bucket privé « groups », objets en <groupe>/<fichier>) ─
const FILES = 'groups';
const filePath = (f: Pick<GroupFile, 'groupId' | 'id'>) => `${f.groupId}/${f.id}`;

const toFile = (r: Row): GroupFile => ({
  id: String(r.id),
  groupId: String(r.group_id),
  name: String(r.name),
  mime: s(r.mime),
  size: Number(r.size ?? 0),
  createdBy: s(r.created_by),
  createdAt: String(r.created_at),
});

export async function fetchFiles(groupId: string): Promise<GroupFile[]> {
  const rows = check(await db().from('group_files').select('*').eq('group_id', groupId).order('created_at', { ascending: false }));
  return (rows as Row[]).map(toFile);
}

/** Envoie le contenu puis enregistre le fichier ; rien ne reste à moitié si l'une des deux étapes est refusée. */
export async function uploadFile(groupId: string, blob: Blob, name: string): Promise<GroupFile> {
  if (blob.size > MAX_GROUP_FILE) throw new Error('file too large');
  // Group files count in the uploader's quota, like their Drive (the storage policy checks it too:
  // asking first gives a clear message instead of a « not allowed »).
  if (QUOTA) {
    const used = await db().rpc('storage_used');
    if (!used.error && Number(used.data) + blob.size > QUOTA) throw new StorageError(`Plus de place : ton espace en ligne (${quotaLabel()}) est plein. Vide la corbeille de ton Drive ou supprime des fichiers.`);
  }
  const id = crypto.randomUUID();
  const path = filePath({ groupId, id });
  const mime = blob.type || 'application/octet-stream';
  const up = await db().storage.from(FILES).upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  try {
    const row = check(
      await db().from('group_files').insert({ id, group_id: groupId, name: name.trim().slice(0, 255) || 'Fichier', mime: mime.slice(0, 200), size: blob.size }).select('*').single(),
    );
    return toFile(row as Row);
  } catch (e) {
    await db().storage.from(FILES).remove([path]);
    throw e;
  }
}

export async function downloadFile(f: GroupFile): Promise<Blob> {
  const { data, error } = await db().storage.from(FILES).download(filePath(f));
  if (error || !data) throw error ?? new Error('introuvable');
  return data;
}

export async function deleteFile(f: GroupFile) {
  changed(await db().from('group_files').delete().eq('id', f.id).select('id'), `Tu ne peux pas supprimer de fichier dans ${words().this}.`);
  await db().storage.from(FILES).remove([filePath(f)]);
}

/** Avant la disparition d'un groupe : retire ses fichiers du stockage (la table suit en cascade). */
/** Efface les fichiers d'un groupe supprimé, puis l'oublie ; une coupure : on recommence à la prochaine ouverture. */
async function purgeFiles(groupId: string) {
  try {
    for (;;) {
      const { data } = await db().storage.from(FILES).list(groupId, { limit: 1000 });
      if (!data?.length) break;
      const { error } = await db().storage.from(FILES).remove(data.map(o => `${groupId}/${o.name}`));
      if (error) return;
    }
    await db().from('deleted_groups').delete().eq('id', groupId);
  } catch {
    // Au pire, des fichiers orphelins que plus personne ne peut lire.
  }
}

let leftoversDone = false;
/** Les fichiers de groupes supprimés pendant une coupure : effacés une fois par visite. */
export async function purgeDeletedGroups() {
  if (leftoversDone || !supabase) return;
  leftoversDone = true;
  const { data, error } = await db().from('deleted_groups').select('id');
  if (error) return; // sans la migration 2026-10-18e
  for (const r of (data ?? []) as Row[]) await purgeFiles(String(r.id));
}

/** Suppression du compte : les groupes dont on est le dernier membre disparaissent avec nous, fichiers d'abord. */
export async function purgeSoleGroups() {
  const me = await sessionUserId();
  const rows = check(await db().from('group_members').select('group_id, user_id')) as Row[];
  const count = new Map<string, number>();
  for (const r of rows) count.set(String(r.group_id), (count.get(String(r.group_id)) ?? 0) + 1);
  for (const r of rows) if (r.user_id === me && count.get(String(r.group_id)) === 1) await purgeFiles(String(r.group_id));
}
