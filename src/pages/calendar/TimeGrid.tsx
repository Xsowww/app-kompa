import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Plus } from 'lucide-react';
import { catOf, type CalendarEvent } from '../../store/calendar';
import type { Todo } from '../../store/todos';
import { fmt, fromKey, fromMinutes, toMinutes } from '../../lib/dates';
import { cx } from '../../lib/utils';
import { periodsFill, periodsOn, type Period } from '../../lib/periods';
import { eventTitle, useCalendarSource } from './source';
import SeriesIcon from './SeriesIcon';
import type { DragMode, DragState } from './useEventDrag';
import { DEFAULT_LENGTH, layout, spanBars, sweptRange, tasksOn } from './layout';
import { TaskChip } from './TaskItem';
import { t, tn } from '../../i18n';

const HOUR_PX = 52;
/** Items of a day shown in the « Journée » row of the week before « +N ». */
const ALL_DAY_SHOWN = 3;

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

interface Props {
  /** One day (day view) or the seven of a week. */
  days: string[];
  today: string;
  /** The week: the day chosen (its column is marked; ← → move it). */
  selected?: string;
  /** The events of these days (filtered as the calendar shows them). */
  events: CalendarEvent[];
  /** The tasks due these days. */
  todos: Todo[];
  periods: Period[];
  drag: DragState | null;
  /** Can be moved, resized, ticked (not on a read-only calendar, nor an event of a shared calendar shown in mine). */
  canChange: (ev: CalendarEvent) => boolean;
  /** Ticked here (my own calendar: a shared one has no « fait »). */
  canTick: (ev: CalendarEvent) => boolean;
  canCreate: boolean;
  onDragStart: (ev: CalendarEvent, e: ReactPointerEvent<HTMLElement>, opts?: { grabFromTop?: boolean; mode?: DragMode }) => void;
  onEdit: (ev: CalendarEvent) => void;
  onToggle: (ev: CalendarEvent) => void;
  onCreate: (day: string, start: string, end: string) => void;
  onMenu?: (ev: CalendarEvent, e: ReactMouseEvent<HTMLElement>) => void;
  onSelectDay?: (day: string) => void;
  onOpenTask: (todo: Todo) => void;
}

/**
 * The hourly grid: one day (day view) or a week (seven columns), a « Journée » row above for what has no time
 * (the tasks of the day too), and the hours below. Click an empty slot to add (sweep several to choose the
 * length), drag an event to another time or day, its bottom edge to change its end, tick it from its block.
 */
