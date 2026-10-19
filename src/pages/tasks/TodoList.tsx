import { useToday } from '../../lib/useToday';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellRing, CalendarPlus, Check, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTodos, type Todo } from '../../store/todos';
import { countdownLabel, daysUntil, fmt, fmtDay, fromKey, todayKey } from '../../lib/dates';
import { cx } from '../../lib/utils';
import { isTourTodo, startTour } from '../../store/tour';
import { confirmAction, toast } from '../../store/ui';
import TaskDialog from './TaskDialog';
import { DatePopover } from '../../components/Pickers';

const OVERDUE = 'var(--cat-examen-text)';

const sortOpen = (a: Todo, b: Todo) =>
  (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt.localeCompare(b.createdAt);

function dueText(due: string, inOverdueGroup?: boolean) {
  const n = daysUntil(due);
  // Under the « En retard » heading, the date alone is enough.
  if (n < -1) return inOverdueGroup ? fmtDay(fromKey(due), 'd MMM') : `En retard · ${fmtDay(fromKey(due), 'd MMM')}`;
  return n > 6 ? fmtDay(fromKey(due), 'd MMM') : n > 1 ? fmt(fromKey(due), 'EEE d') : countdownLabel(due);
}

function DueLabel({ due, short }: { due: string; short?: boolean }) {
  const n = daysUntil(due);
  const label = dueText(due, short);
  return (
    // inline-block: ::first-letter only works on a block (« Mar. 20 »).
    <span className={cx('tabular inline-block shrink-0 text-[12px] first-letter:uppercase', n < 0 ? 'font-medium' : n === 0 ? 'text-ink' : 'text-stone-500')} style={n < 0 ? { color: OVERDUE } : undefined}>
      {label}
    </span>
  );
}

const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** Where the keyboard focus goes once a row is removed: the same button on the next (or previous) task, else the add field. */
function focusAfterRemoval(row: HTMLElement | null, later = false) {
  const list = row?.closest('[data-todolist]');
  const rows = [...(list?.querySelectorAll('li') ?? [])];
  const i = row ? rows.indexOf(row as HTMLLIElement) : -1;
  const near = rows[i + 1] ?? rows[i - 1];
  const target =
    near?.querySelector<HTMLElement>('[data-remove]') ??
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

const confirmRemove = (t: Todo) => confirmAction(`Supprimer « ${t.title} » ?`, 'Tu pourras l’annuler juste après.', 'Supprimer');

/** Removes tasks with a way back: a single tap on the bin must not lose one for good. */
function removeWithUndo(gone: Todo[]) {
  if (!gone.length) return;
  const text = gone.length === 1 ? `Tâche « ${gone[0].title} » supprimée` : `${gone.length} tâches supprimées`;
  toast(text, 'info', {
    label: 'Annuler',
    run: () => {
      useTodos.getState().restore(gone);
      // The toast's button goes away: the focus goes to the task that came back (once it's on screen).
      setTimeout(() => document.querySelector<HTMLElement>(`[data-todo="${gone[0].id}"]`)?.focus(), 0);
    },
  });
}

/** Under a ticked task: when it leaves the list. */
const GoesIn = ({ minutes }: { minutes: number }) => (
  <span className="block text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400">Se supprime dans {minutes} min</span>
);

function TodoRow({ t, editable, preview, now = 0 }: { t: Todo; editable?: boolean; preview?: boolean; now?: number }) {
  // A ticked task is shown green at the bottom of the list until it goes (SETTLE_MS).
  const justDone = t.done;
  // (`now` can lag behind a tick just made: never more than the 30 minutes)
  const minutesLeft = justDone && t.doneAt ? Math.min(SETTLE_MS / 60_000, Math.max(1, Math.ceil((Date.parse(t.doneAt) + SETTLE_MS - now) / 60_000))) : 0;
  const { toggle, remove, update } = useTodos();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  // The date button the small calendar hangs from while it is open.
  const [dating, setDating] = useState<HTMLElement | null>(null);
  const [openDialog, setOpenDialog] = useState<'edit' | 'remind' | null>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  // A new date can move the task to another group (a new row): the focus follows it there.
  const pickDue = (value: string) => {
    setDating(null);
    if (value !== (t.due ?? '')) update(t.id, { due: value || undefined });
    focusDueButton(t.id);
  };
  const overdue = !t.done && !!t.due && t.due < todayKey();
  const canEdit = editable && !t.done;
  const hasReminder = !!t.due && !!t.reminders?.length;

  // Back to the title after Enter or Escape, or the keyboard focus would fall to the top of the page.
  // Not on blur: the focus went elsewhere on purpose (another field…).
  const stopEditing = (refocus: boolean) => {
    setEditing(false);
    if (refocus) setTimeout(() => titleRef.current?.focus(), 0);
  };
  const save = (refocus: boolean) => {
    stopEditing(refocus);
    if (title.trim() && title.trim() !== t.title) update(t.id, { title: title.trim() });
    else setTitle(t.title);
  };

  return (
    <li ref={rowRef} className="group flex min-h-9 items-center gap-2 rounded-lg sm:gap-3 px-1.5 py-1 transition-colors hover:bg-stone-50">
      <button
        data-todo={t.id}
        onClick={() => {
          toggle(t.id);
          refocusTodo(t.id);
        }}
        className={cx(
          'hit flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors',
          justDone ? 'border-emerald-500 bg-emerald-500' : overdue ? 'border-[#d9a19a] hover:border-[#b13428] dark:border-red-300 dark:hover:border-red-600' : 'border-stone-300 hover:border-stone-500',
        )}
        title={t.done ? 'Remettre à faire' : 'Marquer comme faite'}
        aria-label={t.done ? `Remettre « ${t.title} » à faire` : `Cocher « ${t.title} »`}
      >
        {t.done && <Check size={10} strokeWidth={3} className="pop text-white" />}
      </button>
      {preview ? (
        <Link to={`/taches?tache=${t.id}`} className="min-w-0 flex-1 rounded text-[13px] hover:underline pointer-coarse:-my-1 pointer-coarse:py-2" title="Ouvrir dans Tâches">
          <span className={cx('line-clamp-2 break-words', justDone ? 'text-stone-500 line-through decoration-emerald-500/70' : 'text-ink')}>{t.title}</span>
          {justDone && <GoesIn minutes={minutesLeft} />}
        </Link>
      ) : editing ? (
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => save(false)}
          onKeyDown={e => {
            if (e.key === 'Enter') save(true);
            if (e.key === 'Escape') {
              setTitle(t.title);
              stopEditing(true);
            }
          }}
          aria-label="Modifier la tâche"
          className="field h-7 min-w-0 flex-1 px-2"
        />
      ) : (
        <span
          ref={titleRef}
          onDoubleClick={() => canEdit && setEditing(true)}
          {...(canEdit && {
            role: 'button',
            tabIndex: 0,
            'aria-label': `Renommer « ${t.title} »`,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key !== 'Enter' && e.key !== 'F2') return;
              e.preventDefault();
              setEditing(true);
            },
          })}
          // As tall as the row on touch screens (36 px), the clamped text inside.
          className={cx('flex min-w-0 flex-1 items-center rounded text-[13px] pointer-coarse:-my-1 pointer-coarse:self-stretch pointer-coarse:py-1', 'text-ink')}
          title={canEdit ? 'Double-clic pour renommer' : t.title}
        >
          <span className="min-w-0">
            <span className={cx('line-clamp-2 break-words', justDone && 'text-stone-500 line-through decoration-emerald-500/70')}>{t.title}</span>
            {justDone && <GoesIn minutes={minutesLeft} />}
          </span>
        </span>
      )}
      {isTourTodo(t.title) && !t.done && (
        <button type="button" onClick={startTour} className="btn-primary h-7 shrink-0 px-2.5 text-[12px] pointer-coarse:h-9">
          Lancer
        </button>
      )}
      {canEdit && !isTourTodo(t.title) && (
        <button
          type="button"
          onClick={() => setOpenDialog('edit')}
          className="icon-btn touch-show h-9 w-9 shrink-0 opacity-0 sm:h-6 sm:w-6 group-hover:opacity-100 focus-visible:opacity-100"
          title="Modifier"
          aria-label={`Modifier «\u00a0${t.title}\u00a0»`}
        >
          <Pencil size={13} />
        </button>
      )}
      {canEdit && !isTourTodo(t.title) && (
        <button
          type="button"
          onClick={() => setOpenDialog('remind')}
          className={cx(
            'hit flex shrink-0 items-center gap-1 rounded-md text-[11.5px]',
            // On a phone the empty bell, empty date and bin make way for the title: the pencil does all three.
            hasReminder ? 'px-1 py-0.5 font-medium text-brand-600 hover:bg-stone-100' : 'icon-btn touch-show h-9 w-9 opacity-0 max-sm:hidden sm:h-6 sm:w-6 group-hover:opacity-100 focus-visible:opacity-100',
          )}
          title={hasReminder ? 'Changer le rappel' : 'Me le rappeler'}
          aria-label={hasReminder ? `Changer le rappel de «\u00a0${t.title}\u00a0»` : `Me rappeler «\u00a0${t.title}\u00a0»`}
        >
          {hasReminder ? <BellRing size={13} /> : <Bell size={13} />}
          {hasReminder && t.time && <span className="tabular">{t.time.replace(':', 'h').replace(/h00$/, 'h').replace(/^0(?=\d)/, '')}</span>}
        </button>
      )}
      {openDialog && (
        <TaskDialog
          todo={t}
          remind={openDialog === 'remind'}
          onClose={() => {
            setOpenDialog(null);
            refocusTodo(t.id);
          }}
          onDelete={async () => {
            if (!(await confirmRemove(t))) return refocusTodo(t.id);
            focusAfterRemoval(rowRef.current, true);
            removeWithUndo([remove(t.id)].filter(x => !!x));
          }}
        />
      )}
      {/* The tour task has « Lancer » in that column instead (no deadline to give it). */}
      {!t.done && editable && !(isTourTodo(t.title) && !t.due) ? (
        <>
          <button
            data-due={t.id}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={!!dating}
            onClick={e => setDating(dating ? null : e.currentTarget)}
            className={cx(
              // Same width with or without a date: the reminder bells stay in one column.
              'hit min-w-[58px] shrink-0 rounded-md',
              t.due ? 'px-1 py-0.5 text-right hover:bg-stone-100' : 'icon-btn touch-show h-9 w-9 opacity-0 max-sm:hidden sm:h-6 sm:w-6 group-hover:opacity-100 focus-visible:opacity-100',
            )}
            title={t.due ? 'Changer l’échéance' : 'Ajouter une échéance'}
            aria-label={t.due ? `Changer l’échéance de «\u00a0${t.title}\u00a0» (${dueText(t.due, overdue)})` : `Ajouter une échéance à «\u00a0${t.title}\u00a0»`}
          >
            {t.due ? <DueLabel due={t.due} short={overdue} /> : <CalendarPlus size={13} />}
          </button>
          {dating && <DatePopover anchor={dating} value={t.due ?? ''} clearable label={`Échéance de « ${t.title} »`} onPick={pickDue} onClose={() => setDating(null)} />}
        </>
      ) : (
        t.due && !t.done && <DueLabel due={t.due} />
      )}
      {!preview && <button
        data-remove
        onClick={async e => {
          const row = e.currentTarget.closest('li');
          if (!(await confirmRemove(t))) return;
          removeWithUndo([remove(t.id)].filter(x => !!x));
          focusAfterRemoval(row, true);
        }}
        className="icon-btn touch-show h-9 w-9 opacity-0 max-sm:hidden sm:h-6 sm:w-6 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-600" title="Supprimer" aria-label={`Supprimer « ${t.title} »`}>
        <Trash2 size={13} />
      </button>}
    </li>
  );
}

