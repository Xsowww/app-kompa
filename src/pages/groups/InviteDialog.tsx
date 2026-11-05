import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { useInvite } from '../../store/invite';
import { useSettings } from '../../store/settings';
import { inviteLink, inviteText } from '../../lib/groupInvite';
import { AGENDA_WORDS, groupWords } from '../../lib/usage';
import { toast } from '../../store/ui';
import { t } from '../../i18n';

/**
 * « Inviter » (a shared calendar or a group): the link in a field to copy, the phone's own sharing (WhatsApp, SMS…)
 * where there is one, a group's code, and how it works in one line. Once in AppShell, opened by lib/groups › shareInvite.
 */
export function InviteDialog() {
  const invite = useInvite(s => s.invite);
  const usage = useSettings(s => s.usage);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  if (!invite) return null;
  const close = () => (useInvite.setState({ invite: null }), setCopied(null));
  const agenda = invite.kind === 'agenda';
  const w = agenda ? AGENDA_WORDS : groupWords(usage);
  const link = inviteLink(invite.kind, invite.secret, location.origin);
  const canShare = typeof navigator.share === 'function';
  const copy = async (what: 'link' | 'code') => {
    try {
      await navigator.clipboard.writeText(what === 'link' ? link : invite.secret);
      setCopied(what);
      toast(what === 'link' ? t('Lien copié : colle-le dans un message.') : t('Code copié'), 'success');
    } catch {
      // No clipboard (an old browser, a refused permission): the field is selected, ready for a long press or Ctrl+C.
      document.querySelector<HTMLInputElement>('#invite-link')?.select();
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: invite.name, text: inviteText(invite, invite.secret, location.origin) });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') void copy('link');
    }
  };

  return (
    <Modal open onClose={close} width={460}>
      <h3 className="text-[16px] font-semibold [overflow-wrap:anywhere]">{t('Inviter dans « {name} »', { name: invite.name })}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-stone-500">
        {agenda
          ? t('La personne ouvre le lien, se connecte ou crée son compte, et voit l’agenda tout de suite. Elle peut y ajouter ses événements.')
          : t('La personne ouvre le lien, se connecte ou crée son compte, et rejoint {the}. Elle peut aussi taper le code dans « Rejoindre ».', { the: w.the })}
      </p>

      <label htmlFor="invite-link" className="mt-4 block text-[12.5px] font-medium text-stone-600">
        {t('Lien d’invitation')}
      </label>
      <div className="mt-1.5 flex gap-2">
        <input id="invite-link" readOnly value={link} onFocus={e => e.currentTarget.select()} className="field h-10 min-w-0 flex-1 px-3 text-[13px] text-stone-600" />
        <button type="button" className="btn-secondary h-10 shrink-0" onClick={() => void copy('link')}>
          {copied === 'link' ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          {copied === 'link' ? t('Copié') : t('Copier')}
        </button>
      </div>

      {!agenda && (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-stone-50 px-3.5 py-2.5">
          <span className="text-[12.5px] text-stone-600">{t('Code')}</span>
          <span className="tabular font-mono text-[17px] font-semibold tracking-[0.18em]">{invite.secret}</span>
          <button type="button" className="btn-ghost ml-auto h-9 px-2.5" onClick={() => void copy('code')} aria-label={t('Copier le code')}>
            {copied === 'code' ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            {t('Copier')}
          </button>
        </div>
      )}

      <div className="modal-foot">
        <button type="button" className="btn-secondary" onClick={close}>
          {t('Fermer')}
        </button>
        {canShare && (
          <button type="button" className="btn-primary" onClick={() => void share()}>
            <Share2 size={15} aria-hidden /> {t('Envoyer (WhatsApp, SMS…)')}
          </button>
        )}
      </div>
    </Modal>
  );
}
