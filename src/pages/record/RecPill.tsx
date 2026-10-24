import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Star } from 'lucide-react';
import { elapsed, star, useRecLive, useRecorder } from '../../store/recorder';
import { clock } from '../../lib/recorder/course';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';

/** On every other page while a class is recorded: the time, a way back, and « Moment important ». */
export default function RecPill() {
  const session = useRecorder(s => s.session);
  const hearing = useRecLive(s => s.hearing);
  const problem = useRecLive(s => s.problem);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [, tick] = useState(0);
  const on = !!session && session.phase !== 'done' && pathname !== '/enregistrer';
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => {
      clearInterval(t);
    };
  }, [on]);
  // The upload card (components/UploadCard) goes one line up instead of sitting on it.
  useLayoutEffect(() => {
    if (!on) return;
    const root = document.documentElement.style;
    root.setProperty('--rec-room', '4rem');
    return () => void root.removeProperty('--rec-room');
  }, [on]);
  if (!on || !session) return null;
  const finishing = session.phase === 'finishing';
  const paused = !!session.pausedAt;
  return (
    // Level with the « + » button (components/CreateButton), and never as wide as to reach it: the title gives way.
    <div className="fixed bottom-[calc(5.375rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex max-w-[calc(100vw-10rem)] -translate-x-1/2 items-center gap-1 rounded-full bg-tile-dark p-1 text-white shadow-pop ring-1 ring-white/10 lg:bottom-[30px] lg:left-[calc(50%+128px)] lg:max-w-[calc(100vw-27rem)]">
      <button type="button" onClick={() => navigate('/enregistrer')} className="flex h-9 min-w-0 items-center gap-2 rounded-full pl-3 pr-3 text-[13px] font-semibold hover:bg-white/10" title={problem ?? t('Revenir à l’enregistrement')}>
        {finishing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', hearing && !paused ? 'animate-pulse bg-red-500' : 'bg-amber-400')} aria-hidden />}
        {!finishing && (paused ? <span className="shrink-0 text-[11px] font-bold tracking-wide text-amber-300">{t('En pause')}</span> : <span className="text-[11px] font-bold tracking-wide text-red-400">REC</span>)}
        <span className="tabular">{finishing ? t('Rédaction…') : clock(elapsed(session))}</span>
        <span className="min-w-0 max-w-[140px] truncate font-medium text-white/70 max-[400px]:hidden">{session.title}</span>
      </button>
      {hearing && !paused && (
        <button type="button" onClick={star} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/10" title={t('Moment important')} aria-label={t('Marquer un moment important')}>
          <Star size={15} className="fill-amber-400 text-amber-400" />
        </button>
      )}
    </div>
  );
}

/** Next to « Enregistrer » in the menu, while a class is recorded: a red dot and the time. */
export function RecBadge() {
  const session = useRecorder(s => s.session);
  const hearing = useRecLive(s => s.hearing);
  const [, tick] = useState(0);
  const on = !!session && session.phase !== 'done';
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
  if (!on || !session) return null;
  const paused = !!session.pausedAt;
  return (
    <span className="ml-auto flex items-center gap-1.5 text-[11.5px] font-semibold tabular" aria-label={paused ? t('En pause') : t('Enregistrement en cours')}>
      <span className={cx('h-2 w-2 rounded-full', hearing && !paused ? 'animate-pulse bg-red-500' : 'bg-amber-400')} aria-hidden />
      {session.phase === 'finishing' ? '…' : clock(elapsed(session)).replace(/^00:/, '')}
    </span>
  );
}
