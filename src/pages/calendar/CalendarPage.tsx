import { useToday } from '../../lib/useToday';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, addMonths, endOfMonth, startOfMonth, isSameMonth } from 'date-fns';
import { Bell, Copy, ExternalLink, Flag, Link2, ListFilter, ListTodo, MapPin, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, CornerDownLeft, CalendarArrowDown, CalendarArrowUp, CalendarRange, CalendarPlus, CalendarClock } from 'lucide-react';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { catOf, allCategories, guessCategory, isDeliverable, isBigEvent, sortEvents, type CalendarEvent, type EventCategory } from '../../store/calendar';
import { parseQuickAdd, toKey, fromKey, todayKey, validKey, fmt, fmtDay, weekStart, countdownLabel, daysUntil, toMinutes, fromMinutes, isOver } from '../../lib/dates';
import { toast } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { AGENDA_EXAMPLES, WORDS } from '../../lib/usage';
import CategoriesDialog from './CategoriesDialog';
import PeriodsDialog from './PeriodsDialog';
import { covers, periodColor, periodUntil, periodLabel, periodsFill, weekLanes, periodRange, periodText, periodTint, periodsBetween, periodsOn, type Period } from '../../lib/periods';
import { cx } from '../../lib/utils';
import EventForm from './EventForm';
import { eventTitle, periodIdeas, removeEvent, useCalendarSource } from './source';
import TimeGrid from './TimeGrid';
import SeriesIcon from './SeriesIcon';
import { firstOfSpans } from '../../lib/repeat';
import ImportIcsDialog, { type IcsSource } from './ImportIcsDialog';
import { useCreateActions } from '../../store/create';
import { isIcsFile } from '../../lib/ics';
import { useEventDrag, type DragMode, type DropTarget } from './useEventDrag';
import { exportIcs } from '../../lib/backup';
import { flashWhenReady } from '../../lib/flash';
import { eventReminders, followMoments, reminderLabel } from '../../lib/reminders';
import { feedLabel, feedOf } from '../../lib/icsFeeds';
import { useTodos, type Todo } from '../../store/todos';
import TaskDialog from '../tasks/TaskDialog';
import { TaskRow } from './TaskItem';
import { isFor, spanBars, sweptRange, tasksOn, upcomingList } from './layout';
import { agendaLink, copyToMyCalendar, fromAgenda, useAgendaOverlay } from './agendas';
import { ContextMenu, type MenuItem } from '../../components/Overlays';
import { isMenuKey, menuPoint } from '../../lib/a11y';
import { GROUP_COLORS, type Group } from '../../lib/groups';
import { t, tn } from '../../i18n';

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
const shortQuery = media('(max-height: 500px)');
const subscribeShort = subscribeTo(shortQuery);
const useShort = () => useSyncExternalStore(subscribeShort, () => shortQuery?.matches ?? false);
const coarseQuery = media('(pointer: coarse)');
const subscribeCoarse = subscribeTo(coarseQuery);
const useCoarse = () => useSyncExternalStore(subscribeCoarse, () => coarseQuery?.matches ?? false);
// From a tablet the week is an hourly grid of seven columns; on a phone, the seven days one under the other.
const gridQuery = media('(min-width: 768px)');
const subscribeGrid = subscribeTo(gridQuery);
const useWeekGrid = () => useSyncExternalStore(subscribeGrid, () => gridQuery?.matches ?? true);

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
  // Today's events already over: lighter, what is left of the day stands out.
  const past = ev.date === todayKey() && isOver(ev);
  const c = catOf(ev.category);
  const defaults = useSettings(s => s.defaultReminders);
  // A shared calendar's reminders are the ones chosen on it (no usual reminder of mine there).
  const reminders = shared ? (ev.reminders ?? []) : eventReminders(ev, defaults);
  // From a timetable followed by link: its name, so it is never mixed up with what was added by hand.
  const feed = feedOf(ev, useSettings(s => s.icsFeeds));
  return (
    <div className="group enter flex items-stretch gap-2 sm:gap-4">
      <div className="tabular w-10 shrink-0 pt-3 text-right text-[12px] sm:w-12">
        {ev.start ? (
          <>
            <p className="font-medium">{ev.start}</p>
            {ev.end && <p className="text-stone-500">{ev.end}</p>}
          </>
        ) : (
          <p className="text-stone-500">{t('Journée')}</p>
        )}
      </div>
      {/* The card alone lights up when a link leads here (lib/flash), not the time beside it. */}
      <div
        data-event={ev.id}
        onPointerDown={readOnly ? undefined : onDragStart}
        onContextMenu={e => (e.preventDefault(), onMenu(e))}
        onKeyDown={e => isMenuKey(e) && (e.preventDefault(), onMenu(e))}
        title={readOnly ? undefined : t('Glisse sur un autre jour pour déplacer')}
        className={cx('flex min-w-0 flex-1 touch-manipulation items-start gap-3 rounded-[16px] bg-stone-50 py-3 pl-3 pr-2 transition-colors [-webkit-touch-callout:none] hover:bg-stone-100', past && 'opacity-60', dragging && 'opacity-40')}
      >
        {/* An event: its colour bar, no box (only tasks are ticked, with their square box). */}
        <span className="mt-0.5 w-[3px] self-stretch rounded-full" style={{ background: c.color }} />
        {/* A reader opens it too: the whole event, read-only (EventForm). */}
        <button className="min-w-0 flex-1 text-left pointer-coarse:py-2" onClick={onEdit}>
          <p className="text-[14px] font-medium leading-snug hyphens-auto [overflow-wrap:anywhere]">
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
            {reminders.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 whitespace-nowrap" title={t('Rappels')}>
                <Bell size={11} aria-label={t('Rappel')} />
                {reminderLabel(Math.min(...reminders), !!ev.start, ev.date, ev.start)}
                {reminders.length > 1 && ` +${reminders.length - 1}`}
              </span>
            )}
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
        <span className="max-sm:sr-only [@media(max-height:500px)]:sr-only">{t('Filtrer')}</span>
        {count > 0 && <span className="tabular rounded-full bg-ink px-1.5 text-[11px] leading-[18px] text-paper">{count}</span>}
      </button>
      {open && (
        // A low screen (a phone on its side): over the page, its choices on three columns, so all fit without a scrollbar
        // (a 64 px wide column went under the tab bar and scrolled).
        <div
          id="filtre-calendrier"
          role="group"
          aria-label={t('Filtrer les événements')}
          className="pop absolute right-0 top-full z-[60] mt-2 max-h-[min(70dvh,560px)] w-64 overflow-y-auto overscroll-contain rounded-xl border border-stone-200 bg-surface p-2 shadow-pop [@media(max-height:500px)]:fixed [@media(max-height:500px)]:inset-x-4 [@media(max-height:500px)]:top-3 [@media(max-height:500px)]:z-[90] [@media(max-height:500px)]:mx-auto [@media(max-height:500px)]:mt-0 [@media(max-height:500px)]:max-h-[calc(100dvh-24px)] [@media(max-height:500px)]:w-auto [@media(max-height:500px)]:max-w-2xl"
        >
          <p className="px-2 pb-1 pt-0.5 text-[12px] text-stone-500">{t('Afficher seulement :')}</p>
          <div className="[@media(max-height:500px)]:grid [@media(max-height:500px)]:grid-cols-3 [@media(max-height:500px)]:gap-x-1">
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
          {(onImportant || onTasks) && <div className="my-1 h-px bg-stone-100 [@media(max-height:500px)]:hidden" />}
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
              <p className="px-2 pb-1 pt-1 text-[12px] text-stone-500">{t('Mes agendas partagés')}</p>
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
  // My tasks with a due day, on their day (not in a shared calendar: they are mine).
  const allTodos = useTodos(s => s.todos);
  const [task, setTask] = useState<Todo | null>(null);
  const [selected, setSelected] = useState(() => validKey(params.get('jour')) ?? todayKey());
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
  // The fixed header's background in the glass looks: the page's own wallpaper, fixed as it is (seamless); under a
  // finger (Safari draws no fixed background there) the page's colour, frosted.
  const look = useSettings(s => s.style);
  const coarse = useCoarse();
  const glassHead = (look === 'verre' || look === 'liquide') && !coarse;
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
          { label: t('Nouvel événement'), icon: <CalendarPlus />, onClick: () => setForm({ date: selected }) },
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
      if (!readOnly) setFormState({ date: selected });
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
  }, [params, setParams, readOnly, selected, shared]);

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
  const visible = useMemo(() => events.filter(passes), [events, passes]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of [...visible].sort(sortEvents)) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [visible]);

  const selDate = fromKey(selected);
  const today = useToday();
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(selDate), i));
  const dayEvents = byDay.get(selected) ?? [];
  const dayTasks = tasksOn(todos, selected);
  // Periods (« En entreprise »…): a band over the week, a tint on their days.
  const { periods } = source;
  const weekKeys = week.map(toKey);
  const weekBands = periodsBetween(periods, weekKeys[0], weekKeys[6]);
  const selPeriods = periodsOn(periods, selected);
  const tintOf = (key: string): Period | undefined => periodsOn(periods, key)[0];
  const fillOf = (key: string, strength: number) => periodsFill(periodsOn(periods, key), strength);
  const label = (p: Period) => periodLabel(p, shared?.nameOf);

  const parsed = quick.trim() ? parseQuickAdd(quick) : null;
  const parsedCat = parsed ? guessCategory(parsed.title || quick, !!parsed.start, custom) : null;
  // No day in the sentence: the day shown, unless it is past (an event typed while looking back lands today).
  const quickDate = parsed?.date ?? (selected < today ? today : selected);

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
    if (parsed.weekly || parsed.yearly) return setForm({ date: quickDate, start: parsed.start ?? undefined, end: parsed.end ?? undefined, title: quick, fromQuick: true });
    const date = quickDate;
    source.add({ title: parsed.title, date, start: parsed.start ?? undefined, end: parsed.end ?? undefined, category: parsedCat!, important: parsed.important });
    setQuick('');
    showSaved({ date, category: parsedCat!, important: parsed.important });
    toast(
      parsed.weekly ? t('Ajouté pour {day}, une seule fois (pas encore de répétition)', { day: fmt(fromKey(date), 'EEEE d MMMM') }) : t('Ajouté : {title}', { title: parsed.title }),
      'success',
    );
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
  const { drag, ghostRef, start: dragStart } = useEventDrag(moveEvent);
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
  const isHomeworkSoon = (e: CalendarEvent) => isDeliverable(e) && daysUntil(e.date) <= 14 && daysUntil(e.date) >= 0;
  // « Rien à afficher » only when a hidden category holds something this block would list (not a hidden « Sport »).
  // Anything still to come (not over): after the important ones, the next things, whatever they are.
  const isComing = (e: CalendarEvent) => e.date >= today && !isOver(e);
  // Not the day shown below the calendar: its events are already listed there (the week shows all its days).
  const away = (e: CalendarEvent) => mode === 'week' || e.date !== selected;
  // Sorted once per change of the events (and once a minute, for « over »), not at each key typed in the quick add.
  const minute = Math.floor(Date.now() / 60_000);
  const { upcomingHidden, upcoming } = useMemo(() => {
    const upcomingHidden = filtering && events.some(e => !passes(e) && away(e) && (isComing(e) || isHomeworkSoon(e)));
    // An event over several days once, at its first day (not « J-3, J-4, J-5 »); none when that day is the one shown
    // (its next day, J-4, would say the wrong day).
    const pool = firstOfSpans([...visible].sort(sortEvents).filter(e => isUpcomingExam(e) || isHomeworkSoon(e) || isComing(e))).filter(away);
    // One list in date order: the important ones (marked, one per repeat) among homework to hand in and the next events.
    const upcoming = upcomingList(pool, e => (isUpcomingExam(e) ? 'big' : isHomeworkSoon(e) ? 'homework' : 'other'));
    return { upcomingHidden, upcoming };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers above only read these values
  }, [events, visible, passes, filtering, shared, today, minute, selected, mode]);
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
      const bars = spanBars(r.keys.flatMap(k => byDay.get(k) ?? []), r.keys);
      const barred = new Set(bars.flatMap(b => r.keys.flatMap(k => (byDay.get(k) ?? []).filter(e => e.series === b.ev.series).map(e => e.id))));
      return { ...r, bars, barred, lanes: bars.length ? Math.max(...bars.map(b => b.lane)) + 1 : 0 };
    });
  }, [mode, monthDays, byDay]);

  // A shared calendar has no title here (its page has one).
  const title = !shared && <h1 className="mr-3 flex items-center gap-2 text-[24px] font-semibold tracking-[-0.02em] max-sm:w-full max-sm:pb-1 max-sm:pt-2">{t('Calendrier')}</h1>;
  // Quick add. Keyboard focus: a brand ring (the shadow alone was invisible on the dark theme).
  const quickAdd = (
    readOnly ? (
          <p className="card px-4 py-3 text-[13px] text-stone-500">{t('Agenda en lecture seule.')}</p>
        ) : (
        <form onSubmit={submitQuick} className="card flex flex-col px-3 transition-shadow focus-within:border-stone-300 focus-within:shadow-pop has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-focus">
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
              <span>{fmtDay(fromKey(quickDate), 'EEEE d MMMM')}</span>
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
              {(parsed.weekly || parsed.yearly) && <span className="w-full text-stone-500">{t('Entrée\u00a0: choisir jusqu’à quand.')}</span>}
              {parsed.impossible && <span className="w-full font-medium text-red-600 dark:text-red-400">{t('Cette date n’existe pas : corrige-la pour ajouter.')}</span>}
            </div>
          )}
        </form>
        )
  );

  const monthBands = mode === 'month' && monthDays.length ? periodsBetween(periods, toKey(monthDays[0]), toKey(monthDays[monthDays.length - 1])) : [];

  return (
    <div
      ref={pageRef}
      className={cx('h-full overflow-y-auto pb-room', shared ? 'shadow-room' : 'px-4 md:px-8')}
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
            Fixed at the top while the page scrolls, over a background of the page's own colour (a frosted one in the
            glass looks, laid under it: a backdrop filter on the header itself would hold the filter's panel). */}
        <div ref={headRef} className={cx('sticky top-0 z-30', compactHead ? 'pb-3 pt-1' : 'pb-4 pt-2')}>
          <div
            aria-hidden
            className={cx(
              'pointer-events-none absolute inset-y-0 -z-10 bg-paper [:root[data-style=liquide]_&]:bg-paper/75 [:root[data-style=liquide]_&]:backdrop-blur-xl [:root[data-style=verre]_&]:bg-paper/70 [:root[data-style=verre]_&]:backdrop-blur-xl',
              shared ? '-inset-x-4' : '-inset-x-4 md:-inset-x-8',
            )}
            style={glassHead ? { background: 'var(--wallpaper, var(--color-paper))', backgroundAttachment: 'fixed', backdropFilter: 'none' } : undefined}
          />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {!compactHead && title}
          <div className={cx('flex items-center gap-2', !shared && 'sm:ml-auto')}>
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
            <button className="btn-secondary h-8 pointer-coarse:h-9" onClick={() => selectDay(today)}>
              {t('Aujourd’hui')}
            </button>
          </div>
          <div className={cx('flex items-center gap-2 max-sm:w-full', shared && 'ml-auto')}>
            {/* A capsule of capsules: the chosen view the same shape as its frame, 3 px inside it in every look. */}
            <div className="flex h-8 items-center rounded-full bg-stone-100 p-[3px] text-[13px] pointer-coarse:h-9" role="group" aria-label={t('Affichage')}>
              {MODES.map(m => (
                <button key={m.id} onClick={() => setMode(m.id)} aria-pressed={mode === m.id} className={cx('hit h-full rounded-full px-2.5 font-medium transition-colors pointer-coarse:min-w-11 sm:px-3', mode === m.id ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(20_22_31/0.14)]' : 'text-stone-500 hover:text-ink')}>
                  {m.label}
                </button>
              ))}
            </div>
            {/* Periods, filter and export: together, at the right edge of their row. */}
            <div className="ml-auto flex items-center gap-2 sm:ml-0">
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
              {/* Mine: not on phones, where the row has no room for it (Profil › Données exports too). A shared calendar
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
        <div className={cx('mt-4 grid grid-cols-1 items-start gap-4', mode !== 'week' && 'xl:grid-cols-[minmax(0,1fr)_300px]')}>
          <section className="card min-w-0 p-4 md:p-5">
            {weekBands.length > 0 && mode !== 'month' && (
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
                  events={weekKeys.flatMap(k => byDay.get(k) ?? [])}
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
                  {weekKeys.map(key => {
                    const evs = byDay.get(key) ?? [];
                    const tasks = tasksOn(todos, key);
                    const dayPeriods = periodsOn(periods, key);
                    return (
                      <section key={key} data-drop-day={key} aria-label={fmt(fromKey(key), 'EEEE d MMMM')} className={cx('rounded-xl transition-colors', dropDay === key && 'bg-brand-50 ring-2 ring-brand-500/40')}>
                        <div className="mb-2 flex items-center gap-2 border-b border-stone-100 pb-1.5">
                          <button
                            type="button"
                            onClick={() => (selectDay(key), setMode('day'))}
                            className={cx('flex min-h-9 items-center gap-1.5 rounded-md text-left text-[14px] font-semibold', key === today && 'text-brand-600')}
                            title={t('Voir la journée')}
                          >
                            <span className="first-letter:uppercase">{fmt(fromKey(key), 'EEEE d')}</span>
                            {key === today && <span className="text-[12px] font-medium">{t('Aujourd’hui')}</span>}
                          </button>
                          {dayPeriods.slice(0, 2).map(p => (
                            <span key={p.id} className="flex h-5 min-w-0 max-w-[9rem] items-center rounded-full px-2 text-[11px] font-semibold" style={{ background: periodTint(p, 18), color: periodText(p) }}>
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
                            {evs.map(ev => (
                              <EventItem key={ev.id} ev={ev} dragging={drag?.ev.id === ev.id} onDragStart={e => startDrag(ev, e)} onEdit={() => openEvent(ev)} onMenu={e => openMenu(ev, e)} />
                            ))}
                            {tasks.map(x => (
                              <TaskRow key={x.id} todo={x} onOpen={setTask} />
                            ))}
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
                        dropDay === key ? 'bg-brand-50 ring-2 ring-brand-500/40' : isSel ? 'bg-stone-100' : tint ? 'hover:brightness-95' : 'hover:bg-stone-50',
                        drag && dropDay !== key && 'ring-1 ring-stone-200 ring-inset',
                      )}
                      style={tint && dropDay !== key ? { backgroundImage: fillOf(key, isSel ? 26 : 13) } : undefined}
                    >
                      <span className="text-[11px] font-medium capitalize text-stone-500">{fmt(d, 'EEE')}</span>
                      <span
                        className={cx(
                          'tabular mt-1 flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-semibold',
                          isSel ? 'bg-tile-blue text-white' : isToday ? 'text-brand-600' : '',
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
                <div className="flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-stone-200 [gap:1px]">
                  {monthRows.map((row, r) => (
                    <div key={row.keys[0]} className="relative grid grid-cols-7 [gap:1px]" style={{ '--lanes': row.lanes } as React.CSSProperties}>
                      {row.days.map((d, c) => {
                        const i = r * 7 + c;
                        const key = row.keys[c];
                        const all = byDay.get(key) ?? [];
                        const evs = all.filter(e => !row.barred.has(e.id));
                        const tasks = tasksOn(todos, key);
                        const isSel = key === selected;
                        const dayPeriods = periodsOn(periods, key);
                        const tint = dayPeriods[0];
                        // Each name where its period starts (or starts again after skipped days), and at the start of each week row.
                        const named = dayPeriods.filter(p => i % 7 === 0 || !covers(p, toKey(addDays(d, -1))));
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
                              dropDay === key ? 'bg-brand-50 shadow-[inset_0_0_0_2px_var(--color-brand-200)]' : isSel ? 'bg-stone-50' : 'bg-surface hover:bg-stone-50',
                              !isSameMonth(d, selDate) && 'text-stone-500',
                            )}
                            // Tint over the cell's own background (white or grey), so the grid lines stay.
                            style={tint && dropDay !== key ? { backgroundImage: fillOf(key, isSel ? 24 : 13) } : undefined}
                          >
                            {dayPeriods.length > 0 && (
                              <span className="absolute inset-x-0 top-0 flex flex-col" aria-hidden>
                                {dayPeriods.slice(0, 3).map(p => <span key={p.id} className="h-[3px]" style={{ background: periodColor(p) }} />)}
                              </span>
                            )}
                            <span
                              className={cx(
                                'tabular mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-full text-[12px] font-medium @md:self-start',
                                isSel ? 'bg-tile-blue text-white' : key === today && 'text-brand-600',
                              )}
                            >
                              {fmt(d, 'd')}
                            </span>
                            {/* Room for the bars of the events over several days, drawn over the row. */}
                            {row.lanes > 0 && <span aria-hidden className="block h-[calc(var(--lanes)*6px)] shrink-0 @md:h-[calc(var(--lanes)*20px)]" />}
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
                                  className={cx('mb-0.5 hidden select-none items-center gap-1 truncate rounded px-1 text-[11px] text-stone-700 hover:bg-stone-100 @md:flex', canChange(it.ev) && 'cursor-grab', drag?.ev.id === it.ev.id && 'opacity-40')}
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
                            {items.length > 0 && (
                              <span className="flex justify-center gap-0.5 @md:hidden">
                                {evs.slice(0, 3).map(e => (
                                  <Dot key={e.id} color={catOf(e.category).color} size={5} />
                                ))}
                                {tasks.length > 0 && evs.length < 3 && <span className="h-[5px] w-[5px] rounded-[1.5px] border border-stone-400" aria-hidden />}
                              </span>
                            )}
                            {items.length > 2 && <span className="hidden px-1 text-[10px] text-stone-500 @md:block">{tn(items.length - 2, '+{n} autre', '+{n} autres')}</span>}
                          </button>
                        );
                      })}
                      {/* Events over several days: one bar across their days of the row (a line on a phone). */}
                      {row.bars.map(({ ev, from, to, lane, before, after }) => {
                        const n = to - from + 1;
                        const c = catOf(ev.category);
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
                              // A line in its colour on a phone, a light bar with its name from a tablet.
                              'pointer-events-none absolute flex h-1 items-center gap-1 overflow-hidden bg-[var(--bar)] px-1.5 text-left text-[11px] font-medium @md:pointer-events-auto @md:h-[18px] @md:bg-[var(--bar-soft)]',
                              'top-[calc(30px+var(--lane)*6px)] @md:top-[calc(30px+var(--lane)*20px)]',
                              before ? 'rounded-l-none' : 'rounded-l',
                              after ? 'rounded-r-none' : 'rounded-r',
                              drag && '@md:pointer-events-none',
                            )}
                            style={{
                              '--lane': lane,
                              '--bar': c.color,
                              '--bar-soft': c.soft,
                              left: `calc(${from} * (100% - 6px) / 7 + ${from}px + ${before ? 0 : 3}px)`,
                              width: `calc(${n} * (100% - 6px) / 7 + ${n - 1}px - ${(before ? 0 : 3) + (after ? 0 : 3)}px)`,
                              color: c.text,
                              boxShadow: before ? undefined : `inset 3px 0 0 ${c.color}`,
                            } as React.CSSProperties}
                          >
                            <span className="hidden truncate @md:inline">{eventTitle(ev, shared)}</span>
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
                  days={[selected]}
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
                    preview="slots"
                  />
                )
              ) : (
                <div className="space-y-2">
                  {dayEvents.map(ev => (
                    <EventItem key={ev.id} ev={ev} dragging={drag?.ev.id === ev.id} onDragStart={e => startDrag(ev, e)} onEdit={() => openEvent(ev)} onMenu={e => openMenu(ev, e)} />
                  ))}
                  {dayTasks.map(x => (
                    <TaskRow key={x.id} todo={x} onOpen={setTask} />
                  ))}
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
                    <li key={e.id} className="flex min-w-0">
                      <button onClick={() => showEvent(e)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-stone-50">
                        <span className={cx('tabular w-9 shrink-0 font-semibold', big ? 'text-[13px]' : 'text-[12px]', big && n <= 3 ? 'font-extrabold text-urgent-text' : big ? 'text-ink' : 'text-stone-500')}>
                          {n === 0 ? t('Auj.') : n === 1 ? t('Dem.') : t('J-{n}', { n })}
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
