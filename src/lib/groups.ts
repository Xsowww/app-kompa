import type { SupabaseClient } from '@supabase/supabase-js';
import { accessToken, supabase } from './supabase';
import { toast } from '../store/ui';
import { getSettings } from '../store/settings';
import { AGENDA_WORDS, groupWords } from './usage';
import { cleanPeriod, type Period } from './periods';
import { knowSharedCategories, type CustomCategory } from '../store/calendar';

let space: GroupKind = 'groupe';
/** The screens in use (/groupes or /agendas): messages speak of « ce groupe » or « cet agenda ». */
export const setGroupSpace = (kind: GroupKind) => void (space = kind);
const words = () => (space === 'agenda' ? AGENDA_WORDS : groupWords(getSettings().usage));
import { QUOTA, quotaError, StorageError } from './blobStore';
import { abandonUpload, storageUpload } from './storageUpload';
import { useInvite } from '../store/invite';
import { MAX_INVITE_EMAILS } from './groupInvite';
import { lang, t } from '../i18n';

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
  /** Shared calendars: their own categories, for every member (migration 2026-10-27). */
  categories: CustomCategory[];
  /** Rights given to whoever joins (owner's choice, migration 2026-11-03; before it: editor who may invite). */
  defaultRole: GroupRole;
  defaultCanInvite: boolean;
}
export type GroupKind = 'groupe' | 'agenda';

export interface GroupMember {
  userId: string;
  name: string;
  joinedAt: string;
  isOwner: boolean;
  role: GroupRole;
  canInvite: boolean;
  /** Their profile's picture (small data URL) or colour (migration 2026-11-03; before it: none, a colour from their id). */
  photo?: string | null;
  color?: string | null;
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
  /** Shared calendars: reminders in minutes before the start, sent to each member it is for (migration 2026-10-27). */
  reminders: number[];
  /** Shared calendars: same id on every occurrence of an event that repeats or lasts several days (migration 2026-10-31). */
  series: string | null;
  /** Who last changed what the members see, and when (set by the database, migration 2026-11-03; before it: null). */
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface Attendance {
  eventId: string;
  userId: string;
}

export type NewGroupEvent = Pick<GroupEvent, 'title' | 'date' | 'start' | 'end' | 'place'> & Partial<Pick<GroupEvent, 'category' | 'details' | 'people' | 'reminders' | 'series'>>;

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));

