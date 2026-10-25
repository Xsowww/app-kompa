import { CalendarRange, Repeat } from 'lucide-react';
import { isSpan } from '../../lib/repeat';
import { t } from '../../i18n';

/** The mark of an event linked to others: one that repeats, or one day of an event over several days. */
export default function SeriesIcon({ series, size = 11, className }: { series?: string; size?: number; className?: string }) {
  if (!series) return null;
  const span = isSpan(series);
  const Icon = span ? CalendarRange : Repeat;
  return <Icon size={size} className={className} aria-label={span ? t('Sur plusieurs jours') : t('Se répète')} />;
}
