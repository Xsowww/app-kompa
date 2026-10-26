import { useState } from 'react';
import { Bug, Check, Flag, Lightbulb, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { EmptyState } from '../../components/EmptyState';
import type { Feedback, Inbox, Report } from './inbox';
import { REPORT_REASONS } from '../../lib/feedback';
import { confirmAction, toast } from '../../store/ui';
import { cx, formatBytes, relativeTime } from '../../lib/utils';
import { fmtDay, fromKey } from '../../lib/dates';
import { t } from '../../i18n';

const KIND = { note: t('Note'), file: t('Fichier'), event: t('Événement') };
const reasonLabel = (r: string) => REPORT_REASONS.find(x => x.value === r)?.label ?? r;

/** Onglet « À traiter » : signalements des groupes et messages « Avis ou bug ». */
export default function AdminInbox({ inbox, missing, reload }: { inbox: Inbox | null; missing: boolean; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState(false);

  const handle = async (r: Report, action: 'remove' | 'dismiss') => {
    if (!supabase) return;
    if (action === 'remove' && !(await confirmAction(t('Retirer ce contenu du groupe ?'), t('« {title} » sera supprimé pour tous les membres. Les autres signalements de ce contenu seront classés.', { title: r.snapshot.title ?? '' }), t('Retirer')))) return;
    setBusy(r.id);
    const { data: path, error } = await supabase.rpc('admin_handle_report', { p_id: r.id, p_action: action });
    // A file: its content leaves the storage too.
    if (!error && typeof path === 'string' && path) await supabase.storage.from('groups').remove([path]);
    setBusy(null);
    if (error) return toast(t('Action impossible. Réessaie.'), 'error');
    toast(action === 'remove' ? t('Contenu retiré.') : t('Signalement classé.'), 'success');
    reload();
  };

  const toggleDone = async (f: Feedback) => {
    if (!supabase) return;
    setBusy(f.id);
    const { error } = await supabase.rpc('admin_feedback_done', { p_id: f.id, p_done: f.status === 'open' });
    setBusy(null);
    if (error) return toast(t('Action impossible. Réessaie.'), 'error');
    reload();
  };

  if (missing) {
    return (
      <p className="card p-5 text-[13px] text-stone-500">
        {t('Applique la migration 2026-10-16b_signalements_avis.sql dans Supabase pour recevoir les signalements et les avis.')}
      </p>
    );
  }
  // Not read (the first load failed): said, with « Réessayer », not an empty tab.
  if (!inbox) return <EmptyState className="card" tone="error" title={t('Impossible de charger.')} onRetry={reload} />;
  const reports = inbox.reports.filter(r => (r.status === 'open') !== history);
  const feedback = inbox.feedback.filter(f => (f.status === 'open') !== history);
  const openReports = inbox.reports.filter(r => r.status === 'open').length;
  const openFeedback = inbox.feedback.filter(f => f.status === 'open').length;

  return (
    <div>
      <div className="mb-3 flex h-8 w-fit items-center rounded-lg bg-stone-100 p-0.5 text-[12px] pointer-coarse:h-10" role="group" aria-label={t('Afficher')}>
        {[
          [false, t('À traiter ({n})', { n: openReports + openFeedback })],
          [true, t('Déjà traités')],
        ].map(([v, label]) => (
          <button
            key={String(v)}
            aria-pressed={history === v}
            onClick={() => setHistory(v as boolean)}
            className={cx('h-7 rounded-md px-3 font-medium transition-colors pointer-coarse:h-9', history === v ? 'bg-surface text-ink shadow-card' : 'text-stone-500 hover:text-ink')}
          >
            {label as string}
          </button>
        ))}
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <section className="card overflow-hidden" aria-labelledby="admin-reports">
          <h2 id="admin-reports" className="flex items-center gap-2 border-b border-stone-100 px-4 py-3 text-[13px] font-medium text-stone-600">
            <Flag size={14} /> {t('Signalements des groupes')}
            {!history && openReports > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{openReports}</span>}
          </h2>
          {reports.length === 0 ? (
            <EmptyState size="sm" className="py-8" icon={Flag} title={history ? t('Aucun signalement traité.') : t('Rien à traiter.')} />
          ) : (
            <ul className="divide-y divide-stone-100">
              {reports.map(r => (
                // A long link or word in a report wraps instead of going out of the card.
                <li key={r.id} className="px-4 py-3 [overflow-wrap:anywhere]">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-stone-500">
                    <span className="font-medium text-ink">{KIND[r.kind]}</span>
                    {r.snapshot.group && <span>· {r.snapshot.group}</span>}
                    <span>· {relativeTime(r.created_at)}</span>
                    {r.status !== 'open' && <span>· {r.status === 'removed' ? t('retiré') : t('classé sans suite')}</span>}
                  </div>
                  <p className="mt-1 text-[14px] font-medium">« {r.snapshot.title ?? t('Sans titre')} »</p>
                  {r.snapshot.excerpt && <p className="mt-1 line-clamp-3 text-[12.5px] text-stone-600">{r.snapshot.excerpt}</p>}
                  {r.kind === 'event' && r.snapshot.date && (
                    <p className="mt-1 text-[12.5px] text-stone-600">
                      {fmtDay(fromKey(r.snapshot.date), 'EEE d MMM')}
                      {r.snapshot.start && ` · ${r.snapshot.start}`}
                      {r.snapshot.place && ` · ${r.snapshot.place}`}
                    </p>
                  )}
                  {r.kind === 'file' && r.snapshot.size != null && <p className="mt-1 text-[12.5px] text-stone-600">{formatBytes(r.snapshot.size)}</p>}
                  <p className="mt-1.5 text-[12.5px]">
                    <span className="font-medium text-red-700">{reasonLabel(r.reason)}</span>
                    {r.message && <span className="text-stone-600"> — {r.message}</span>}
                  </p>
                  <p className="mt-1 text-[11.5px] text-stone-500">
                    {t('Signalé par {reporter}', { reporter: r.reporter ?? t('un compte supprimé') })} · {t('auteur {author}', { author: r.author ?? t('inconnu') })}
                  </p>
                  {r.status === 'open' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.still_there ? (
                        <button className="btn-danger h-8 text-[12px]" disabled={busy === r.id} onClick={() => void handle(r, 'remove')}>
                          <Trash2 size={13} /> {t('Retirer le contenu')}
                        </button>
                      ) : (
                        <span className="self-center text-[12px] text-stone-500">{t('Déjà supprimé par le groupe.')}</span>
                      )}
                      <button className="btn-secondary h-8 text-[12px]" disabled={busy === r.id} onClick={() => void handle(r, 'dismiss')}>
                        {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {t('Classer sans suite')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden" aria-labelledby="admin-feedback">
          <h2 id="admin-feedback" className="flex items-center gap-2 border-b border-stone-100 px-4 py-3 text-[13px] font-medium text-stone-600">
            <Lightbulb size={14} /> {t('Avis et bugs')}
            {!history && openFeedback > 0 && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{openFeedback}</span>}
          </h2>
          {feedback.length === 0 ? (
            <EmptyState size="sm" className="py-8" icon={Lightbulb} title={history ? t('Aucun message traité.') : t('Rien à traiter.')} />
          ) : (
            <ul className="divide-y divide-stone-100">
              {feedback.map(f => (
                <li key={f.id} className="flex gap-3 px-4 py-3">
                  <span className={cx('mt-0.5 shrink-0', f.kind === 'bug' ? 'text-red-600' : 'text-amber-600')} aria-label={f.kind === 'bug' ? t('Bug') : t('Avis')}>
                    {f.kind === 'bug' ? <Bug size={15} /> : <Lightbulb size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-[13.5px]">{f.message}</p>
                    <p className="mt-1 text-[11.5px] text-stone-500">
                      {f.email ?? t('compte supprimé')} · {relativeTime(f.created_at)}
                      {f.page && ` · ${f.page}`}
                      {f.device && ` · ${f.device}`}
                    </p>
                  </div>
                  <button
                    className="icon-btn shrink-0"
                    disabled={busy === f.id}
                    title={f.status === 'open' ? t('Marquer comme traité') : t('Remettre à traiter')}
                    aria-label={f.status === 'open' ? t('Marquer comme traité') : t('Remettre à traiter')}
                    onClick={() => void toggleDone(f)}
                  >
                    {f.status === 'open' ? <Check size={15} /> : <RotateCcw size={15} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
