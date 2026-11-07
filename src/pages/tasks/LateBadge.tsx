import { CircleAlert } from 'lucide-react';
import { fmtDay, fromKey, todayKey } from '../../lib/dates';
import { cx } from '../../lib/utils';
import { lateDays, lateLabel } from './lateDays';
import { t } from '../../i18n';
import './late.css';

/**
 * A late task, said loud: a red badge « En retard · depuis 3 jours », the same in Tâches, on the home page, in the
 * calendar and at the top of the task's window (only a small « Ce moment est passé. » said it there). Its day in the tooltip.
 */
export function LateBadge({ due, size = 'sm', className }: { due: string; size?: 'sm' | 'md'; className?: string }) {
  const days = lateDays({ due }, todayKey());
  if (!days) return null;
  return (
    <span
      data-late-badge
      className={cx(
        'late-badge inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold',
        size === 'md' ? 'h-7 px-2.5 text-[12.5px]' : 'h-5 px-1.5 text-[11.5px] leading-5',
        className,
      )}
      title={t('Prévue le {day}', { day: fmtDay(fromKey(due), 'EEEE d MMMM') })}
    >
      <CircleAlert size={size === 'md' ? 14 : 12} strokeWidth={2.4} className="shrink-0" aria-hidden />
      {lateLabel(days)}
    </span>
  );
}
