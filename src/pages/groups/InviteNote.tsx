import { useState } from 'react';
import { CalendarHeart, Users } from 'lucide-react';
import { pendingInvite, readInvite } from './invitePending';
import { t } from '../../i18n';

/**
 * On the sign-up and sign-in pages, after an invitation link (pages/groups/InvitePage): a line that says the
 * invitation is kept and joined right after entering. Nothing without one.
 */
export default function InviteNote({ register }: { register: boolean }) {
  const [invite] = useState(() => {
    const path = pendingInvite();
    return path ? readInvite(path) : null;
  });
  if (!invite) return null;
  const agenda = invite.kind === 'agenda';
  const Icon = agenda ? CalendarHeart : Users;
  const text = invite.name
    ? agenda
      ? register
        ? t('Après ton inscription, tu rejoins l’agenda « {name} ».', { name: invite.name })
        : t('Après la connexion, tu rejoins l’agenda « {name} ».', { name: invite.name })
      : register
        ? t('Après ton inscription, tu rejoins le groupe « {name} ».', { name: invite.name })
        : t('Après la connexion, tu rejoins le groupe « {name} ».', { name: invite.name })
    : register
      ? t('Après ton inscription, tu rejoins l’invitation reçue.')
      : t('Après la connexion, tu rejoins l’invitation reçue.');
  return (
    <p className="mt-4 flex items-start gap-2.5 rounded-xl bg-brand-50 px-3.5 py-3 text-[14px] leading-snug" role="note">
      <Icon size={17} strokeWidth={1.9} className="mt-px shrink-0 text-brand-600" aria-hidden />
      <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
    </p>
  );
}
