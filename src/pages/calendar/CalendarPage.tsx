import { useToday } from '../../lib/useToday';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, addMonths, endOfMonth, startOfMonth, isSameMonth } from 'date-fns';
import { Bell, Check, Flag, ListFilter, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, CornerDownLeft, CalendarArrowDown, CalendarArrowUp, CalendarRange } from 'lucide-react';
import { catOf, allCategories, guessCategory, isDeliverable, isBigEvent, sortEvents, type CalendarEvent, type EventCategory } from '../../store/calendar';
import { parseQuickAdd, toKey, fromKey, todayKey, validKey, fmt, fmtDay, weekStart, countdownLabel, daysUntil, toMinutes, fromMinutes, isOver } from '../../lib/dates';
import { toast } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { WORDS } from '../../lib/usage';
import CategoriesDialog from './CategoriesDialog';
import PeriodsDialog from './PeriodsDialog';
import { covers, periodColor, periodLabel, periodsFill, weekLanes, periodRange, periodText, periodTint, periodsBetween, periodsOn, type Period } from '../../lib/periods';
import { cx } from '../../lib/utils';
import EventForm from './EventForm';
import { useCalendarSource } from './source';
import DayView from './DayView';
import ImportIcsDialog, { type IcsSource } from './ImportIcsDialog';
import { isIcsFile } from '../../lib/ics';
import { useEventDrag, type DropTarget } from './useEventDrag';
import { exportIcs } from '../../lib/backup';
import { flashWhenReady } from '../../lib/flash';
import { eventReminders, followMoments, reminderLabel } from '../../lib/reminders';

type Mode = 'week' | 'month' | 'day';
const MODES: { id: Mode; label: string }[] = [
  { id: 'day', label: 'Jour' },
  { id: 'week', label: 'Semaine' },
  { id: 'month', label: 'Mois' },
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

// Phones get a shorter hint in the quick add (the long example was cut in the middle of a word at 375 px).
const wideQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 640px)') : null;
const subscribeWide = (cb: () => void) => {
  wideQuery?.addEventListener('change', cb);
  return () => wideQuery?.removeEventListener('change', cb);
};
const useWide = () => useSyncExternalStore(subscribeWide, () => wideQuery?.matches ?? true);

/** How many exams « À venir » lists before « Voir les … autres ». */
const EXAMS_SHOWN = 4;

function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ background: color, width: size, height: size }} />;
}

interface EventItemProps {
  ev: CalendarEvent;
  onEdit: () => void;
  dragging: boolean;
  onDragStart: (e: ReactPointerEvent<HTMLElement>) => void;
}

