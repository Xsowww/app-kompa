import { useState, type FormEvent } from 'react';
import { Bug, Lightbulb } from 'lucide-react';
import { Modal } from './Overlays';
import { toast } from '../store/ui';
import { cx } from '../lib/utils';
import { REPORT_REASONS, reportGroupItem, sendFeedback, useFeedback, type FeedbackKind, type ReportKind, type ReportReason } from '../lib/feedback';
import { t } from '../i18n';

/** « Donner mon avis / Signaler un bug » : rendu une fois dans la mise en page, ouvert par openFeedback(). */
export function FeedbackDialog() {
  const open = useFeedback(s => s.open);
  return (
    <Modal open={!!open} onClose={() => useFeedback.setState({ open: null })} width={460}>
      {open && <FeedbackForm initial={open} />}
    </Modal>
  );
}

function FeedbackForm({ initial }: { initial: FeedbackKind }) {
  const [kind, setKind] = useState<FeedbackKind>(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => useFeedback.setState({ open: null });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const how = await sendFeedback(kind, text);
      close();
      toast(how === 'mail' ? t('Ton application d’e-mail s’ouvre avec le message prêt.') : t('Merci ! Ton message est bien arrivé.'), 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  };
  const bug = kind === 'bug';
  return (
    <form onSubmit={submit}>
      <h2 className="text-[15px] font-semibold">{t('Donner mon avis ou signaler un bug')}</h2>
      <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('Type de message')}>
        {(
          [
            ['idea', t('Une idée, un avis'), Lightbulb],
            ['bug', t('Un bug'), Bug],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cx(
              'flex h-10 items-center justify-center gap-2 rounded-lg border text-[13px] font-medium transition-colors',
              kind === k ? 'border-ink bg-surface text-ink' : 'border-stone-200 text-stone-500 hover:text-ink',
            )}
          >
            <Icon size={15} aria-hidden className="max-[359px]:hidden" /> {label}
          </button>
        ))}
      </div>
      <label htmlFor="feedback-text" className="mt-4 block text-[13px] font-medium">
        {bug ? t('Que s’est-il passé ?') : t('Ton message')}
      </label>
      <textarea
        id="feedback-text"
        autoFocus
        className="field mt-2 h-auto! min-h-[120px] w-full resize-y py-2 leading-relaxed"
        maxLength={4000}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={bug ? t('J’ai ajouté un fichier dans le Drive, il n’apparaît pas…') : t('J’aimerais pouvoir…')}
      />
      <p className="mt-2 text-[11.5px] text-stone-500">{t('On joint la page ouverte et le type d’appareil, rien d’autre.')}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={close}>
          {t('Annuler')}
        </button>
        <button type="submit" className="btn-primary" disabled={!text.trim() || busy}>
          {busy ? t('Envoi…') : t('Envoyer')}
        </button>
      </div>
    </form>
  );
}

export interface ReportTarget {
  kind: ReportKind;
  id: string;
  /** Shown in the dialog: « Signaler « Plan de l’exposé » ». */
  title: string;
}

/** Signaler une note, un fichier ou un événement d'un groupe à l'administrateur. */
export function ReportDialog({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  return (
    <Modal open={!!target} onClose={onClose} width={460}>
      {target && <ReportForm target={target} onClose={onClose} />}
    </Modal>
  );
}

function ReportForm({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const heading = target.kind === 'note' ? t('Signaler cette note') : target.kind === 'file' ? t('Signaler ce fichier') : t('Signaler cet événement');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason || busy) return;
    setBusy(true);
    try {
      await reportGroupItem(target.kind, target.id, reason, text);
      onClose();
      toast(t('Merci, signalement envoyé.'), 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <h2 className="text-[15px] font-semibold">{heading}</h2>
      <p className="mt-1 truncate text-[13px] text-stone-500">{t('« {title} »', { title: target.title })}</p>
      <fieldset className="mt-4">
        <legend className="text-[13px] font-medium">{t('Pourquoi ?')}</legend>
        <div className="mt-2 grid gap-1">
          {REPORT_REASONS.map(r => (
            <label key={r.value} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13.5px] hover:bg-stone-100">
              <input type="radio" name="report-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-[var(--color-brand-600)]" />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor="report-text" className="mt-3 block text-[13px] font-medium">
        {t('Précisions')} <span className="font-normal text-stone-500">{t('(facultatif)')}</span>
      </label>
      <textarea
        id="report-text"
        className="field mt-2 h-auto! min-h-[72px] w-full resize-y py-2 leading-relaxed"
        maxLength={1000}
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <p className="mt-2 text-[11.5px] text-stone-500">{t('Les membres ne savent pas qui a signalé. L’administrateur voit une copie du contenu.')}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          {t('Annuler')}
        </button>
        <button type="submit" className="btn-danger" disabled={!reason || busy}>
          {busy ? t('Envoi…') : t('Envoyer le signalement')}
        </button>
      </div>
    </form>
  );
}