export default function TimeGrid({ days, today, selected, events, todos, periods, drag, canChange, canTick, canCreate, onDragStart, onEdit, onToggle, onCreate, onMenu, onSelectDay, onOpenTask }: Props) {
  const { shared } = useCalendarSource();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(nowMinutes);
  const [hover, setHover] = useState<{ day: string; min: number } | null>(null);
  // « +N » in the « Journée » row: every item of every day shown.
  const [allDayOpen, setAllDayOpen] = useState(false);
  const week = days.length > 1;
  const cols = `48px repeat(${days.length}, minmax(0, 1fr))`;

  // A week: an event over several days is one bar across its days, not a piece a day (nor a tall block per day).
  const bars = useMemo(() => (week ? spanBars(events, days) : []), [week, events, days]);
  const barred = useMemo(() => new Set(bars.flatMap(b => events.filter(e => e.series === b.ev.series).map(e => e.id))), [bars, events]);
  const lanes = bars.length ? Math.max(...bars.map(b => b.lane)) + 1 : 0;
  const allDay = (day: string) => events.filter(e => e.date === day && !e.start && !barred.has(e.id));
  const placedByDay = useMemo(() => new Map(days.map(d => [d, layout(events.filter(e => e.date === d && e.start && !barred.has(e.id)))])), [days, events, barred]);
  const placed = [...placedByDay.values()].flat();

  // 7h–23h, stretched when an event starts earlier or ends later.
  const firstHour = Math.min(7, ...placed.map(p => Math.floor(p.start / 60)));
  const lastHour = Math.max(23, ...placed.map(p => Math.min(24, Math.ceil(p.end / 60))));
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const y = (min: number) => ((min - firstHour * 60) / 60) * HOUR_PX;
  const showsToday = days.includes(today);

  useEffect(() => {
    if (!showsToday) return;
    const id = window.setInterval(() => setNow(nowMinutes()), 30_000);
    return () => window.clearInterval(id);
  }, [showsToday]);

  // Open on the current time (today) or on the first lesson of the day (of the week).
  const firstStart = placed.length ? Math.min(...placed.map(p => p.start)) : null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focus = showsToday ? nowMinutes() - 90 : firstStart !== null ? firstStart - 30 : 8 * 60;
    el.scrollTop = Math.max(0, ((focus - firstHour * 60) / 60) * HOUR_PX);
    // Only when the day (the week) changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0], days.length]);

  const slotAt = (clientY: number, el: HTMLElement, step = 30) => {
    const min = firstHour * 60 + ((clientY - el.getBoundingClientRect().top) / HOUR_PX) * 60;
    return Math.max(firstHour * 60, Math.min(lastHour * 60 - step, Math.floor(min / step) * step));
  };

  const dragged = drag?.ev;
  const moving = drag?.mode === 'move' ? drag : null;
  const previewLength = dragged?.start && dragged.end ? toMinutes(dragged.end) - toMinutes(dragged.start) : DEFAULT_LENGTH;

  const chip = (ev: CalendarEvent) => {
    const c = catOf(ev.category);
    const movable = canChange(ev);
    return (
      <button
        key={ev.id}
        data-event={ev.id}
        onPointerDown={movable ? e => onDragStart(ev, e) : undefined}
        onClick={() => onEdit(ev)}
        onContextMenu={onMenu && (e => onMenu(ev, e))}
        className={cx('flex h-6 max-w-full shrink-0 touch-manipulation select-none items-center gap-1.5 truncate rounded-md px-2 text-[12px] font-medium [-webkit-touch-callout:none] pointer-coarse:h-9', ev.done && 'line-through opacity-60', dragged?.id === ev.id && 'opacity-40')}
        style={{ background: c.soft, color: c.text }}
        title={eventTitle(ev, shared)}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.color }} />
        <span className="truncate">{eventTitle(ev, shared)}</span>
        <SeriesIcon series={ev.series} size={11} className="shrink-0" />
      </button>
    );
  };

  const header = week && (
    <div className="grid border-b border-stone-200 [scrollbar-gutter:stable] overflow-y-hidden" style={{ gridTemplateColumns: cols }}>
      <span />
      {days.map(d => {
        const isSel = d === selected;
        const tint = periodsOn(periods, d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelectDay?.(d)}
            aria-pressed={isSel}
            aria-label={`${fmt(fromKey(d), 'EEEE d MMMM')}${d === today ? t(', aujourd’hui') : ''}`}
            className={cx('flex flex-col items-center border-l border-stone-200 py-1.5 transition-colors', isSel ? 'bg-stone-100' : 'hover:bg-stone-50')}
            style={tint.length ? { backgroundImage: periodsFill(tint, isSel ? 26 : 13) } : undefined}
          >
            <span className="text-[11px] font-medium capitalize text-stone-500">{fmt(fromKey(d), 'EEE')}</span>
            <span className={cx('tabular mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[14px] font-semibold', isSel ? 'bg-tile-blue text-white' : d === today && 'text-brand-600')}>{fmt(fromKey(d), 'd')}</span>
          </button>
        );
      })}
    </div>
  );

  // The « Journée » row: the bars of the events over several days on their lanes, then each day's own items.
  const allDayRow = (
    <div
      className={cx('grid border-b border-stone-200 bg-stone-50/70 [scrollbar-gutter:stable] overflow-y-hidden', !week && 'min-h-10')}
      style={{ gridTemplateColumns: cols, gridTemplateRows: lanes ? `repeat(${lanes}, auto) minmax(36px, auto)` : 'minmax(36px, auto)' }}
    >
      <span className="px-1 pt-2 text-right text-[10px] font-medium leading-tight text-stone-500" style={{ gridColumn: 1, gridRow: `1 / span ${lanes + 1}` }} title={t('Événements sur toute la journée')}>
        {t('Journée')}
      </span>
      {days.map((d, i) => (
        <span
          key={d}
          data-drop-day={d}
          aria-hidden
          className={cx('border-l border-stone-200', drag?.target?.day === d && drag.target.minutes === undefined && 'bg-brand-50')}
          style={{ gridColumn: i + 2, gridRow: `1 / span ${lanes + 1}` }}
        />
      ))}
      {bars.map(({ ev, from, to, lane, before, after }) => {
        const c = catOf(ev.category);
        return (
          <button
            key={`${ev.series}-${from}`}
            type="button"
            data-event={ev.id}
            onClick={() => onEdit(ev)}
            onContextMenu={onMenu && (e => onMenu(ev, e))}
            className={cx('relative z-10 mt-1 flex h-6 min-w-0 items-center gap-1.5 truncate px-2 text-left text-[12px] font-medium pointer-coarse:h-8', before ? 'ml-0 rounded-l-none' : 'ml-1 rounded-l-md', after ? 'mr-0 rounded-r-none' : 'mr-1 rounded-r-md', ev.done && 'line-through opacity-60', drag && 'pointer-events-none')}
            style={{ gridColumn: `${from + 2} / ${to + 3}`, gridRow: lane + 1, background: c.soft, color: c.text, boxShadow: `inset 3px 0 0 ${c.color}` }}
            title={eventTitle(ev, shared)}
          >
            <span className="truncate">{eventTitle(ev, shared)}</span>
            {ev.start && !before && <span className="tabular shrink-0 opacity-80">{ev.start}</span>}
          </button>
        );
      })}
      {days.map((d, i) => {
        const items = [...allDay(d).map(ev => ({ ev })), ...tasksOn(todos, d).map(todo => ({ todo }))];
        const cap = week && !allDayOpen && items.length > ALL_DAY_SHOWN + 1 ? ALL_DAY_SHOWN : items.length;
        return (
          <div key={d} data-drop-day={d} className={cx('relative z-10 flex min-w-0 gap-1 p-1', week ? 'flex-col' : 'flex-wrap items-start')} style={{ gridColumn: i + 2, gridRow: lanes + 1 }}>
            {items.slice(0, cap).map(it => ('ev' in it ? chip(it.ev) : <TaskChip key={it.todo.id} todo={it.todo} onOpen={onOpenTask} />))}
            {cap < items.length && (
              <button type="button" onClick={() => setAllDayOpen(true)} className="h-6 rounded-md px-1.5 text-left text-[11.5px] font-medium text-stone-500 hover:bg-stone-100 hover:text-ink pointer-coarse:h-8">
                {tn(items.length - cap, '+{n} autre', '+{n} autres')}
              </button>
            )}
          </div>
        );
      })}
      {week && allDayOpen && (
        <button type="button" onClick={() => setAllDayOpen(false)} className="relative z-10 justify-self-start px-2 pb-1 text-[11.5px] font-medium text-stone-500 hover:text-ink" style={{ gridColumn: 2, gridRow: lanes + 2 }}>
          {t('Réduire')}
        </button>
      )}
    </div>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200">
      {header}
      {allDayRow}

      {/* Hourly grid */}
      {/* Reachable from the keyboard: arrows then scroll the hours. */}
      <div
        ref={scrollRef}
        data-autoscroll
        tabIndex={0}
        role="region"
        aria-label={week ? t('Heures de la semaine') : t('Heures de la journée')}
        className="relative max-h-[max(360px,calc(100dvh-420px))] overflow-y-auto overscroll-contain outline-none [scrollbar-gutter:stable] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      >
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: hours.length * HOUR_PX }}>
          <div className="relative select-none">
            {hours.map(h => (
              <span key={h} className="tabular absolute right-2 -translate-y-1/2 text-[11px] text-stone-500" style={{ top: y(h * 60) }}>
                {h === firstHour ? '' : t('{n} h||heure', { n: h })}
              </span>
            ))}
          </div>

          {days.map(day => {
            const isToday = day === today;
            const resizing = drag?.mode === 'resize' && dragged?.date === day && drag.target ? drag : null;
            const sweep = drag?.mode === 'create' && dragged?.date === day && drag.target?.minutes !== undefined ? sweptRange(toMinutes(dragged.start!), drag.target.minutes) : null;
            const preview = moving?.target?.minutes !== undefined && moving.target.day === day ? moving.target.minutes : null;
            return (
              <div
                key={day}
                data-drop-timeline={day}
                data-start-hour={firstHour}
                data-hour-px={HOUR_PX}
                className={cx('relative touch-manipulation border-l border-stone-200 [-webkit-touch-callout:none]', canCreate && 'cursor-pointer', week && day === selected && 'bg-stone-50/60')}
                onPointerDown={
                  canCreate
                    ? e => {
                        if (e.target !== e.currentTarget) return; // on an event: that event is dragged
                        const slot = slotAt(e.clientY, e.currentTarget, 15);
                        onDragStart({ id: '', title: '', date: day, start: fromMinutes(slot), category: 'perso', done: false, createdAt: '' }, e, { mode: 'create' });
                      }
                    : undefined
                }
                onClick={
                  canCreate
                    ? e => {
                        const start = slotAt(e.clientY, e.currentTarget);
                        onCreate(day, fromMinutes(start), fromMinutes(start + 60));
                      }
                    : undefined
                }
                onMouseMove={
                  canCreate
                    ? e => {
                        const min = slotAt(e.clientY, e.currentTarget);
                        if (min !== hover?.min || day !== hover.day) setHover({ day, min });
                      }
                    : undefined
                }
                onMouseLeave={() => setHover(null)}
              >
                {hours.map(h => (
                  <div key={h} className="pointer-events-none absolute inset-x-0" style={{ top: y(h * 60), height: HOUR_PX }}>
                    {h !== firstHour && <div className="border-t border-stone-200/80" />}
                    <div className="absolute inset-x-0 border-t border-dashed border-stone-100" style={{ top: HOUR_PX / 2 }} />
                  </div>
                ))}

                {hover?.day === day && !drag && (
                  <div className="pointer-events-none absolute inset-x-1 flex items-start gap-1 overflow-hidden rounded-md bg-stone-100/80 px-1.5 py-1 text-[11px] font-medium text-stone-500" style={{ top: y(hover.min) + 1, height: HOUR_PX / 2 - 2 }}>
                    <Plus size={12} className="mt-px shrink-0" /> <span className="tabular">{fromMinutes(hover.min)}</span>
                  </div>
                )}

                {placedByDay.get(day)!.map(({ ev, start, end: plannedEnd, col, cols: n }) => {
                  const c = catOf(ev.category);
                  const end = resizing?.ev.id === ev.id ? Math.max(start + 15, resizing.target!.minutes!) : plannedEnd;
                  const height = Math.max(y(end) - y(start), 22) - 2;
                  const compact = height < 40;
                  // One line of title when two wouldn't leave room for the hour (a 1 h block is 50 px).
                  const oneLine = height < 66;
                  const movable = canChange(ev);
                  const tick = canTick(ev);
                  return (
                    <div
                      key={ev.id}
                      className={cx('group/ev absolute', ev.done && 'opacity-55', dragged?.id === ev.id && drag?.mode === 'move' && 'opacity-35', resizing?.ev.id === ev.id && 'z-10 shadow-pop')}
                      style={{ top: y(start) + 1, height, left: `calc(${(col / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` }}
                      onMouseMove={e => e.stopPropagation()}
                      onMouseEnter={() => setHover(null)}
                    >
                      <button
                        data-event={ev.id}
                        onPointerDown={movable ? e => onDragStart(ev, e, { grabFromTop: true }) : undefined}
                        onClick={e => {
                          e.stopPropagation();
                          onEdit(ev);
                        }}
                        onContextMenu={onMenu && (e => onMenu(ev, e))}
                        // Narrow in a week: the whole of it on hover.
                        title={[eventTitle(ev, shared), ev.end ? `${ev.start} – ${ev.end}` : ev.start, ev.place].filter(Boolean).join(' · ')}
                        className={cx(
                          'flex h-full w-full touch-manipulation select-none flex-col overflow-hidden rounded-md border-l-[3px] text-left transition-[opacity,box-shadow] [-webkit-touch-callout:none] hover:shadow-card hover:ring-1 hover:ring-stone-900/5',
                          week ? 'px-1.5' : 'px-2',
                          compact ? 'justify-center py-0' : 'py-1',
                          // Room for the box (a week's narrow column keeps it for the title, the box shows on hover).
                          tick && (week ? 'pointer-coarse:pr-5' : 'pr-5'),
                        )}
                        style={{ background: c.soft, borderColor: c.color }}
                      >
                        {compact ? (
                          <span className="truncate text-[12px] leading-tight">
                            <span className={cx('font-medium text-ink', ev.done && 'line-through')}>{eventTitle(ev, shared)}</span>
                            <SeriesIcon series={ev.series} size={10} className="ml-1 inline-block -translate-y-px text-stone-500" />
                            <span className="tabular ml-1.5" style={{ color: c.text }}>
                              {ev.start}
                            </span>
                          </span>
                        ) : (
                          <>
                            <span className={cx('shrink-0 text-[12.5px] font-medium leading-snug text-ink', oneLine ? 'truncate' : 'line-clamp-2', ev.done && 'line-through')}>
                              <SeriesIcon series={ev.series} size={11} className="mr-1 inline-block -translate-y-px text-stone-500" />
                              {eventTitle(ev, shared)}
                            </span>
                            <span className="tabular mt-0.5 truncate text-[11px]" style={{ color: c.text }}>
                              {ev.start}
                              {resizing?.ev.id === ev.id ? ` – ${fromMinutes(end)}` : ev.end && ` – ${ev.end}`}
                            </span>
                            {height > 70 && (ev.place || ev.details) && <span className="mt-0.5 truncate text-[11px] text-stone-500">{ev.place || ev.details!.split('\n')[0]}</span>}
                          </>
                        )}
                      </button>
                      {/* Ticked from its block (shown on hover with a mouse, always under a finger or once done). */}
                      {tick && (
                        <button
                          type="button"
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => {
                            e.stopPropagation();
                            onToggle(ev);
                          }}
                          className={cx(
                            'absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-[1.5px] transition-[opacity,colors] pointer-coarse:opacity-100',
                            ev.done ? 'border-ink bg-ink opacity-100' : 'border-stone-400 bg-surface opacity-0 hover:border-stone-600 focus-visible:opacity-100 group-hover/ev:opacity-100',
                          )}
                          title={ev.done ? t('Marquer comme à faire') : t('Marquer comme fait')}
                          aria-label={ev.done ? t('Marquer « {title} » comme à faire', { title: ev.title }) : t('Marquer « {title} » comme fait', { title: ev.title })}
                        >
                          {ev.done && <Check size={9} strokeWidth={3.5} className="text-paper" />}
                        </button>
                      )}
                      {/* Its bottom edge: drag it to change the end (by 15 minutes). */}
                      {movable && (
                        <span
                          aria-hidden
                          onPointerDown={e => {
                            e.stopPropagation();
                            onDragStart(ev, e, { mode: 'resize' });
                          }}
                          onClick={e => e.stopPropagation()}
                          className="absolute inset-x-0 bottom-0 flex h-2 cursor-ns-resize touch-none items-end justify-center pb-0.5 pointer-coarse:h-3"
                          title={t('Glisse pour changer l’heure de fin')}
                        >
                          <span className="h-[3px] w-6 rounded-full bg-stone-400/70 opacity-0 transition-opacity group-hover/ev:opacity-100 pointer-coarse:opacity-60" />
                        </span>
                      )}
                    </div>
                  );
                })}

                {preview !== null && dragged && (
                  <div
                    className="pointer-events-none absolute inset-x-1 z-10 overflow-hidden rounded-md border-2 border-dashed px-1.5 py-1 text-[11px] font-semibold"
                    style={{ top: y(preview) + 1, height: Math.max((previewLength / 60) * HOUR_PX - 2, 22), borderColor: catOf(dragged.category).color, color: catOf(dragged.category).text, background: 'color-mix(in srgb, var(--color-surface) 75%, transparent)' }}
                  >
                    <span className="tabular">
                      {fromMinutes(preview)}
                      {dragged.end && ` – ${fromMinutes(preview + previewLength)}`}
                    </span>
                  </div>
                )}

                {sweep && (
                  <div
                    className="pointer-events-none absolute inset-x-1 z-10 overflow-hidden rounded-md border-2 border-dashed border-brand-500 bg-brand-50/80 px-1.5 py-1 text-[11px] font-semibold text-brand-700"
                    style={{ top: y(sweep.from) + 1, height: Math.max(y(sweep.to) - y(sweep.from) - 2, 22) }}
                  >
                    <span className="tabular">
                      {fromMinutes(sweep.from)} – {fromMinutes(sweep.to)}
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
            );
          })}
        </div>
      </div>
    </div>
  );
}
