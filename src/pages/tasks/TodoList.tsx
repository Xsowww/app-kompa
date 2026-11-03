import { useToday } from '../../lib/useToday';
import { memo, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays } from 'date-fns';
import { BellRing, CalendarClock, CalendarPlus, Check, ChevronRight, ListTodo, Pencil, Plus, Repeat, RotateCcw, TextCursorInput, Trash2 } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ContextMenu, type MenuItem } from '../../components/Overlays';
import { useTodos, type Todo } from '../../store/todos';
import { countdownLabel, daysUntil, fmt, fmtDay, fromKey, parseQuickAdd, toKey, todayKey } from '../../lib/dates';
import { cx } from '../../lib/utils';
import { reminderMoment } from '../../lib/reminders';
import { repeatIn, TASK_REPEATS, type TaskRepeat } from '../../lib/taskRepeat';
import { isMenuKey, menuPoint } from '../../lib/a11y';
import { isTourTodo, startTour } from '../../store/tour';
import { useProgressive } from '../../lib/useProgressive';
import { toast } from '../../store/ui';
import TaskDialog from './TaskDialog';
import { DatePopover } from '../../components/Pickers';
import { t, tn } from '../../i18n';

const OVERDUE = 'var(--cat-examen-text)';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** The delete key as the keyboard names it (a Mac laptop has no « Suppr »). */
const DELETE_KEY = isMac ? '⌘⌫' : t('Suppr');
const repeatLabel = (r: TaskRepeat) => TASK_REPEATS.find(x => x.key === r)?.label ?? '';

// By day, then by hour on the same day (a task without an hour after those with one).
const sortOpen = (a: Todo, b: Todo) =>
  (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.time ?? '99').localeCompare(b.time ?? '99') || a.createdAt.localeCompare(b.createdAt);

function dueText(due: string, inOverdueGroup?: boolean) {
  const n = daysUntil(due);
  // Under the « En retard » heading, the day alone is enough; elsewhere yesterday is late too (« En retard · hier »).
  if (n < 0) {
    const day = n === -1 ? countdownLabel(due) : fmtDay(fromKey(due), 'd MMM');
    return inOverdueGroup ? day : t('En retard · {day}', { day: n === -1 ? day.toLowerCase() : day });
  }
  return n > 6 ? fmtDay(fromKey(due), 'd MMM') : n > 1 ? fmt(fromKey(due), 'EEE d') : countdownLabel(due);
}

/** The due day (none under the « Aujourd’hui » heading: `noDay`), and its hour as in the lists (« 18:00 »); ⟳ when it repeats. */
function DueLabel({ due, time, short, noDay, repeat }: { due: string; time?: string; short?: boolean; noDay?: boolean; repeat?: TaskRepeat }) {
  const n = daysUntil(due);
  const label = [!noDay && dueText(due, short), time].filter(Boolean).join(' · ');
  return (
    // inline-block: ::first-letter only works on a block (« Mar. 20 »).
    <span className={cx('tabular inline-block shrink-0 text-[12px] first-letter:uppercase', n < 0 ? 'font-medium' : n === 0 ? 'text-ink' : 'text-stone-500')} style={n < 0 ? { color: OVERDUE } : undefined}>
      {repeat && <Repeat size={11} className="mr-1 inline align-[-1px]" aria-hidden />}
      {label}
    </span>
  );
}

/** When a task was ticked, in the « Faites » list: « Aujourd’hui », « Hier », « Il y a 3 j », then the date. */
function doneText(doneAt?: string) {
  if (!doneAt) return '';
  const key = toKey(new Date(doneAt));
  return daysUntil(key) >= -6 ? countdownLabel(key) : fmtDay(fromKey(key), 'd MMM');
}

const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/**
 * Where the keyboard focus goes once a row is removed: the same control on the next (or previous) task — its title
 * when the key was pressed on a title (Suppr), else its bin —, else the add field.
 */
