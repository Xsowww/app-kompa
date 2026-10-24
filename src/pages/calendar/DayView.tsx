import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Plus, Repeat } from 'lucide-react';
import { catOf, type CalendarEvent } from '../../store/calendar';
import { fromMinutes, toMinutes } from '../../lib/dates';
import { cx } from '../../lib/utils';
import { eventTitle, useCalendarSource } from './source';
import type { DragState } from './useEventDrag';
import { t } from '../../i18n';

const HOUR_PX = 52;
/** Events without an end time are drawn one hour long. */
const DEFAULT_LENGTH = 60;

interface Placed {
  ev: CalendarEvent;
  start: number;
  end: number;
  col: number;
  cols: number;
}

const spanOf = (ev: CalendarEvent) => {
  const start = toMinutes(ev.start!);
  const end = ev.end ? toMinutes(ev.end) : start + DEFAULT_LENGTH;
  return { start, end: Math.max(end, start + 15) };
};

/** Overlapping events share the width side by side (classic agenda layout). */
function layout(events: CalendarEvent[]): Placed[] {
  const items = events
    .map(ev => ({ ev, ...spanOf(ev), col: 0, cols: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const p of cluster) p.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const it of items) {
    if (it.start >= clusterEnd) flush();
    let col = colEnds.findIndex(end => end <= it.start);
    if (col < 0) col = colEnds.push(0) - 1;
    colEnds[col] = it.end;
    it.col = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

interface Props {
  date: string;
  isToday: boolean;
  events: CalendarEvent[];
  drag: DragState | null;
  onDragStart: (ev: CalendarEvent, e: ReactPointerEvent<HTMLElement>, grabFromTop?: boolean) => void;
  onEdit: (ev: CalendarEvent) => void;
  onCreate: (start: string, end: string) => void;
}

export default function DayView({ date, isToday, events, drag, onDragStart, onEdit, onCreate }: Props) {
  const { shared } = useCalendarSource();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(nowMinutes);
  const [hover, setHover] = useState<number | null>(null);

  const allDay = events.filter(e => !e.start);
  const placed = useMemo(() => layout(events.filter(e => e.start)), [events]);

  // 7h–23h, stretched when an event starts earlier or ends later.
  const firstHour = Math.min(7, ...placed.map(p => Math.floor(p.start / 60)));
  const lastHour = Math.max(23, ...placed.map(p => Math.min(24, Math.ceil(p.end / 60))));
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const y = (min: number) => ((min - firstHour * 60) / 60) * HOUR_PX;

  useEffect(() => {
    if (!isToday) return;
    const id = window.setInterval(() => setNow(nowMinutes()), 30_000);
    return () => window.clearInterval(id);
  }, [isToday]);

  // Open on the current time (today) or on the first lesson of the day.
  const firstStart = placed.length ? Math.min(...placed.map(p => p.start)) : null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focus = isToday ? nowMinutes() - 90 : firstStart !== null ? firstStart - 30 : 8 * 60;
    el.scrollTop = Math.max(0, ((focus - firstHour * 60) / 60) * HOUR_PX);
    // Only when the day changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const slotAt = (clientY: number, el: HTMLElement) => {
    const min = firstHour * 60 + ((clientY - el.getBoundingClientRect().top) / HOUR_PX) * 60;
    return Math.max(firstHour * 60, Math.min(lastHour * 60 - 30, Math.floor(min / 30) * 30));
  };

  const dragged = drag?.ev;
  const preview = drag?.target?.minutes !== undefined && drag.target.day === date ? drag.target.minutes : null;
  const previewLength = dragged?.start && dragged.end ? toMinutes(dragged.end) - toMinutes(dragged.start) : DEFAULT_LENGTH;

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200">
      {/* All-day band */}
      <div data-drop-day={date} className={cx('flex min-h-10 items-start gap-2 border-b border-stone-200 bg-stone-50/70 px-2 py-1.5', drag?.target?.day === date && drag.target.minutes === undefined && 'bg-brand-50')}>
        <span className="w-10 shrink-0 pt-1 text-right text-[10px] font-medium leading-tight text-stone-500" title={t('Événements sur toute la journée')}>{t('Journée')}</span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {allDay.map(ev => {
            const c = catOf(ev.category);
            return (
              <button
                key={ev.id}
                data-event={ev.id}
                onPointerDown={e => onDragStart(ev, e)}
                onClick={() => onEdit(ev)}
                className={cx('flex h-6 max-w-full touch-manipulation select-none pointer-coarse:h-9 items-center gap-1.5 truncate rounded-md px-2 text-[12px] font-medium [-webkit-touch-callout:none]', ev.done && 'line-through opacity-60', dragged?.id === ev.id && 'opacity-40')}
                style={{ background: c.soft, color: c.text }}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.color }} />
                <span className="truncate">{eventTitle(ev, shared)}</span>
                {ev.series && <Repeat size={11} className="shrink-0" aria-label={t('Se répète')} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Hourly grid */}
      {/* Reachable from the keyboard: arrows then scroll the hours. */}
      <div
        ref={scrollRef}
        data-autoscroll
        tabIndex={0}
        role="region"
        aria-label={t('Heures de la journée')}
        className="relative max-h-[max(360px,calc(100dvh-420px))] overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      >
        <div className="relative flex" style={{ height: hours.length * HOUR_PX }}>
          <div className="relative w-12 shrink-0 select-none">
            {hours.map(h => (
              <span key={h} className="tabular absolute right-2 -translate-y-1/2 text-[11px] text-stone-500" style={{ top: y(h * 60) }}>
                {h === firstHour ? '' : t('{n}h', { n: h })}
              </span>
            ))}
          </div>

          <div
            data-drop-timeline={date}
            data-start-hour={firstHour}
            data-hour-px={HOUR_PX}
            className="relative flex-1 cursor-pointer border-l border-stone-200"
            onClick={e => {
              const start = slotAt(e.clientY, e.currentTarget);
              onCreate(fromMinutes(start), fromMinutes(start + 60));
            }}
            onMouseMove={e => {
              const s = slotAt(e.clientY, e.currentTarget);
              if (s !== hover) setHover(s);
            }}
            onMouseLeave={() => setHover(null)}
          >
            {hours.map(h => (
              <div key={h} className="pointer-events-none absolute inset-x-0" style={{ top: y(h * 60), height: HOUR_PX }}>
                {h !== firstHour && <div className="border-t border-stone-200/80" />}
                <div className="absolute inset-x-0 border-t border-dashed border-stone-100" style={{ top: HOUR_PX / 2 }} />
              </div>
            ))}

            {hover !== null && !drag && (
              <div className="pointer-events-none absolute inset-x-1 flex items-start gap-1 rounded-md bg-stone-100/80 px-2 py-1 text-[11px] font-medium text-stone-500" style={{ top: y(hover) + 1, height: HOUR_PX / 2 - 2 }}>
                <Plus size={12} className="mt-px" /> <span className="tabular">{fromMinutes(hover)}</span>
              </div>
            )}

            {placed.map(({ ev, start, end, col, cols }) => {
              const c = catOf(ev.category);
              const height = Math.max(y(end) - y(start), 22) - 2;
              const compact = height < 40;
              // One line of title when two wouldn't leave room for the hour (a 1 h block is 50 px).
              const oneLine = height < 66;
              return (
                <button
                  key={ev.id}
                  data-event={ev.id}
                  onPointerDown={e => onDragStart(ev, e, true)}
                  onClick={e => {
                    e.stopPropagation();
                    onEdit(ev);
                  }}
                  onMouseMove={e => e.stopPropagation()}
                  onMouseEnter={() => setHover(null)}
                  className={cx(
                    'absolute flex touch-manipulation select-none flex-col overflow-hidden rounded-md border-l-[3px] px-2 text-left transition-[opacity,box-shadow] [-webkit-touch-callout:none] hover:shadow-card hover:ring-1 hover:ring-stone-900/5',
                    compact ? 'justify-center py-0' : 'py-1',
                    ev.done && 'opacity-55',
                    dragged?.id === ev.id && 'opacity-35',
                  )}
                  style={{
                    top: y(start) + 1,
                    height,
                    left: `calc(${(col / cols) * 100}% + 3px)`,
                    width: `calc(${100 / cols}% - 6px)`,
                    background: c.soft,
                    borderColor: c.color,
                  }}
                >
                  {compact ? (
                    <span className="truncate text-[12px] leading-tight">
                      <span className={cx('font-medium text-ink', ev.done && 'line-through')}>{eventTitle(ev, shared)}</span>
                      {ev.series && <Repeat size={10} className="ml-1 inline-block -translate-y-px text-stone-500" aria-label={t('Se répète')} />}
                      <span className="tabular ml-1.5" style={{ color: c.text }}>
                        {ev.start}
                      </span>
                    </span>
                  ) : (
                    <>
                      <span className={cx('shrink-0 text-[12.5px] font-medium leading-snug text-ink', oneLine ? 'truncate' : 'line-clamp-2', ev.done && 'line-through')}>
                        {ev.series && <Repeat size={11} className="mr-1 inline-block -translate-y-px text-stone-500" aria-label={t('Se répète')} />}
                        {eventTitle(ev, shared)}
                      </span>
                      <span className="tabular mt-0.5 truncate text-[11px]" style={{ color: c.text }}>
                        {ev.start}
                        {ev.end && ` – ${ev.end}`}
                      </span>
                      {height > 70 && ev.details && <span className="mt-0.5 truncate text-[11px] text-stone-500">{ev.details.split('\n')[0]}</span>}
                    </>
                  )}
                </button>
              );
            })}

            {preview !== null && dragged && (
              <div
                className="pointer-events-none absolute inset-x-1 z-10 rounded-md border-2 border-dashed px-2 py-1 text-[11px] font-semibold"
                style={{ top: y(preview) + 1, height: Math.max((previewLength / 60) * HOUR_PX - 2, 22), borderColor: catOf(dragged.category).color, color: catOf(dragged.category).text, background: 'color-mix(in srgb, var(--color-surface) 75%, transparent)' }}
              >
                <span className="tabular">
                  {fromMinutes(preview)}
                  {dragged.end && ` – ${fromMinutes(preview + previewLength)}`}
                </span>
              </div>
            )}

            {isToday && now >= firstHour * 60 && now <= lastHour * 60 && (
              <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: y(now) }}>
                <div className="absolute -left-[5px] -top-[4.5px] h-[9px] w-[9px] rounded-full bg-red-500" />
                <div className="border-t-2 border-red-500" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
