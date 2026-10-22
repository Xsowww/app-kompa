import { useRef, useState, type FormEvent } from 'react';
import { Bug, Lightbulb } from 'lucide-react';
import { Modal } from './Overlays';
import { FieldError } from './Field';
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
  // An empty message: said under the field at the submit, gone once something is typed.
  const [error, setError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const close = () => useFeedback.setState({ open: null });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!text.trim()) {
      setError(t('Écris ton message.'));
      return textRef.current?.focus();
    }
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
              'hit flex h-10 items-center justify-center gap-2 rounded-lg border text-[13px] font-medium transition-colors',
              kind === k ? 'border-ink bg-surface text-ink' : 'border-stone-200 text-stone-500 hover:text-ink',
            )}
          >
            <Icon size={15} aria-hidden className="max-[359px]:hidden" /> {label}
          </button>
        ))}
      </div>
      <label htmlFor="feedback-text" className="mb-1.5 mt-4 block text-[13px] font-medium">
        {bug ? t('Que s’est-il passé ?') : t('Ton message')}
      </label>
      <textarea
        id="feedback-text"
        ref={textRef}
        autoFocus
        className="field h-auto! min-h-[120px] w-full resize-y py-2 leading-relaxed"
        maxLength={4000}
        value={text}
        onChange={e => (setText(e.target.value), e.target.value.trim() && setError(''))}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'feedback-text-err' : undefined}
        placeholder={bug ? t('J’ai ajouté un fichier dans le Drive, il n’apparaît pas…') : t('J’aimerais pouvoir…')}
      />
      <FieldError id="feedback-text-err">{error}</FieldError>
      <p className="mt-1.5 text-[11.5px] text-stone-500">{t('On joint la page ouverte et le type d’appareil, rien d’autre.')}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={close}>
          {t('Annuler')}
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
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
  // No reason chosen: said under the choices at the submit, the focus on the first one.
  const [error, setError] = useState('');
  const firstReason = useRef<HTMLInputElement>(null);
  const heading = target.kind === 'note' ? t('Signaler cette note') : target.kind === 'file' ? t('Signaler ce fichier') : t('Signaler cet événement');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!reason) {
      setError(t('Choisis une raison.'));
      return firstReason.current?.focus();
    }
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
      <fieldset className="mt-4" aria-invalid={error ? true : undefined} aria-describedby={error ? 'report-reason-err' : undefined}>
        <legend className="text-[13px] font-medium">{t('Pourquoi ?')}</legend>
        <div className="mt-1.5 grid gap-1">
          {REPORT_REASONS.map((r, i) => (
            <label key={r.value} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13.5px] hover:bg-stone-100 pointer-coarse:py-3">
              <input ref={i === 0 ? firstReason : undefined} type="radio" name="report-reason" value={r.value} checked={reason === r.value} onChange={() => (setReason(r.value), setError(''))} className="accent-[var(--color-brand-600)]" />
              {r.label}
            </label>
          ))}
        </div>
        <FieldError id="report-reason-err">{error}</FieldError>
      </fieldset>
      <label htmlFor="report-text" className="mb-1.5 mt-4 block text-[13px] font-medium">
        {t('Précisions')} <span className="font-normal text-stone-500">{t('(facultatif)')}</span>
      </label>
      <textarea
        id="report-text"
        className="field h-auto! min-h-[72px] w-full resize-y py-2 leading-relaxed"
        maxLength={1000}
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <p className="mt-1.5 text-[11.5px] text-stone-500">{t('Les membres ne savent pas qui a signalé. L’administrateur voit une copie du contenu.')}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          {t('Annuler')}
        </button>
        <button type="submit" className="btn-danger" disabled={busy}>
          {busy ? t('Envoi…') : t('Envoyer le signalement')}
        </button>
      </div>
    </form>
  );
}