function focusAfterRemoval(row: HTMLElement | null, later = false) {
  const list = row?.closest('[data-todolist]');
  const rows = [...(list?.querySelectorAll('li') ?? [])];
  const i = row ? rows.indexOf(row as HTMLLIElement) : -1;
  const near = rows[i + 1] ?? rows[i - 1];
  const onTitle = !!(document.activeElement as HTMLElement | null)?.matches?.('[data-task-title]');
  const target =
    near?.querySelector<HTMLElement>(onTitle ? '[data-task-title]' : '[data-remove]') ??
    // No keyboard popping up on phones when the list empties.
    (coarse() ? null : list?.querySelector<HTMLElement>('[data-quickadd]'));
  const go = () => target?.focus({ preventScroll: true });
  if (later) setTimeout(go, 0); // after a closing dialog has handed the focus back
  else go();
}

/** The task's box again once its row moved (ticked, new due day): only when the focus fell to the page. */
const refocusTodo = (id: string) =>
  setTimeout(() => {
    const a = document.activeElement;
    if (!a || a === document.body) document.querySelector<HTMLElement>(`[data-todo="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }, 0);

/** A changed due date can move the task to another group (new row): find its date button again after the render. */
const focusDueButton = (id: string) => setTimeout(() => document.querySelector<HTMLElement>(`[data-due="${id}"]`)?.focus(), 0);

/** Tasks to the trash (kept 30 days, like notes and events), « Annuler » in the message: no question first. */
function trashTodos(ids: string[]) {
  const gone = useTodos.getState().removeMany(ids);
  if (!gone.length) return;
  const text = gone.length === 1 ? t('Tâche «\u00a0{title}\u00a0» mise à la corbeille', { title: gone[0].title }) : tn(gone.length, '{n} tâche mise à la corbeille', '{n} tâches mises à la corbeille');
  toast(text, 'info', {
    label: t('Annuler||l’action'),
    run: () => {
      useTodos.getState().restore(gone.map(x => x.id));
      // The toast's button goes away: the focus goes to the task that came back (once it's on screen).
      setTimeout(() => document.querySelector<HTMLElement>(`[data-todo="${gone[0].id}"]`)?.focus(), 0);
    },
  });
}

const tomorrowKey = () => toKey(addDays(new Date(), 1));

/** « Reporter »: late tasks to today or tomorrow; « Annuler » gives them their days back. */
function postponeTodos(list: Todo[], day: string) {
  if (!list.length) return;
  const { update } = useTodos.getState();
  const before = list.map(x => [x.id, x.due] as const);
  list.forEach(x => update(x.id, { due: day }));
  const today = day === todayKey();
  const text =
    list.length === 1
      ? today
        ? t('«\u00a0{title}\u00a0» reportée à aujourd’hui', { title: list[0].title })
        : t('«\u00a0{title}\u00a0» reportée à demain', { title: list[0].title })
      : today
        ? tn(list.length, '{n} tâche reportée à aujourd’hui', '{n} tâches reportées à aujourd’hui')
        : tn(list.length, '{n} tâche reportée à demain', '{n} tâches reportées à demain');
  toast(text, 'success', { label: t('Annuler||l’action'), run: () => before.forEach(([id, due]) => useTodos.getState().update(id, { due })) });
}

/** The two days a late task can be put off to, in a menu (a row's « Reporter », « Tout reporter »). */
const postponeItems = (list: Todo[], all?: boolean): MenuItem[] => [
  { label: all ? t('Tout reporter à aujourd’hui') : t('Reporter à aujourd’hui'), icon: <CalendarClock />, onClick: () => postponeTodos(list, todayKey()) },
  { label: all ? t('Tout reporter à demain') : t('Reporter à demain'), icon: <CalendarPlus />, onClick: () => postponeTodos(list, tomorrowKey()) },
];

/** Under a ticked task: when it leaves the list. */
const GoesIn = ({ minutes }: { minutes: number }) => (
  <span className="block text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400">{t('Masquée dans {n} min', { n: minutes })}</span>
);

// memo: ticking one task re-renders its row only, not the whole list.
// `group`: the heading the row is under (« Aujourd’hui » already says the day). `history`: in « Faites » (when ticked).
// Keyboard (Tâches): ↑/↓ from task to task, Espace ticks, Entrée opens, F2 renames, Suppr (⌘⌫) to the trash,
// Maj+F10 or the menu key (or a right-click) the row's menu.
const TodoRow = memo(function TodoRow({ t: todo, editable, preview, now = 0, group, history }: { t: Todo; editable?: boolean; preview?: boolean; now?: number; group?: string; history?: boolean }) {
  // A ticked task is shown green at the bottom of the list until it goes (SETTLE_MS).
  const justDone = todo.done;
  // (`now` can lag behind a tick just made: never more than the 30 minutes)
  const minutesLeft = justDone && todo.doneAt ? Math.min(SETTLE_MS / 60_000, Math.max(1, Math.ceil((Date.parse(todo.doneAt) + SETTLE_MS - now) / 60_000))) : 0;
  const { toggle, update } = useTodos.getState();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  // The date button the small calendar hangs from while it is open.
  const [dating, setDating] = useState<HTMLElement | null>(null);
  const [openDialog, setOpenDialog] = useState<'edit' | 'remind' | null>(null);
  // The row's menu (right-click, Maj+F10) or that of its « Reporter » button.
  const [menu, setMenu] = useState<{ x: number; y: number; postpone?: boolean } | null>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  // A new date can move the task to another group (a new row): the focus follows it there.
  const pickDue = (value: string) => {
    setDating(null);
    if (value !== (todo.due ?? '')) update(todo.id, { due: value || undefined });
    focusDueButton(todo.id);
  };
  const overdue = !todo.done && !!todo.due && todo.due < todayKey();
  const canEdit = editable && !todo.done;
  // A reminder still to come (one whose moment passed can't ring any more: no bell).
  const hasReminder = !!todo.due && !!todo.reminders?.some(m => reminderMoment(todo.due!, todo.time, m).getTime() > Date.now());
  const noDay = group === 'today';
  // Under « Aujourd’hui », no day to say: only an hour, or the ⟳ of a task that repeats.
  const showDue = !!todo.due && !(noDay && !todo.time && !todo.repeat);

  // Back to the title after Enter or Escape, or the keyboard focus would fall to the top of the page.
  // Not on blur: the focus went elsewhere on purpose (another field…).
  const stopEditing = (refocus: boolean) => {
    setEditing(false);
    if (refocus) setTimeout(() => titleRef.current?.focus(), 0);
  };
  const save = (refocus: boolean) => {
    stopEditing(refocus);
    if (title.trim() && title.trim() !== todo.title) update(todo.id, { title: title.trim() });
    else setTitle(todo.title);
  };

  const tour = isTourTodo(todo.title);
  const open = () => (tour ? startTour() : setOpenDialog('edit'));
  // Ticked from its title (Espace): the focus stays on it, wherever the task now is (« Faites », the list).
  const tick = (fromTitle?: boolean) => {
    toggle(todo.id);
    if (fromTitle) setTimeout(() => document.querySelector<HTMLElement>(`[data-task-title="${CSS.escape(todo.id)}"]`)?.focus({ preventScroll: true }), 0);
    else refocusTodo(todo.id);
  };
  const toTrash = (later = false) => {
    focusAfterRemoval(rowRef.current, later);
    trashTodos([todo.id]);
  };
  const late = group === 'late' && canEdit;

  const onRowKey = (e: React.KeyboardEvent<HTMLLIElement>) => {
    const el = e.target as HTMLElement;
    // This row's own controls only (a dialog opened from it passes its keys up here too), never while typing.
    if (preview || editing || e.defaultPrevented || !e.currentTarget.contains(el) || el.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (isMenuKey(e)) {
      e.preventDefault();
      return setMenu(menuPoint(e));
    }
    if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) {
      if (e.ctrlKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      return toTrash();
    }
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const titles = [...(rowRef.current?.closest('[data-todolist]')?.querySelectorAll<HTMLElement>('[data-task-title]') ?? [])];
      const i = titles.findIndex(x => rowRef.current?.contains(x));
      return titles[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
    // Espace and Entrée on the buttons keep their own meaning.
    if (!el.matches('[data-task-title]')) return;
    if (e.key === ' ') {
      e.preventDefault();
      tick(true);
    } else if (e.key === 'Enter' && canEdit) {
      e.preventDefault();
      open();
    } else if (e.key === 'F2' && canEdit) {
      e.preventDefault();
      setEditing(true);
    }
  };

  const keys = !coarse(); // no keyboard names in the menu on a touch screen
  const menuItems: MenuItem[] = !menu
    ? []
    : menu.postpone
      ? [...postponeItems([todo]), { label: t('Choisir un jour…'), icon: <CalendarPlus />, onClick: () => setDating(document.querySelector<HTMLElement>(`[data-due="${CSS.escape(todo.id)}"]`)) }]
      : [
          ...(canEdit ? [{ label: tour ? t('Lancer') : t('Modifier'), icon: <Pencil />, shortcut: keys ? t('Entrée') : undefined, onClick: open }] : []),
          ...(canEdit ? [{ label: t('Renommer'), icon: <TextCursorInput />, shortcut: keys ? 'F2' : undefined, onClick: () => setEditing(true) }] : []),
          { label: todo.done ? t('Remettre à faire') : t('Marquer comme faite'), icon: todo.done ? <RotateCcw /> : <Check />, shortcut: keys ? t('Espace') : undefined, onClick: () => tick(true) },
          ...(overdue && editable ? [{ label: '', divider: true, onClick: () => {} }, ...postponeItems([todo])] : []),
          { label: '', divider: true, onClick: () => {} },
          { label: t('Supprimer'), icon: <Trash2 />, shortcut: keys ? DELETE_KEY : undefined, danger: true, onClick: () => toTrash(true) },
        ];

  return (
    <li
      ref={rowRef}
      onKeyDown={onRowKey}
      onContextMenu={e => {
        if (preview || editing || !e.currentTarget.contains(e.target as Node)) return;
        e.preventDefault();
        setMenu(menuPoint(e));
      }}
      className="list-row group flex min-h-9 items-center gap-2 rounded-lg sm:gap-3 pointer-coarse:gap-4 px-1.5 pointer-coarse:pl-3.5 py-1 transition-colors hover:bg-stone-50"
    >
      <button
        data-todo={todo.id}
        onClick={() => tick()}
        className={cx(
          'hit flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors',
          justDone ? 'border-emerald-500 bg-emerald-500' : overdue ? 'border-[#d9a19a] hover:border-[#b13428] dark:border-red-300 dark:hover:border-red-600' : 'border-stone-300 hover:border-stone-500',
        )}
        title={todo.done ? t('Remettre à faire') : t('Marquer comme faite')}
        data-tour-todo={isTourTodo(todo.title) || undefined}
        aria-label={todo.done ? t('Remettre « {title} » à faire', { title: todo.title }) : t('Cocher « {title} »', { title: todo.title })}
      >
        {todo.done && <Check size={10} strokeWidth={3} className="pop text-white" />}
      </button>
      {preview ? (
        <Link to={`/taches?tache=${todo.id}`} className="min-w-0 flex-1 rounded text-[13px] hover:underline pointer-coarse:-my-2 pointer-coarse:py-3" title={t('Ouvrir dans Tâches')}>
          <span className={cx('line-clamp-2 break-words', justDone ? 'text-stone-500 line-through decoration-emerald-500/70' : 'text-ink')}>{todo.title}</span>
          {justDone && <GoesIn minutes={minutesLeft} />}
        </Link>
      ) : editing ? (
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => save(false)}
          maxLength={160}
          onKeyDown={e => {
            if (e.key === 'Enter') save(true);
            if (e.key === 'Escape') {
              setTitle(todo.title);
              stopEditing(true);
            }
          }}
          aria-label={t('Modifier la tâche')}
          className="field h-7 min-w-0 flex-1 px-2"
        />
      ) : (
        <span
          ref={titleRef}
          data-task-title={todo.id}
          onDoubleClick={() => canEdit && setEditing(true)}
          // The task's own stop for the keyboard (onRowKey): Entrée opens it, Espace ticks it, F2 renames it.
          role="button"
          tabIndex={0}
          aria-label={todo.done ? t('« {title} », faite', { title: todo.title }) : todo.title}
          aria-keyshortcuts={canEdit ? 'Enter Space F2 Delete' : 'Space Delete'}
          // As tall as the row on touch screens (36 px), the clamped text inside.
          className={cx('flex min-w-0 flex-1 items-center rounded text-[13px] pointer-coarse:-my-1 pointer-coarse:self-stretch pointer-coarse:py-1', 'text-ink')}
          title={canEdit ? t('Double-clic pour renommer') : todo.title}
        >
          <span className="min-w-0">
            <span className={cx('line-clamp-2 break-words', justDone && 'text-stone-500 line-through decoration-emerald-500/70')}>{todo.title}</span>
            {justDone && !history && <GoesIn minutes={minutesLeft} />}
          </span>
        </span>
      )}
      {late && (
        <button
          type="button"
          aria-haspopup="menu"
          onClick={e => setMenu({ ...menuPoint(e), postpone: true })}
          className="hit flex h-9 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-stone-600 hover:bg-stone-100 hover:text-ink sm:h-6"
          title={t('Reporter')}
          aria-label={t('Reporter « {title} »', { title: todo.title })}
        >
          <CalendarClock size={13} /> <span className="max-sm:hidden">{t('Reporter')}</span>
        </button>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} label={menu.postpone ? t('Reporter « {title} »', { title: todo.title }) : todo.title} />}
      {isTourTodo(todo.title) && !todo.done && (
        <button type="button" onClick={startTour} className="btn-primary h-7 shrink-0 px-2.5 text-[12px] pointer-coarse:h-9">
          {t('Lancer')}
        </button>
      )}
      {canEdit && !isTourTodo(todo.title) && (
        <button
          type="button"
          onClick={() => setOpenDialog('edit')}
          // Last on phones (the bin is hidden there): the pencils stay in one column, whatever the date beside them.
          className="icon-btn touch-show h-9 w-9 shrink-0 opacity-0 max-sm:order-last sm:h-6 sm:w-6 group-hover:opacity-100 focus-visible:opacity-100"
          title={t('Modifier')}
          aria-label={t('Modifier «\u00a0{title}\u00a0»', { title: todo.title })}
        >
          <Pencil size={13} />
        </button>
      )}
      {/* The bell only when a reminder is set (it says so): to add one, the pencil opens the same dialog. */}
      {canEdit && hasReminder && !isTourTodo(todo.title) && (
        <button
          type="button"
          onClick={() => setOpenDialog('remind')}
          className="hit flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] font-medium text-brand-600 hover:bg-stone-100"
          title={t('Changer le rappel')}
          aria-label={t('Changer le rappel de «\u00a0{title}\u00a0»', { title: todo.title })}
        >
          <BellRing size={13} />
        </button>
      )}
      {openDialog && (
        <TaskDialog
          todo={todo}
          remind={openDialog === 'remind'}
          onClose={() => {
            setOpenDialog(null);
            refocusTodo(todo.id);
          }}
          onDelete={() => toTrash(true)}
        />
      )}
      {/* The tour task has « Lancer » in that column instead (no deadline to give it). */}
      {!todo.done && editable && !(isTourTodo(todo.title) && !todo.due) ? (
        <>
          <button
            data-due={todo.id}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={!!dating}
            onClick={e => setDating(dating ? null : e.currentTarget)}
            className={cx(
              // Same width with or without a date: the reminder bells stay in one column.
              'hit min-w-[58px] shrink-0 rounded-md',
              showDue ? 'px-1 py-0.5 text-right hover:bg-stone-100' : 'icon-btn touch-show h-9 w-9 opacity-0 max-sm:hidden sm:h-6 sm:w-6 group-hover:opacity-100 focus-visible:opacity-100',
            )}
            title={todo.due ? t('Changer l’échéance') : t('Ajouter une échéance')}
            aria-label={
              (todo.due ? t('Changer l’échéance de «\u00a0{title}\u00a0» ({due})', { title: todo.title, due: dueText(todo.due, overdue) }) : t('Ajouter une échéance à «\u00a0{title}\u00a0»', { title: todo.title })) +
              (todo.repeat && todo.due ? ` · ${repeatLabel(todo.repeat)}` : '')
            }
          >
            {showDue ? <DueLabel due={todo.due!} time={todo.time} short={overdue} noDay={noDay} repeat={todo.repeat} /> : <CalendarPlus size={13} />}
          </button>
          {dating && <DatePopover anchor={dating} value={todo.due ?? ''} clearable label={t('Échéance de « {title} »', { title: todo.title })} onPick={pickDue} onClose={() => setDating(null)} />}
        </>
      ) : history ? (
        <span className="tabular shrink-0 text-[12px] text-stone-500 first-letter:uppercase">{doneText(todo.doneAt)}</span>
      ) : (
        todo.due && !todo.done && <DueLabel due={todo.due} time={todo.time} repeat={todo.repeat} />
      )}
      {!preview && <button
        data-remove
        onClick={e => {
          e.currentTarget.focus(); // Safari doesn't focus a clicked button: the next row's bin must take the focus, not its title
          toTrash(true);
        }}
        className="icon-btn touch-show h-9 w-9 opacity-0 max-sm:hidden sm:h-6 sm:w-6 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-600" title={t('Mettre à la corbeille')} aria-label={t('Supprimer « {title} »', { title: todo.title })}>
        <Trash2 size={13} />
      </button>}
    </li>
  );
});

function QuickAdd() {
  const add = useTodos(s => s.add);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [dueMenu, setDueMenu] = useState<HTMLElement | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!title.trim()) return;
    // « Arroser les plantes tous les jours », « Sortir les poubelles tous les lundis »: a task that repeats (from today
    // when no day is said). « Appeler la banque demain 14h »: the day and the hour come out of the sentence, as in the
    // calendar (not a day already past or an « urgent » the task has no place for: then as typed).
    const r = repeatIn(title);
    const text = r.repeat && r.text ? r.text : title;
    const p = due ? null : parseQuickAdd(text);
    const found = p?.title && p.date && p.date >= todayKey() && !p.important && !p.impossible ? p : null;
    const repeat = r.repeat && r.text ? r.repeat : found?.weekly ? 'week' : undefined;
    const day = due || found?.date || (repeat ? todayKey() : undefined);
    const todo = add(found ? found.title : text, day, found?.start ?? undefined);
    if (repeat) useTodos.getState().update(todo.id, { repeat });
    setTitle('');
    setDue('');
    titleRef.current?.focus(); // ready for the next one, even from the date field that just went away
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <input
          ref={titleRef}
          data-quickadd
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={t('Ajouter une tâche…')}
          aria-label={t('Nouvelle tâche')}
          maxLength={160}
          className="field w-full"
        />
      </div>
      {/* The new task's due date: a button, the small calendar under it. */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={!!dueMenu}
        onClick={e => setDueMenu(dueMenu ? null : e.currentTarget)}
        className={cx('flex h-10 shrink-0 items-center gap-1.5 rounded-[14px] px-3 text-[12.5px] font-semibold transition-colors pointer-coarse:h-11 pointer-coarse:min-w-11', due ? 'bg-brand-50 text-brand-700 hover:bg-brand-100' : 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-ink')}
        title={due ? t('Changer l’échéance') : t('Ajouter une échéance')}
        aria-label={due ? t('Échéance : {day}', { day: fmtDay(fromKey(due), 'EEEE d MMMM') }) : t('Ajouter une échéance')}
      >
        <CalendarPlus size={15} />
        <span className="first-letter:uppercase max-sm:sr-only">{due ? fmtDay(fromKey(due), 'EEE d MMM') : t('Échéance')}</span>
      </button>
      {dueMenu && (
        <DatePopover
          anchor={dueMenu}
          value={due}
          min={todayKey()}
          clearable
          label={t('Échéance de la nouvelle tâche')}
          onPick={k => {
            setDue(k);
            setDueMenu(null);
            titleRef.current?.focus();
          }}
          onClose={() => setDueMenu(null)}
        />
      )}
      <button type="button" onClick={submit} disabled={!title.trim()} className="btn h-10 shrink-0 bg-tile-blue px-4 text-white hover:brightness-110 disabled:opacity-50 pointer-coarse:h-11">
        <Plus size={15} strokeWidth={2.4} aria-hidden /> <span className="max-sm:sr-only">{t('Ajouter')}</span>
      </button>
    </div>
  );
}

/**
 * A ticked task stays this long at the bottom of the list, green and struck through (a wrong tick is undone
 * right there), then leaves the list. It stays in the data: « Ma semaine » and the badges still count it.
 */
export const SETTLE_MS = 30 * 60_000;
const settling = (t: Todo, now: number) => t.done && !!t.doneAt && now - Date.parse(t.doneAt) < SETTLE_MS;

/**
 * Simple to-do list, independent from the calendar. `grouped`: the Tâches page (add, change, group by day).
 * `limit`: the home page preview — tick, or open a task in Tâches; adding and changing happen there.
 */
export default function TodoList({ limit, grouped }: { limit?: number; grouped?: boolean }) {
  const todos = useTodos(s => s.todos);
  useToday(); // re-render the next day (overdue, « Aujourd'hui »)
  const preview = !!limit;
  // Ticks less than 30 minutes old stay in the list: one render when the next of them is due to leave.
  const [now, setNow] = useState(Date.now);
  const nextLeave = Math.min(...todos.filter(t => settling(t, now)).map(t => Date.parse(t.doneAt!) + SETTLE_MS));
  useEffect(() => {
    if (!Number.isFinite(nextLeave)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(30_000, Math.max(500, nextLeave - Date.now())));
    return () => clearTimeout(timer);
  }, [nextLeave, now]);
  // (a tick just made: its time is `doneAt`, newer than `now`, so it stays too)
  const open = todos.filter(t => !t.done).sort(sortOpen);
  // Ticked, at the bottom: the first ticked first, the order they were done in.
  const ticked = todos.filter(t => settling(t, now)).sort((a, b) => a.doneAt!.localeCompare(b.doneAt!));
  // The home preview keeps room for at least the last two ticks (more when places are free), so a tick made there shows green.
  const tickedShown = limit ? ticked.slice(-Math.max(2, limit - open.length)) : ticked;
  const openShown = limit ? open.slice(0, Math.max(0, limit - tickedShown.length)) : open;
  const today = todayKey();

  const groups = (
    grouped
      ? [
          { key: 'late', label: t('En retard'), items: open.filter(x => x.due && x.due < today) },
          { key: 'today', label: t('Aujourd’hui'), items: open.filter(x => x.due === today) },
          { key: 'soon', label: t('À venir'), items: open.filter(x => x.due && x.due > today) },
          { key: 'none', label: t('Sans échéance'), items: open.filter(x => !x.due) },
          { key: 'done', label: t('Cochées à l’instant'), items: ticked },
        ]
      : [{ key: 'all', label: '', items: [...openShown, ...tickedShown] }]
  ).filter(g => g.items.length);
  // « Tout reporter » under « En retard ».
  const [lateMenu, setLateMenu] = useState<{ x: number; y: number } | null>(null);
  const lateItems = groups.find(g => g.key === 'late')?.items ?? [];
  // Hundreds of tasks: the first rows at once, the others right after (useProgressive).
  let left = useProgressive(groups.reduce((n, g) => n + g.items.length, 0));
  const rendered = groups.map(g => {
    const rows = g.items.slice(0, Math.max(0, left));
    left -= g.items.length;
    return { ...g, rows };
  });

  return (
    <div className="flex flex-1 flex-col" data-todolist>
      {!preview && <QuickAdd />}
      {open.length === 0 &&
        (ticked.length || todos.some(x => x.done) ? (
          <p className={cx('text-[13px] text-stone-500', ticked.length ? 'pt-3' : 'py-5')}>{t('Tout est coché. Profites-en.')}</p>
        ) : (
          // No button here: the add field (Tâches) and the « + » button (Tâches, home) are right there.
          <EmptyState
            size="sm"
            icon={ListTodo}
            title={t('Aucune tâche pour l’instant.')}
            preview="list"
          />
        ))}
      {groups.length > 0 && (
        <div className="mt-2">
          {rendered.filter(g => g.rows.length).map(g => (
            <div key={g.key} className={cx(g.label && 'mt-3 first:mt-1')}>
              {g.label && (
                <div className="mb-0.5 flex items-center gap-2 px-1.5">
                  <h2 className={cx('eyebrow', g.key === 'done' && 'text-emerald-700 dark:text-emerald-400')} style={g.key === 'late' ? { color: OVERDUE } : undefined}>
                    {g.label}
                  </h2>
                  {g.key === 'late' && (
                    <button
                      type="button"
                      aria-haspopup="menu"
                      onClick={e => setLateMenu(menuPoint(e))}
                      className="-my-1 ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-ink pointer-coarse:py-2"
                    >
                      <CalendarClock size={13} aria-hidden /> {t('Tout reporter')}
                    </button>
                  )}
                </div>
              )}
              <ul className="-mx-1.5">
                {g.rows.map(x => (
                  <TodoRow key={x.id} t={x} editable={grouped} preview={preview} now={x.done ? now : 0} group={grouped ? g.key : undefined} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {lateMenu && <ContextMenu x={lateMenu.x} y={lateMenu.y} items={postponeItems(lateItems, true)} onClose={() => setLateMenu(null)} label={t('Tout reporter')} />}
      {/* The home preview: the tasks it leaves out are counted, one tap from Tâches. */}
      {preview && open.length > openShown.length && (
        <Link to="/taches" className="mt-1 self-start rounded px-1.5 text-[12px] font-medium text-stone-500 hover:text-ink hover:underline pointer-coarse:py-2">
          {tn(open.length - openShown.length, '+{n} autre dans Tâches', '+{n} autres dans Tâches')}
        </Link>
      )}
    </div>
  );
}

const SHOWN_DONE = 8;
const DONE_OPEN = 'cop-faites-ouvert';

/**
 * « Faites (N) »: the ticked tasks, the last first — to untick one, or put them all in the trash. They stay in the
 * data anyway (« Ma semaine » and the badges count them). Folded or not: remembered on this device.
 */
export function DoneTasks() {
  const todos = useTodos(s => s.todos);
  const done = todos.filter(x => x.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(DONE_OPEN) !== '0';
    } catch {
      return true;
    }
  });
  const [all, setAll] = useState(false);
  if (!done.length) return null;
  const shown = all ? done : done.slice(0, SHOWN_DONE);
  const fold = () => {
    setOpen(!open);
    try {
      localStorage.setItem(DONE_OPEN, open ? '0' : '1');
    } catch {
      /* private mode: folded until the next visit only */
    }
  };
  return (
    <section aria-labelledby="faites-titre" className="card p-5">
      <div className="flex items-center gap-2">
        <h2 id="faites-titre" className="mr-auto">
          <button type="button" onClick={fold} aria-expanded={open} aria-controls="faites-liste" className="-ml-1 flex items-center gap-1 rounded px-1 text-[13px] font-medium text-stone-600 hover:text-ink pointer-coarse:min-h-9">
            <ChevronRight size={14} className={cx('transition-transform', open && 'rotate-90')} aria-hidden />
            {t('Faites')} <span className="tabular text-stone-500">({done.length})</span>
          </button>
        </h2>
        {open && (
          <button type="button" onClick={() => trashTodos(done.map(x => x.id))} className="-my-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-stone-500 transition-colors hover:bg-red-50 hover:text-red-600 pointer-coarse:py-2">
            {t('Tout supprimer')}
          </button>
        )}
      </div>
      {open && (
        <div id="faites-liste" data-todolist className="mt-2">
          <ul className="-mx-1.5">
            {shown.map(x => (
              <TodoRow key={x.id} t={x} editable history />
            ))}
          </ul>
          {done.length > shown.length && (
            <button type="button" onClick={() => setAll(true)} className="mt-1 rounded px-0.5 text-[12px] font-medium text-brand-600 hover:underline pointer-coarse:min-h-9">
              {tn(done.length - shown.length, 'Voir {n} autre', 'Voir les {n} autres')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
