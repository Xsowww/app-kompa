import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { fmtDay, fromKey, todayKey } from '../lib/dates';
import { useTodos } from '../store/todos';
import { cheer, weekItems } from '../lib/weekProgress';
import { cx } from '../lib/utils';
import { t, tn } from '../i18n';

/** The ring of the week: how much of what was planned is done, filling up as things get ticked. */
export default function WeekProgress({ from, to }: { from: string; to: string }) {
  const todos = useTodos(s => s.todos);
  const { total, done, left } = weekItems(todos, from, to);
  const ratio = total ? done / total : 0;
  const full = total > 0 && done === total;
  const R = 46;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex flex-1 flex-col">
    <div className="flex items-center gap-5" role="group" aria-label={`${tn(done, '{n} tâche sur {total} faite cette semaine.', '{n} tâches sur {total} faites cette semaine.', { total })} ${cheer(done, total)}`}>
      <span className="relative h-[116px] w-[116px] shrink-0">
        <svg viewBox="0 0 116 116" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="58" cy="58" r={R} fill="none" strokeWidth="12" className="stroke-stone-100" />
          <circle
            cx="58"
            cy="58"
            r={R}
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - ratio)}
            className={cx('transition-[stroke-dashoffset,stroke] duration-700 ease-out', full ? 'stroke-emerald-500' : 'stroke-tile-blue', !done && 'opacity-0')}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          {full ? (
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-white">
              <Check size={24} strokeWidth={3} />
            </span>
          ) : (
            <span className="tabular text-[28px] font-extrabold leading-none tracking-[-0.04em]">
              {Math.round(ratio * 100)}
              <span className="text-[15px]">%</span>
            </span>
          )}
        </span>
      </span>
      <span className="min-w-0">
        <span className="tabular block text-[26px] font-extrabold leading-none tracking-[-0.03em]">
          {done}
          <span className="text-[16px] font-bold text-stone-500"> / {total}</span>
        </span>
        <span className="mt-1 block text-[13px] font-medium text-stone-500">{tn(total, 'tâche faite cette semaine', 'tâches faites cette semaine')}</span>
        <span className={cx('mt-2.5 block text-[13px] font-semibold leading-snug', full ? 'text-emerald-700 dark:text-emerald-400' : 'text-ink')}>{cheer(done, total)}</span>
      </span>
    </div>
    {left.length > 0 && (
      <div className="mt-4 border-t border-stone-100 pt-3">
        <p className="eyebrow mb-1">{t('Ce qu’il reste')}</p>
        <ul className="-mx-1.5">
          {left.slice(0, 3).map(x => (
            <li key={x.id}>
              <Link
                to={`/taches?tache=${x.id}`}
                className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-[13px] transition-colors hover:bg-stone-50 pointer-coarse:py-2"
              >
                <span className="h-4 w-4 shrink-0 rounded-full border-[1.5px] border-stone-300" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">{x.title}</span>
                {x.due && (
                  <span className={cx('shrink-0 text-[12px]', x.due < todayKey() ? 'font-semibold text-urgent-text' : 'capitalize text-stone-500')}>
                    {x.due < todayKey() ? t('En retard') : x.due === todayKey() ? t('Auj.') : fmtDay(fromKey(x.due), 'EEE d')}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {/* One left: straight to it. Several: the next one (the list shows them all from there). */}
        <Link to={`/taches?tache=${left[0].id}`} className="btn-secondary mt-2 h-9 w-full">
          {left.length === 1 ? t('Aller à ma tâche') : left.length > 3 ? t('Voir les {n} qui restent', { n: left.length }) : t('Aller à mes tâches')} <ArrowRight size={15} />
        </Link>
      </div>
    )}
    </div>
  );
}
