import { useEffect, useRef, useState } from 'react';
import { fmt, fromKey, todayKey } from '../../lib/dates';
import { cx } from '../../lib/utils';
import { formatMinutes } from './focusStats';

export const FOCUS_COLOR = '#2f9e6b';

/* ── Minutes per subject: horizontal bars ────────────────────── */

export function SubjectBars({ rows }: { rows: { subject: string; minutes: number; sessions: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map(r => r.minutes));
  const total = rows.reduce((a, r) => a + r.minutes, 0);

  if (rows.length === 0) return <p className="py-8 text-center text-[13px] text-stone-500">Aucune session sur cette période.</p>;

  return (
    <ul className="space-y-[2px]" onMouseLeave={() => setHover(null)}>
      {rows.map((r, i) => (
        <li
          key={r.subject}
          onMouseEnter={() => setHover(i)}
          className="relative grid grid-cols-[minmax(72px,40%)_1fr_auto] items-center gap-3 rounded-md px-1 py-1.5 text-[13px]"
        >
          <span className="truncate text-stone-600" title={r.subject}>
            {r.subject}
          </span>
          <span className="h-3">
            <span
              className="block h-full rounded-r-[4px] transition-opacity"
              style={{ width: `${Math.max(1.5, (r.minutes / max) * 100)}%`, background: FOCUS_COLOR, opacity: hover === null || hover === i ? 1 : 0.45 }}
            />
          </span>
          <span className="tabular w-[64px] text-right text-stone-600">{formatMinutes(r.minutes)}</span>
          {hover === i && (
            <span
              className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-md bg-inverse px-2.5 py-1.5 text-[12px] whitespace-nowrap text-on-inverse shadow-pop"
              style={{ left: `clamp(0px, calc(40% + ${(r.minutes / max) * 40}%), calc(100% - 170px))` }}
            >
              <span className="block text-on-inverse/60">{r.subject}</span>
              <span className="tabular font-medium">
                {formatMinutes(r.minutes)} · {r.sessions} session{r.sessions > 1 ? 's' : ''} · {Math.round((r.minutes / total) * 100)} %
              </span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── Minutes per day: columns (same drawing as the admin charts) ── */

export function DailyFocus({ data }: { data: { day: string; minutes: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  const max = Math.max(0, ...data.map(d => d.minutes));
  const top = max <= 60 ? 60 : Math.ceil(max / 60) * 60;

  // Draw at the real width so that the axis text keeps its size on a phone.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 140;
  const slot = W / data.length;
  const bar = Math.min(16, slot - 2);
  const tip = hover !== null ? data[hover] : null;
  const today = todayKey();
  const last = data.length - 1;

  return (
    <div ref={box} className="relative pt-1">
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full overflow-visible" role="img" aria-label={`Minutes de travail par jour sur les 30 derniers jours : ${data.reduce((a, d) => a + d.minutes, 0)} min au total, ${data.filter(d => d.minutes > 0).length} jours actifs, maximum ${max} min`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1="0" x2={W} y1={H - f * H} y2={H - f * H} stroke="var(--color-stone-200)" strokeWidth="1" />
            {f > 0 && (
              <text x={W} y={H - f * H - 4} textAnchor="end" fontSize="10" fill="var(--color-stone-500)">
                {formatMinutes(Math.round(top * f))}
              </text>
            )}
          </g>
        ))}
        {data.map((d, i) => {
          const h = (d.minutes / top) * H;
          const x = i * slot + (slot - bar) / 2;
          const r = Math.min(4, h / 2, bar / 2);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={i * slot} y="0" width={slot} height={H} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x} ${H} V${H - h + r} Q${x} ${H - h} ${x + r} ${H - h} H${x + bar - r} Q${x + bar} ${H - h} ${x + bar} ${H - h + r} V${H} Z`}
                  fill={FOCUS_COLOR}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
            </g>
          );
        })}
        {[0, Math.floor(last / 2), last].map(i => (
          <text key={i} x={i * slot + slot / 2} y={H + 14} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} fontSize="10" fill="var(--color-stone-500)">
            {data[i].day === today ? 'Aujourd’hui' : fmt(fromKey(data[i].day), 'd MMM')}
          </text>
        ))}
      </svg>
      {tip && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md bg-inverse px-2.5 py-1.5 text-[12px] text-on-inverse shadow-pop"
          style={{ left: `clamp(0px, calc(${((hover + 0.5) / data.length) * 100}% - 70px), calc(100% - 140px))` }}
        >
          <p className="text-on-inverse/60 first-letter:uppercase">{fmt(fromKey(tip.day), 'EEEE d MMMM')}</p>
          <p className="tabular font-medium">{tip.minutes ? formatMinutes(tip.minutes) : 'Pas de session'}</p>
        </div>
      )}
    </div>
  );
}

/* ── Accessible fallbacks ────────────────────────────────────── */

export function DataTable({ head, rows, className }: { head: string[]; rows: (string | number)[][]; className?: string }) {
  return (
    <div className={cx('max-h-[260px] overflow-auto rounded-lg border border-stone-100', className)}>
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-stone-100 text-left text-[12px] text-stone-500">
            {head.map((h, i) => (
              <th key={h} className={cx('px-3 py-2 font-medium', i > 0 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={String(r[0])} className="border-b border-stone-50 last:border-0">
              {r.map((c, i) => (
                <td key={i} className={cx('px-3 py-1.5', i > 0 ? 'tabular text-right text-stone-600' : 'text-ink')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
