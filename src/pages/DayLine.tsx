import { catOf, type CalendarEvent } from '../store/calendar';
import { cx } from '../lib/utils';
import { dayWindow, hourTicks, toMin } from './dayLine';
import { t } from '../i18n';

/** Near an edge a label is set against it, elsewhere centred on its place (it never leaves the tile). */
const anchor = (pct: number, pad = 0) => (pct < 12 ? `translateX(-${pad}px)` : pct > 88 ? `translateX(calc(-100% + ${pad}px))` : 'translateX(-50%)');

/**
 * The day as a slider (Dashboard, blue tile): the hours, the part already gone, a knob at the time now, a dot for
 * each event of today (a bar while it lasts), and the name of the next one above its dot.
 * A picture of what the tile and the « Aujourd’hui » list already say: hidden from screen readers.
 */
export default function DayLine({ events, now }: { events: CalendarEvent[]; now: Date }) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const timed = events
    .filter(e => e.start)
    .map(e => {
      const start = toMin(e.start!);
      const end = e.end && toMin(e.end) > start ? toMin(e.end) : null;
      return { e, start, end };
    });
  const { from, to } = dayWindow(
    timed.map(x => x.start),
    timed.map(x => x.end ?? x.start),
    nowMin,
  );
  const pct = (m: number) => ((Math.min(Math.max(m, from), to) - from) / (to - from)) * 100;
  const next = timed.find(x => !x.e.done && x.start > nowMin);

  return (
    <div aria-hidden className="relative mt-5 h-12 select-none">
      {next && (
        <span className="absolute top-0 max-w-[48%] truncate whitespace-nowrap text-[12px] font-semibold leading-4" style={{ left: `${pct(next.start)}%`, transform: anchor(pct(next.start), 6) }}>
          {next.e.title}
          <span className="font-medium text-white/80"> · {next.e.start}</span>
        </span>
      )}
      <span className="absolute inset-x-0 top-[22px] h-1.5 rounded-full bg-white/25" />
      <span className="absolute left-0 top-[22px] h-1.5 rounded-full bg-gradient-to-r from-white/50 to-white" style={{ width: `${pct(nowMin)}%` }} />
      {timed.map(({ e, start, end }) => {
        const past = e.done || (end ?? start) <= nowMin;
        return (
          <span key={e.id}>
            {end && <span className={cx('absolute top-[22px] h-1.5 rounded-full', past ? 'bg-white/35' : 'bg-white/60')} style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }} />}
            <span
              className={cx('absolute top-[19px] -ml-1.5 h-3 w-3 rounded-full ring-2', past ? 'opacity-55 ring-white/70' : 'ring-white')}
              style={{ left: `${pct(start)}%`, background: catOf(e.category).color }}
            />
          </span>
        );
      })}
      <span className="absolute top-[15px] -ml-2.5 h-5 w-5 rounded-full bg-white shadow-[0_2px_8px_rgb(0_0_0/0.25)] ring-4 ring-white/25" style={{ left: `${pct(nowMin)}%` }} />
      {hourTicks(from, to).map(m => (
        <span key={m} className="tabular absolute top-[34px] whitespace-nowrap text-[11.5px] font-medium leading-[14px] text-white/75" style={{ left: `${pct(m)}%`, transform: anchor(pct(m)) }}>
          {t('{h} h', { h: m / 60 })}
        </span>
      ))}
    </div>
  );
}
