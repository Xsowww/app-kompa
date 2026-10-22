import { AlertTriangle, RotateCw, SearchX, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../lib/utils';
import { t } from '../i18n';

/** The shape of the content to come: rows (notes, tasks), tiles (Drive), time slots (calendar), people (members). */
export type Shape = 'list' | 'tiles' | 'slots' | 'people';

interface Action {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

// Bars of different lengths, so the rows read as different items.
const WIDTHS = ['62%', '44%', '54%', '38%'];

/** Grey placeholders in the shape of the content: still (preview of what will appear) or pulsing (loading). */
function Shapes({ shape, rows, pulse }: { shape: Shape; rows: number; pulse?: boolean }) {
  const block = cx('bg-stone-200', pulse && 'animate-pulse motion-reduce:animate-none');
  const bar = block + ' rounded-full';
  const items = Array.from({ length: rows }, (_, i) => i);
  if (shape === 'tiles')
    return (
      <div className="grid w-full grid-cols-3 gap-2">
        {items.map(i => (
          <div key={i} className="flex flex-col items-center gap-2 rounded-xl border border-stone-200 px-2 py-3">
            <span className={cx(block, 'h-8 w-7 rounded-md')} />
            <span className={bar + ' h-1.5'} style={{ width: WIDTHS[i % 4] }} />
          </div>
        ))}
      </div>
    );
  return (
    <div className="flex w-full flex-col gap-2">
      {items.map(i =>
        shape === 'slots' ? (
          <div key={i} className="flex items-center gap-2.5">
            <span className={bar + ' h-1.5 w-7 shrink-0'} />
            <span className={cx(block, 'h-7 flex-1 rounded-lg')} style={{ maxWidth: `${88 - i * 14}%` }} />
          </div>
        ) : (
          <div key={i} className="flex items-center gap-2.5 rounded-xl border border-stone-200 px-3 py-2.5">
            <span className={cx(block, 'h-6 w-6 shrink-0', shape === 'people' ? 'rounded-full' : 'rounded-md')} />
            <span className="flex flex-1 flex-col gap-1.5">
              <span className={bar + ' h-2'} style={{ width: WIDTHS[i % 4] }} />
              <span className={bar + ' h-1.5 opacity-70'} style={{ width: WIDTHS[(i + 1) % 4] }} />
            </span>
          </div>
        ),
      )}
    </div>
  );
}

/** Loading: the shape of the content, pulsing; shown only when the wait lasts (no flash on a fast load). */
export function Skeleton({ shape = 'list', rows = 3, className }: { shape?: Shape; rows?: number; className?: string }) {
  return (
    <div role="status" aria-label={t('Chargement')} className={cx('late-show w-full', className)}>
      <Shapes shape={shape} rows={rows} pulse />
    </div>
  );
}

/**
 * An empty list, a search without result, or content that couldn't be read. Names what is missing, offers one
 * way to start (or « Réessayer »), and can show the shape of what will appear here.
 * `search`: the field and the filters stay above; `secondary` is « Retirer les filtres ».
 */
export function EmptyState({
  icon,
  title,
  text,
  action,
  secondary,
  preview,
  tone = 'empty',
  onRetry,
  size = 'md',
  className,
}: {
  icon?: LucideIcon;
  title: string;
  text?: ReactNode;
  action?: Action;
  secondary?: Action;
  preview?: Shape;
  tone?: 'empty' | 'search' | 'error';
  onRetry?: () => void;
  /** sm: in a side panel or a small tile. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const Icon = tone === 'error' ? AlertTriangle : (icon ?? (tone === 'search' ? SearchX : undefined));
  const main = tone === 'error' && onRetry ? { label: t('Réessayer'), onClick: onRetry, icon: RotateCw } : action;
  const sm = size === 'sm';
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={cx('flex flex-col items-center text-center', sm ? 'px-2 py-4' : 'px-4 py-10', className)}>
      {Icon && (
        <span className={cx('flex shrink-0 items-center justify-center rounded-full', sm ? 'h-10 w-10' : 'h-12 w-12', tone === 'error' ? 'bg-red-50 text-red-600' : 'bg-stone-200/60 text-stone-500')} aria-hidden>
          <Icon size={sm ? 18 : 21} strokeWidth={1.8} />
        </span>
      )}
      <p className={cx('mt-3 max-w-sm font-semibold text-ink [overflow-wrap:anywhere]', sm ? 'text-[13.5px]' : 'text-[15px]')}>{title}</p>
      {text && <div className="mt-1 max-w-xs text-[13px] text-stone-500">{text}</div>}
      {(main || secondary) && (
        <div className={cx('flex flex-wrap justify-center gap-2', sm ? 'mt-3' : 'mt-4')}>
          {main && (
            <button type="button" className={cx(tone === 'search' ? 'btn-secondary' : 'btn-primary', 'h-9 px-3.5')} onClick={main.onClick}>
              {main.icon && <main.icon size={15} aria-hidden />} {main.label}
            </button>
          )}
          {secondary && (
            <button type="button" className="btn-secondary h-9 px-3.5" onClick={secondary.onClick}>
              {secondary.icon && <secondary.icon size={15} aria-hidden />} {secondary.label}
            </button>
          )}
        </div>
      )}
      {preview && tone === 'empty' && (
        <div aria-hidden className={cx('pointer-events-none w-full select-none opacity-70 [mask-image:linear-gradient(to_bottom,black_30%,transparent)]', sm ? 'mt-4 max-w-[240px]' : 'mt-7 max-w-[300px]')}>
          <Shapes shape={preview} rows={3} />
        </div>
      )}
    </div>
  );
}

/** One line above content that stays on screen (a calendar): couldn't be read, « Réessayer ». */
export function LoadErrorLine({ onRetry, className }: { onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={cx('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-red-50 px-3 py-1.5 text-[13px] text-red-700', className)}>
      <AlertTriangle size={15} aria-hidden className="shrink-0" />
      <span className="mr-auto">{t('Impossible de charger.')}</span>
      <button type="button" className="btn-ghost h-8 px-2.5 text-[12.5px] text-red-700 hover:bg-red-100 hover:text-red-800" onClick={onRetry}>
        <RotateCw size={13} aria-hidden /> {t('Réessayer')}
      </button>
    </div>
  );
}
