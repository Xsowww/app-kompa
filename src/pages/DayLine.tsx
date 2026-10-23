import { catOf, type CalendarEvent } from '../store/calendar';
import { cx } from '../lib/utils';
import { dayWindow, hourTicks, labelSpots, toMin } from './dayLine';
import { t } from '../i18n';

/** Near an edge an hour is set against it, elsewhere centred on its mark (it never leaves the tile). */
const anchor = (pct: number) => (pct < 12 ? 'none' : pct > 88 ? 'translateX(-100%)' : 'translateX(-50%)');

/**
 * The day as a slider (Dashboard, blue tile): the hours, the part already gone, a knob at the time now, a dot for
 * each event of today (a bar while it lasts), and the name of each one to come above its dot (dayLine.labelSpots).
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
  const coming = timed.filter(x => !x.e.done && x.start > nowMin);
  const spots = labelSpots(coming.map(x => pct(x.start)));
  // More lines of names when they are close: the bar and the hours go down by as many lines.
  const lines = spots.length ? Math.max(...spots.map(s => s.row)) : 0;
  const down = lines * 16;
  const y = (px: number) => ({ top: px + down });

  return (
    <div aria-hidden className="relative mt-5 select-none" style={{ height: 48 + down }}>
      {coming.map((x, i) => {
        const s = spots[i];
        return (
          <span
            key={x.e.id}
            className="absolute truncate whitespace-nowrap text-[12px] font-semibold leading-4"
            style={{ top: (lines - s.row) * 16, left: `${pct(x.start)}%`, maxWidth: `${s.max}%`, transform: s.align === 'end' ? 'translateX(calc(-100% + 6px))' : 'translateX(-6px)' }}
          >
            {x.e.title}
            {/* Short of room, the name alone: its dot already says when. */}
            {s.max >= 30 && <span className="font-medium text-white/80"> · {x.e.start}</span>}
          </span>
        );
      })}
      <span className="absolute inset-x-0 h-1.5 rounded-full bg-white/25" style={y(22)} />
      <span className="absolute left-0 h-1.5 rounded-full bg-gradient-to-r from-white/50 to-white" style={{ ...y(22), width: `${pct(nowMin)}%` }} />
      {timed.map(({ e, start, end }) => {
        const past = e.done || (end ?? start) <= nowMin;
        return (
          <span key={e.id}>
            {end && <span className={cx('absolute h-1.5 rounded-full', past ? 'bg-white/35' : 'bg-white/60')} style={{ ...y(22), left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }} />}
            <span
              className={cx('absolute -ml-1.5 h-3 w-3 rounded-full ring-2', past ? 'opacity-55 ring-white/70' : 'ring-white')}
              style={{ ...y(19), left: `${pct(start)}%`, background: catOf(e.category).color }}
            />
          </span>
        );
      })}
      <span className="absolute -ml-2.5 h-5 w-5 rounded-full bg-white shadow-[0_2px_8px_rgb(0_0_0/0.25)] ring-4 ring-white/25" style={{ ...y(15), left: `${pct(nowMin)}%` }} />
      {hourTicks(from, to).map(m => (
        <span key={m} className="tabular absolute whitespace-nowrap text-[11.5px] font-medium leading-[14px] text-white/75" style={{ ...y(34), left: `${pct(m)}%`, transform: anchor(pct(m)) }}>
          {t('{h} h', { h: m / 60 })}
        </span>
      ))}
    </div>
  );
}
