import { useState } from 'react';
import { SelectField } from '../../components/Pickers';
import { Crown, LogOut, RefreshCw, Send, Trash2, UserMinus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useGroups } from '../../store/groups';
import { askChoice, confirmAction, toast } from '../../store/ui';
import { Modal } from '../../components/Overlays';
import {
  deleteGroup, fetchMembers, groupError, leaveGroup, regenerateAgendaToken, regenerateCode, removeMember, setMemberRights, shareInvite, transferGroup,
  type Group, type GroupMember, type GroupRole,
} from '../../lib/groups';
import { fmt } from '../../lib/dates';
import { MemberDot, LoadFailed } from './shared';
import { defaultHeir, roleLabel } from './logic';
import { Skeleton } from '../../components/EmptyState';
import { useFinitions, useGroupWords } from './util';
import { t, tn } from '../../i18n';

/**
 * Quitter, Supprimer et Nouveau code / lien : at the bottom of the members, and in the ⚙ settings (`withCode`).
 * The owner who leaves chooses who takes over.
 */
export function GroupActions({ group, onLeft, withCode = false }: { group: Group; onLeft: () => void; withCode?: boolean }) {
  const w = useGroupWords();
  const me = useAuth(s => s.user?.id);
  const isOwner = group.ownerId === me;
  const agenda = group.kind === 'agenda';
  const [busy, setBusy] = useState(false);
  const [heirs, setHeirs] = useState<GroupMember[] | null>(null);
  const [heir, setHeir] = useState<string | null>(null);
  const canChoose = useFinitions(); // choosing who takes over: migration 2026-11-03 (before it, the oldest member)

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    try {
      await job();
    } catch (e) {
      toast(groupError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  // A shared calendar is joined by its link only (a secret token), a group by its code.
  const newCode = async () => {
    const ask = agenda
      ? confirmAction(t('Créer un nouveau lien ?'), t('L’ancien lien ne marchera plus. Les membres restent.'), t('Nouveau lien'), false)
      : confirmAction(t('Créer un nouveau code ?'), t('L’ancien code ne marchera plus. Les membres restent.'), t('Nouveau code'), false);
    if (!(await ask)) return;
    await run(async () => {
      await (agenda ? regenerateAgendaToken(group.id) : regenerateCode(group.id));
      await useGroups.getState().refresh(group.id, ['members']);
      toast(agenda ? t('Nouveau lien créé') : t('Nouveau code créé'), 'success');
    });
  };

  const left = async (message: string) => {
    await useGroups.getState().loadGroups();
    toast(message, 'success');
    onLeft();
  };

  const leave = async () => {
    // What leaving does depends on who else is there (alone, everything goes): never decided on a list not read yet.
    let members = useGroups.getState().members[group.id];
    if (!members) {
      setBusy(true);
      try {
        const read = await fetchMembers(group.id);
        useGroups.setState(s => ({ members: { ...s.members, [group.id]: read } }));
        members = read;
      } catch (e) {
        return toast(groupError(e), 'error');
      } finally {
        setBusy(false);
      }
    }
    const others = members.filter(m => m.userId !== me);
    const alone = others.length === 0;
    // The owner with other members: who takes over, in the window below.
    if (isOwner && !alone && canChoose) {
      setHeir(defaultHeir(members, me));
      return setHeirs(others);
    }
    const mine = members.find(m => m.userId === me);
    const message = alone
      ? agenda
        ? t('Il n’y a que toi : tout sera supprimé ({the} et ses {many}).', { the: w.the, many: w.meet.many })
        : t('Il n’y a que toi : tout sera supprimé ({the}, ses notes, ses fichiers et ses {many}).', { the: w.the, many: w.meet.many })
      : isOwner
        ? agenda
          ? t('Le membre le plus ancien deviendra propriétaire. Tu pourras revenir avec le lien.')
          : t('Le membre le plus ancien deviendra propriétaire. Tu pourras revenir avec le code.')
      : mine?.role !== 'editeur'
        ? agenda
          ? t('Tu pourras revenir avec le lien.')
          : t('Tu pourras revenir avec le code.')
        : agenda
          ? t('Tes événements restent. Tu pourras revenir avec le lien.')
          : t('Tes notes restent. Tu pourras revenir avec le code.');
    if (!(await confirmAction(t('Quitter « {name} » ?', { name: group.name }), message, t('Quitter')))) return;
    await run(async () => {
      await leaveGroup(group.id, alone);
      await left(t('Tu as quitté {the}', { the: w.the }));
    });
  };

  const leaveTo = (heirId: string) =>
    run(async () => {
      // A server without the choice (migration 2026-11-03): the member there the longest takes over, as before.
      const chosen = await transferGroup(group.id, heirId);
      await leaveGroup(group.id, false);
      setHeirs(null);
      await left(chosen ? t('Tu as quitté {the}', { the: w.the }) : t('Tu as quitté {the}. Le membre le plus ancien en est maintenant propriétaire.', { the: w.the }));
    });

  const destroy = async () => {
    if (!(await confirmAction(
        t('Supprimer « {name} » ?', { name: group.name }),
        agenda
          ? t('{The} et ses {many} seront supprimés pour tous les membres, définitivement.', { The: w.The, many: w.meet.many })
          : t('{The}, ses notes, ses fichiers et ses {many} seront supprimés pour tous les membres, définitivement.', { The: w.The, many: w.meet.many }),
        t('Supprimer {the}', { the: w.the }),
      ))) return;
    await run(async () => {
      await deleteGroup(group.id);
      await left(w.deleted);
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      {withCode && isOwner && (
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void newCode()}>
          <RefreshCw size={14} /> {agenda ? t('Nouveau lien') : t('Nouveau code')}
        </button>
      )}
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void leave()}>
        <LogOut size={14} /> {t('Quitter {the}', { the: w.the })}
      </button>
      {isOwner && (
        <button type="button" className="btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700" disabled={busy} onClick={() => void destroy()}>
          <Trash2 size={14} /> {t('Supprimer {the}', { the: w.the })}
        </button>
      )}
      <Modal open={!!heirs} onClose={() => setHeirs(null)}>
        {heirs && (
          <form
            onSubmit={e => {
              e.preventDefault();
              e.stopPropagation();
              if (heir) void leaveTo(heir);
            }}
          >
            <h3 className="text-[15px] font-semibold">{t('Quitter « {name} » ?', { name: group.name })}</h3>
            <p className="mt-1 text-[13px] text-stone-500">{agenda ? t('Choisis qui devient propriétaire. Tu pourras revenir avec le lien.') : t('Choisis qui devient propriétaire. Tu pourras revenir avec le code.')}</p>
            <SelectField<string>
              className="mt-4 w-full"
              label={t('Nouveau propriétaire')}
              value={heir ?? ''}
              onChange={setHeir}
              options={heirs.map(m => ({ value: m.userId, label: m.name, hint: roleLabel(m) }))}
            />
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setHeirs(null)}>{t('Annuler')}</button>
              <button type="submit" className="btn-danger" disabled={busy || !heir}>{t('Quitter')}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

export default function GroupMembers({ group, onLeft }: { group: Group; onLeft: () => void }) {
  const w = useGroupWords();
  const me = useAuth(s => s.user?.id);
  const members = useGroups(s => s.members[group.id]);
  const failed = useGroups(s => s.loadFailed[`${group.id}:members`]);
  const code = useGroups(s => s.codes[group.id]);
  const mine = members?.find(m => m.userId === me);
  const [busy, setBusy] = useState(false);
  const isOwner = group.ownerId === me;
  const agenda = group.kind === 'agenda';
  const canCrown = useFinitions(); // naming another owner: migration 2026-11-03

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    try {
      await job();
    } catch (e) {
      toast(groupError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const newCode = async () => {
    const ask = agenda
      ? confirmAction(t('Créer un nouveau lien ?'), t('L’ancien lien ne marchera plus. Les membres restent.'), t('Nouveau lien'), false)
      : confirmAction(t('Créer un nouveau code ?'), t('L’ancien code ne marchera plus. Les membres restent.'), t('Nouveau code'), false);
    if (!(await ask)) return;
    await run(async () => {
      await (agenda ? regenerateAgendaToken(group.id) : regenerateCode(group.id));
      await useGroups.getState().refresh(group.id, ['members']);
      toast(agenda ? t('Nouveau lien créé') : t('Nouveau code créé'), 'success');
    });
  };

  // Removed with the old code (or link) still valid, they could come back: « … et changer le code » prevents it.
  const kick = async (m: GroupMember) => {
    const answer = await askChoice(
      t('Retirer {name} {of} ?', { name: m.name, of: w.of }),
      agenda
        ? t('Ses événements restent. Avec l’ancien lien, {name} pourrait revenir : « Retirer et changer le lien » l’en empêche.', { name: m.name })
        : t('Ses notes restent. Avec l’ancien code, {name} pourrait revenir : « Retirer et changer le code » l’en empêche.', { name: m.name }),
      t('Retirer'),
      agenda ? t('Retirer et changer le lien') : t('Retirer et changer le code'),
      true,
    );
    if (!answer) return;
    await run(async () => {
      await removeMember(group.id, m.userId);
      if (answer === 'other') await (agenda ? regenerateAgendaToken(group.id) : regenerateCode(group.id));
      await useGroups.getState().refresh(group.id, ['members']);
      if (answer === 'other') toast(agenda ? t('Nouveau lien créé') : t('Nouveau code créé'), 'success');
    });
  };

  const crown = async (m: GroupMember) => {
    if (!(await confirmAction(t('Nommer {name} propriétaire ?', { name: m.name }), t('{name} aura tous les droits sur {the}. Tu resteras membre, éditeur.', { name: m.name, the: w.the }), t('Nommer propriétaire'), false))) return;
    await run(async () => {
      if (!(await transferGroup(group.id, m.userId))) return toast(t('Nommer un autre propriétaire n’est pas encore disponible.'), 'error');
      await useGroups.getState().loadGroups();
      await useGroups.getState().refresh(group.id, ['members']);
      toast(t('{name} est maintenant propriétaire', { name: m.name }), 'success');
    });
  };

  const setRights = (m: GroupMember, role: GroupRole, canInvite: boolean) =>
    run(async () => {
      await setMemberRights(group.id, m.userId, role, canInvite);
      await useGroups.getState().refresh(group.id, ['members']);
      const changed =
        role !== m.role
          ? role === 'lecteur'
            ? t('{name} est maintenant lecteur', { name: m.name })
            : t('{name} est maintenant éditeur', { name: m.name })
          : canInvite
            ? t('{name} peut maintenant inviter', { name: m.name })
            : t('{name} ne peut plus inviter', { name: m.name });
      toast(changed, 'success');
    });

  return (
    <div className="shadow-room min-h-0 flex-1 overflow-y-auto pb-room">
      {code ? (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-[220px] flex-1">
            <p className="text-[14px] font-medium">{t('Inviter quelqu’un')}</p>
            <p className="mt-0.5 text-[13px] text-stone-500">{agenda ? t('Envoie-lui le lien.') : t('Envoie-lui le lien, ou le code affiché sous le nom {of}.', { of: w.of })}</p>
          </div>
          <div className="flex gap-1.5">
            <button className="btn-primary h-8 px-3" onClick={() => void shareInvite(group, code)}>
              <Send size={14} /> {t('Inviter')}
            </button>
            {isOwner && (
              <button
                className="icon-btn"
                title={agenda ? t('Nouveau lien (l’ancien ne marchera plus)') : t('Nouveau code (l’ancien ne marchera plus)')}
                aria-label={agenda ? t('Nouveau lien (l’ancien ne marchera plus)') : t('Nouveau code (l’ancien ne marchera plus)')}
                disabled={busy}
                onClick={() => void newCode()}
              >
                <RefreshCw size={15} />
              </button>
            )}
          </div>
        </div>
      ) : (
        code === null && <p className="card px-4 py-3 text-[13px] text-stone-500">{agenda ? t('Pour inviter quelqu’un, demande au propriétaire.') : t('Pour inviter quelqu’un, demande le code au propriétaire.')}</p>
      )}
      {!isOwner && mine && (
        <p className="mt-3 text-[13px] text-stone-500">
          {mine.role === 'lecteur' ? t('Tu es lecteur : tu vois tout, sans rien modifier.') : t('Tu es éditeur : tu peux ajouter, modifier et supprimer.')}
        </p>
      )}

      <p className="eyebrow mb-2 mt-6">{members ? tn(members.length, '{n} membre', '{n} membres') : t('Membres')}</p>
      <div className="card divide-y divide-stone-100">
        {!members && (failed ? <LoadFailed groupId={group.id} part="members" /> : <Skeleton shape="people" rows={2} className="p-3" />)}
        {members?.map(m => (
          <div key={m.userId} className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
            <MemberDot userId={m.userId} name={m.name} photo={m.photo} color={m.color} size={30} className="ring-0" />
            <div className="min-w-[120px] flex-1">
              {/* The owner's badge on the name's line: on a small phone it doesn't fall under the picture. */}
              <p className="flex items-center gap-2 text-[13px] font-medium">
                <span className="truncate">
                  {m.name}
                  {m.userId === me && <span className="font-normal text-stone-500"> {t('(toi)')}</span>}
                </span>
                {m.isOwner && <span className="shrink-0 rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">{t('Propriétaire')}</span>}
              </p>
              {/* Everyone sees the rights (the owner changes them on the right). */}
              <p className="text-[12px] text-stone-500">
                {!m.isOwner && !isOwner && `${roleLabel(m)} · `}
                {t('Depuis le {date}', { date: fmt(new Date(m.joinedAt), 'd MMMM yyyy') })}
              </p>
            </div>
            {!m.isOwner && isOwner ? (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <SelectField<GroupRole>
                  className="h-9 w-32 shrink-0 text-[13px]"
                  label={t('Rôle de {name}', { name: m.name })}
                  value={m.role}
                  disabled={busy}
                  onChange={role => void setRights(m, role, m.canInvite)}
                  options={[
                    { value: 'lecteur', label: t('Lecteur'), hint: t('Voit tout, ne modifie rien') },
                    { value: 'editeur', label: t('Éditeur'), hint: t('Ajoute et modifie') },
                  ]}
                />
                <label className="check-hit flex min-w-17 grow basis-17 items-center gap-1.5 text-[12px] leading-tight text-stone-600">
                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--color-ink)]" checked={m.canInvite} disabled={busy} onChange={e => void setRights(m, m.role, e.target.checked)} />
                  {t('Peut inviter')}
                </label>
                {canCrown && (
                  <button className="icon-btn" title={t('Nommer {name} propriétaire', { name: m.name })} aria-label={t('Nommer {name} propriétaire', { name: m.name })} disabled={busy} onClick={() => void crown(m)}>
                    <Crown size={15} />
                  </button>
                )}
                {/* With the role: on a small phone they go to the next line together (« Peut inviter » on two lines if needed). */}
                <button className="icon-btn hover:text-red-600" title={t('Retirer {name}', { name: m.name })} aria-label={t('Retirer {name}', { name: m.name })} disabled={busy} onClick={() => void kick(m)}>
                  <UserMinus size={15} />
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-6">
        <GroupActions group={group} onLeft={onLeft} />
      </div>
      <p className="mt-3 text-[12px] text-stone-500">{t('Les membres voient seulement ton prénom et ta photo de profil, jamais ton adresse e-mail.')}</p>
    </div>
  );
}