/** A shared calendar's categories as saved (anything else dropped). */
function toCategories(v: unknown): CustomCategory[] {
  if (!Array.isArray(v)) return [];
  const list = v.filter((c): c is CustomCategory => !!c && /^c-[a-z0-9-]{1,20}$/.test(c.id) && typeof c.label === 'string' && !!c.label && /^#[0-9a-f]{6}$/i.test(c.color));
  knowSharedCategories(list);
  return list;
}

const toGroup = (r: Row): Group => ({
  categories: toCategories(r.categories),
  id: String(r.id),
  name: String(r.name),
  color: s(r.color),
  photo: typeof r.photo === 'string' && r.photo.startsWith('data:image/') ? r.photo : null,
  ownerId: s(r.owner_id),
  createdAt: String(r.created_at),
  kind: r.kind === 'agenda' ? 'agenda' : 'groupe',
  defaultRole: r.default_role === 'lecteur' ? 'lecteur' : 'editeur',
  defaultCanInvite: r.default_can_invite !== false,
});

export const toNote = (r: Row): GroupNote => ({
  id: String(r.id),
  groupId: String(r.group_id),
  title: String(r.title ?? t('Sans titre')),
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
  reminders: Array.isArray(r.reminders) ? r.reminders.map(Number).filter(n => Number.isInteger(n) && n >= 0) : [],
  series: s(r.series),
  updatedBy: s(r.updated_by),
  updatedAt: s(r.updated_at),
});

function db(): SupabaseClient {
  if (!supabase) throw new Error(t('Les {groups} nécessitent la version en ligne.', { groups: words().groups }));
  return supabase;
}

/** A refusal the app words itself (« Seul le propriétaire… »): shown as it is. */
export class Refused extends Error {}

/** In a shared calendar, the words for an event the database refuses to change (made reader meanwhile). */
export const READ_ONLY_AGENDA = t('Tu peux seulement consulter cet agenda.');

/** The database refused for lack of rights (made reader meanwhile…): « Réessayer » would change nothing. */
export const refusedRights = (e: unknown) =>
  (e instanceof Refused && e.message === READ_ONLY_AGENDA) || /forbidden|row-level security|permission denied/i.test(String((e as { message?: string })?.message ?? ''));

/** Message lisible pour une erreur Supabase / réseau. */
export function groupError(e: unknown): string {
  const w = words();
  if (e instanceof StorageError || e instanceof Refused) return e.message;
  const msg = String((e as { message?: string })?.message ?? e ?? '');
  if (/too many attempts/i.test(msg)) return t('Trop de codes essayés. Réessaie dans un quart d’heure.');
  if (/group full/i.test(msg)) return t('Plus de place : 50 membres au maximum dans {group}.', { group: w.this });
  // The 30 count groups and shared calendars together (create_group, join_group, join_agenda).
  if (/too many groups/i.test(msg)) return t('Tu fais déjà partie de 30 {groups} et agendas partagés en tout, c’est le maximum.', { groups: groupWords(getSettings().usage).groups });
  if (/too many comments/i.test(msg)) return t('Trop de commentaires d’un coup. Réessaie dans une minute.');
  if (/group_notes_content_check/.test(msg)) return t('Note trop lourde pour être partagée (ses images comptent) : retire une image ou coupe-la en deux notes.');
  if (/not a member/i.test(msg)) return t('Cette personne ne fait plus partie de {group}.', { group: w.this });
  if (/too large|exceeded the maximum|payload too large|413/i.test(msg)) return t('Fichier trop lourd : 50 Mo au maximum.');
  if (/photo/i.test(msg) && /column|schema cache/i.test(msg)) return t('Les photos de groupe ne sont pas encore disponibles.');
  if (/group_periods|42P01|PGRST205/.test(msg)) return t('Les périodes ne sont pas encore disponibles ici.');
  if (/group_events_category_check|group_events_reminders_check/.test(msg)) return AGENDA_MISSING;
  if (/too many periods/i.test(msg)) return t('Trop de périodes dans cet agenda (300 au maximum).');
  if (/mfa required/i.test(msg)) return t('Confirme d’abord ta connexion avec le code de ton téléphone.');
  if (/forbidden|row-level security|permission denied/i.test(msg)) return t('Tu n’as pas le droit de faire ça dans {group}.', { group: w.this });
  if (/fetch|network/i.test(msg)) return t('Pas de connexion. Réessaie dans un instant.');
  return t('Une erreur est survenue. Réessaie.');
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

/**
 * Events: no row changed either when they are gone (another member deleted them) or when I may only read them.
 * Read again to say which. Gone and `removing`: what was asked is done.
 */
async function eventsChanged(res: { data: unknown; error: unknown }, ids: string[], removing = false) {
  const rows = check(res) as unknown[] | null;
  if (rows?.length) return;
  const left = check(await db().from('group_events').select('id').in('id', ids)) as unknown[] | null;
  if (!left?.length) {
    if (removing) return;
    throw new Refused(t('Cet événement a été supprimé par un autre membre.'));
  }
  throw new Refused(space === 'agenda' ? READ_ONLY_AGENDA : t('Seul l’auteur ou le propriétaire peut le faire.'));
}

/** The account actually signed in (the one the database sees), not the one a stale tab displays. */
export async function sessionUserId(): Promise<string> {
  const { data } = await db().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error(t('Ta session a expiré. Reconnecte-toi.'));
  return id;
}

// ── Groupes et membres ────────────────────────────────────────────────────
export async function fetchGroups(): Promise<Group[]> {
  // Jamais « * » : le code d'invitation n'est pas lisible dans la table (voir group_invite_code).
  // Newest columns first; a server without a recent migration (no « categories », 2026-10-27; no « photo », 2026-10-19;
  // no « kind », 2026-10-18) answers 42703 (no such column) or 42501 (column not readable yet) and the next, older list is tried.
  // (« default_role, default_can_invite »: 2026-11-03.)
  for (const cols of ['id, name, color, photo, owner_id, created_at, kind, categories, default_role, default_can_invite', 'id, name, color, photo, owner_id, created_at, kind, categories', 'id, name, color, photo, owner_id, created_at, kind', 'id, name, color, owner_id, created_at, kind', 'id, name, color, owner_id, created_at']) {
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

/**
 * Invites someone: a group by its link (/groupes?rejoindre=CODE) and code, a shared calendar by its link (its secret
 * token), joined after signing in. On a phone, the system's share sheet (Messages, WhatsApp…); else, or when it is
 * refused, the ready-to-send message is copied.
 */
/** « Inviter »: the window with the link to copy or send (pages/groups/InviteDialog), not a toast cut short. */
export async function shareInvite(g: Pick<Group, 'id' | 'kind' | 'name'>, secret: string) {
  useInvite.setState({ invite: { id: g.id, kind: g.kind, name: g.name, secret } });
}

/**
 * « Inviter par e-mail »: Kompaly's server sends the invitation itself (server/invite.mjs), with this group's link, in
 * my language. It checks my right to invite with my own session; it never says whether an address has an account.
 * Resolves to the number sent; throws an Error whose message is said to the person.
 */
export async function sendInviteEmails(g: { id: string; kind: GroupKind }, emails: string[]): Promise<number> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch('/api/invitation/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ group: g.id, kind: g.kind, emails, lang }),
    });
  } catch {
    throw new Error(t('Pas de connexion : l’invitation n’est pas partie. Réessaie, ou envoie le lien.'));
  }
  const data = (await res.json().catch(() => ({}))) as { sent?: number; error?: string; invalid?: string[] };
  if (res.ok) return data.sent ?? emails.length;
  throw new Error(
    data.error === 'bad_email'
      ? t('Adresse à vérifier : {list}', { list: (data.invalid ?? []).join(', ') })
      : data.error === 'too_many'
        ? t('{n} adresses au plus à la fois.', { n: MAX_INVITE_EMAILS })
        : data.error === 'forbidden'
          ? t('Seuls le créateur et les membres autorisés peuvent inviter.')
          : data.error === 'rate_limited' || data.error === 'daily_limit'
            ? t('Beaucoup d’invitations d’un coup : réessaie plus tard, ou envoie le lien.')
            : data.error === 'disabled'
              ? t('L’envoi par e-mail n’est pas disponible pour le moment : envoie le lien.')
              : t('L’invitation n’est pas partie. Réessaie, ou envoie le lien.'),
  );
}

/** A shared calendar's link token (null: not allowed to invite). Never in the groups table's readable columns. */
export async function fetchAgendaToken(id: string): Promise<string | null> {
  const token = check(await db().rpc('agenda_invite_token', { p_group: id }));
  return typeof token === 'string' ? token : null;
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

export async function updateGroup(id: string, patch: { name?: string; color?: string | null; photo?: string | null; defaultRole?: GroupRole; defaultCanInvite?: boolean }) {
  const { defaultRole, defaultCanInvite, ...row } = patch;
  const res = await db()
    .from('groups')
    .update({ ...row, ...(defaultRole !== undefined && { default_role: defaultRole }), ...(defaultCanInvite !== undefined && { default_can_invite: defaultCanInvite }) })
    .eq('id', id)
    .select('id');
  // Rights of newcomers need migration 2026-11-03 (no such column, or not allowed to change it yet).
  if ((defaultRole !== undefined || defaultCanInvite !== undefined) && /default_(role|can_invite)/.test(`${res.error?.message}`)) throw new Refused(t('Le rôle des nouveaux membres n’est pas encore disponible.'));
  changed(res, t('Seul le propriétaire peut modifier {group}.', { group: words().this }));
}

/** Groups I left or deleted myself: their disappearance from the list isn't news (store/groups says the others). */
export const goneByMe = new Set<string>();

export async function deleteGroup(id: string) {
  // Le groupe d'abord : s'il reste (coupure, refus), ses fichiers restent aussi. Ensuite celui qui l'a supprimé
  // garde le droit d'effacer ses fichiers (table deleted_groups, migration 2026-10-18e).
  goneByMe.add(id);
  changed(await db().from('groups').delete().eq('id', id).select('id'), t('Seul le propriétaire peut supprimer {group}.', { group: words().this }));
  await purgeFiles(id);
}

/**
 * Makes another member the owner (the former one stays, as an editor who may invite). False on a server without
 * migration 2026-11-03: nothing changed (leaving then hands it to the oldest member, as before).
 */
export async function transferGroup(groupId: string, userId: string): Promise<boolean> {
  const res = await db().rpc('transfer_group', { p_group: groupId, p_member: userId });
  if (res.error?.code === 'PGRST202') return false;
  check(res);
  return true;
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
    photo: typeof r.avatar_image === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(r.avatar_image) ? r.avatar_image : null,
    color: typeof r.avatar_color === 'string' && /^#[0-9a-f]{6}$/i.test(r.avatar_color) ? r.avatar_color : null,
  }));
}