function EventItem({ ev, onEdit, dragging, onDragStart }: EventItemProps) {
  const { toggleDone, remove, shared } = useCalendarSource();
  const readOnly = !!shared && !shared.canEdit; // a reader of a shared calendar: nothing to change
  const c = catOf(ev.category);
  const defaults = useSettings(s => s.defaultReminders);
  const reminders = shared ? [] : eventReminders(ev, defaults);
  return (
    <div className="group enter flex items-stretch gap-2 sm:gap-4">
      <div className="tabular w-10 shrink-0 pt-3 text-right text-[12px] sm:w-12">
        {ev.start ? (
          <>
            <p className="font-medium">{ev.start}</p>
            {ev.end && <p className="text-stone-500">{ev.end}</p>}
          </>
        ) : (
          <p className="text-stone-500">Journée</p>
        )}
      </div>
      {/* The card alone lights up when a link leads here (lib/flash), not the time beside it. */}
      <div
        data-event={ev.id}
        onPointerDown={readOnly ? undefined : onDragStart}
        title={readOnly ? undefined : 'Glisse sur un autre jour pour déplacer'}
        className={cx('flex min-w-0 flex-1 touch-manipulation items-start gap-3 rounded-[16px] bg-stone-50 py-3 pl-3 pr-2 transition-colors [-webkit-touch-callout:none] hover:bg-stone-100', ev.done && 'opacity-60', dragging && 'opacity-40')}
      >
        <span className="mt-0.5 w-[3px] self-stretch rounded-full" style={{ background: c.color, opacity: ev.done ? 0.35 : 1 }} />
        {!shared && <button
          onClick={() => toggleDone(ev.id)}
          className={cx('hit mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors', ev.done ? 'border-ink bg-ink' : 'border-stone-300 hover:border-stone-500')}
          title={ev.done ? 'Marquer comme à faire' : 'Marquer comme fait'} aria-label={`Marquer « ${ev.title} » comme ${ev.done ? 'à faire' : 'fait'}`}
        >
          {ev.done && <Check size={11} strokeWidth={3} className="text-paper" />}
        </button>}
        <button className={cx('min-w-0 flex-1 text-left pointer-coarse:py-2', readOnly && 'cursor-default')} onClick={readOnly ? undefined : onEdit}>
          <p className={cx('text-[14px] font-medium leading-snug hyphens-auto [overflow-wrap:anywhere]', ev.done && 'text-stone-500 line-through')}>
            {ev.important && <Flag size={12} className="mr-1 inline-block -translate-y-px fill-amber-500 text-amber-500" aria-label="Important" />}
            {ev.title}
          </p>
          <p className="mt-0.5 text-[12px] text-stone-500">
            <span style={{ color: c.text }}>{c.label}</span>
            {shared && ` · par ${shared.author(ev.id)}`}
            {isBigEvent(ev) && !ev.done && ` · ${countdownLabel(ev.date)}`}
            {!ev.done && reminders.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 whitespace-nowrap" title="Rappels">
                <Bell size={11} aria-label="Rappel" />
                {reminderLabel(Math.min(...reminders), !!ev.start, ev.date, ev.start)}
                {reminders.length > 1 && ` +${reminders.length - 1}`}
              </span>
            )}
          </p>
          {ev.details && <p className="mt-1.5 whitespace-pre-line text-[13px] text-stone-600 [overflow-wrap:anywhere]">{ev.details}</p>}
        </button>
        {/* On a phone the card itself opens the form (with « Supprimer »): the title keeps the width. */}
        {!readOnly && <div className="touch-show flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:max-sm:hidden">
          <button className="icon-btn" title="Modifier" aria-label={`Modifier « ${ev.title} »`} onClick={onEdit}>
            <Pencil size={14} />
          </button>
          <button
            className="icon-btn hover:text-red-600"
            title="Supprimer" aria-label={`Supprimer « ${ev.title} »`}
            onClick={() => remove(ev.id)}
          >
            <Trash2 size={14} />
          </button>
        </div>}
      </div>
    </div>
  );
}


/**
 * « Filtrer » : everything is shown by default; ticking categories (or « Importants ») shows only those.
 * A popover of real checkboxes (keyboard, screen readers), closed by Échap or a click outside.
 */
