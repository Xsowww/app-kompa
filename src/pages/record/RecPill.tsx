import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Star } from 'lucide-react';
import { elapsed, star, useRecLive, useRecorder } from '../../store/recorder';
import { clock } from '../../lib/recorder/course';
import { cx } from '../../lib/utils';

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
    return () => clearInterval(t);
  }, [on]);
  if (!on || !session) return null;
  const finishing = session.phase === 'finishing';
  return (
    <div className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-tile-dark p-1 text-white shadow-pop ring-1 ring-white/10 lg:bottom-5 lg:left-[calc(50%+128px)]">
      <button type="button" onClick={() => navigate('/enregistrer')} className="flex h-9 items-center gap-2 rounded-full pl-3 pr-3 text-[13px] font-semibold hover:bg-white/10" title={problem ?? 'Revenir à l’enregistrement'}>
        {finishing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <span className={cx('h-2.5 w-2.5 rounded-full', hearing ? 'animate-pulse bg-red-500' : 'bg-amber-400')} aria-hidden />}
        {!finishing && <span className="text-[11px] font-bold tracking-wide text-red-400">REC</span>}
        <span className="tabular">{finishing ? 'Rédaction…' : clock(elapsed(session))}</span>
        <span className="max-w-[140px] truncate font-medium text-white/70">{session.title}</span>
      </button>
      {hearing && (
        <button type="button" onClick={star} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" title="Moment important" aria-label="Marquer un moment important">
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
  return (
    <span className="ml-auto flex items-center gap-1.5 text-[11.5px] font-semibold tabular" aria-label="Enregistrement en cours">
      <span className={cx('h-2 w-2 rounded-full', hearing ? 'animate-pulse bg-red-500' : 'bg-amber-400')} aria-hidden />
      {session.phase === 'finishing' ? '…' : clock(elapsed(session)).replace(/^00:/, '')}
    </span>
  );
}
