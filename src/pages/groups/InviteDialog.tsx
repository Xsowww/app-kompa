import { useState } from 'react';
import { Check, Copy, Mail, MessageCircle, MessageSquareText, Share2 } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { useInvite } from '../../store/invite';
import { useSettings } from '../../store/settings';
import { useAuth } from '../../store/auth';
import { inviteLink, inviteText, shareLinks } from '../../lib/groupInvite';
import { AGENDA_WORDS, groupWords } from '../../lib/usage';
import { toast } from '../../store/ui';
import { t } from '../../i18n';

/**
 * « Inviter » (a shared calendar or a group): the phone's own sharing (« Partager ») where there is one, else SMS,
 * WhatsApp and e-mail with the message written; the link in a field to copy, a group's code, and how it works in one
 * line. The link carries my first name and the name of what I invite to, for the page a guest without an account
 * lands on (pages/groups/InvitePage). Once in AppShell, opened by lib/groups › shareInvite.
 */
export function InviteDialog() {
  const invite = useInvite(s => s.invite);
  const usage = useSettings(s => s.usage);
  const me = useAuth(s => s.user?.name ?? '');
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  if (!invite) return null;
  const close = () => (useInvite.setState({ invite: null }), setCopied(null));
  const agenda = invite.kind === 'agenda';
  const w = agenda ? AGENDA_WORDS : groupWords(usage);
  const from = me.split(' ')[0];
  const link = inviteLink(invite.kind, invite.secret, location.origin, { from, name: invite.name });
  const message = inviteText(invite, invite.secret, location.origin, from);
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
      await navigator.share({ title: invite.name, text: message });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') void copy('link');
    }
  };
  const ways = shareLinks(message, t('Invitation : {name}', { name: invite.name }));
  const WAY = {
    sms: { label: t('SMS'), icon: MessageSquareText },
    whatsapp: { label: 'WhatsApp', icon: MessageCircle },
    email: { label: t('E-mail'), icon: Mail },
  } as const;

  return (
    <Modal open onClose={close} width={460}>
      <h3 className="text-[16px] font-semibold [overflow-wrap:anywhere]">{t('Inviter dans « {name} »', { name: invite.name })}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-stone-500">
        {agenda
          ? t('La personne ouvre le lien, se connecte ou crée son compte, et voit l’agenda tout de suite. Elle voit seulement cet agenda, jamais ton agenda perso, et peut y ajouter ses événements.')
          : t('La personne ouvre le lien, se connecte ou crée son compte, et rejoint {the}. Elle peut aussi taper le code dans « Rejoindre ».', { the: w.the })}
      </p>

      {/* Sending it: the phone's own sharing first; SMS, WhatsApp and e-mail always there (a computer has no share sheet). */}
      {canShare && (
        <button type="button" className="btn-primary mt-4 h-11 w-full text-[14.5px]" onClick={() => void share()}>
          <Share2 size={16} aria-hidden /> {t('Partager')}
        </button>
      )}
      <p className="mb-1.5 mt-4 text-[12.5px] font-medium text-stone-600">{canShare ? t('Ou envoyer par') : t('Envoyer par')}</p>
      <ul className="grid grid-cols-3 gap-2">
        {ways.map(x => {
          const Icon = WAY[x.key].icon;
          return (
            <li key={x.key} className="min-w-0">
              <a
                href={x.href}
                target={x.key === 'whatsapp' ? '_blank' : undefined}
                rel={x.key === 'whatsapp' ? 'noopener noreferrer' : undefined}
                className="btn-secondary h-11 w-full min-w-0 px-2 text-[13.5px] max-[439px]:h-14 max-[439px]:flex-col max-[439px]:gap-0.5 max-[439px]:text-[12.5px]"
                aria-label={t('Envoyer l’invitation par {way}', { way: WAY[x.key].label })}
              >
                <Icon size={16} aria-hidden className="shrink-0" /> <span className="truncate">{WAY[x.key].label}</span>
              </a>
            </li>
          );
        })}
      </ul>

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
      </div>
    </Modal>
  );
}
