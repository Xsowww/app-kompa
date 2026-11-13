import { useToday } from '../../lib/useToday';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, addMonths, endOfMonth, startOfMonth, isSameMonth } from 'date-fns';
import { Copy, ExternalLink, Flag, Link2, ListFilter, ListTodo, MapPin, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, CornerDownLeft, CalendarArrowDown, CalendarArrowUp, CalendarRange, CalendarPlus, CalendarClock } from 'lucide-react';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { allCategories, guessCategory, isDeliverable, isBigEvent, sortEvents, type CalendarEvent, type EventCategory } from '../../store/calendar';
// The colours of the categories, vivid in the Affichage Pro.
import { catOf } from './proColors';
import { parseQuickAdd, remindMinutes, toKey, fromKey, todayKey, validKey, fmt, fmtDay, weekStart, countdownLabel, daysUntil, toMinutes, fromMinutes, isOver } from '../../lib/dates';
import { toast } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { AGENDA_EXAMPLES, WORDS, groupWords } from '../../lib/usage';
import CategoriesDialog from './CategoriesDialog';
import PeriodsDialog from './PeriodsDialog';
import { periodColor, periodUntil, periodLabel, periodsFill, weekLanes, dayLanes, periodRange, periodText, periodTint, periodsBetween, periodsOn, type Period } from '../../lib/periods';
import { cx } from '../../lib/utils';
import { newSeries } from '../../lib/seriesId';
import EventForm from './EventForm';
import { usePanelInset } from './usePanelInset';
import { eventTitle, periodIdeas, removeEvent, useCalendarSource } from './source';
import TimeGrid from './TimeGrid';
import SeriesIcon from './SeriesIcon';
import { firstOfSpans, isSpan, spanDays, spanMove, spanTooLong } from '../../lib/repeat';
import { refillEndless } from '../../lib/repeatSeries';
import ImportIcsDialog, { type IcsSource } from './ImportIcsDialog';
import { useCreateActions } from '../../store/create';
import { isIcsFile } from '../../lib/ics';
import { useEventDrag, type DragMode, type DropTarget } from './useEventDrag';
import { exportIcs } from '../../lib/backup';
import { flashWhenReady } from '../../lib/flash';
import { followMoments, shownReminders } from '../../lib/reminders';
import { ReminderChip } from './ReminderChip';
import { feedLabel, feedOf } from '../../lib/icsFeeds';
import { useTodos, type Todo } from '../../store/todos';
import TaskDialog from '../tasks/TaskDialog';
import { TaskRow } from './TaskItem';
import { byStartTime, dayMark, isFor, jumpSaid, markJumpSaid, openingDay, newEventDay, spanBars, spanEdge, sweptRange, tasksOn, upcomingList } from './layout';
import { agendaLink, copyToMyCalendar, fromAgenda, useAgendaOverlay } from './agendas';
import { ContextMenu, type MenuItem } from '../../components/Overlays';
import { useModals } from '../../lib/modals';
import { isMenuKey, menuPoint } from '../../lib/a11y';
import { GROUP_COLORS, type Group } from '../../lib/groups';
import { t, tn } from '../../i18n';
import { untilLabel } from '../../lib/until';

type Mode = 'week' | 'month' | 'day';
const MODES: { id: Mode; label: string }[] = [
  { id: 'day', label: t('Jour') },
  { id: 'week', label: t('Semaine') },
  { id: 'month', label: t('Mois') },
];
const MODE_KEY = 'cop.calendar.mode';

function savedMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === 'day' || m === 'month' ? m : 'week';
  } catch {
    return 'week';
  }
}

const media = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null);
const subscribeTo = (mq: MediaQueryList | null) => (cb: () => void) => {
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
};
// Phones get a shorter hint in the quick add (the long example was cut in the middle of a word at 375 px).
const wideQuery = media('(min-width: 640px)');
const subscribeWide = subscribeTo(wideQuery);
const useWide = () => useSyncExternalStore(subscribeWide, () => wideQuery?.matches ?? true);
// A low screen (a phone on its side): the fixed header keeps one row, its tools as icons.
const shortQuery = media('(max-height: 500px) and (width < 64rem)'); // as the `short:` variant (index.css)
const subscribeShort = subscribeTo(shortQuery);
const useShort = () => useSyncExternalStore(subscribeShort, () => shortQuery?.matches ?? false);
// From a tablet the week is an hourly grid of seven columns; on a phone, the seven days one under the other.
const gridQuery = media('(min-width: 768px)');
const subscribeGrid = subscribeTo(gridQuery);
const useWeekGrid = () => useSyncExternalStore(subscribeGrid, () => gridQuery?.matches ?? true);

/** « 14h », « 9h30 »: the month's cells on a phone have room for a few characters only. */
const shortTime = (hhmm: string) => `${Number(hhmm.slice(0, 2))}h${hhmm.slice(3) === '00' ? '' : hhmm.slice(3)}`;
/** Lines left for events in a phone's month cell under the bars of events over several days. */
const phoneRoom = (lanes: number) => Math.max(1, 2 - lanes);
/** The morning end of a night (an event from an evening to the next morning, « span- »): « 07:00 », else null. */
function nightEnd(ev: CalendarEvent, byDay: Map<string, CalendarEvent[]>): string | null {
  if (!ev.start || ev.end !== '23:59' || !ev.series) return null;
  const next = new Date(`${ev.date}T12:00`);
  next.setDate(next.getDate() + 1);
  const morning = (byDay.get(toKey(next)) ?? []).find(e => e.series === ev.series && e.start === '00:00');
  return morning?.end ?? null;
}

function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ background: color, width: size, height: size }} />;
}

