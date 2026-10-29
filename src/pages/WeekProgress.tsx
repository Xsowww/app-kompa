import { Check } from 'lucide-react';
import { useTodos } from '../store/todos';
import { cheer, weekItems } from '../lib/weekProgress';
import { cx } from '../lib/utils';
import { tn } from '../i18n';

/** The ring of the week: how much of what was planned is done, filling up as things get ticked. */
export default function WeekProgress({ from, to }: { from: string; to: string }) {
  const todos = useTodos(s => s.todos);
  const { total, done } = weekItems(todos, from, to);
  // Nothing to do this week: nothing left either, so the ring is full (not an empty 0 %).
  const ratio = total ? done / total : 1;
  const full = done === total;
  const R = 46;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex flex-1 flex-col">
    <div className="flex items-center gap-5" role="group" aria-label={`${tn(done, '{n} tâche sur {total} faite cette semaine.', '{n} tâches sur {total} faites cette semaine.', { total })} ${cheer(done, total)}`}>
      <span className="relative h-[116px] w-[116px] shrink-0">
        <svg viewBox="0 0 116 116" className="h-full w-full" shapeRendering="geometricPrecision" aria-hidden>
          <circle cx="58" cy="58" r={R} fill="none" strokeWidth="12" className="stroke-stone-100" />
          <circle
            cx="58"
            cy="58"
            r={R}
            fill="none"
            strokeWidth="12"
            // Rotated inside the drawing (a CSS rotation turns the ring into a blurry picture on some screens);
            // full: a plain circle, the two round ends of the stroke would make a bump where they meet.
            transform="rotate(-90 58 58)"
            strokeLinecap={full ? 'butt' : 'round'}
            strokeDasharray={full ? undefined : C}
            strokeDashoffset={full ? undefined : C * (1 - ratio)}
            className={cx('transition-[stroke-dashoffset,stroke] duration-700 ease-out', full ? 'stroke-emerald-500' : 'stroke-tile-blue', !done && !full && 'opacity-0')}
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
        {/* Nothing ticked yet: « 0 / 3 » would only repeat the sentence (« C’est parti : 3 tâches… »). */}
        {done > 0 && (
          <>
            <span className="tabular block text-[26px] font-extrabold leading-none tracking-[-0.03em]">
              {done}
              <span className="text-[16px] font-bold text-stone-500"> / {total}</span>
            </span>
            <span className="mt-1 block text-[13px] font-medium text-stone-500">{tn(total, 'tâche faite cette semaine', 'tâches faites cette semaine')}</span>
          </>
        )}
        <span className={cx('block text-[13px] font-semibold leading-snug', done > 0 && 'mt-2.5', full ? 'text-emerald-700 dark:text-emerald-400' : 'text-ink')}>{cheer(done, total)}</span>
      </span>
    </div>
    </div>
  );
}
