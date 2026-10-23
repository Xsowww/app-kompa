import { useRef, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { DateField, TimeField } from '../../components/Pickers';
import { Modal } from '../../components/Overlays';
import Field from '../../components/Field';
import ReminderPicker from '../../components/ReminderPicker';
import { followMoments } from '../../lib/reminders';
import { useTodos, type Todo } from '../../store/todos';
import { toast } from '../../store/ui';
import { t } from '../../i18n';

/**
 * « Modifier la tâche » : its title, due day, optional time and reminders. Opened from the pencil, or from
 * the bell of a task that has reminders (`remind`: about them, the title not focused).
 * No `todo`: « Nouvelle tâche », from the « + » button (pages/tasks/TasksPage).
 */
export default function TaskDialog({ todo, onClose, remind, onDelete }: { todo?: Todo; onClose: () => void; remind?: boolean; onDelete?: () => void }) {
  const [title, setTitle] = useState(todo?.title ?? '');
  const [due, setDue] = useState(todo?.due ?? '');
  const [time, setTime] = useState(todo?.time ?? '');
  const [reminders, setReminders] = useState<number[]>(todo?.reminders ?? []);

  // The title is required: said when it is emptied and left, or at the submit (the focus goes back to it).
  const [titleError, setTitleError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError(t('Donne un titre.'));
      return titleRef.current?.focus();
    }
    const { add, update } = useTodos.getState();
    const id = todo?.id ?? add(title, due || undefined, time || undefined).id;
    update(id, { title: title.trim(), due: due || undefined, time: due && time ? time : undefined, reminders: due ? reminders : todo?.reminders });
    toast(remind && due && reminders.length ? t('Rappel enregistré') : t('Tâche enregistrée'), 'success');
    onClose();
  };

  return (
    <Modal open onClose={onClose} width={420}>
      <form onSubmit={submit}>
        <h3 className="text-[18px]">{todo ? t('Modifier la tâche') : t('Nouvelle tâche')}</h3>
        <Field className="mt-4" label={t('Tâche')} error={titleError}>
          <input
            ref={titleRef}
            autoFocus={!remind}
            value={title}
            maxLength={160}
            onChange={e => (setTitle(e.target.value), e.target.value.trim() && setTitleError(''))}
            onBlur={() => (todo || title) && !title.trim() && setTitleError(t('Donne un titre.'))}
            aria-label={t('Titre de la tâche')}
            className="field w-full"
          />
        </Field>
        {/* One under the other at 320 px, where « Lun. 19 oct. » was cut. */}
        <div className="mt-4 grid grid-cols-1 gap-x-2 gap-y-4 min-[360px]:grid-cols-2">
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
        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {onDelete && (
            <button type="button" className="btn-ghost mr-auto text-red-600 hover:text-red-700" onClick={() => (onClose(), onDelete())}>
              <Trash2 size={15} /> {t('Supprimer')}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('Annuler')}
          </button>
          <button type="submit" className="btn-primary">
            {t('Enregistrer||sauver')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
