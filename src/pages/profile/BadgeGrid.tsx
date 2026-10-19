import { Lock } from 'lucide-react';
import { FAMILIES, type Badge } from '../../lib/badges';
import { fmt, fromKey } from '../../lib/dates';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';

const earnedLabel = (at?: string) => (at ? t('Obtenu le {date}', { date: fmt(at.length === 10 ? fromKey(at) : new Date(at), 'd MMMM yyyy') }) : t('Obtenu'));

function BadgeCard({ b }: { b: Badge }) {
  const color = FAMILIES[b.family].color;
  const pct = Math.round((b.current / b.target) * 100);
  return (
    <li className={cx('flex gap-3 rounded-xl border p-3.5', b.earned ? 'border-stone-200/80 bg-surface shadow-card' : 'border-dashed border-stone-200 bg-stone-50/60')}>
      <span
        className={cx('relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full', !b.earned && 'bg-stone-100 text-stone-500')}
        style={b.earned ? { background: `color-mix(in srgb, ${color} 13%, var(--color-surface))`, color, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 22%, var(--color-surface))` } : undefined}
      >
        <b.icon size={18} strokeWidth={1.9} />
        {!b.earned && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-stone-50 bg-stone-300 text-white">
            <Lock size={8} strokeWidth={3} />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx('text-[13px] font-semibold', b.earned ? 'text-ink' : 'text-stone-600')}>{b.title}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-stone-500">{b.description}</p>
        {b.earned ? (
          <p className="mt-2 text-[11px] text-stone-500">{earnedLabel(b.earnedAt)}</p>
        ) : (
          <div className="mt-2 flex items-center gap-2" title={t('{n} sur {total}', { n: b.current, total: b.target })}>
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-stone-200/70" role="progressbar" aria-valuemin={0} aria-valuemax={b.target} aria-valuenow={b.current} aria-label={t('Progression vers « {title} »', { title: b.title })}>
              <span className="block h-full rounded-full bg-stone-500" style={{ width: `${pct}%` }} />
            </span>
            <span className="tabular text-[11px] text-stone-500">
              {b.current}/{b.target}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

export default function BadgeGrid({ badges }: { badges: Badge[] }) {
  const earned = badges.filter(b => b.earned).sort((a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? ''));
  // Locked badges: the closest to completion first.
  const locked = badges.filter(b => !b.earned).sort((a, b) => b.current / b.target - a.current / a.target);
  return (
    <div className="space-y-5">
      {earned.length > 0 && (
        <div>
          <p className="eyebrow mb-2">{t('Obtenus')}</p>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {earned.map(b => (
              <BadgeCard key={b.id} b={b} />
            ))}
          </ul>
        </div>
      )}
      {locked.length > 0 && (
        <div>
          <p className="eyebrow mb-2">{t('À débloquer')}</p>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {locked.map(b => (
              <BadgeCard key={b.id} b={b} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
