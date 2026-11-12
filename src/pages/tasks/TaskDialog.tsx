import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarClock, CalendarDays, CalendarPlus, Trash2 } from 'lucide-react';
import { DateField, SelectField, TimeField } from '../../components/Pickers';
import { softKeyboard } from '../../lib/keyboard';
import { Modal } from '../../components/Overlays';
import Field from '../../components/Field';
import ReminderPicker from '../../components/ReminderPicker';
import { followMoments, taskReminders } from '../../lib/reminders';
import { useTodos, type Todo } from '../../store/todos';
import { getSettings } from '../../store/settings';
import { TASK_REPEATS, type TaskRepeat } from '../../lib/taskRepeat';
import { toast } from '../../store/ui';
import { fmtDay, fromKey, todayKey } from '../../lib/dates';
import { LateBadge } from './LateBadge';
import { postponedToast, tomorrowKey } from './postpone';
import { t } from '../../i18n';

/**
 * « Modifier la tâche » : its title, due day, optional time, repeat and reminders. Opened from the pencil, or from
 * the bell of a task that has reminders (`remind`: about them, the title not focused).
 * No `todo`: « Nouvelle tâche », from the « + » button (pages/tasks/TasksPage).
 */
export default function TaskDialog({ todo, onClose, remind, onDelete }: { todo?: Todo; onClose: () => void; remind?: boolean; onDelete?: () => void }) {
  const [title, setTitle] = useState(todo?.title ?? '');
  const [due, setDue] = useState(todo?.due ?? '');
  const [time, setTime] = useState(todo?.time ?? '');
  const [reminders, setReminders] = useState<number[]>(todo?.reminders ?? []);
  const [repeat, setRepeat] = useState<TaskRepeat | ''>(todo?.repeat ?? '');

  // The title is required: said when it is emptied and left, or at the submit (the focus goes back to it).
  const [titleError, setTitleError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  // The title is focused (the keyboard opened) for a new task, or on a computer; a task opened to be changed on a
  // phone keeps the keyboard closed (often it is for its day or a reminder): the window's title gets the focus,
  // before the window gives it to its first field (layout effects run before Modal's effect).
  const [focusTitle] = useState(() => !remind && (!todo || !softKeyboard()));
  const headRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (!focusTitle) headRef.current?.focus({ preventScroll: true });
  }, [focusTitle]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError(t('Donne un titre.'));
      return titleRef.current?.focus();
    }
    const { add, update } = useTodos.getState();
    const id = todo?.id ?? add(title, due || undefined, time || undefined).id;
    update(id, { title: title.trim(), due: due || undefined, time: due && time ? time : undefined, reminders: due ? reminders : todo?.reminders, repeat: (due && repeat) || undefined });
    toast(remind && due && reminders.length ? t('Rappel enregistré') : t('Tâche enregistrée'), 'success');
    onClose();
  };

  // Late (its day, as in the form, is past): said at the top, with the two ways to put it off.
  const late = !!todo && !todo.done && !!due && due < todayKey();
  /** « Reporter à aujourd'hui / demain »: what is in the form, saved on that day (its reminders follow it), then closed. */
  const postpone = (day: string) => {
    if (!todo) return;
    if (!title.trim()) {
      setTitleError(t('Donne un titre.'));
      return titleRef.current?.focus();
    }
    const before = { due: todo.due, time: todo.time, reminders: todo.reminders };
    const moved = followMoments(reminders, { date: due, time: time || undefined }, { date: day, time: time || undefined }, reminders);
    useTodos.getState().update(todo.id, { title: title.trim(), due: day, time: time || undefined, reminders: moved, repeat: repeat || undefined });
    postponedToast([{ title: title.trim() }], day, () => useTodos.getState().update(todo.id, before));
    onClose();
  };

  return (
    <Modal open onClose={onClose} width={420}>
      <form onSubmit={submit}>
        <h3 ref={headRef} tabIndex={-1} className="text-[18px] outline-none">{todo ? t('Modifier la tâche') : t('Nouvelle tâche')}</h3>
        {late && (
          <div data-late-banner className="late-banner mt-3 rounded-2xl p-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <LateBadge due={due} size="md" />
              <span className="late-when text-[12.5px] font-medium">{t('Prévue le {day}', { day: fmtDay(fromKey(due), 'EEEE d MMMM') })}</span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2" role="group" aria-label={t('Reporter')}>
              <span className="late-when text-[12.5px] font-medium" aria-hidden>
                {t('Reporter à')}
              </span>
              <button type="button" className="btn-secondary h-9 flex-1 px-3 text-[13px]" onClick={() => postpone(todayKey())} aria-label={t('Reporter à aujourd’hui')}>
                <CalendarClock size={14} aria-hidden className="shrink-0" /> {t('Aujourd’hui')}
              </button>
              <button type="button" className="btn-secondary h-9 flex-1 px-3 text-[13px]" onClick={() => postpone(tomorrowKey())} aria-label={t('Reporter à demain')}>
                <CalendarPlus size={14} aria-hidden className="shrink-0" /> {t('Demain')}
              </button>
              {/* Another day: the form's own date picker opens (its reminders follow, as with Aujourd'hui / Demain). */}
              <button type="button" className="btn-secondary h-9 flex-1 px-3 text-[13px]" onClick={() => document.querySelector<HTMLElement>('[data-due-field] button')?.click()} aria-label={t('Reporter à un autre jour')}>
                <CalendarDays size={14} aria-hidden className="shrink-0" /> {t('Autre jour')}
              </button>
            </div>
          </div>
        )}
        <Field className="mt-4" label={t('Tâche')} error={titleError}>
          <input
            ref={titleRef}
            autoFocus={focusTitle}
            value={title}
            maxLength={160}
            onChange={e => (setTitle(e.target.value), e.target.value.trim() && setTitleError(''))}
            onBlur={() => (todo || title) && !title.trim() && setTitleError(t('Donne un titre.'))}
            aria-label={t('Titre de la tâche')}
            className="field w-full"
          />
        </Field>
        {/* One under the other below 390 px, where « Lun. 19 oct. » and « Dans la journée » were cut. */}
        <div className="mt-4 grid grid-cols-1 gap-x-2 gap-y-4 min-[390px]:grid-cols-2 big-text:max-sm:grid-cols-1">
          <div data-due-field>
            <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Échéance')}</span>
            <DateField
              value={due}
              onChange={v => {
                // « La veille à 9h » follows the task to its new day.
                if (due && v) setReminders(r => followMoments(r, { date: due, time: time || undefined }, { date: v, time: time || undefined }, r));
                // A first due day: the usual reminders of a task (Réglages › Notifications), shown here to change.
                else if (!due && v && !reminders.length) setReminders(taskReminders(v, time || undefined, new Date(), getSettings().defaultTaskReminders));
                setDue(v);
              }}
              label={t('Échéance')}
              clearable
              className="w-full"
            />
          </div>
          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Heure (facultatif)')}</span>
            <TimeField
              value={time}
              disabled={!due}
              clearable
              label={t('Heure de l’échéance')}
              placeholder={t('Dans la journée')}
              onChange={v => {
                // None left that can follow: the usual ones of a task (« 1 h avant » with a time), never another fixed « 15 min ».
                if (due && v !== time) setReminders(r => followMoments(r, { date: due, time: time || undefined }, { date: due, time: v || undefined }, taskReminders(due, v || undefined, new Date(), [900, 0])));
                setTime(v);
              }}
              className="w-full"
            />
          </div>
        </div>
        {/* Ticked, a repeating task comes back with its next due day (store/todos). */}
        <div className="mt-4">
          <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Répéter')}</span>
          <SelectField<TaskRepeat | ''>
            className="w-full"
            label={t('Répéter')}
            value={due ? repeat : ''}
            disabled={!due}
            options={[{ value: '', label: t('Ne se répète pas') }, ...TASK_REPEATS.map(r => ({ value: r.key, label: r.label }))]}
            onChange={setRepeat}
          />
        </div>
        <ReminderPicker value={reminders} onChange={setReminders} timed={!!time} date={due || undefined} time={time || undefined} disabled={due ? undefined : t('Choisis d’abord une échéance.')} item={{ kind: 'task', id: todo?.id, title }} />
        <div className="modal-foot max-[359px]:gap-1.5">
          {onDelete && (
            // Phones: the bin alone, so that « Annuler » and « Enregistrer » stay on one line beside it.
            <button type="button" className="btn-ghost mr-auto text-red-600 hover:text-red-700 max-sm:w-10 max-sm:px-0" onClick={() => (onClose(), onDelete())} title={t('Supprimer')}>
              <Trash2 size={15} aria-hidden /> <span className="max-sm:sr-only">{t('Supprimer')}</span>
            </button>
          )}
          <button type="button" className="btn-secondary max-sm:px-3" onClick={onClose}>
            {t('Annuler')}
          </button>
          <button type="submit" className="btn-primary max-sm:px-3">
            {t('Enregistrer||sauver')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
