import { Bell } from 'lucide-react';
import { remindersShort, remindersText } from '../../lib/reminders';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';

/**
 * An event's reminders in a list: a small chip, lit up but quiet — a bell and « 1 h avant » for one, « 2 rappels » for
 * more (the whole sentence, « Le jour même à 09:00, La veille à 18:00 », was cut by what stood beside it). Never cut: it
 * goes to the next line whole. Every reminder in its tooltip and for screen readers; a tap opens the event, where each
 * one is listed.
 */
export function ReminderChip({ reminders, date, time, className }: { reminders: number[]; date: string; time?: string; className?: string }) {
  if (!reminders.length) return null;
  const all = remindersText(reminders, date, time);
  return (
    <span data-reminders className={cx('rem-chip inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full bg-brand-50 px-1.5 text-[11px] font-medium leading-[18px] text-brand-700', className)} title={all}>
      <Bell size={10} strokeWidth={2.4} className="shrink-0" aria-hidden />
      <span aria-hidden>{remindersShort(reminders, date, time)}</span>
      <span className="sr-only">{t('Rappels : {list}', { list: all })}</span>
    </span>
  );
}
