import { useAuth } from '../../store/auth';
import { getSettings, useSettings } from '../../store/settings';
import { createContext, useContext, useEffect, useState } from 'react';
import { AGENDA_WORDS, groupWords } from '../../lib/usage';
import { useGroups } from '../../store/groups';
import { toast } from '../../store/ui';
import { sendUpload, trackUpload } from '../../store/uploads';
import { GROUP_COLORS, MAX_GROUP_FILE, abandonFile, deleteFile, finitionsReady, groupError, uploadFile, type Group, type GroupKind } from '../../lib/groups';
import { t, tn } from '../../i18n';

/** Which space the group screens are in: work groups (/groupes) or shared calendars (/agendas). */
export const KindContext = createContext<GroupKind>('groupe');

/** « groupe » / « équipe », « révisions » / « réunions » / « rendez-vous », selon l'usage du compte. */
export const useGroupWords = () => {
  const words = groupWords(useSettings(s => s.usage));
  return useContext(KindContext) === 'agenda' ? AGENDA_WORDS : words;
};
export const groupWordsNow = () => groupWords(getSettings().usage);

export const groupColor = (g: Pick<Group, 'color'>) => g.color ?? GROUP_COLORS[0];

/** Nom d'un membre tel qu'affiché (« toi » pour soi-même, après « par » : « Modifiée par toi »). */
export function useMemberName(groupId: string) {
  const me = useAuth(s => s.user?.id);
  const members = useGroups(s => s.members[groupId]);
  return (userId: string | null, self = t('toi||après par')) => {
    if (!userId) return t('un ancien membre');
    if (userId === me) return self;
    return members?.find(m => m.userId === userId)?.name ?? t('un ancien membre');
  };
}

/**
 * Mes droits dans le groupe, d'après la liste des membres (la base les vérifie de toute façon), ou d'après mon
 * rôle lu avec la liste des groupes tant qu'elle n'est pas chargée.
 */
export function useRights(group: Pick<Group, 'id' | 'ownerId'>) {
  const me = useAuth(s => s.user?.id);
  const role = useGroups(s => s.members[group.id]?.find(m => m.userId === me)?.role ?? (s.members[group.id] ? undefined : s.myRoles[group.id]));
  const isOwner = !!me && group.ownerId === me;
  return { isOwner, canEdit: isOwner || role === 'editeur' };
}

/** A member as listed (name, picture or colour), for their round badge. */
export function useMemberOf(groupId: string) {
  const members = useGroups(s => s.members[groupId]);
  return (userId: string | null) => members?.find(m => m.userId === userId);
}

/** A refusal worded here (file missing, too big): shown as it is. */
class FileRefused extends Error {}

/** Ajoute des fichiers au groupe, un par un (chacun peut être mis en pause ou annulé) ; dit ce qui est passé et ce qui a été refusé. */
export async function shareFiles(group: Group, files: { blob: Blob | (() => Promise<Blob | undefined>); name: string }[]): Promise<number> {
  let ok = 0;
  let error = '';
  // All on the upload card from the start (the size of a Drive file comes once it is read).
  const tracks = files.map(f => trackUpload(f.name, f.blob instanceof Blob ? f.blob.size : 0, `group:${group.id}`));
  for (const [i, f] of files.entries()) {
    try {
      const blob = typeof f.blob === 'function' ? await f.blob() : f.blob;
      if (tracks[i].cancelled) continue;
      if (!blob) throw new FileRefused(t('Le contenu de « {name} » est introuvable.', { name: f.name }));
      if (blob.size > MAX_GROUP_FILE) throw new FileRefused(t('« {name} » dépasse 50 Mo.', { name: f.name }));
      // Paused: waits, then goes on (over 6 Mo, from where it was: same id each time). Cancelled: nothing in the
      // group (removed if it got there, its unfinished upload dropped otherwise).
      const id = crypto.randomUUID();
      const sent = await sendUpload(
        tracks[i],
        signal => uploadFile(group.id, blob, f.name, loaded => tracks[i].progress(loaded, blob.size), signal, id),
        file => (file ? deleteFile(file) : abandonFile(group.id, id)),
      );
      if (!sent) continue;
      tracks[i].done();
      ok++;
    } catch (e) {
      tracks[i].fail();
      error = e instanceof FileRefused ? e.message : groupError(e);
    }
  }
  if (ok) void useGroups.getState().refresh(group.id, ['files']);
  if (error) toast(ok ? tn(ok, '{n} fichier partagé. {error}', '{n} fichiers partagés. {error}', { error }) : error, 'error');
  return ok;
}

/** An order chosen in a list, kept for the next visit (this browser). */
export function useRememberedSort<T extends string>(key: string, allowed: readonly T[]): [T, (v: T) => void] {
  const initial = allowed[0];
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      return saved && allowed.includes(saved) ? saved : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* private mode: kept for this visit */
    }
  };
  return [value, set];
}

/**
 * Migration 2026-11-03 applied: what needs it (renaming a shared file, naming another owner, the rights of newcomers,
 * reminders of a group's meetings) is only offered then; before, the screens stay as they were.
 */
export function useFinitions() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void finitionsReady().then(ok => alive && setReady(ok));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}
