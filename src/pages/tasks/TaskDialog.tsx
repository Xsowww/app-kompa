import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { DateField, TimeField } from '../../components/Pickers';
import { Modal } from '../../components/Overlays';
import ReminderPicker from '../../components/ReminderPicker';
import { followMoments, reminderMoment } from '../../lib/reminders';
import { useTodos, type Todo } from '../../store/todos';
import { toast } from '../../store/ui';
import { t } from '../../i18n';

/**
 * « Modifier la tâche » : its title, due day, optional time and reminders. Opened from the bell
 * (`remind`: a reminder is offered straight away) or from the pencil.
 */
export default function TaskDialog({ todo, onClose, remind, onDelete }: { todo: Todo; onClose: () => void; remind?: boolean; onDelete?: () => void }) {
  const [title, setTitle] = useState(todo.title);
  const [due, setDue] = useState(todo.due ?? '');
  const [time, setTime] = useState(todo.time ?? '');
  // A task without reminders yet: the evening before, or 15 min before when it has a time.
  // Not one already past (« la veille à 18h » of a task due today): the moment itself instead.
  const [reminders, setReminders] = useState<number[]>(() => {
    if (todo.reminders) return todo.reminders;
    if (!remind) return [];
    const first = todo.time ? 15 : 900;
    // Never a moment already gone (a task due today, opened after 9:00): the next one still ahead, else none.
    const ahead = (m: number) => reminderMoment(todo.due!, todo.time, m).getTime() > Date.now();
    return !todo.due || ahead(first) ? [first] : ahead(0) ? [0] : [];
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    useTodos.getState().update(todo.id, { title: title.trim(), due: due || undefined, time: due && time ? time : undefined, reminders: due ? reminders : todo.reminders });
    toast(remind && due && reminders.length ? t('Rappel enregistré') : t('Tâche enregistrée'), 'success');
    onClose();
  };

  return (
    <Modal open onClose={onClose} width={420}>
      <form onSubmit={submit}>
        <h3 className="text-[18px]">{t('Modifier la tâche')}</h3>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Tâche')}</span>
          <input autoFocus={!remind} value={title} maxLength={160} onChange={e => setTitle(e.target.value)} aria-label={t('Titre de la tâche')} className="field w-full" />
        </label>
        {/* One under the other at 320 px, where « Lun. 19 oct. » was cut. */}
        <div className="mt-3 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Échéance')}</span>
            <DateField
              value={due}
              onChange={v => {
                // « La veille à 9h » follows the task to its new day.
                if (due && v) setReminders(r => followMoments(r, { date: due, time: time || undefined }, { date: v, time: time || undefined }, r));
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
                if (due && v !== time) setReminders(r => followMoments(r, { date: due, time: time || undefined }, { date: due, time: v || undefined }, v ? [15] : [900]));
                setTime(v);
              }}
              className="w-full"
            />
          </div>
        </div>
        <ReminderPicker value={reminders} onChange={setReminders} timed={!!time} date={due || undefined} time={time || undefined} disabled={due ? undefined : t('Choisis d’abord une échéance.')} />
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {onDelete && (
            <button type="button" className="btn-ghost mr-auto text-red-600 hover:text-red-700" onClick={() => (onClose(), onDelete())}>
              <Trash2 size={15} /> {t('Supprimer')}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('Annuler')}
          </button>
          <button type="submit" className="btn-primary" disabled={!title.trim()}>
            {t('Enregistrer')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