function CalendarFilter({ categories, shown, importantOnly, onToggle, onImportant, onReset, onManage }: {
  categories: EventCategory[];
  shown: Set<EventCategory>;
  importantOnly: boolean;
  onToggle: (k: EventCategory) => void;
  /** Absent in a shared calendar (nothing is marked important there). */
  onImportant?: () => void;
  onReset: () => void;
  /** Absent in a shared calendar (my categories are mine). */
  onManage?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const count = shown.size + (importantOnly ? 1 : 0);
  useEffect(() => {
    if (!open) return;
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
        className={cx('btn-secondary h-8 px-2.5', count > 0 && 'border-ink/40 text-ink')}
        title="Filtrer les événements affichés"
      >
        <ListFilter size={15} />
        <span className="max-sm:sr-only">Filtrer</span>
        {count > 0 && <span className="tabular rounded-full bg-ink px-1.5 text-[11px] leading-[18px] text-paper">{count}</span>}
      </button>
      {open && (
        <div id="filtre-calendrier" role="group" aria-label="Filtrer les événements" className="pop absolute right-0 top-10 z-[60] w-64 rounded-xl border border-stone-200 bg-surface p-2 shadow-pop max-sm:left-0 max-sm:right-auto">
          <p className="px-2 pb-1 pt-0.5 text-[12px] text-stone-500">{count ? 'Seuls les éléments cochés sont affichés.' : 'Tout est affiché. Coche pour n’afficher que certains éléments.'}</p>
          {onImportant && (
            <>
              <label className={row}>
                <input type="checkbox" className={box} checked={importantOnly} onChange={onImportant} />
                <Flag size={13} className="shrink-0 fill-amber-500 text-amber-500" />
                Importants
              </label>
              <div className="my-1 h-px bg-stone-100" />
            </>
          )}
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
          <div className="mt-1 flex items-center gap-1 border-t border-stone-100 pt-2">
            <button type="button" className="btn-ghost h-8 px-2 text-[12px]" disabled={!count} onClick={onReset}>
              Tout afficher
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
                Gérer les catégories
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
  const source = useCalendarSource();
  const { events, shared } = source;
  const [selected, setSelected] = useState(() => validKey(params.get('jour')) ?? todayKey());
  const [mode, setModeState] = useState<Mode>(savedMode);
  const [quick, setQuick] = useState('');
  // Filter: nothing ticked shows everything; ticked categories (and/or « Importants ») show only those.
  const [shown, setShown] = useState<Set<EventCategory>>(new Set());
  const [importantOnly, setImportantOnly] = useState(false);
  const filtering = shown.size > 0 || importantOnly;
  const mine = useSettings(s => s.customCategories);
  const custom = shared ? [] : mine; // a shared calendar: the built-in categories only (mine aren't the others')
  const words = WORDS[useSettings(s => s.usage)] ?? WORDS.etudes;
  const wide = useWide();
  const [allExams, setAllExams] = useState(false);
  const [managing, setManaging] = useState(false);
  const [periodsOpen, setPeriodsOpen] = useState(false);
  // fromQuick: opened from the quick add (« demain 14h » without a title), whose text is cleared once saved.
  const [form, setFormState] = useState<{ event?: CalendarEvent; date: string; start?: string; end?: string; fromQuick?: boolean } | null>(null);
  // A reader of a shared calendar sees it, without the ways to change it (the server refuses them anyway).
  const readOnly = !!shared && !shared.canEdit;
  const setForm = (f: typeof form) => setFormState(readOnly ? null : f);
  const [importing, setImporting] = useState<{ initial?: IcsSource } | null>(null);
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
    if (params.get('ajout')) {
      quickRef.current?.focus();
      setParams(p => (p.delete('ajout'), p), { replace: true });
    }
  }, [params, setParams]);

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

  const passes = useCallback((e: Pick<CalendarEvent, 'category' | 'important'>) => (shown.size === 0 || shown.has(e.category)) && (!importantOnly || !!e.important), [shown, importantOnly]);
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
  // Periods (« En entreprise »…): a band over the week, a tint on their days.
  const { periods } = source;
  const weekKeys = week.map(toKey);
  const weekBands = periodsBetween(periods, weekKeys[0], weekKeys[6]);
  const selPeriods = periodsOn(periods, selected);
  const tintOf = (key: string): Period | undefined => periodsOn(periods, key)[0];
  const fillOf = (key: string, strength: number) => periodsFill(periodsOn(periods, key), strength);
  const label = (p: Period) => periodLabel(p, shared?.nameOf);

  const parsed = quick.trim() ? parseQuickAdd(quick) : null;
  const parsedCat = parsed ? guessCategory(parsed.title || quick, !!parsed.start) : null;

  // The form, with what the sentence already gives (« demain 14h » has a day and an hour but no title).
  const openForm = () => setForm({ date: parsed?.date ?? selected, start: parsed?.start ?? undefined, end: parsed?.end ?? undefined, fromQuick: !!quick.trim() });

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
    if (!parsed) return;
    if (!parsed.title) return openForm();
    const date = parsed.date ?? selected;
    source.add({ title: parsed.title, date, start: parsed.start ?? undefined, end: parsed.end ?? undefined, category: parsedCat!, important: parsed.important });
    setQuick('');
    showSaved({ date, category: parsedCat!, important: parsed.important });
    toast(
      parsed.weekly ? `Ajouté pour ${fmt(fromKey(date), 'EEEE d MMMM')}, seulement celui-ci : la répétition chaque semaine n’existe pas encore.` : `Ajouté : ${parsed.title}`,
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

  // ← / → move one day (↑ / ↓ one week outside the day view), like a desktop agenda.
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keysRef.current = e => {
      if (form || importing || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [aria-modal="true"]')) return;
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

  // Drag an event onto another day, or onto another time in the day view.
  const moveEvent = (ev: CalendarEvent, target: DropTarget) => {
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
    const label = dayChanged ? `Déplacé au ${fmt(fromKey(target.day), 'EEEE d MMM')}${timeChanged ? ` à ${patch.start}` : ''}` : `Déplacé à ${patch.start}`;
    toast(label, 'success', { label: 'Annuler', run: () => update(ev.id, before) });
  };
  const { drag, ghostRef, start: dragStart } = useEventDrag(moveEvent);
  const startDrag: typeof dragStart = (...a) => (readOnly ? undefined : dragStart(...a));
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
      toast(`Dépose un fichier .ics pour importer un ${words.timetable}`, 'error');
      return;
    }
    setImporting({ initial: { name: file.name, text: await file.text() } });
  };

  // Same filter as the calendar (the category chips sit in this block).
  // An exam of today already over (its end, else its start, passed) is no longer « à venir », as on the home page.
  // Exams and events marked important (they count as big days too).
  const isUpcomingExam = (e: CalendarEvent) => isBigEvent(e) && !e.done && !isOver(e);
  // A shared calendar has no « fait »: what is past is just past, not « en retard ».
  const isHomeworkSoon = (e: CalendarEvent) => isDeliverable(e) && !e.done && daysUntil(e.date) <= 14 && (!shared || daysUntil(e.date) >= 0);
  // « Rien à afficher » only when a hidden category holds something this block would list (not a hidden « Sport »).
  // Anything still to come (not done, not over): after the important ones, the next things, whatever they are.
  const isComing = (e: CalendarEvent) => !e.done && e.date >= today && !isOver(e);
  const upcomingHidden = filtering && events.some(e => !passes(e) && (isComing(e) || isHomeworkSoon(e)));
  const allUpcomingExams = visible.filter(isUpcomingExam).sort(sortEvents);
  const upcomingExams = allExams ? allUpcomingExams : allUpcomingExams.slice(0, EXAMS_SHOWN);
  const moreExams = allUpcomingExams.length - EXAMS_SHOWN;
  const homework = visible.filter(isHomeworkSoon).sort(sortEvents).slice(0, 6);
  // After the important ones, one list in time order: homework to hand in (late first) and the next events.
  const listed = new Set([...allUpcomingExams, ...homework].map(e => e.id));
  const others = visible.filter(e => isComing(e) && !listed.has(e.id)).sort(sortEvents).slice(0, Math.max(1, EXAMS_SHOWN - upcomingExams.length));
  const nextUp = [...homework, ...others].sort(sortEvents);

  const monthDays = useMemo(() => {
    const ref = fromKey(selected);
    const start = weekStart(startOfMonth(ref));
    const end = endOfMonth(ref);
    const days: Date[] = [];
    for (let d = start; d <= end || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);
    return days;
  }, [selected]);

  const monthBands = mode === 'month' && monthDays.length ? periodsBetween(periods, toKey(monthDays[0]), toKey(monthDays[monthDays.length - 1])) : [];

  return (
    <div
      className={cx('h-full overflow-y-auto pb-12', !shared && 'px-4 md:px-8')}
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
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 pb-4 pt-2">
          {!shared && <h1 className="mr-3 text-[24px] font-semibold tracking-[-0.02em]">Calendrier</h1>}
          <div className="ml-auto flex items-center gap-1">
            <button className="icon-btn" onClick={() => shift(-1)} title={mode === 'day' ? 'Jour précédent' : 'Précédent'} aria-label={mode === 'day' ? 'Jour précédent' : 'Précédent'}>
              <ChevronLeft size={17} />
            </button>
            <span className="min-w-28 text-center text-[14px] font-medium first-letter:uppercase">{fmt(selDate, mode === 'day' ? 'EEE d MMMM' : 'MMMM yyyy')}</span>
            <button className="icon-btn" onClick={() => shift(1)} title={mode === 'day' ? 'Jour suivant' : 'Suivant'} aria-label={mode === 'day' ? 'Jour suivant' : 'Suivant'}>
              <ChevronRight size={17} />
            </button>
          </div>
          <button className="btn-secondary h-8" onClick={() => selectDay(today)}>
            Aujourd’hui
          </button>
          <div className="flex h-8 items-center rounded-lg bg-stone-100 p-0.5 text-[13px] pointer-coarse:h-10" role="group" aria-label="Affichage">
            {MODES.map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} aria-pressed={mode === m.id} className={cx('h-7 rounded-md px-2 font-medium transition-colors pointer-coarse:h-9 sm:px-3', mode === m.id ? 'bg-surface text-ink shadow-card' : 'text-stone-500 hover:text-ink')}>
                {m.label}
              </button>
            ))}
          </div>
          {/* Filter and import wrap together: on a phone the import icon was left alone on its own line. */}
          <div className="flex items-center gap-2">
          {(!readOnly || periods.length > 0) && (
            <button className="btn-secondary h-8 px-2.5" onClick={() => setPeriodsOpen(true)} title="Périodes : en cours, en entreprise, vacances…" aria-label="Périodes">
              <CalendarRange size={15} /> <span className="max-sm:sr-only">Périodes</span>
            </button>
          )}
          <CalendarFilter
            categories={allCategories(custom)}
            shown={shown}
            importantOnly={importantOnly}
            onToggle={k =>
              setShown(prev => {
                const n = new Set(prev);
                if (n.has(k)) n.delete(k);
                else n.add(k);
                return n;
              })
            }
            onImportant={shared ? undefined : () => setImportantOnly(v => !v)}
            onReset={() => {
              setShown(new Set());
              setImportantOnly(false);
            }}
            onManage={shared ? undefined : () => setManaging(true)}
          />
          {/* Together: on a tablet the header wraps, and the export icon was left alone on a second line. */}
          {!shared && <div className="flex items-center gap-1">
          <button className="icon-btn h-8 w-8" onClick={() => setImporting({})} title={`Importer un ${words.timetable} (.ics)`} aria-label={`Importer un ${words.timetable} (.ics)`}>
            <CalendarArrowDown size={16} />
          </button>
          {/* Not on phones, where the header would wrap for it: Profil › Données exports too. */}
          <button className="icon-btn hidden h-8 w-8 disabled:opacity-40 sm:inline-flex" disabled={!events.length} onClick={() => (exportIcs(), toast('Calendrier exporté', 'success'))} title="Exporter le calendrier (.ics)" aria-label="Exporter le calendrier (.ics)">
            <CalendarArrowUp size={16} />
          </button>
          </div>}
          </div>
        </div>

        {/* Quick add */}
        {/* Keyboard focus: a brand ring (the shadow alone was invisible on the dark theme). */}
        {readOnly ? (
          <p className="card px-4 py-3 text-[13px] text-stone-500">Tu peux consulter cet agenda ; seuls ses éditeurs peuvent le modifier.</p>
        ) : (
        <form onSubmit={submitQuick} className="card flex flex-col px-3 transition-shadow focus-within:border-stone-300 focus-within:shadow-pop has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-focus">
          <div className="flex h-12 items-center gap-2.5">
            <Plus size={17} className="shrink-0 text-stone-400" />
            <input
              ref={quickRef}
              value={quick}
              onChange={e => setQuick(e.target.value)}
              placeholder={wide ? `Ajouter un événement, par exemple «\u00a0${words.quickExample}\u00a0»` : 'Ajouter un événement…'}
              aria-label="Ajouter un événement en une phrase"
              className="h-full min-w-0 flex-1 text-ellipsis bg-transparent text-[14px] outline-none placeholder:text-stone-400"
            />
            {parsed?.title ? (
              <button type="submit" className="btn-primary h-8 px-3">
                Ajouter <CornerDownLeft size={13} />
              </button>
            ) : (
              <button type="button" className="btn-ghost h-8 px-2.5 text-[12px]" onClick={openForm}>
                Formulaire
              </button>
            )}
          </div>
          {parsed?.title && parsedCat && (
            <div className="enter flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-stone-100 py-2 pl-[27px] text-[12px] text-stone-500">
              <Dot color={catOf(parsedCat).color} />
              <span className="font-medium text-ink">{parsed.title}</span>
              <span>·</span>
              <span>{fmtDay(fromKey(parsed.date ?? selected), 'EEEE d MMMM')}</span>
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
                    <Flag size={11} className="fill-current" /> Important
                  </span>
                </>
              )}
              {parsed.weekly && <span className="w-full text-stone-500">Seulement celui-ci&nbsp;: la répétition chaque semaine n’existe pas encore.</span>}
            </div>
          )}
        </form>
        )}

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="card min-w-0 p-4 md:p-5">
            {mode !== 'month' ? (
              <>
              {weekBands.length > 0 && (
                <div className="mb-1 grid grid-cols-7 gap-1" aria-label="Périodes de la semaine">
                  {weekLanes(weekBands, weekKeys).filter(b => b.lane < 3).map(({ period: p, from, to, lane }) => {
                    return (
                      <button
                        key={`${p.id}-${from}`}
                        onClick={() => setPeriodsOpen(true)}
                        title={`${label(p)} · ${periodRange(p, fmtDay)}`}
                        className="flex h-6 min-w-0 items-center gap-1.5 truncate rounded-md px-2 text-left text-[11.5px] font-semibold"
                        style={{ gridColumn: `${from + 1} / ${to + 2}`, gridRow: lane + 1, background: periodTint(p, 20), color: periodText(p) }}
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: periodColor(p) }} aria-hidden />
                        <span className="truncate">{label(p)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="grid grid-cols-7 gap-1">
                {week.map(d => {
                  const key = toKey(d);
                  const evs = byDay.get(key) ?? [];
                  const isSel = key === selected;
                  const isToday = key === today;
                  const tint = tintOf(key);
                  return (
                    <button
                      key={key}
                      data-drop-day={key}
                      aria-pressed={isSel}
                      aria-label={`${fmt(d, 'EEEE d MMMM')}${isToday ? ', aujourd’hui' : ''}${evs.length ? `, ${evs.length} événement${evs.length > 1 ? 's' : ''}` : ''}`}
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
                      <span className="mt-1.5 flex h-1.5 gap-[3px]">
                        {evs.slice(0, 4).map(e => (
                          <span key={e.id} className="h-1.5 w-1.5 rounded-full" style={{ background: catOf(e.category).color, opacity: e.done ? 0.3 : 1 }} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              </>
            ) : (
              <div className="@container">
                <div className="grid grid-cols-7 pb-1.5 text-center text-[11px] font-medium text-stone-500">
                  {['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'].map(d => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-stone-200 bg-stone-200 [gap:1px]">
                  {monthDays.map((d, i) => {
                    const key = toKey(d);
                    const evs = byDay.get(key) ?? [];
                    const isSel = key === selected;
                    const dayPeriods = periodsOn(periods, key);
                    const tint = dayPeriods[0];
                    // Each name where its period starts (or starts again after skipped days), and at the start of each week row.
                    const named = dayPeriods.filter(p => i % 7 === 0 || !covers(p, toKey(addDays(d, -1))));
                    return (
                      <button
                        key={key}
                        data-drop-day={key}
                        aria-pressed={isSel}
                        aria-label={`${fmt(d, 'EEEE d MMMM')}${key === today ? ', aujourd’hui' : ''}${evs.length ? `, ${evs.length} événement${evs.length > 1 ? 's' : ''}` : ''}`}
                        onClick={() => selectDay(key)}
                        onDoubleClick={() => setForm({ date: key })}
                        className={cx(
                          'relative flex min-h-16 flex-col items-stretch p-1 text-left transition-colors @md:min-h-[84px]',
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
                            'tabular mb-0.5 flex h-6 w-6 items-center justify-center self-center rounded-full text-[12px] font-medium @md:self-start',
                            isSel ? 'bg-tile-blue text-white' : key === today && 'text-brand-600',
                          )}
                        >
                          {fmt(d, 'd')}
                        </span>
                        {/* Under the number: every day number stays on the same line, with or without a period. */}
                        {named.slice(0, 2).map(p => (
                          <span key={p.id} className="hidden truncate px-1 text-[10px] font-semibold leading-tight @md:block" style={{ color: periodText(p) }}>{label(p)}</span>
                        ))}
                        {evs.slice(0, 2).map(e => (
                          <span
                            key={e.id}
                            onPointerDown={p => startDrag(e, p)}
                            className={cx('mb-0.5 hidden cursor-grab select-none items-center gap-1 truncate rounded px-1 text-[11px] text-stone-700 hover:bg-stone-100 @md:flex', drag?.ev.id === e.id && 'opacity-40')}
                            style={{ textDecoration: e.done ? 'line-through' : undefined }}
                          >
                            <Dot color={catOf(e.category).color} size={6} />
                            <span className="truncate">{e.title}</span>
                          </span>
                        ))}
                        {evs.length > 0 && (
                          <span className="flex justify-center gap-0.5 @md:hidden">
                            {evs.slice(0, 3).map(e => (
                              <Dot key={e.id} color={catOf(e.category).color} size={5} />
                            ))}
                          </span>
                        )}
                        {evs.length > 2 && <span className="hidden px-1 text-[10px] text-stone-500 @md:block">+{evs.length - 2} autre{evs.length > 3 ? 's' : ''}</span>}
                      </button>
                    );
                  })}
                </div>
                {monthBands.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Périodes du mois">
                    {monthBands.slice(0, 8).map(p => (
                      <button key={p.id} onClick={() => setPeriodsOpen(true)} className="flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold" style={{ background: periodTint(p, 16), color: periodText(p) }}>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: periodColor(p) }} aria-hidden />
                        <span className="min-w-0 truncate">{label(p)}</span> <span className="shrink-0 font-medium">{periodRange(p, fmtDay)}</span>
                      </button>
                    ))}
                    {monthBands.length > 8 && <span className="self-center text-[11.5px] text-stone-500">+{monthBands.length - 8}</span>}
                  </div>
                )}
              </div>
            )}

            {/* Selected day */}
            <div className="mt-5 border-t border-stone-100 pt-5">
              <div className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h2 className="text-[16px] font-semibold first-letter:uppercase">{selected === today ? 'Aujourd’hui' : fmt(selDate, 'EEEE d MMMM')}</h2>
                {selPeriods.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setPeriodsOpen(true)}
                    className="flex h-6 min-w-0 max-w-[16rem] items-center gap-1 self-center rounded-full px-2.5 text-[12px] font-semibold"
                    style={{ background: periodTint(p, 18), color: periodText(p) }}
                    title={`${label(p)} · ${periodRange(p, fmtDay)}`}
                  >
                    <span className="min-w-0 truncate">{label(p)}</span>
                    {p.end !== selected && <span className="shrink-0 font-medium max-sm:hidden">· jusqu’au {fmtDay(fromKey(p.end), 'd MMM')}</span>}
                  </button>
                ))}
                {!readOnly && <button className="btn-ghost ml-auto h-8 text-[12px]" onClick={() => setForm({ date: selected })}>
                  <Plus size={14} /> Ajouter
                </button>}
              </div>
              {mode === 'day' ? (
                <DayView
                  date={selected}
                  isToday={selected === today}
                  events={dayEvents}
                  drag={drag}
                  onDragStart={startDrag}
                  onEdit={ev => setForm({ event: ev, date: ev.date })}
                  onCreate={(start, end) => setForm({ date: selected, start, end })}
                />
              ) : dayEvents.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-stone-500">{events.some(e => e.date === selected) ? 'Rien à afficher avec ce filtre.' : selected === today ? 'Rien de prévu aujourd’hui.' : 'Rien de prévu ce jour-là.'}</p>
              ) : (
                <div className="space-y-2">
                  {dayEvents.map(ev => (
                    <EventItem key={ev.id} ev={ev} dragging={drag?.ev.id === ev.id} onDragStart={e => startDrag(ev, e)} onEdit={() => setForm({ event: ev, date: ev.date })} />
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside aria-labelledby="a-venir-titre" className="card min-w-0 self-start p-4">
            <h2 id="a-venir-titre" className="mb-2 text-[13px] font-medium text-stone-600">
              À venir
            </h2>
            {upcomingExams.length === 0 && nextUp.length === 0 ? (
              <p className="py-1 text-[13px] text-stone-500">
                {upcomingHidden ? 'Rien à afficher avec ce filtre.' : 'Rien de prévu pour la suite.'}
              </p>
            ) : (
              <ul className="-mx-1.5">
                {upcomingExams.map(e => {
                  const n = daysUntil(e.date);
                  return (
                    <li key={e.id}>
                      <button onClick={() => showEvent(e)} className="flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-stone-50">
                        <span className={cx('tabular w-9 shrink-0 text-[13px] font-semibold', n <= 3 ? 'font-extrabold text-urgent-text' : 'text-ink')}>{n === 0 ? 'Auj.' : `J-${n}`}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{e.title}</span>
                          <span className="block text-[12px] first-letter:uppercase text-stone-500">
                            {fmtDay(fromKey(e.date), 'EEE d MMM')}
                            {e.start && ` · ${e.start}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {moreExams > 0 && (
                  <li>
                    <button onClick={() => setAllExams(v => !v)} aria-expanded={allExams} className="w-full rounded-lg px-1.5 py-1 text-left text-[12px] font-medium text-stone-500 transition-colors hover:bg-stone-50 hover:text-ink pointer-coarse:py-2">
                      {allExams ? 'Réduire' : `Voir ${moreExams} autre${moreExams > 1 ? 's' : ''}`}
                    </button>
                  </li>
                )}
                {nextUp.map(e => {
                  const n = daysUntil(e.date);
                  const late = e.date < today;
                  const toHandIn = isDeliverable(e) && !shared;
                  return (
                    <li key={e.id} className="flex items-center">
                      <button onClick={() => showEvent(e)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-stone-50">
                        <span className={cx('tabular w-9 shrink-0 text-[12px] font-semibold', late ? 'font-extrabold text-urgent-text' : 'text-stone-500')}>{late ? 'Retard' : n === 0 ? 'Auj.' : n === 1 ? 'Dem.' : `J-${n}`}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                            <Dot color={catOf(e.category).color} size={6} />
                            <span className="truncate">{e.title}</span>
                          </span>
                          <span className="block text-[12px] first-letter:uppercase text-stone-500">
                            {toHandIn ? `${words.markDone === 'rendu' ? 'À rendre' : 'À faire'} · ` : ''}
                            {fmtDay(fromKey(e.date), 'EEE d MMM')}
                            {e.start && ` · ${e.start}`}
                          </span>
                        </span>
                      </button>
                      {/* Something to hand in: ticked here once done (it then leaves the list). */}
                      {toHandIn && (
                        <button
                          onClick={() => source.toggleDone(e.id)}
                          className="hit ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-300 text-transparent transition-colors hover:border-emerald-500 hover:text-emerald-500"
                          title={`Marquer comme ${words.markDone}`}
                          aria-label={`Marquer « ${e.title} » comme ${words.markDone}`}
                        >
                          <Check size={13} strokeWidth={3} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

          </aside>
        </div>
      </div>

      {form && (
        <EventForm
          event={form.event}
          date={form.date}
          start={form.start}
          end={form.end}
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

      {/* Chip that follows the pointer while an event is dragged */}
      {drag && (
        <div
          ref={ghostRef}
          className={cx(
            'pointer-events-none fixed left-0 top-0 z-[80] flex max-w-56 items-center gap-1.5 rounded-md border border-stone-200 bg-surface px-2 py-1 text-[12px] font-medium shadow-pop transition-opacity',
            // Over the hourly grid the dashed preview already shows where it lands.
            drag.target?.minutes !== undefined && 'opacity-0',
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
            <p className="mt-2 text-[15px] font-semibold">Dépose ton {words.timetable}</p>
            <p className="mt-0.5 text-[13px] text-stone-500">Fichier .ics exporté depuis {words.icsFrom}</p>
          </div>
        </div>
      )}
    </div>
  );
}