function QuickAdd() {
  const add = useTodos(s => s.add);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [dueMenu, setDueMenu] = useState<HTMLElement | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!title.trim()) return;
    add(title, due || undefined);
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
          placeholder="Ajouter une tâche…"
          aria-label="Nouvelle tâche"
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
        className={cx('flex h-10 shrink-0 items-center gap-1.5 rounded-[14px] px-3 text-[12.5px] font-semibold transition-colors', due ? 'bg-brand-50 text-brand-700 hover:bg-brand-100' : 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-ink')}
        title={due ? 'Changer l’échéance' : 'Ajouter une échéance'}
        aria-label={due ? `Échéance : ${fmtDay(fromKey(due), 'EEEE d MMMM')}` : 'Ajouter une échéance'}
      >
        <CalendarPlus size={15} />
        <span className="first-letter:uppercase max-sm:sr-only">{due ? fmtDay(fromKey(due), 'EEE d MMM') : 'Échéance'}</span>
      </button>
      {dueMenu && (
        <DatePopover
          anchor={dueMenu}
          value={due}
          min={todayKey()}
          clearable
          label="Échéance de la nouvelle tâche"
          onPick={k => {
            setDue(k);
            setDueMenu(null);
            titleRef.current?.focus();
          }}
          onClose={() => setDueMenu(null)}
        />
      )}
      <button type="button" onClick={submit} disabled={!title.trim()} className="btn h-10 shrink-0 bg-tile-blue px-4 text-white hover:brightness-110 disabled:opacity-50">
        <Plus size={15} strokeWidth={2.4} aria-hidden /> <span className="max-sm:sr-only">Ajouter</span>
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
          { label: 'En retard', items: open.filter(t => t.due && t.due < today) },
          { label: 'Aujourd’hui', items: open.filter(t => t.due === today) },
          { label: 'À venir', items: open.filter(t => t.due && t.due > today) },
          { label: 'Sans échéance', items: open.filter(t => !t.due) },
          { label: 'Faites', items: ticked },
        ]
      : [{ label: '', items: [...openShown, ...tickedShown] }]
  ).filter(g => g.items.length);

  return (
    <div className="flex flex-1 flex-col" data-todolist>
      {!preview && <QuickAdd />}
      {open.length === 0 && <p className={cx('text-[13px] text-stone-500', ticked.length ? 'pt-3' : 'py-5')}>{ticked.length || todos.some(t => t.done) ? 'Tout est coché. Profites-en.' : 'Rien à faire pour l’instant.'}</p>}
      {groups.length > 0 && (
        <div className="mt-2">
          {groups.map(g => (
            <div key={g.label} className={cx(g.label && 'mt-3 first:mt-1')}>
              {g.label && (
                <h2 className={cx('eyebrow mb-0.5 px-1.5', g.label === 'Faites' && 'text-emerald-700 dark:text-emerald-400')} style={g.label === 'En retard' ? { color: OVERDUE } : undefined}>
                  {g.label}
                </h2>
              )}
              <ul className="-mx-1.5">
                {g.items.map(t => (
                  <TodoRow key={t.id} t={t} editable={grouped} preview={preview} now={now} />
                ))}
              </ul>
            </div>
          ))}
          {limit && open.length > openShown.length && (
            <Link to="/taches" className="mt-1 inline-flex items-center gap-0.5 px-0.5 text-[12px] text-stone-500 hover:text-ink pointer-coarse:min-h-9">
              {open.length - openShown.length} autre{open.length - openShown.length > 1 ? 's' : ''} <ChevronRight size={13} />
            </Link>
          )}
        </div>
      )}
      {preview && (
        <Link to="/taches?ajout=1" className="mt-auto inline-flex h-9 items-center gap-1.5 self-start rounded-full px-1.5 pt-2 text-[12.5px] font-semibold text-brand-600 hover:text-brand-700">
          <Plus size={14} aria-hidden /> Ajouter une tâche
        </Link>
      )}
    </div>
  );
}
