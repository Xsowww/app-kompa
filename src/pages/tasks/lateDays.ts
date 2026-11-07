import { differenceInCalendarDays } from 'date-fns';
import { fromKey } from '../../lib/dates';
import { t, tn } from '../../i18n';

/** How many days a task not done is late (0: not late). `today`: YYYY-MM-DD. */
export function lateDays(task: { due?: string; done?: boolean }, today: string): number {
  if (task.done || !task.due || task.due >= today) return 0;
  return differenceInCalendarDays(fromKey(today), fromKey(task.due));
}

/** « En retard · depuis hier », « En retard · depuis 3 jours »: the same words everywhere (LateBadge). */
export function lateLabel(days: number): string {
  return days <= 1 ? t('En retard · depuis hier') : tn(days, 'En retard · depuis {n} jour', 'En retard · depuis {n} jours');
}