/** An event's mark in a list: a short bar of its colour (a task has a square box instead). */
function Bar({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-[3px] shrink-0 rounded-full" style={{ background: color }} aria-hidden />;
}

interface EventItemProps {
  ev: CalendarEvent;
  onEdit: () => void;
  dragging: boolean;
  onDragStart: (e: ReactPointerEvent<HTMLElement>) => void;
  onMenu: (e: ReactMouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => void;
}

function EventItem({ ev, onEdit, dragging, onDragStart, onMenu }: EventItemProps) {
  const source = useCalendarSource();
  const { shared } = source;
  // A reader of a shared calendar, or a shared calendar's event shown in mine: nothing to change here.
  const agenda = fromAgenda(ev);
  const readOnly = (!!shared && !shared.canEdit) || agenda;
  // Events already over (a past day, or today's ended): still there, lighter and struck through; what is left stands out.
  const past = isOver(ev);
  const edge = spanEdge(ev, source.events);
  const c = catOf(ev.category);
  const defaults = useSettings(s => s.defaultReminders);
  // A shared calendar's reminders are the ones chosen on it (no usual reminder of mine there).
  const reminders = shownReminders(ev, defaults, !!shared);
  // From a timetable followed by link: its name, so it is never mixed up with what was added by hand.
  const feed = feedOf(ev, useSettings(s => s.icsFeeds));
  return (
    <div className="group flex items-stretch gap-2 sm:gap-4">
      <div className="tabular w-10 shrink-0 pt-3 text-right text-[12px] sm:w-12">
        {/* A night (an event over two days): « 21:00 » the evening, « → 07:00 » the next morning, not 23:59 and 00:00. */}
        {ev.start && isSpan(ev.series) && ev.start === '00:00' && ev.end ? (
          <p className="whitespace-nowrap text-stone-500">
            <span aria-hidden>→ </span>
            <span className="sr-only">{t('jusqu’à')} </span>
            {ev.end}
          </p>
        ) : ev.start ? (
          <>
            <p className="font-medium">{ev.start}</p>
            {ev.end && !(isSpan(ev.series) && ev.end === '23:59') && <p className="text-stone-500">{ev.end}</p>}
          </>
        ) : (
          <p className="text-stone-500">{t('Journée')}</p>
        )}
      </div>
      {/* The card alone lights up when a link leads here (lib/flash), not the time beside it. */}
      <div
        data-event={ev.id}
        // The Affichage Pro lights an important one up (calPro.css).
        data-important={ev.important || undefined}
        onPointerDown={readOnly ? undefined : onDragStart}
        onContextMenu={e => (e.preventDefault(), onMenu(e))}
        onKeyDown={e => isMenuKey(e) && (e.preventDefault(), onMenu(e))}
        title={readOnly ? undefined : t('Glisse sur un autre jour pour déplacer')}
        data-past={past || undefined}
        className={cx('flex min-w-0 flex-1 touch-manipulation items-start gap-3 rounded-[16px] bg-stone-50 py-3 pl-3 pr-2 transition-colors [-webkit-touch-callout:none] hover:bg-stone-100', past && 'cal-past', dragging && 'opacity-40')}
      >
        {/* An event: its colour bar, no box (only tasks are ticked, with their square box). The last day of one over
            several days has it at the right: its end. */}
        <span className={cx('mt-0.5 w-[3px] self-stretch rounded-full', edge === 'end' && 'order-last')} style={{ background: c.color }} />
        {/* A reader opens it too: the whole event, read-only (EventForm). */}
        <button className="min-w-0 flex-1 text-left pointer-coarse:py-2" onClick={onEdit}>
          <p className="text-[14px] font-medium leading-snug hyphens-auto [overflow-wrap:anywhere]">
            {past && <span className="sr-only">{t('Passé :')} </span>}
            {ev.important && <Flag size={12} className="mr-1 inline-block -translate-y-px fill-amber-500 text-amber-500" aria-label={t('Important')} />}
            {ev.title}
          </p>
          <p className="mt-0.5 text-[12px] text-stone-500">
            <span style={{ color: c.text }}>{c.label}</span>
            <SeriesIcon series={ev.series} size={11} className="ml-1.5 inline-block -translate-y-px" />
            {feed && (
              <span className="ml-1.5 inline-flex max-w-full items-center gap-1 align-bottom" title={t('Vient de l’emploi du temps « {name} »', { name: feedLabel(feed.name) })}>
                <Link2 size={11} className="shrink-0" aria-hidden /> <span className="truncate">{feedLabel(feed.name)}</span>
              </span>
            )}
            {ev.place && (
              <span className="ml-1.5 inline-flex max-w-full items-center gap-1 align-bottom">
                <MapPin size={11} className="shrink-0" aria-label={t('Lieu')} /> <span className="truncate">{ev.place}</span>
              </span>
            )}
            {agenda && <ExternalLink size={11} className="ml-1.5 inline-block -translate-y-px" aria-label={t('Ouvre l’agenda partagé')} />}
            {shared && ev.people?.length ? ` · ${t('pour {names}', { names: ev.people.map(shared.nameFor).join(', ') })}` : ''}
            {shared && ` · ${t('par {name}', { name: shared.author(ev.id) })}`}
            {isBigEvent(ev) && ` · ${countdownLabel(ev.date)}`}
            {/* Its reminders as a small chip (« 1 h avant », « 2 rappels »), whole: the full list in its tooltip. */}
            {reminders.length > 0 && <ReminderChip reminders={reminders} date={ev.date} time={ev.start} className="ml-2 align-[1px]" />}
          </p>
          {/* Two lines at most here; the whole notes in the event's window. */}
          {ev.details && <p className="mt-1.5 line-clamp-2 whitespace-pre-line text-[13px] text-stone-600 [overflow-wrap:anywhere]">{ev.details}</p>}
        </button>
        {/* The card itself opens the form (with « Supprimer »); on a phone the bin goes too: the title keeps the width. */}
        {!readOnly && <div className="touch-show flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:max-sm:hidden">
          <button
            className="icon-btn hover:text-red-600"
            title={t('Supprimer')} aria-label={t('Supprimer « {title} »', { title: ev.title })}
            onClick={() => void removeEvent(ev, source)}
          >
            <Trash2 size={14} />
          </button>
        </div>}
      </div>
    </div>
  );
}


/**
 * « Filtrer » : everything is shown by default; ticking categories (or « Importants », « Tâches ») shows only those.
 * Below, my shared calendars shown over mine (all at first), or « Pour qui » in a shared calendar.
 * A popover of real checkboxes (keyboard, screen readers), closed by Échap or a click outside.
 */
function CalendarFilter({ categories, shown, importantOnly, tasksOnly, onToggle, onImportant, onTasks, onReset, onManage, agendas, hiddenAgendas, onAgenda, people, forWho, onForWho }: {
  categories: EventCategory[];
  shown: Set<EventCategory>;
  importantOnly: boolean;
  tasksOnly: boolean;
  onToggle: (k: EventCategory) => void;
  /** Absent in a shared calendar (nothing is marked important there, no tasks). */
  onImportant?: () => void;
  onTasks?: () => void;
  onReset: () => void;
  /** Absent for a reader of a shared calendar (its categories are changed by its editors). */
  onManage?: () => void;
  /** My calendar: my shared calendars, ticked when shown over it. */
  agendas: Group[];
  hiddenAgendas: string[];
  onAgenda: (id: string) => void;
  /** A shared calendar: its members (« Moi » first), to see what is for one of them. */
  people?: { id: string; name: string }[];
  forWho: string | null;
  onForWho: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const usage = useSettings(s => s.usage);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const count = shown.size + (importantOnly ? 1 : 0) + (tasksOnly ? 1 : 0) + (forWho ? 1 : 0);
  useEffect(() => {
    if (!open) return;
    // Lower on the page (shared agenda on a phone) it went under the tab bar: the page scrolls to show it whole.
    rootRef.current?.querySelector('#filtre-calendrier')?.scrollIntoView({ block: 'nearest' });
    const onDown = (e: MouseEvent | TouchEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const box = 'h-4 w-4 shrink-0 accent-[var(--color-ink)]';
  const row = 'flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] hover:bg-stone-50';
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls="filtre-calendrier"
        className={cx('btn-secondary hit-sm h-8 px-2.5 pointer-coarse:h-9 pointer-coarse:min-w-9', count > 0 && 'border-ink/40 text-ink')}
        title={t('Filtrer les événements affichés')}
      >
        <ListFilter size={15} />
        <span className="max-sm:sr-only short:sr-only">{t('Filtrer')}</span>
        {count > 0 && <span className="tabular rounded-full bg-ink px-1.5 text-[11px] leading-[18px] text-paper">{count}</span>}
      </button>
      {open && (
        // A low screen (a phone on its side): over the page, its choices on three columns, so all fit without a scrollbar
        // (a 64 px wide column went under the tab bar and scrolled).
        <div
          id="filtre-calendrier"
          role="group"
          aria-label={t('Filtrer les événements')}
          className="pop absolute right-0 top-full z-[60] mt-2 max-h-[min(70dvh,560px)] max-sm:max-h-[min(70dvh,calc(100dvh-360px))] w-64 overflow-y-auto overscroll-contain rounded-xl border border-stone-200 bg-surface p-2 shadow-pop short:fixed short:inset-x-4 short:top-3 short:z-[90] short:mx-auto short:mt-0 short:max-h-[calc(100dvh-24px)] short:w-auto short:max-w-2xl"
        >
          <p className="px-2 pb-1 pt-0.5 text-[12px] text-stone-500">{t('Afficher seulement :')}</p>
          <div className="short:grid short:grid-cols-3 short:gap-x-1">
          {onImportant && (
            <label className={row}>
              <input type="checkbox" className={box} checked={importantOnly} onChange={onImportant} />
              <Flag size={13} className="shrink-0 fill-amber-500 text-amber-500" />
              {t('Importants')}
            </label>
          )}
          {onTasks && (
            <label className={row}>
              <input type="checkbox" className={box} checked={tasksOnly} onChange={onTasks} />
              <ListTodo size={13} className="shrink-0 text-stone-500" />
              {t('Tâches')}
            </label>
          )}
          {(onImportant || onTasks) && <div className="my-1 h-px bg-stone-100 short:hidden" />}
          {categories.map(k => {
            const c = catOf(k);
            return (
              <label key={k} className={row}>
                <input type="checkbox" className={box} checked={shown.has(k)} onChange={() => onToggle(k)} />
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
                <span className="min-w-0 truncate">{c.label}</span>
              </label>
            );
          })}
          </div>
          {people && people.length > 1 && (
            <div role="radiogroup" aria-label={t('Pour qui')} className="mt-1 border-t border-stone-100 pt-1">
              <p className="px-2 pb-1 pt-1 text-[12px] text-stone-500">{t('Pour qui :')}</p>
              {[{ id: null, name: t('Tout le monde') }, ...people].map(p => (
                <label key={p.id ?? ''} className={row}>
                  <input type="radio" name="pour-qui" className={box} checked={forWho === p.id} onChange={() => onForWho(p.id)} />
                  <span className="min-w-0 truncate">{p.name}</span>
                </label>
              ))}
            </div>
          )}
          {agendas.length > 0 && (
            <div className="mt-1 border-t border-stone-100 pt-1">
              <p className="px-2 pb-1 pt-1 text-[12px] text-stone-500">
                {agendas.some(g => g.kind !== 'agenda') ? t('Mes agendas partagés et {groups}', { groups: groupWords(usage).groups }) : t('Mes agendas partagés')}
              </p>
              {agendas.map(g => (
                <label key={g.id} className={row}>
                  <input type="checkbox" className={box} checked={!hiddenAgendas.includes(g.id)} onChange={() => onAgenda(g.id)} />
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: g.color ?? GROUP_COLORS[0] }} />
                  <span className="min-w-0 truncate">{g.name}</span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center gap-1 border-t border-stone-100 pt-2">
            <button type="button" className="btn-ghost h-8 px-2 text-[12px]" disabled={!count} onClick={onReset}>
              {t('Tout afficher')}
            </button>
            {onManage && (
              <button
                type="button"
                className="btn-ghost ml-auto h-8 px-2 text-[12px]"
                onClick={() => {
                  setOpen(false);
                  onManage();
                }}
              >
                {t('Gérer les catégories')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const source = useCalendarSource();
  const { events: ownEvents, shared } = source;
  // My calendar: my shared calendars' events over it (read-only here), in each one's colour.
  const overlay = useAgendaOverlay(!shared);
  const events = useMemo(() => (shared || !overlay.events.length ? ownEvents : [...ownEvents, ...overlay.events]), [shared, ownEvents, overlay.events]);
  const hiddenAgendas = useSettings(s => s.hiddenAgendas) ?? [];
  // My series without end: their next occurrences made when due (lib/repeatSeries), once per visit.
  useEffect(() => {
    if (!shared) refillEndless();
  }, [shared]);
  // My tasks with a due day, on their day (not in a shared calendar: they are mine).
  const allTodos = useTodos(s => s.todos);
  const [task, setTask] = useState<Todo | null>(null);
  // Today; or, when nothing is left this week, the next day something is planned (and a line says so).
  const [opening] = useState(() => {
    const asked = validKey(params.get('jour'));
    if (asked) return { day: asked, jumped: false };
    const now = new Date();
    const items = [...events, ...(shared ? [] : allTodos.filter(x => x.due).map(x => ({ date: x.due!, done: x.done })))];
    return openingDay(todayKey(), toKey(addDays(weekStart(now), 6)), items, toKey(addDays(now, 60)), jumpSaid());
  });
  const [selected, setSelectedDay] = useState(opening.day);
  // False while the day shown is the one the calendar jumped to by itself: a new event is then proposed for today.
  const [dayChosen, setDayChosen] = useState(!opening.jumped);
  const setSelected = (key: string) => {
    setSelectedDay(key);
    setDayChosen(true);
  };
  const newDay = newEventDay(selected, todayKey(), dayChosen);
  const [jumpNote, setJumpNote] = useState(opening.jumped);
  // Once per session: the next visit opens on today, without the line.
  useEffect(() => {
    if (opening.jumped) markJumpSaid();
  }, [opening.jumped]);
  const [mode, setModeState] = useState<Mode>(savedMode);
  const [quick, setQuick] = useState('');
  // Filter: nothing ticked shows everything; ticked categories (and/or « Importants », « Tâches ») show only those.
  const [shown, setShown] = useState<Set<EventCategory>>(new Set());
  const [importantOnly, setImportantOnly] = useState(false);
  const [tasksOnly, setTasksOnly] = useState(false);
  // A shared calendar: what is for one member (an event for everyone is for each of them).
  const [forWho, setForWho] = useState<string | null>(null);
  const filtering = shown.size > 0 || importantOnly || tasksOnly || !!forWho;
  const clearFilter = () => {
    setShown(new Set());
    setImportantOnly(false);
    setTasksOnly(false);
    setForWho(null);
  };
  const todos = useMemo(() => (shared || (filtering && !tasksOnly) ? [] : allTodos.filter(x => x.due)), [shared, filtering, tasksOnly, allTodos]);
  const [menu, setMenu] = useState<{ x: number; y: number; ev: CalendarEvent } | null>(null);
  const weekGrid = useWeekGrid();
  const custom = source.categories; // a shared calendar: its own (mine aren't the others')
  const usage = useSettings(s => s.usage);
  const words = { ...(WORDS[usage] ?? WORDS.etudes), ...(shared && AGENDA_EXAMPLES) };
  const wide = useWide();
  const short = useShort();
  // Phones and low screens: only the date and the views stay fixed at the top (the title and the field scroll away).
  const compactHead = !wide || short;
  // The fixed header's height, for the week's day names that stay under it (TimeGrid).
  const pageRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const head = headRef.current;
    const page = pageRef.current;
    if (!head || !page || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => page.style.setProperty('--cal-head', `${head.offsetHeight}px`));
    ro.observe(head);
    return () => ro.disconnect();
  }, []);
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRoom = usePanelInset(gridRef, mode === 'week' && weekGrid);
  const [allUpcoming, setAllUpcoming] = useState(false);
  const [managing, setManaging] = useState(false);
  const [periodsOpen, setPeriodsOpen] = useState(false);
  // fromQuick: opened from the quick add (« demain 14h » without a title), whose text is cleared once saved.
  // template: « Dupliquer », a new event filled in as that one.
  const [form, setFormState] = useState<{ event?: CalendarEvent; template?: CalendarEvent; date: string; start?: string; end?: string; title?: string; fromQuick?: boolean } | null>(null);
  // A reader of a shared calendar sees it, without the ways to change it (the server refuses them anyway).
  const readOnly = !!shared && !shared.canEdit;
  // A reader opens an event to read it all (EventForm shows it without anything to change), nothing else.
  const setForm = (f: typeof form) => setFormState(readOnly && !f?.event ? null : f);
  const [importing, setImporting] = useState<{ initial?: IcsSource } | null>(null);
  // The « + » button: the full form for the day shown, and (my own calendar) the import of a .ics.
  // A reader of a shared calendar: nothing to create, no button.
  useCreateActions(
    readOnly
      ? []
      : [
          { label: t('Nouvel événement'), icon: <CalendarPlus />, onClick: () => setForm({ date: newDay }) },
          ...(shared ? [] : [{ label: t('Ajouter un {timetable} (lien ou fichier .ics)', { timetable: words.timetable }), icon: <CalendarArrowDown />, onClick: () => setImporting({}) }]),
        ],
  );
  const [fileOver, setFileOver] = useState(false);
  const quickRef = useRef<HTMLInputElement>(null);

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };

  // Follow links like /calendrier?jour=2026-10-12 (from search, dashboard or Kompaly).
  const jour = validKey(params.get('jour'));
  const [lastJour, setLastJour] = useState(jour);
  if (jour !== lastJour) {
    setLastJour(jour);
    if (jour) setSelected(jour);
  }

  // …&evt=… : that event glows once its day is on screen (from the home page, a search, « Ma semaine »…).
  const evt = params.get('evt');
  useEffect(() => {
    if (!evt) return;
    flashWhenReady(() => document.querySelector(`[data-event="${CSS.escape(evt)}"]`));
    setParams(p => (p.delete('evt'), p), { replace: true });
  }, [evt, setParams]);

  useEffect(() => {
    // ?ajout=1 (« + » of the home page): the new event's window, open on the day shown.
    if (params.get('ajout')) {
      if (!readOnly) setFormState({ date: newDay });
      setParams(p => (p.delete('ajout'), p), { replace: true });
    }
    // ?importer=1 (« Essayer » in Nouveautés): the window to follow a timetable by its link or a .ics file.
    if (params.get('importer')) {
      if (!shared) setImporting({});
      setParams(p => (p.delete('importer'), p), { replace: true });
    }
    // ?filtre=importants (« +N autres » of the home page's big day): only the important ones.
    if (params.get('filtre') === 'importants') {
      if (!shared) setImportantOnly(true);
      setParams(p => (p.delete('filtre'), p), { replace: true });
    }
  }, [params, setParams, readOnly, newDay, shared]);

  /** An event opened: its window, or, a shared calendar's event shown in mine, its day in that agenda. */
  const openEvent = (ev: CalendarEvent) => (fromAgenda(ev) ? navigate(agendaLink(ev)) : setForm({ event: ev, date: ev.date }));
  /** Right click (or the menu key) on an event: what can be done with it. */
  const openMenu = (ev: CalendarEvent, e: ReactMouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    e.preventDefault();
    setMenu({ ...menuPoint(e), ev });
  };
  const menuItems = (ev: CalendarEvent): MenuItem[] => {
    if (fromAgenda(ev))
      return [
        { label: t('Ouvrir dans « {name} »', { name: ev.agenda.name }), icon: <ExternalLink size={15} />, onClick: () => navigate(agendaLink(ev)) },
        { label: t('Copier dans mon agenda'), icon: <CalendarPlus size={15} />, onClick: () => copyToMyCalendar(ev) },
      ];
    if (readOnly) return [{ label: t('Ouvrir'), icon: <ExternalLink size={15} />, onClick: () => openEvent(ev) }, { label: t('Copier dans mon agenda'), icon: <CalendarPlus size={15} />, onClick: () => copyToMyCalendar(ev) }];
    return [
      { label: t('Modifier'), icon: <Pencil size={15} />, onClick: () => openEvent(ev) },
      { label: t('Dupliquer'), icon: <Copy size={15} />, onClick: () => setForm({ template: ev, date: ev.date }) },
      ...(shared ? [{ label: t('Copier dans mon agenda'), icon: <CalendarPlus size={15} />, onClick: () => copyToMyCalendar(ev) }] : []),
      { label: '', divider: true, onClick: () => undefined },
      { label: t('Supprimer'), icon: <Trash2 size={15} />, danger: true, onClick: () => void removeEvent(ev, source) },
    ];
  };

  /** A row of « À venir »: its day, and the event glowing in it. */
  const showEvent = (e: Pick<CalendarEvent, 'id' | 'date'>) => {
    selectDay(e.date);
    flashWhenReady(() => document.querySelector(`[data-event="${CSS.escape(e.id)}"]`));
  };

  const selectDay = (key: string) => {
    setSelected(key);
    // Only « jour »: in a shared calendar, the URL also says which one (?g=…).
    if (jour) setParams(p => (p.delete('jour'), p), { replace: true });
  };

  const passes = useCallback(
    (e: Pick<CalendarEvent, 'category' | 'important' | 'people'>) =>
      // « Tâches » alone ticked: the tasks only.
      !(tasksOnly && !shown.size && !importantOnly) && (shown.size === 0 || shown.has(e.category)) && (!importantOnly || isBigEvent(e)) && isFor(e, forWho),
    [shown, importantOnly, tasksOnly, forWho],
  );
  // Sorted once per change of the events or the filter: the days and « À venir » read this list (with 4 000 events,
  // sorting it again at each day or month shown cost ~60 ms a click).
  const sorted = useMemo(() => events.filter(passes).sort(sortEvents), [events, passes]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of sorted) {
      const list = m.get(e.date);
      if (list) list.push(e);
      else m.set(e.date, [e]);
    }
    return m;
  }, [sorted]);

  const selDate = fromKey(selected);
  const today = useToday();
  // The week shown, its keys and its events: the same arrays while it stays (the hourly grid keeps its layout
  // instead of placing every event again at each key typed in the quick add).
  const monday = toKey(weekStart(selDate));
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(fromKey(monday), i)), [monday]);
  const dayEvents = byDay.get(selected) ?? [];
  const dayTasks = tasksOn(todos, selected);
  // Periods (« En entreprise »…): a band over the week, a tint on their days.
  const { periods } = source;
  const weekKeys = useMemo(() => week.map(toKey), [week]);
  const weekEvents = useMemo(() => weekKeys.flatMap(k => byDay.get(k) ?? []), [weekKeys, byDay]);
  const dayKeys = useMemo(() => [selected], [selected]);
  const weekBands = periodsBetween(periods, weekKeys[0], weekKeys[6]);
  const selPeriods = periodsOn(periods, selected);
  const tintOf = (key: string): Period | undefined => periodsOn(periods, key)[0];
  const fillOf = (key: string, strength: number) => periodsFill(periodsOn(periods, key), strength);
  const label = (p: Period) => periodLabel(p, shared?.nameOf);

  // A window open over the page (the event's form…): the bar behind takes nothing typed, the keyboard stays in the window.
  const behind = useModals(s => s.open > 0);
  const parsed = quick.trim() ? parseQuickAdd(quick, undefined, undefined, true) : null;
  const parsedCat = parsed ? guessCategory(parsed.title || quick, !!parsed.start, custom, shared ? 'shared' : 'mine') : null;
  // No day in the sentence: the day shown, unless it is past (an event typed while looking back lands today).
  const quickDate = parsed?.date ?? (newDay < today ? today : newDay);

  // The form, with what the sentence already gives (« demain 14h » has a day and an hour but no title).
  const openForm = () => setForm({ date: quickDate, start: parsed?.start ?? undefined, end: parsed?.end ?? undefined, fromQuick: !!quick.trim() });

  /** After an event is saved: show its day, and clear the filter if it hid it (it would seem not to be there). */
  const showSaved = (ev: { date: string; category: EventCategory; important?: boolean }) => {
    selectDay(ev.date);
    if (!passes(ev)) {
      setShown(new Set());
      setImportantOnly(false);
    }
  };

  const submitQuick = (e: FormEvent) => {
    e.preventDefault();
    if (parsed?.impossible) return;
    if (!parsed?.title) return openForm();
    // « Sport tous les mardis 18h », « Anniversaire de Léa le 12 mars tous les ans »: the form, to choose until when it repeats.
    // Over more days than an event can last: the form too, which says so.
    if (parsed.every || parsed.rule || (parsed.endDate && spanTooLong(quickDate, parsed.endDate)))
      return setForm({ date: quickDate, start: parsed.start ?? undefined, end: parsed.end ?? undefined, title: quick, fromQuick: true });
    const date = quickDate;
    // « Congés du 22 au 26 décembre »: one event over several days (one a day, linked, as the form makes it); the first
    // day keeps the reminders, the others none.
    if (parsed.endDate) {
      const series = newSeries(true);
      source.addMany(
        spanDays(date, parsed.endDate, parsed.start ?? undefined, parsed.end ?? undefined).map((p, i) => ({
          title: parsed.title,
          ...p,
          category: parsedCat!,
          important: parsed.important,
          series,
          ...(parsed.place && { place: parsed.place }),
          ...(i > 0 ? { reminders: [] } : { reminders: remindMinutes(parsed.remind, date, parsed.start) }),
        })),
      );
      setQuick('');
      showSaved({ date, category: parsedCat!, important: parsed.important });
      toast(t('Ajouté du {from} au {to}', { from: fmtDay(fromKey(date), 'EEEE d MMMM'), to: fmtDay(fromKey(parsed.endDate), 'EEEE d MMMM') }), 'success');
      return;
    }
    // « rappel 1h avant », « sans rappel »: the reminder said is the one made (else the usual ones).
    source.add({ title: parsed.title, date, start: parsed.start ?? undefined, end: parsed.end ?? undefined, category: parsedCat!, important: parsed.important, reminders: remindMinutes(parsed.remind, date, parsed.start), ...(parsed.place && { place: parsed.place }) });
    setQuick('');
    showSaved({ date, category: parsedCat!, important: parsed.important });
    toast(t('Ajouté : {title}', { title: parsed.title }), 'success');
  };

  // Another week or month: today when it is in it, else its first day (not the same date number every month,
  // which looked like « today » in blue on the 18th of each month).
  const shift = (dir: 1 | -1) => {
    if (mode === 'day') return selectDay(toKey(addDays(selDate, dir)));
    const first = mode === 'week' ? addDays(weekStart(selDate), 7 * dir) : addMonths(startOfMonth(selDate), dir);
    const last = mode === 'week' ? addDays(first, 6) : endOfMonth(first);
    selectDay(today >= toKey(first) && today <= toKey(last) ? today : toKey(first));
  };

  // ← / → move one day (↑ / ↓ one week outside the day view), like a desktop agenda. T: today; J, S, M: the day,
  // week or month view (never while typing, with a modifier, or with a window open).
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keysRef.current = e => {
      if (form || importing || task || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [aria-modal="true"], [role="menu"]') || document.querySelector('[aria-modal="true"]')) return;
      const view = !e.shiftKey && !e.repeat && ({ t: 'today', j: 'day', s: 'week', m: 'month' } as const)[e.key.toLowerCase() as 't' | 'j' | 's' | 'm'];
      if (view) {
        e.preventDefault();
        if (view === 'today') selectDay(today);
        else setMode(view);
        return;
      }
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: mode === 'day' ? 0 : -7, ArrowDown: mode === 'day' ? 0 : 7 }[e.key];
      if (!delta) return;
      e.preventDefault();
      selectDay(toKey(addDays(selDate, delta)));
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Drag an event onto another day, or onto another time in the hourly grid; its bottom edge to another end;
  // over empty slots, a new event that long.
  const moveEvent = (ev: CalendarEvent, target: DropTarget, dragMode: DragMode) => {
    if (dragMode === 'create') {
      const r = sweptRange(toMinutes(ev.start!), target.minutes!);
      return setForm({ date: ev.date, start: fromMinutes(r.from), end: fromMinutes(r.to) });
    }
    if (dragMode === 'resize') {
      const end = fromMinutes(Math.max(toMinutes(ev.start!) + 15, target.minutes!));
      if (end === ev.end) return;
      source.update(ev.id, { end });
      return toast(t('Finit à {time}', { time: end }), 'success', { label: t('Annuler||l’action'), run: () => source.update(ev.id, { end: ev.end }) });
    }
    // One day of an event over several days: the whole event moves by as many days (that day alone left the others
    // behind, and its window then showed an event from its first day to that one). Its hours stay as they are.
    if (isSpan(ev.series)) {
      const moved = spanMove(source.events, ev, target.day);
      if (!moved.length) return;
      const { update } = source;
      moved.forEach(m => update(m.id, { date: m.to }));
      return toast(t('Déplacé au {day}', { day: fmt(fromKey(moved[0].to), 'EEEE d MMM') }), 'success', { label: t('Annuler||l’action'), run: () => moved.forEach(m => update(m.id, { date: m.from })) });
    }
    const patch: Partial<CalendarEvent> = { date: target.day };
    if (target.minutes !== undefined) {
      const length = ev.start && ev.end ? toMinutes(ev.end) - toMinutes(ev.start) : ev.start ? null : 60;
      patch.start = fromMinutes(target.minutes);
      patch.end = length === null ? undefined : fromMinutes(target.minutes + length);
    }
    const dayChanged = patch.date !== ev.date;
    const timeChanged = patch.start !== undefined && patch.start !== ev.start;
    if (!dayChanged && !timeChanged) return;
    // A reminder at a set moment (« La veille à 9h ») keeps its hour on the new day.
    if (ev.reminders) patch.reminders = followMoments(ev.reminders, { date: ev.date, time: ev.start }, { date: patch.date!, time: patch.start ?? ev.start }, ev.reminders);
    const before = { date: ev.date, start: ev.start, end: ev.end, reminders: ev.reminders };
    const { update } = source;
    update(ev.id, patch);
    const day = fmt(fromKey(target.day), 'EEEE d MMM');
    const label = dayChanged ? (timeChanged ? t('Déplacé au {day} à {time}', { day, time: patch.start! }) : t('Déplacé au {day}', { day })) : t('Déplacé à {time}', { time: patch.start! });
    toast(label, 'success', { label: t('Annuler||l’action'), run: () => update(ev.id, before) });
  };
  // A slow tap (the finger held still a moment) opens the event, as a quick one does.
  const { drag, ghostRef, start: dragStart } = useEventDrag(moveEvent, ev => openEvent(ev));
  // Nothing moves on a read-only calendar, nor a shared calendar's event shown in mine.
  const canChange = (ev: CalendarEvent) => !readOnly && !fromAgenda(ev);
  const startDrag: typeof dragStart = (ev, ...a) => (canChange(ev) ? dragStart(ev, ...a) : undefined);
  const dropDay = drag?.target && drag.target.minutes === undefined ? drag.target.day : null;

  // Drop an .ics file anywhere on the page to import it.
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const onFileDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e) || shared) return;
    e.preventDefault();
    setFileOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!isIcsFile(file)) {
      toast(t('Dépose un fichier .ics pour importer un {timetable}', { timetable: words.timetable }), 'error');
      return;
    }
    setImporting({ initial: { name: file.name, text: await file.text() } });
  };

  // Same filter as the calendar (the category chips sit in this block).
  // An exam of today already over (its end, else its start, passed) is no longer « à venir », as on the home page.
  // Exams and events marked important (they count as big days too).
  const isUpcomingExam = (e: CalendarEvent) => isBigEvent(e) && !isOver(e);
  // Events are not ticked (only tasks): what is past is just past, not « en retard ».
  // (Days compared as keys: date-fns' differenceInCalendarDays twice per event was the slowest part of this list.)
  const in14 = toKey(addDays(fromKey(today), 14));
  const isHomeworkSoon = (e: CalendarEvent) => e.date >= today && e.date <= in14 && isDeliverable(e);
  // « Rien à afficher » only when a hidden category holds something this block would list (not a hidden « Sport »).
  // Anything still to come (not over): after the important ones, the next things, whatever they are.
  const isComing = (e: CalendarEvent) => e.date >= today && !isOver(e);
  // From now on, whatever day is shown: « À venir » is what comes next, not what follows the day looked at (it
  // used to leave out the day shown, so today's next class was missing from it on opening).
  // Sorted once per change of the events (and once a minute, for « over »), not at each key typed in the quick add.
  const minute = Math.floor(Date.now() / 60_000);
  const { upcomingHidden, upcoming } = useMemo(() => {
    const upcomingHidden = filtering && events.some(e => !passes(e) && (isComing(e) || isHomeworkSoon(e)));
    // An event over several days once, at its first day still to come (not « J-3, J-4, J-5 »).
    // Only what is from today on can be listed: the sorted list from its first event of today (a binary search).
    let lo = 0;
    for (let hi = sorted.length; lo < hi; ) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].date < today) lo = mid + 1;
      else hi = mid;
    }
    const pool = firstOfSpans(sorted.slice(lo).filter(e => isUpcomingExam(e) || isHomeworkSoon(e) || isComing(e)));
    // One list in date order: the important ones (marked, one per repeat) among homework to hand in and the next events.
    const upcoming = upcomingList(pool, e => (isUpcomingExam(e) ? 'big' : isHomeworkSoon(e) ? 'homework' : 'other'));
    return { upcomingHidden, upcoming };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers above only read these values
  }, [events, sorted, passes, filtering, shared, today, minute]);
  const upcomingRows = allUpcoming ? [...upcoming.shown, ...upcoming.more].sort(sortEvents) : upcoming.shown;

  const monthDays = useMemo(() => {
    const ref = fromKey(selected);
    const start = weekStart(startOfMonth(ref));
    const end = endOfMonth(ref);
    const days: Date[] = [];
    for (let d = start; d <= end || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);
    return days;
  }, [selected]);
  // The month by rows of a week: an event over several days is one bar across its days in each row.
  const monthRows = useMemo(() => {
    if (mode !== 'month') return [];
    const rows: { days: Date[]; keys: string[] }[] = [];
    for (let i = 0; i < monthDays.length; i += 7) {
      const days = monthDays.slice(i, i + 7);
      rows.push({ days, keys: days.map(toKey) });
    }
    return rows.map(r => {
      const bars = spanBars(r.keys.flatMap(k => byDay.get(k) ?? []), r.keys, events);
      const barred = new Set(bars.flatMap(b => r.keys.flatMap(k => (byDay.get(k) ?? []).filter(e => e.series === b.ev.series).map(e => e.id))));
      return { ...r, bars, barred, lanes: bars.length ? Math.max(...bars.map(b => b.lane)) + 1 : 0 };
    });
  }, [mode, monthDays, byDay, events]);

  // A shared calendar has no title here (its page has one).
  const title = !shared && <h1 className="mr-3 flex items-center gap-2 text-[24px] font-semibold tracking-[-0.02em] max-sm:w-full max-sm:pb-1 max-sm:pt-2">{t('Calendrier')}</h1>;
  // Quick add. Keyboard focus: a brand ring (the shadow alone was invisible on the dark theme).
  const quickAdd = (
    readOnly ? (
          <p className="cal-notice card px-4 py-3 text-[13px] text-stone-500">{t('Agenda en lecture seule.')}</p>
        ) : (
        <form onSubmit={submitQuick} inert={behind} className="card flex flex-col px-3 transition-shadow focus-within:border-stone-300 focus-within:shadow-pop has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-focus">
          <div className="flex h-12 items-center gap-2.5">
            <Plus size={17} className="shrink-0 text-stone-400" />
            <input
              ref={quickRef}
              value={quick}
              onChange={e => setQuick(e.target.value)}
              placeholder={wide ? t('Ajouter un événement, par exemple «\u00a0{example}\u00a0»', { example: words.quickExample }) : t('Ajouter un événement…')}
              aria-label={t('Ajouter un événement en une phrase')}
              className="h-full min-w-0 flex-1 text-ellipsis bg-transparent text-[14px] outline-none placeholder:text-stone-500"
            />
            {/* Nothing typed (or no title, « demain 14h »): Entrée opens the full form, as the « + » button does. */}
            {parsed?.title && (
              <button type="submit" disabled={parsed.impossible} className="btn-primary h-8 px-3 disabled:opacity-50">
                {t('Ajouter')} <CornerDownLeft size={13} />
              </button>
            )}
          </div>
          {parsed?.title && parsedCat && (
            <div className="enter flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-stone-100 py-2 pl-[27px] text-[12px] text-stone-500">
              <Dot color={catOf(parsedCat).color} />
              <span className="font-medium text-ink">{parsed.title}</span>
              <span>·</span>
              <span>{fmtDay(fromKey(quickDate), 'EEEE d MMMM')}{parsed.endDate && ` → ${fmtDay(fromKey(parsed.endDate), 'EEEE d MMMM')}`}</span>
              {parsed.start && (
                <>
                  <span>·</span>
                  <span className="tabular">
                    {parsed.start}
                    {parsed.end && `–${parsed.end}`}
                  </span>
                </>
              )}
              <span>·</span>
              <span style={{ color: catOf(parsedCat).text }}>{catOf(parsedCat).label}</span>
              {parsed.important && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                    <Flag size={11} className="fill-current" /> {t('Important')}
                  </span>
                </>
              )}
              {parsed.every && <span className="w-full text-stone-500">{t('Entrée\u00a0: choisir jusqu’à quand.')}</span>}
              {parsed.impossible && <span className="w-full font-medium text-red-600 dark:text-red-400">{t('Cette date n’existe pas : corrige-la pour ajouter.')}</span>}
            </div>
          )}
        </form>
        )
  );

  const monthBands = mode === 'month' && monthDays.length ? periodsBetween(periods, toKey(monthDays[0]), toKey(monthDays[monthDays.length - 1])) : [];
  // A phone's week (its days one under the other): the periods' rows over its seven days.
  // The days it lists: this week, from today on, plus the days already past that still hold something (it opened on a
  // Monday's « Rien de prévu. » rows, today's plans far down the page); another week, all its days.
  const phoneWeekKeys = useMemo(
    () => (weekKeys.includes(today) ? weekKeys.filter(k => k >= today || byDay.has(k) || tasksOn(todos, k).length > 0) : weekKeys),
    [weekKeys, today, byDay, todos],
  );
  const phoneWeekLanes = useMemo(() => dayLanes(mode === 'week' && !weekGrid ? periods : [], phoneWeekKeys), [mode, weekGrid, periods, phoneWeekKeys]);
  // The rows of the periods over the whole month shown (a period keeps its height across the weeks too).
  const monthLanes = useMemo(() => dayLanes(mode === 'month' ? periods : [], monthDays.map(toKey)), [mode, periods, monthDays]);

  return (
    <div
      ref={pageRef}
      className={cx('cal-page h-full overflow-y-auto pb-room', shared ? 'shadow-room' : 'px-4 md:px-8')}
      onDragOver={e => {
        if (!hasFiles(e) || shared) return;
        e.preventDefault();
        if (!fileOver) setFileOver(true);
      }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false);
      }}
      onDrop={e => void onFileDrop(e)}
    >
      <div className="mx-auto max-w-[1180px]">
        {compactHead && title}
        {/* Header: the date (‹ month ›, Aujourd’hui), then the views and the tools at the right. A shared calendar
            has no title here (its page has one): the date starts the row. Phones: two rows, the views and tools
            under the date, the tools at the right edge. One height for all (36 px under a finger).
            Fixed at the top while the page scrolls (the shared page-head: the page's own background, in every look). */}
        <div ref={headRef} className={cx('page-head', compactHead ? 'pb-3 pt-1' : 'pb-4 pt-2')}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {!compactHead && title}
          <div className={cx('flex flex-wrap items-center gap-2', !shared && 'sm:ml-auto')}>
            <div className="flex items-center gap-1">
              <button className="icon-btn pointer-coarse:h-9 pointer-coarse:w-9" onClick={() => shift(-1)} title={mode === 'day' ? t('Jour précédent') : t('Précédent')} aria-label={mode === 'day' ? t('Jour précédent') : t('Précédent')}>
                <ChevronLeft size={17} />
              </button>
              <span className="min-w-28 text-center text-[14px] font-medium first-letter:uppercase max-sm:min-w-24">
                {mode === 'day' ? (
                  <>
                    {/* A phone: the short month, so « Aujourd’hui » stays on the screen. */}
                    <span className="max-sm:hidden">{fmt(selDate, 'EEE d MMMM')}</span>
                    <span className="sm:hidden">{fmt(selDate, 'EEE d MMM')}</span>
                  </>
                ) : (
                  fmt(selDate, 'MMMM yyyy')
                )}
              </span>
              <button className="icon-btn pointer-coarse:h-9 pointer-coarse:w-9" onClick={() => shift(1)} title={mode === 'day' ? t('Jour suivant') : t('Suivant')} aria-label={mode === 'day' ? t('Jour suivant') : t('Suivant')}>
                <ChevronRight size={17} />
              </button>
            </div>
            {/* Only of use away from today: greyed while today is the day shown. */}
            <button className="btn-secondary h-8 pointer-coarse:h-9 disabled:pointer-events-none disabled:opacity-40" onClick={() => selectDay(today)} disabled={selected === today}>
              {t('Aujourd’hui')}
            </button>
          </div>
          {/* The smallest phones: the tools go under the views rather than past the edge. */}
          <div className={cx('flex flex-wrap items-center gap-2 max-sm:w-full', shared && 'ml-auto')}>
            {/* The shared segmented control (index.css › seg): the chosen view the same shape as its frame, in every look. */}
            <div className="seg text-[13px]" role="group" aria-label={t('Affichage')}>
              {MODES.map(m => (
                <button key={m.id} onClick={() => setMode(m.id)} aria-pressed={mode === m.id} className="seg-item pointer-coarse:min-w-11 sm:px-3">
                  {m.label}
                </button>
              ))}
            </div>
            {/* Periods, filter and export: together, at the right edge of their row. */}
            <div className="ml-auto flex items-center gap-2 sm:ml-0">
              {/* Google Agenda, Pronote, an ENT… (also in the « + » menu): in sight, it was not found there. */}
              {!shared && (
                <button className="btn-secondary hit-sm h-8 px-2.5 pointer-coarse:h-9 pointer-coarse:min-w-9" onClick={() => setImporting({})} title={t('Importer un {timetable} (Google Agenda, Pronote, ENT, fichier .ics)', { timetable: words.timetable })} aria-label={t('Importer un {timetable}', { timetable: words.timetable })}>
                  <CalendarArrowDown size={15} /> <span className={cx('max-sm:sr-only', short && 'sr-only')}>{t('Importer')}</span>
                </button>
              )}
              {(!readOnly || periods.length > 0) && (
                <button className="btn-secondary hit-sm h-8 px-2.5 pointer-coarse:h-9 pointer-coarse:min-w-9" onClick={() => setPeriodsOpen(true)} title={t('Périodes : {ideas}…', { ideas: periodIdeas(usage) })} aria-label={t('Périodes')}>
                  <CalendarRange size={15} /> <span className={cx('max-sm:sr-only', short && 'sr-only')}>{t('Périodes')}</span>
                </button>
              )}
              <CalendarFilter
                categories={allCategories(custom)}
                shown={shown}
                importantOnly={importantOnly}
                tasksOnly={tasksOnly}
                onToggle={k =>
                  setShown(prev => {
                    const n = new Set(prev);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    return n;
                  })
                }
                onImportant={shared ? undefined : () => setImportantOnly(v => !v)}
                onTasks={shared ? undefined : () => setTasksOnly(v => !v)}
                onReset={clearFilter}
                onManage={readOnly ? undefined : () => setManaging(true)}
                agendas={overlay.agendas}
                hiddenAgendas={hiddenAgendas}
                onAgenda={id => useSettings.getState().set({ hiddenAgendas: hiddenAgendas.includes(id) ? hiddenAgendas.filter(x => x !== id) : [...hiddenAgendas, id] })}
                people={shared?.people}
                forWho={forWho}
                onForWho={setForWho}
              />
              {/* Mine: not on phones, where the row has no room for it (Réglages › Données exports too). A shared calendar
                  has no title on this row: its export fits there, and is the only one. Importing: the « + » button. */}
              <button
                className={cx('icon-btn h-8 w-8 disabled:opacity-40', shared ? 'inline-flex pointer-coarse:h-9 pointer-coarse:w-9' : 'hidden sm:inline-flex')}
                disabled={!ownEvents.length}
                onClick={() => (exportIcs(ownEvents, shared?.group.name), toast(shared ? t('Agenda « {name} » exporté', { name: shared.group.name }) : t('Calendrier exporté'), 'success'))}
                title={shared ? t('Exporter cet agenda (.ics)') : t('Exporter le calendrier (.ics)')}
                aria-label={shared ? t('Exporter cet agenda (.ics)') : t('Exporter le calendrier (.ics)')}
              >
                <CalendarArrowUp size={16} />
              </button>
            </div>
          </div>
          </div>
          {!compactHead && <div className="mt-3">{quickAdd}</div>}
        </div>
        {compactHead && quickAdd}

        {/* Two columns from 1280 px: at 1024 px (with the sidebar) the calendar was left ~370 px, the month without titles.
            The week's seven columns need all the width: its list goes under it (titles were cut to « Payer l… »). */}
        {/* Opened on the next thing planned (nothing left this week): said, with the way back to today. */}
        {jumpNote && selected === opening.day && (
          // The Affichage Pro draws it as the island draws a message (calPro.css): black, its icon, a white pill.
          <p role="status" className="cal-jump cal-notice mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-brand-50 px-4 py-2.5 text-[13.5px] text-ink">
            <span className="cal-notice-icon hidden" aria-hidden>
              <CalendarClock size={16} />
            </span>
            <span className="min-w-0 flex-1 basis-[12rem]">{t('Rien de prévu d’ici dimanche : voici ton prochain rendez-vous, {day}.', { day: fmt(fromKey(opening.day), 'EEEE d MMMM') })}</span>
            <button type="button" className="cal-notice-btn btn-ghost h-9 shrink-0 px-2.5 text-[13px] font-medium" onClick={() => (setJumpNote(false), selectDay(today))}>
              {t('Revenir à aujourd’hui')}
            </button>
          </p>
        )}
        {/* Kompaly's panel open beside the week (computer): its seven days share the width left, none under the panel. */}
        <div ref={gridRef} className={cx('mt-4 grid grid-cols-1 items-start gap-4', mode !== 'week' && 'xl:grid-cols-[minmax(0,1fr)_300px]')} style={panelRoom ? { paddingRight: panelRoom } : undefined}>
          <section className="card min-w-0 p-4 md:p-5">
            {/* Over the days side by side (the week's grid, the day view's strip of seven days). A phone's week, its days
                one under the other, draws them down the days instead (phoneWeekLanes). */}
            {weekBands.length > 0 && mode !== 'month' && (mode === 'day' || weekGrid) && (
              // Over the week grid, the bands start after the hours column, as its days do.
              <div className={cx('mb-1 grid gap-1', mode === 'week' && weekGrid && 'overflow-y-hidden px-px [scrollbar-gutter:stable]')} style={{ gridTemplateColumns: mode === 'week' && weekGrid ? '48px repeat(7, minmax(0, 1fr))' : 'repeat(7, minmax(0, 1fr))' }} role="group" aria-label={t('Périodes de la semaine')}>
                {weekLanes(weekBands, weekKeys).filter(b => b.lane < 3).map(({ period: p, from, to, lane }) => {
                  const o = mode === 'week' && weekGrid ? 2 : 1;
                  return (
                    <span
                      key={`${p.id}-${from}`}
                      title={`${label(p)} · ${periodRange(p, fmtDay)}`}
                      className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-[11.5px] font-semibold"
                      style={{ gridColumn: `${from + o} / ${to + o + 1}`, gridRow: lane + 1, background: periodTint(p, 20), color: periodText(p) }}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: periodColor(p) }} aria-hidden />
                      <span className="truncate">{label(p)}</span>
                    </span>
                  );
                })}
              </div>
            )}
            {mode === 'week' ? (
              weekGrid ? (
                <TimeGrid
                  days={weekKeys}
                  today={today}
                  selected={selected}
                  events={weekEvents}
                  todos={todos}
                  periods={periods}
                  drag={drag}
                  canChange={canChange}
                  canCreate={!readOnly}
                  onDragStart={startDrag}
                  onEdit={openEvent}
                  onCreate={(date, start, end) => setForm({ date, start, end })}
                  onMenu={openMenu}
                  onSelectDay={selectDay}
                  onOpenTask={setTask}
                />
              ) : shared?.unread ? (
                shared.unread === 'loading' && <Skeleton shape="slots" rows={3} className="py-2" />
              ) : (
                // A phone: the seven days one under the other, each with its events and tasks (a day opens in the day view).
                <div className="-mt-1 space-y-4">
                  {phoneWeekKeys.map(key => {
                    const evs = byDay.get(key) ?? [];
                    const tasks = tasksOn(todos, key);
                    const dayPeriods = phoneWeekLanes.byDay.get(key) ?? [];
                    return (
                      <section
                        key={key}
                        data-drop-day={key}
                        aria-label={fmt(fromKey(key), 'EEEE d MMMM')}
                        className={cx('relative rounded-xl transition-colors', dropDay === key && 'bg-brand-50 ring-2 ring-brand-500/40')}
                        // Room at the left for the periods' strips (one per row of periods).
                        style={phoneWeekLanes.lanes ? { paddingLeft: Math.min(phoneWeekLanes.lanes, 3) * 6 + 8 } : undefined}
                      >
                        {/* The periods down the days, as the week goes: one coloured strip per period at the left, on its
                            row, unbroken from its first day to its last (over the space between two days). */}
                        {dayPeriods.filter(l => l.lane < 3).map(l => (
                          <span
                            key={l.period.id}
                            aria-hidden
                            className={cx('absolute w-[3px]', l.first ? 'top-1 rounded-t-full' : 'top-0', l.last ? 'bottom-1 rounded-b-full' : '-bottom-4')}
                            style={{ left: l.lane * 6, background: periodColor(l.period) }}
                          />
                        ))}
                        <div className="mb-2 flex items-center gap-2 border-b border-stone-100 pb-1.5">
                          <button
                            type="button"
                            onClick={() => (selectDay(key), setMode('day'))}
                            className={cx('flex min-h-9 items-center gap-1.5 rounded-md text-left pointer-coarse:min-h-11 text-[14px] font-semibold', key === today && 'text-brand-600')}
                            title={t('Voir la journée')}
                          >
                            <span className="first-letter:uppercase">{fmt(fromKey(key), 'EEEE d')}</span>
                            {key === today && <span className="text-[12px] font-medium">{t('Aujourd’hui')}</span>}
                          </button>
                          {/* Its name where it starts (and at the top of the week); its strip says the days that follow. */}
                          {dayPeriods.filter(l => l.first).slice(0, 2).map(({ period: p }) => (
                            <span key={p.id} title={`${label(p)} · ${periodRange(p, fmtDay)}`} className="flex h-5 min-w-0 max-w-[9rem] items-center rounded-full px-2 text-[11px] font-semibold" style={{ background: periodTint(p, 18), color: periodText(p) }}>
                              <span className="truncate">{label(p)}</span>
                            </span>
                          ))}
                          {!readOnly && (
                            <button type="button" className="icon-btn ml-auto h-9 w-9" onClick={() => setForm({ date: key })} title={t('Nouvel événement')} aria-label={t('Nouvel événement le {day}', { day: fmt(fromKey(key), 'EEEE d MMMM') })}>
                              <Plus size={16} />
                            </button>
                          )}
                        </div>
                        {evs.length || tasks.length ? (
                          <div className="space-y-2">
                            {/* Events and dated tasks in the order of the day (a task at 10:00 before an event at 21:00). */}
                            {byStartTime(evs, tasks).map(it =>
                              'todo' in it ? (
                                <TaskRow key={it.todo.id} todo={it.todo} onOpen={setTask} />
                              ) : (
                                <EventItem key={it.ev.id} ev={it.ev} dragging={drag?.ev.id === it.ev.id} onDragStart={e => startDrag(it.ev, e)} onEdit={() => openEvent(it.ev)} onMenu={e => openMenu(it.ev, e)} />
                              ),
                            )}
                          </div>
                        ) : (
                          <p className="pl-1 text-[13px] text-stone-500">{t('Rien de prévu.')}</p>
                        )}
                      </section>
                    );
                  })}
                </div>
              )
            ) : mode === 'day' ? (
              <div className="grid grid-cols-7 gap-1">
                {week.map(d => {
                  const key = toKey(d);
                  const evs = byDay.get(key) ?? [];
                  const tasks = tasksOn(todos, key);
                  const isSel = key === selected;
                  const isToday = key === today;
                  const tint = tintOf(key);
                  return (
                    <button
                      key={key}
                      data-drop-day={key}
                      aria-pressed={isSel}
                      aria-label={`${fmt(d, 'EEEE d MMMM')}${isToday ? t(', aujourd’hui') : ''}${evs.length ? tn(evs.length, ', {n} événement', ', {n} événements') : ''}${tasks.length ? tn(tasks.length, ', {n} tâche', ', {n} tâches') : ''}`}
                      onClick={() => selectDay(key)}
                      onDoubleClick={() => setForm({ date: key })}
                      className={cx(
                        'flex flex-col items-center rounded-lg py-2.5 transition-colors',
                        dropDay === key ? 'bg-brand-50 ring-2 ring-brand-500/40' : isSel ? 'day-picked bg-stone-100' : tint ? 'hover:brightness-95' : 'hover:bg-stone-50',
                        drag && dropDay !== key && 'ring-1 ring-stone-200 ring-inset',
                      )}
                      style={tint && dropDay !== key ? { backgroundImage: fillOf(key, isSel ? 26 : 13) } : undefined}
                    >
                      <span className="text-[11px] font-medium capitalize text-stone-500">{fmt(d, 'EEE')}</span>
                      <span
                        className={cx(
                          'tabular mt-1 flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-semibold',
                          dayMark(isToday, isSel),
                        )}
                      >
                        {fmt(d, 'd')}
                      </span>
                      {/* No silent cap: past four, the number of the others. */}
                      <span className="mt-1.5 flex h-1.5 items-center gap-[3px]">
                        {evs.slice(0, evs.length > 4 ? 3 : 4).map(e => (
                          <span key={e.id} className="h-1.5 w-1.5 rounded-full" style={{ background: catOf(e.category).color }} />
                        ))}
                        {evs.length > 4 && <span className="tabular text-[9.5px] font-semibold leading-none text-stone-500">+{evs.length - 3}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="@container">
                <div className="grid grid-cols-7 pb-1.5 text-center text-[11px] font-medium text-stone-500">
                  {[t('Lun.'), t('Mar.'), t('Mer.'), t('Jeu.'), t('Ven.'), t('Sam.'), t('Dim.')].map(d => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                {/* data-fab-ignore: days and events fill the grid, the « + » button may sit over its corner (components/CreateButton). */}
                <div data-fab-ignore className="flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-stone-200 [gap:1px]">
                  {monthRows.map(row => (
                    <div key={row.keys[0]} className="relative grid grid-cols-7 [gap:1px]" style={{ '--lanes': row.lanes } as React.CSSProperties}>
                      {row.days.map((d, c) => {
                        const key = row.keys[c];
                        const all = byDay.get(key) ?? [];
                        const evs = all.filter(e => !row.barred.has(e.id));
                        const tasks = tasksOn(todos, key);
                        const isSel = key === selected;
                        const dayPeriods = periodsOn(periods, key);
                        const tint = dayPeriods[0];
                        // Each name where its period starts (or starts again after skipped days), and at the start of each week row.
                        const named = (monthLanes.byDay.get(key) ?? []).filter(l => l.first || c === 0).map(l => l.period);
                        const items = [...evs.map(ev => ({ ev })), ...tasks.map(todo => ({ todo }))];
                        return (
                          <button
                            key={key}
                            data-drop-day={key}
                            aria-pressed={isSel}
                            aria-label={`${fmt(d, 'EEEE d MMMM')}${key === today ? t(', aujourd’hui') : ''}${all.length ? tn(all.length, ', {n} événement', ', {n} événements') : ''}${tasks.length ? tn(tasks.length, ', {n} tâche', ', {n} tâches') : ''}`}
                            onClick={() => selectDay(key)}
                            onDoubleClick={() => setForm({ date: key })}
                            className={cx(
                              'relative flex min-h-16 min-w-0 flex-col items-stretch p-1 text-left transition-colors @md:min-h-[84px]',
                              dropDay === key ? 'bg-brand-50 shadow-[inset_0_0_0_2px_var(--color-brand-200)]' : isSel ? 'day-picked bg-stone-50' : 'bg-surface hover:bg-stone-50',
                              !isSameMonth(d, selDate) && 'text-stone-500',
                            )}
                            // Tint over the cell's own background (white or grey), so the grid lines stay.
                            style={tint && dropDay !== key ? { backgroundImage: fillOf(key, isSel ? 24 : 13) } : undefined}
                          >
                            {/* Each period's band on its own row (monthLanes): the same height on all its days, and periods that
                                don't overlap at the same height. */}
                            {(monthLanes.byDay.get(key) ?? []).filter(l => l.lane < 3).map(l => (
                              <span key={l.period.id} aria-hidden className="absolute inset-x-0 h-[3px]" style={{ top: l.lane * 4, background: periodColor(l.period) }} />
                            ))}
                            <span
                              className={cx(
                                'tabular mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-full text-[12px] font-medium @md:self-start',
                                dayMark(key === today, isSel),
                              )}
                            >
                              {fmt(d, 'd')}
                            </span>
                            {/* Room for the bars of the events over several days, drawn over the row. */}
                            {row.lanes > 0 && <span aria-hidden className="block h-[calc(var(--lanes)*15px)] shrink-0 @md:h-[calc(var(--lanes)*20px)]" />}
                            {/* Under the number: every day number stays on the same line, with or without a period. */}
                            {named.slice(0, 2).map(p => (
                              <span key={p.id} className="hidden truncate px-1 text-[10px] font-semibold leading-tight @md:block" style={{ color: periodText(p) }}>{label(p)}</span>
                            ))}
                            {items.slice(0, 2).map(it =>
                              'ev' in it ? (
                                <span
                                  key={it.ev.id}
                                  onPointerDown={p => startDrag(it.ev, p)}
                                  onContextMenu={x => (x.stopPropagation(), openMenu(it.ev, x))}
                                  // A double click on an event opens it; on the rest of the day, a new event.
                                  onDoubleClick={x => {
                                    x.stopPropagation();
                                    openEvent(it.ev);
                                  }}
                                  title={!canChange(it.ev) ? eventTitle(it.ev, shared) : t('{title} · double-clic pour modifier', { title: eventTitle(it.ev, shared) })}
                                  className={cx('mb-0.5 hidden select-none items-center gap-1 truncate rounded px-1 text-[11px] text-stone-700 hover:bg-stone-100 @md:flex', canChange(it.ev) && 'cursor-grab', drag?.ev.id === it.ev.id ? 'opacity-40' : isOver(it.ev) && 'cal-past')}
                                >
                                  <Bar color={catOf(it.ev.category).color} />
                                  <span className="truncate">{eventTitle(it.ev, shared)}</span>
                                  <SeriesIcon series={it.ev.series} size={10} className="shrink-0 text-stone-500" />
                                </span>
                              ) : (
                                // A task, lighter: a small square and its title in grey (opened from the day's list).
                                <span key={it.todo.id} className={cx('mb-0.5 hidden items-center gap-1 truncate px-1 text-[11px] text-stone-500 @md:flex', it.todo.done && 'line-through')}>
                                  <span className="h-[7px] w-[7px] shrink-0 rounded-[2px] border border-stone-400" aria-hidden />
                                  <span className="truncate">{it.todo.title}</span>
                                </span>
                              ),
                            )}
                            {/* A phone: the first ones by their title (their time under it when alone that day), not anonymous
                                dots (test n°3); the day's list below the grid has them whole. */}
                            {items.slice(0, phoneRoom(row.lanes)).map(it => (
                              <span
                                key={'ev' in it ? it.ev.id : it.todo.id}
                                aria-hidden
                                className={cx('flex min-w-0 items-center gap-[3px] overflow-hidden whitespace-nowrap text-[10px] leading-[14px] text-stone-700 @md:hidden', 'todo' in it && 'text-stone-500', 'todo' in it ? it.todo.done && 'line-through' : isOver(it.ev) && 'cal-past')}
                              >
                                {'ev' in it ? <span className="h-[10px] w-[2px] shrink-0 rounded-full" style={{ background: catOf(it.ev.category).color }} /> : <span className="h-[6px] w-[6px] shrink-0 rounded-[1.5px] border border-stone-400" />}
                                <span className="min-w-0 truncate">{'ev' in it ? eventTitle(it.ev, shared) : it.todo.title}</span>
                              </span>
                            ))}
                            {items.length === 1 && row.lanes === 0 && ('ev' in items[0] ? items[0].ev.start : items[0].todo.time) && (
                              <span aria-hidden className="tabular truncate pl-[5px] text-[10px] leading-[14px] text-stone-500 @md:hidden">
                                {shortTime(('ev' in items[0] ? items[0].ev.start : items[0].todo.time)!)}
                              </span>
                            )}
                            {items.length > phoneRoom(row.lanes) && <span aria-hidden className="text-[10px] font-medium leading-[14px] text-stone-500 @md:hidden">+{items.length - phoneRoom(row.lanes)}</span>}
                            {items.length > 2 && <span className="hidden px-1 text-[10px] text-stone-500 @md:block">{tn(items.length - 2, '+{n} autre', '+{n} autres')}</span>}
                          </button>
                        );
                      })}
                      {/* Events over several days: one bar across their days of the row (a line on a phone). */}
                      {row.bars.map(({ ev, from, to, lane, before, after }) => {
                        const n = to - from + 1;
                        const c = catOf(ev.category);
                        // A night (evening to next morning): its end time on the bar, as the day's list says it.
                        const night = nightEnd(ev, byDay);
                        return (
                          <button
                            key={`${ev.series}-${from}`}
                            type="button"
                            data-event={ev.id}
                            onClick={() => openEvent(ev)}
                            onContextMenu={x => openMenu(ev, x)}
                            title={eventTitle(ev, shared)}
                            aria-label={eventTitle(ev, shared)}
                            className={cx(
                              // A light bar with its name, across its days (a night: « Garde → 07:00 », one piece, test n°3).
                              'pointer-events-none absolute flex h-[13px] items-center gap-1 overflow-hidden whitespace-nowrap bg-[var(--bar-soft)] px-1 text-left text-[10px] font-medium leading-none @md:pointer-events-auto @md:h-[18px] @md:px-1.5 @md:text-[11px]',
                              'top-[calc(30px+var(--lane)*15px)] @md:top-[calc(30px+var(--lane)*20px)]',
                              before ? 'rounded-l-none' : 'rounded-l',
                              after ? 'rounded-r-none' : 'rounded-r',
                              // Over (its last day of the row is past, and it doesn't go on after it): lighter, struck through.
                              !after && isOver(byDay.get(row.keys[to])?.find(e => e.series === ev.series) ?? ev) && 'cal-past',
                              drag && '@md:pointer-events-none',
                            )}
                            style={{
                              '--lane': lane,
                              '--bar': c.color,
                              '--bar-soft': c.soft,
                              left: `calc(${from} * (100% - 6px) / 7 + ${from}px + ${before ? 0 : 3}px)`,
                              width: `calc(${n} * (100% - 6px) / 7 + ${n - 1}px - ${(before ? 0 : 3) + (after ? 0 : 3)}px)`,
                              color: c.text,
                              // Its colour bar where it starts, and at the right where it ends (asked: the end mirrored).
                              boxShadow: [!before && `inset 3px 0 0 ${c.color}`, !after && `inset -3px 0 0 ${c.color}`].filter(Boolean).join(', ') || undefined,
                            } as React.CSSProperties}
                          >
                            <span className="truncate">{eventTitle(ev, shared)}</span>
                            {night && <span className="tabular shrink-0 opacity-80">→ {night}</span>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                {monthBands.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label={t('Périodes du mois')}>
                    {monthBands.slice(0, 8).map(p => (
                      <span key={p.id} className="flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold" style={{ background: periodTint(p, 16), color: periodText(p) }}>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: periodColor(p) }} aria-hidden />
                        <span className="min-w-0 truncate">{label(p)}</span> <span className="shrink-0 font-medium">{periodRange(p, fmtDay)}</span>
                      </span>
                    ))}
                    {monthBands.length > 8 && <span className="self-center text-[11.5px] text-stone-500">+{monthBands.length - 8}</span>}
                  </div>
                )}
              </div>
            )}

            {/* Selected day (the week shows all its days above) */}
            {mode !== 'week' && (
            <div className="mt-5 border-t border-stone-100 pt-5">
              <div className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h2 className="text-[16px] font-semibold first-letter:uppercase">{selected === today ? t('Aujourd’hui') : fmt(selDate, 'EEEE d MMMM')}</h2>
                {selPeriods.map(p => (
                  <span
                    key={p.id}
                    className="flex h-6 min-w-0 max-w-[16rem] items-center gap-1 self-center rounded-full px-2.5 text-[12px] font-semibold"
                    style={{ background: periodTint(p, 18), color: periodText(p) }}
                    title={`${label(p)} · ${periodRange(p, fmtDay)}`}
                  >
                    <span className="min-w-0 truncate">{label(p)}</span>
                    {periodUntil(p, selected) && <span className="shrink-0 font-medium max-sm:hidden">· {periodUntil(p, selected)}</span>}
                  </span>
                ))}
              </div>
              {mode === 'day' ? (
                <TimeGrid
                  days={dayKeys}
                  today={today}
                  events={dayEvents}
                  todos={todos}
                  periods={periods}
                  drag={drag}
                  canChange={canChange}
                  canCreate={!readOnly}
                  onDragStart={startDrag}
                  onEdit={openEvent}
                  onCreate={(date, start, end) => setForm({ date, start, end })}
                  onMenu={openMenu}
                  onOpenTask={setTask}
                />
              ) : shared?.unread ? (
                shared.unread === 'loading' && <Skeleton shape="slots" rows={2} className="py-2" />
              ) : dayEvents.length === 0 && dayTasks.length === 0 ? (
                events.some(e => e.date === selected) ? (
                  <EmptyState size="sm" tone="search" icon={ListFilter} title={t('Rien à afficher avec ce filtre.')} action={{ label: t('Retirer les filtres'), onClick: clearFilter }} />
                ) : (
                  <EmptyState
                    size="sm"
                    icon={CalendarPlus}
                    title={selected === today ? t('Rien de prévu aujourd’hui.') : t('Rien de prévu ce jour-là.')}
                    // « Périodes » was found late (shared custody: one week out of two): named here while none is set.
                    text={!readOnly && !periods.length ? t('Des semaines à part (garde alternée, vacances, stage…) ? Colore-les avec « Périodes ».') : undefined}
                    action={!readOnly && !periods.length ? { label: t('Ajouter une période'), icon: CalendarRange, onClick: () => setPeriodsOpen(true) } : undefined}
                    preview="slots"
                  />
                )
              ) : (
                <div className="space-y-2">
                  {byStartTime(dayEvents, dayTasks).map(it =>
                    'todo' in it ? (
                      <TaskRow key={it.todo.id} todo={it.todo} onOpen={setTask} />
                    ) : (
                      <EventItem key={it.ev.id} ev={it.ev} dragging={drag?.ev.id === it.ev.id} onDragStart={e => startDrag(it.ev, e)} onEdit={() => openEvent(it.ev)} onMenu={e => openMenu(it.ev, e)} />
                    ),
                  )}
                </div>
              )}
            </div>
            )}
          </section>

          {/* Under the calendar (full width), its lists on two columns. */}
          <aside aria-labelledby="a-venir-titre" className="card @container min-w-0 self-start p-4">
            <h2 id="a-venir-titre" className="mb-2 text-[13px] font-medium text-stone-600">
              {t('À venir')}
            </h2>
            {shared?.unread ? (
              shared.unread === 'loading' && <Skeleton rows={2} className="py-1" />
            ) : upcomingRows.length === 0 ? (
              upcomingHidden ? (
                // « Retirer les filtres » is in the day's section (and the filter button is up there).
                <EmptyState size="sm" tone="search" icon={ListFilter} title={t('Rien à afficher avec ce filtre.')} />
              ) : (
                <EmptyState size="sm" icon={CalendarClock} title={t('Rien de prévu pour la suite.')} />
              )
            ) : (
              // One list in date order; the important ones marked (flag, the days left in bold).
              <ul className="-mx-1.5 grid grid-cols-1 gap-x-6 @2xl:grid-cols-2">
                {upcomingRows.map(e => {
                  const n = daysUntil(e.date);
                  const big = isUpcomingExam(e);
                  const toHandIn = isDeliverable(e) && !shared;
                  return (
                    <li key={e.id} data-big={big || undefined} className="flex min-w-0">
                      <button onClick={() => showEvent(e)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-stone-50">
                        {/* « dans 13 jours » in words (« J-13 » wasn't understood), on two short lines. */}
                        <span className={cx('tabular w-[3.75rem] shrink-0 font-semibold leading-tight', big ? 'text-[13px]' : 'text-[12px]', big && n <= 3 ? 'font-extrabold text-urgent-text' : big ? 'text-ink' : 'text-stone-500')}>
                          {n === 0 ? t('Auj.') : n === 1 ? t('Dem.') : untilLabel(n)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                            {big ? <Flag size={11} className="shrink-0 fill-amber-500 text-amber-500" aria-label={t('Important')} /> : <Bar color={catOf(e.category).color} />}
                            <span className={cx('truncate', big && 'font-semibold')}>{eventTitle(e, shared)}</span>
                            <SeriesIcon series={e.series} size={10} className="shrink-0 text-stone-500" />
                          </span>
                          <span className="block text-[12px] first-letter:uppercase text-stone-500">
                            {toHandIn ? `${(WORDS[usage] ?? WORDS.etudes) === WORDS.etudes ? t('À rendre') : t('À faire')} · ` : ''}
                            {fmtDay(fromKey(e.date), 'EEE d MMM')}
                            {e.start && ` · ${e.start}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {upcoming.more.length > 0 && (
                  <li className="col-span-full">
                    <button onClick={() => setAllUpcoming(v => !v)} aria-expanded={allUpcoming} className="w-full rounded-lg px-1.5 py-1 text-left text-[12px] font-medium text-stone-500 transition-colors hover:bg-stone-50 hover:text-ink pointer-coarse:py-2">
                      {allUpcoming ? t('Réduire') : tn(upcoming.more.length, 'Voir {n} autre', 'Voir {n} autres')}
                    </button>
                  </li>
                )}
              </ul>
            )}

          </aside>
        </div>
      </div>

      {form && (
        <EventForm
          // A duplicate opened from an event's window is another form, with its own fields.
          key={form.event?.id ?? (form.template ? `copie-${form.template.id}` : 'nouveau')}
          event={form.event}
          template={form.template}
          date={form.date}
          start={form.start}
          end={form.end}
          title={form.title}
          onDuplicate={ev => setForm({ template: ev, date: ev.date })}
          onClose={() => setForm(null)}
          onSaved={ev => {
            if (form.fromQuick) setQuick('');
            showSaved(ev);
          }}
        />
      )}
      {importing && <ImportIcsDialog initial={importing.initial} onClose={() => setImporting(null)} onImported={selectDay} />}
      {managing && <CategoriesDialog onClose={() => setManaging(false)} />}
      {periodsOpen && <PeriodsDialog day={selected} onClose={() => setPeriodsOpen(false)} />}
      {task && <TaskDialog todo={task} onClose={() => setTask(null)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.ev)} label={menu.ev.title} onClose={() => setMenu(null)} />}

      {/* Chip that follows the pointer while an event is dragged */}
      {drag && (
        <div
          ref={ghostRef}
          className={cx(
            'pointer-events-none fixed left-0 top-0 z-[80] flex max-w-56 items-center gap-1.5 rounded-md border border-stone-200 bg-surface px-2 py-1 text-[12px] font-medium shadow-pop transition-opacity',
            // Over the hourly grid the dashed preview already shows where it lands (a new event or an end: there only).
            (drag.target?.minutes !== undefined || drag.mode !== 'move') && 'opacity-0',
          )}
        >
          <Dot color={catOf(drag.ev.category).color} size={7} />
          <span className="truncate">{drag.ev.title}</span>
        </div>
      )}

      {fileOver && (
        <div className="pointer-events-none fixed inset-0 z-[75] flex items-center justify-center bg-stone-900/10 p-6">
          <div className="pop flex flex-col items-center rounded-2xl border-2 border-dashed border-brand-500 bg-surface/95 px-10 py-8 text-center shadow-pop">
            <CalendarArrowDown size={26} className="text-brand-600" />
            <p className="mt-2 text-[15px] font-semibold">{t('Dépose ton {timetable}', { timetable: words.timetable })}</p>
            <p className="mt-0.5 text-[13px] text-stone-500">{t('Fichier .ics')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
