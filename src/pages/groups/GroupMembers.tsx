import { useState } from 'react';
import { SelectField } from '../../components/Pickers';
import { Copy, LogOut, RefreshCw, Trash2, UserMinus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useGroups } from '../../store/groups';
import { confirmAction, toast } from '../../store/ui';
import { copyCode, copyInviteLink, deleteGroup, groupError, leaveGroup, regenerateAgendaToken, regenerateCode, removeMember, setMemberRights, type Group, type GroupMember, type GroupRole } from '../../lib/groups';
import { fmt } from '../../lib/dates';
import { MemberDot, LoadFailed } from './shared';
import { Skeleton } from '../../components/EmptyState';
import { useGroupWords } from './util';
import { t, tn } from '../../i18n';

export default function GroupMembers({ group, onLeft }: { group: Group; onLeft: () => void }) {
  const w = useGroupWords();
  const me = useAuth(s => s.user?.id);
  const members = useGroups(s => s.members[group.id]);
  const failed = useGroups(s => s.loadFailed[`${group.id}:members`]);
  const code = useGroups(s => s.codes[group.id]);
  const mine = members?.find(m => m.userId === me);
  const [busy, setBusy] = useState(false);
  const isOwner = group.ownerId === me;

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
  const agenda = group.kind === 'agenda';
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

  const kick = async (m: GroupMember) => {
    if (!(await confirmAction(t('Retirer {name} {of} ?', { name: m.name, of: w.of }), agenda ? t('Ses événements restent. {name} pourra revenir avec le lien.', { name: m.name }) : t('Ses notes restent. {name} pourra revenir avec le code.', { name: m.name }), t('Retirer')))) return;
    await run(async () => {
      await removeMember(group.id, m.userId);
      await useGroups.getState().refresh(group.id, ['members']);
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

  const leave = async () => {
    const alone = (members?.length ?? 1) <= 1;
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
      await useGroups.getState().loadGroups();
      toast(t('Tu as quitté {the}', { the: w.the }), 'success');
      onLeft();
    });
  };

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
      await useGroups.getState().loadGroups();
      toast(w.deleted, 'success');
      onLeft();
    });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-room">
      {code && agenda ? (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-[220px] flex-1">
            <p className="text-[14px] font-medium">{t('Inviter quelqu’un')}</p>
            <p className="mt-0.5 text-[13px] text-stone-500">{t('Envoie-lui le lien.')}</p>
          </div>
          <div className="flex gap-1.5">
            <button className="btn-primary h-8 px-3" onClick={() => void copyInviteLink(code, 'agenda')}>
              <Copy size={14} /> {t('Copier le lien')}
            </button>
            {isOwner && (
              <button className="icon-btn" title={t('Nouveau lien (l’ancien ne marchera plus)')} aria-label={t('Nouveau lien (l’ancien ne marchera plus)')} disabled={busy} onClick={() => void newCode()}>
                <RefreshCw size={15} />
              </button>
            )}
          </div>
        </div>
      ) : code ? (
        <div className="card flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-[220px] flex-1">
            <p className="text-[14px] font-medium">{t('Inviter quelqu’un')}</p>
            <p className="mt-0.5 text-[13px] text-stone-500">{t('Envoie-lui ce code ou le lien « Inviter ».')}</p>
          </div>
          <span className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-1.5 font-mono text-[20px] font-semibold tracking-[0.25em]">{code}</span>
          <div className="flex gap-1.5">
            <button className="btn-secondary h-8 px-3" onClick={() => void copyCode(code)}>
              <Copy size={14} /> {t('Copier')}
            </button>
            {isOwner && (
              <button className="icon-btn" title={t('Nouveau code (l’ancien ne marchera plus)')} aria-label={t('Nouveau code (l’ancien ne marchera plus)')} disabled={busy} onClick={() => void newCode()}>
                <RefreshCw size={15} />
              </button>
            )}
          </div>
        </div>
      ) : (
        code === null && <p className="card px-4 py-3 text-[13px] text-stone-500">{t('Pour inviter quelqu’un, demande au propriétaire.')}</p>
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
            <MemberDot userId={m.userId} name={m.name} size={30} className="ring-0" />
            <div className="min-w-[150px] flex-1">
              <p className="truncate text-[13px] font-medium">
                {m.name}
                {m.userId === me && <span className="font-normal text-stone-500"> {t('(toi)')}</span>}
              </p>
              <p className="text-[12px] text-stone-500">{t('Depuis le {date}', { date: fmt(new Date(m.joinedAt), 'd MMMM yyyy') })}</p>
            </div>
            {m.isOwner ? (
              <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">{t('Propriétaire')}</span>
            ) : isOwner ? (
              <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
                <SelectField<GroupRole>
                  className="h-9 w-32 text-[13px]"
                  label={t('Rôle de {name}', { name: m.name })}
                  value={m.role}
                  disabled={busy}
                  onChange={role => void setRights(m, role, m.canInvite)}
                  options={[
                    { value: 'lecteur', label: t('Lecteur'), hint: t('Voit tout, ne modifie rien') },
                    { value: 'editeur', label: t('Éditeur'), hint: t('Ajoute et modifie') },
                  ]}
                />
                <label className="check-hit flex items-center gap-1.5 text-[12px] text-stone-600">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--color-ink)]" checked={m.canInvite} disabled={busy} onChange={e => void setRights(m, m.role, e.target.checked)} />
                  {t('Peut inviter')}
                </label>
              </div>
            ) : null}
            {isOwner && m.userId !== me && (
              <button className="icon-btn hover:text-red-600" title={t('Retirer {name}', { name: m.name })} aria-label={t('Retirer {name}', { name: m.name })} disabled={busy} onClick={() => void kick(m)}>
                <UserMinus size={15} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={busy} onClick={() => void leave()}>
          <LogOut size={14} /> {t('Quitter {the}', { the: w.the })}
        </button>
        {isOwner && (
          <button className="btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700" disabled={busy} onClick={() => void destroy()}>
            <Trash2 size={14} /> {t('Supprimer {the}', { the: w.the })}
          </button>
        )}
      </div>
      <p className="mt-3 text-[12px] text-stone-500">{t('Les membres voient seulement ton prénom, jamais ton adresse e-mail.')}</p>
    </div>
  );
}