/** My role in each of my groups (the list beside them, the rights before their members are read). */
export async function fetchMyRoles(): Promise<Record<string, GroupRole>> {
  const me = await sessionUserId();
  const res = await db().from('group_members').select('group_id, role').eq('user_id', me);
  if (res.error) return {}; // a server without roles (2026-10-13c): « Membre », as before
  return Object.fromEntries((res.data as Row[]).map(r => [String(r.group_id), r.role === 'lecteur' ? 'lecteur' : 'editeur']));
}

/** Retirer un membre (propriétaire seulement). */
export async function removeMember(groupId: string, userId: string) {
  changed(
    await db().from('group_members').delete().eq('group_id', groupId).eq('user_id', userId).select('user_id'),
    t('Seul le propriétaire peut retirer un membre.'),
  );
}

/** Quitter le groupe avec le compte réellement connecté (`last` : le groupe disparaîtra avec ses fichiers). */
export async function leaveGroup(groupId: string, last = false) {
  const me = await sessionUserId();
  goneByMe.add(groupId);
  changed(await db().from('group_members').delete().eq('group_id', groupId).eq('user_id', me).select('user_id'), t('Tu ne fais plus partie de {group}.', { group: words().this }));
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

export async function createNote(groupId: string, title = t('Sans titre'), content = ''): Promise<GroupNote> {
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
  changed(await db().from('group_notes').delete().eq('id', id).select('id'), t('Cette note n’existe plus ou tu n’y as plus accès.'));
}

// ── Commentaires des notes partagées, avec @mention (migration 2026-11-03) ────────
export interface NoteComment {
  id: string;
  noteId: string;
  body: string;
  /** The members named with « @ » (they get a notification). */
  mentions: string[];
  createdBy: string | null;
  createdAt: string;
}

const COMMENT_COLS = 'id, note_id, body, mentions, created_by, created_at';
export const toComment = (r: Row): NoteComment => ({
  id: String(r.id),
  noteId: String(r.note_id),
  body: String(r.body ?? ''),
  mentions: Array.isArray(r.mentions) ? r.mentions.map(String) : [],
  createdBy: s(r.created_by),
  createdAt: String(r.created_at),
});

/** A note's comments, oldest first; null on a server without them yet (the section isn't shown). */
export async function fetchComments(noteId: string): Promise<NoteComment[] | null> {
  const res = await db().from('group_note_comments').select(COMMENT_COLS).eq('note_id', noteId).order('created_at');
  if (res.error && /group_note_comments|42P01|PGRST205/.test(`${res.error.code} ${res.error.message}`)) return null;
  return (check(res) as Row[]).map(toComment);
}

export async function addComment(note: Pick<GroupNote, 'id' | 'groupId'>, body: string, mentions: string[]): Promise<NoteComment> {
  const row = check(await db().from('group_note_comments').insert({ note_id: note.id, group_id: note.groupId, body: body.trim().slice(0, 2000), mentions: mentions.slice(0, 20) }).select(COMMENT_COLS).single());
  return toComment(row as Row);
}

export async function deleteComment(id: string) {
  changed(await db().from('group_note_comments').delete().eq('id', id).select('id'), t('Seul son auteur ou le propriétaire peut supprimer ce commentaire.'));
}

let finitions: Promise<boolean> | null = null;
/** Migration 2026-11-03 applied (reminders of a group's meetings…): asked once per visit (again after a network failure). */
export function finitionsReady(): Promise<boolean> {
  finitions ??= (async () => {
    const { error } = await db().from('group_events').select('updated_at').limit(1);
    if (error && error.code !== '42703') finitions = null;
    return !error;
  })().catch(() => ((finitions = null), false));
  return finitions;
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
const PEOPLE_MISSING = t('Choisir pour qui est un événement n’est pas encore disponible. En attendant, laisse « Tout le monde ».');
const noPeopleColumn = (e: { code?: string; message?: string } | null) => e?.code === 'PGRST204' && /people/.test(e.message ?? '');
/** Reminders and own categories need migration 2026-10-27. */
const AGENDA_MISSING = t('Les rappels et les catégories des agendas partagés ne sont pas encore disponibles.');
const noRemindersColumn = (e: { code?: string; message?: string } | null) => e?.code === 'PGRST204' && /reminders/.test(e.message ?? '');

/** A shared calendar's categories, for all its members (editors only: the database checks it). */
export async function setAgendaCategories(groupId: string, list: CustomCategory[]): Promise<CustomCategory[]> {
  const res = await db().rpc('set_agenda_categories', { p_group: groupId, p_list: list.map(({ id, label, color }) => ({ id, label, color })) });
  if (res.error?.code === 'PGRST202') throw new Refused(AGENDA_MISSING); // no such function yet
  return toCategories(check(res));
}

export async function createEvent(groupId: string, e: NewGroupEvent): Promise<GroupEvent> {
  const res = await db()
    .from('group_events')
    // « people » and « reminders » only when chosen: a server without the columns still takes the others.
    .insert({ group_id: groupId, title: e.title, date: e.date, start_time: e.start, end_time: e.end, place: e.place, ...(e.category !== undefined && { category: e.category }), ...(e.details !== undefined && { details: e.details }), ...(e.people?.length && { people: e.people }), ...(e.reminders?.length && { reminders: e.reminders }) })
    .select('*')
    .single();
  if (noPeopleColumn(res.error)) throw new Refused(PEOPLE_MISSING);
  if (noRemindersColumn(res.error)) throw new Refused(AGENDA_MISSING);
  return toEvent(check(res) as Row);
}

/** Repeats and events over several days need migration 2026-10-31. */
const SERIES_MISSING = t('Répéter un événement ou le faire durer plusieurs jours n’est pas encore disponible dans les agendas partagés.');
const noSeriesColumn = (e: { code?: string; message?: string } | null) => e?.code === 'PGRST204' && /series/.test(e.message ?? '');

/** Several events at once (a repeat, the days of an event): one request, one « Ajouté » for the others. Returns them as saved. */
export async function createEvents(groupId: string, list: NewGroupEvent[]): Promise<GroupEvent[]> {
  const rows = list.map(e => ({ group_id: groupId, title: e.title, date: e.date, start_time: e.start, end_time: e.end, place: e.place, category: e.category ?? null, details: e.details ?? null, ...(e.people?.length && { people: e.people }), ...(e.reminders?.length && { reminders: e.reminders }), series: e.series ?? null }));
  const res = await db().from('group_events').insert(rows).select('*');
  if (noSeriesColumn(res.error)) throw new Refused(SERIES_MISSING);
  if (noPeopleColumn(res.error)) throw new Refused(PEOPLE_MISSING);
  if (noRemindersColumn(res.error)) throw new Refused(AGENDA_MISSING);
  return ((check(res) as Row[] | null) ?? []).map(toEvent);
}

/** Deletes several events (« this one and the next ones »). */
export async function deleteEvents(ids: string[]) {
  await eventsChanged(await db().from('group_events').delete().in('id', ids).select('id'), ids, true);
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
    if (list.some(p => p.skip?.length)) throw new Refused(t('Une période en plusieurs morceaux n’est pas encore disponible. En attendant, choisis des jours qui se suivent.'));
    res = await db().from('group_periods').upsert(rows.map(({ skip: _s, ...r }) => r));
  }
  // Table made before « pour qui »: saved for everyone rather than refused.
  if (res.error?.code === 'PGRST204' && /people/.test(res.error.message)) res = await db().from('group_periods').upsert(rows.map(({ people: _p, skip: _s, ...r }) => r));
  check(res);
}

export async function deletePeriod(id: string) {
  changed(await db().from('group_periods').delete().eq('id', id).select('id'), t('Tu n’as pas le droit de modifier les périodes de cet agenda.'));
}

export async function updateEvent(id: string, patch: Partial<NewGroupEvent>) {
  return updateEvents([id], patch);
}

/** The same change on several events (« this one and the next ones »): one request. */
export async function updateEvents(ids: string[], patch: Partial<NewGroupEvent>) {
  const row: Row = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.date !== undefined) row.date = patch.date;
  if (patch.start !== undefined) row.start_time = patch.start;
  if (patch.end !== undefined) row.end_time = patch.end;
  if (patch.place !== undefined) row.place = patch.place;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.details !== undefined) row.details = patch.details;
  if (patch.people !== undefined) row.people = patch.people;
  if (patch.reminders !== undefined) row.reminders = patch.reminders;
  const send = () => db().from('group_events').update(row).in('id', ids).select('id');
  let res = await send();
  // A server without the newer columns: saved without them when they are empty, else said clearly.
  for (const [col, missing, msg] of [['people', noPeopleColumn, PEOPLE_MISSING], ['reminders', noRemindersColumn, AGENDA_MISSING]] as const) {
    if (!missing(res.error)) continue;
    if ((row[col] as unknown[] | undefined)?.length) throw new Refused(msg);
    delete row[col];
    res = await send();
  }
  await eventsChanged(res, ids);
}

