import { useAuth } from '../../store/auth';
import { getSettings, useSettings } from '../../store/settings';
import { createContext, useContext } from 'react';
import { AGENDA_WORDS, groupWords } from '../../lib/usage';
import { useGroups } from '../../store/groups';
import { toast } from '../../store/ui';
import { sendUpload, trackUpload } from '../../store/uploads';
import { GROUP_COLORS, MAX_GROUP_FILE, deleteFile, groupError, uploadFile, type Group, type GroupKind } from '../../lib/groups';
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

/** Nom d'un membre tel qu'affiché (« toi » pour soi-même). */
export function useMemberName(groupId: string) {
  const me = useAuth(s => s.user?.id);
  const members = useGroups(s => s.members[groupId]);
  return (userId: string | null, self = t('toi')) => {
    if (!userId) return t('un ancien membre');
    if (userId === me) return self;
    return members?.find(m => m.userId === userId)?.name ?? t('un ancien membre');
  };
}

/**
 * Mes droits dans le groupe, d'après la liste des membres (la base les vérifie de toute façon).
 * Tant que la liste n'est pas chargée, seul le propriétaire est sûr de pouvoir modifier.
 */
export function useRights(group: Pick<Group, 'id' | 'ownerId'>) {
  const me = useAuth(s => s.user?.id);
  const mine = useGroups(s => s.members[group.id]?.find(m => m.userId === me));
  const isOwner = !!me && group.ownerId === me;
  return { isOwner, canEdit: isOwner || mine?.role === 'editeur' };
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
      // Paused: waits, then sent again from the start. Cancelled: nothing in the group (removed if it got there).
      const sent = await sendUpload(tracks[i], signal => uploadFile(group.id, blob, f.name, loaded => tracks[i].progress(loaded, blob.size), signal), file => (file ? deleteFile(file) : Promise.resolve()));
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