export async function deleteEvent(id: string) {
  await eventsChanged(await db().from('group_events').delete().eq('id', id).select('id'), [id], true);
}

export async function setAttendance(groupId: string, eventId: string, coming: boolean) {
  const me = await sessionUserId();
  if (coming) check(await db().from('group_event_attendees').upsert({ group_id: groupId, event_id: eventId, user_id: me }, { ignoreDuplicates: true }));
  else check(await db().from('group_event_attendees').delete().eq('event_id', eventId).eq('user_id', me));
}

export async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    toast(t('Code copié'), 'success');
  } catch {
    toast(t('Code d’invitation : {code}', { code }));
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

/**
 * Envoie le contenu puis enregistre le fichier ; rien ne reste à moitié si l'une des deux étapes est refusée.
 * `signal` (pause ou annulation, store/uploads) : arrête l'envoi avec une AbortError, sans rien enregistrer.
 */
/**
 * `id`: the file's, given by the caller so that each attempt of one file (after a pause) has the same path: over
 * 6 Mo, the sending goes on from where it was (storageUpload). abandonFile() once it is cancelled.
 */
export async function uploadFile(groupId: string, blob: Blob, name: string, onProgress?: (loaded: number) => void, signal?: AbortSignal, id: string = crypto.randomUUID()): Promise<GroupFile> {
  if (blob.size > MAX_GROUP_FILE) throw new Error('file too large');
  // Group files count in the uploader's quota, like their Drive (the storage policy checks it too:
  // asking first gives a clear message instead of a « not allowed »).
  if (QUOTA) {
    const used = await db().rpc('storage_used');
    if (!used.error && Number(used.data) + blob.size > QUOTA) throw quotaError(Number(used.data));
  }
  const path = filePath({ groupId, id });
  const mime = blob.type || 'application/octet-stream';
  // As supabase-js's upload, with progress (the multipart part carries the file's own type).
  const up = await storageUpload(FILES, path, blob, { upsert: false }, onProgress, signal);
  if (up.error) throw up.error;
  // Stopped just as the content arrived: no file in the group.
  if (signal?.aborted) {
    await db().storage.from(FILES).remove([path]);
    throw Object.assign(new Error('Upload aborted'), { name: 'AbortError' });
  }
  try {
    const row = check(
      await db().from('group_files').insert({ id, group_id: groupId, name: name.trim().slice(0, 255) || t('Fichier'), mime: mime.slice(0, 200), size: blob.size }).select('*').single(),
    );
    return toFile(row as Row);
  } catch (e) {
    await db().storage.from(FILES).remove([path]);
    throw e;
  }
}

/** An upload cancelled before its file was in the group: what the server kept of it is dropped. */
export const abandonFile = (groupId: string, id: string) => abandonUpload(FILES, filePath({ groupId, id }));

export async function downloadFile(f: GroupFile): Promise<Blob> {
  const { data, error } = await db().storage.from(FILES).download(filePath(f));
  if (error || !data) throw error ?? new Error('introuvable');
  return data;
}

/** A new name (editors and the owner; migration 2026-11-03, else « pas encore disponible »). */
export async function renameFile(f: GroupFile, name: string) {
  const res = await db().from('group_files').update({ name: name.trim().slice(0, 255) }).eq('id', f.id).select('id');
  if (res.error?.code === '42501') throw new Refused(t('Renommer un fichier partagé n’est pas encore disponible.'));
  changed(res, t('Tu ne peux pas renommer ce fichier.'));
}

export async function deleteFile(f: GroupFile) {
  changed(await db().from('group_files').delete().eq('id', f.id).select('id'), t('Tu ne peux pas supprimer de fichier dans {group}.', { group: words().this }));
  await db().storage.from(FILES).remove([filePath(f)]);
}

/** Avant la disparition d'un groupe : retire ses fichiers du stockage (la table suit en cascade). */
/** Efface les fichiers d'un groupe supprimé, puis l'oublie ; une coupure : on recommence à la prochaine ouverture. */
async function purgeFiles(groupId: string) {
  try {
    for (;;) {
      const { data, error: unread } = await db().storage.from(FILES).list(groupId, { limit: 1000 });
      if (unread) return; // not read (network): tried again at the next opening, the group not forgotten with its files left
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
