import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Flag, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { useNotes } from '../../store/notes';
import { catOf, allCategories, guessCategory, type CalendarEvent, type EventCategory } from '../../store/calendar';
import { confirmRemoveEvent, useCalendarSource } from './source';
import PeoplePicker from './PeoplePicker';
import { useSettings } from '../../store/settings';
import { toast } from '../../store/ui';
import { WORDS } from '../../lib/usage';
import { cx } from '../../lib/utils';
import { NewCategory } from './CategoriesDialog';
import ReminderPicker from '../../components/ReminderPicker';
import { DateField, TimeField } from '../../components/Pickers';
import { eventReminders, followMoments } from '../../lib/reminders';

interface Props {
  event?: CalendarEvent;
  date: string;
  /** Prefilled times for a new event (click on the day view). */
  start?: string;
  end?: string;
  onClose: () => void;
  /** After « Ajouter » / « Enregistrer », with the saved event (the calendar goes to its day). */
  onSaved?: (ev: Pick<CalendarEvent, 'date' | 'category' | 'important'>) => void;
}

export default function EventForm({ event, date, start: initialStart, end: initialEnd, onClose, onSaved }: Props) {
  // My calendar or a shared one (no « important », reminders or my own categories there).
  const { add, update, remove, shared } = useCalendarSource();
  const [title, setTitle] = useState(event?.title ?? '');
  const [day, setDay] = useState(event?.date ?? date);
  const [start, setStart] = useState(event?.start ?? initialStart ?? '');
  const [end, setEnd] = useState(event?.end ?? initialEnd ?? '');
  const [category, setCategory] = useState<EventCategory | null>(event?.category ?? null);
  const [details, setDetails] = useState(event?.details ?? '');
  const [important, setImportant] = useState(!!event?.important);
  // Shared calendar: who it is for (none: everyone).
  const [people, setPeople] = useState<string[]>(event?.people ?? []);
  // undefined = not chosen: the usual reminder (Profil › Notifications) for an event with a time.
  const [chosen, setChosen] = useState<number[] | undefined>(event?.reminders);
  const defaults = useSettings(s => s.defaultReminders);
  const reminders = eventReminders({ reminders: chosen, start, externalId: event?.externalId }, defaults);
  const mine = useSettings(s => s.customCategories);
  const custom = shared ? [] : mine;
  const words = WORDS[useSettings(s => s.usage)] ?? WORDS.etudes;
  const [creating, setCreating] = useState(false);
  const effective = category ?? guessCategory(title, !!start);
  const notes = useNotes(s => s.notes);
  const linked = event ? notes.filter(n => n.links?.some(l => l.kind === 'event' && l.id === event.id)) : [];

  const timeError = !!start && !!end && end <= start;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !day || (end && !start) || timeError) return;
    // An end without a start can't be sent: the start field is required then (see below).
    const data = { title: title.trim(), date: day, start: start || undefined, end: start && end ? end : undefined, category: effective, details: details.trim() || undefined, important: important || undefined, reminders: chosen, ...(shared && { people }) };
    if (event) update(event.id, data);
    else add(data);
    toast(`${event ? 'Enregistré' : 'Ajouté'} : ${data.title}`, 'success');
    onSaved?.(data);
    onClose();
  };

  return (
    <Modal open onClose={onClose} width={460}>
      <form onSubmit={submit}>
        <h3 className="text-[15px] font-semibold">{event ? 'Modifier l’événement' : 'Nouvel événement'}</h3>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} aria-label="Titre de l’événement" placeholder={`Titre (ex. ${words.titleExample})`} className="field mt-4 h-10 w-full text-[14px]" />

        <p className="mb-2 mt-4 text-[12px] font-medium text-stone-600">Catégorie</p>
        <div className="flex flex-wrap gap-2">
          {allCategories(custom).map(k => {
            const c = catOf(k);
            const active = effective === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCategory(k)}
                className={cx('flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors pointer-coarse:h-9', active ? 'border-stone-300 bg-stone-50 text-ink' : 'border-stone-200 text-stone-500 hover:bg-stone-50')}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                {c.label}
              </button>
            );
          })}
          {!shared && <button
            type="button"
            onClick={() => setCreating(v => !v)}
            aria-expanded={creating}
            className="flex h-8 items-center gap-1 rounded-md border border-dashed border-stone-300 px-2.5 text-[13px] pointer-coarse:h-9 text-stone-500 transition-colors hover:border-stone-400 hover:text-ink"
          >
            <Plus size={14} /> Nouvelle
          </button>}
        </div>
        {creating && (
          <div className="mt-2.5 rounded-lg bg-stone-50 p-3">
            <NewCategory
              autoFocus
              onCreated={c => {
                setCategory(c.id);
                setCreating(false);
              }}
            />
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <span className="mb-1.5 block text-[12px] font-medium text-stone-600">Jour</span>
            <DateField
              value={day}
              onChange={v => {
                // « La veille à 9h » follows the event to its new day.
                if (chosen && day && v) setChosen(followMoments(chosen, { date: day, time: start || undefined }, { date: v, time: start || undefined }, chosen));
                setDay(v);
              }}
              label="Jour de l’événement"
              className="w-full"
            />
          </div>
          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-stone-600">Début</span>
            <TimeField
              value={start}
              label="Heure de début"
              placeholder="Sans heure"
              clearable
              invalid={!!end && !start}
              onChange={v => {
                // « 15 min avant » follows the new time, « La veille à 9h » stays at 9:00 (lib/reminders).
                if (chosen && day && v !== start) setChosen(followMoments(chosen, { date: day, time: start || undefined }, { date: day, time: v || undefined }, v ? defaults : [0]));
                setStart(v);
              }}
              className="w-full"
            />
          </div>
          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-stone-600">Fin</span>
            <TimeField value={end} onChange={setEnd} label="Heure de fin" placeholder="Facultatif" clearable invalid={timeError} className="w-full" />
          </div>
        </div>
        {(timeError || (end && !start)) && (
          <p className="mt-1.5 text-[12.5px] text-red-600">{end && !start ? 'Indique le début, ou efface la fin.' : 'La fin est avant le début.'}</p>
        )}

        {/* What makes it a « big day » for the home page and Kompaly, whatever its category. */}
        {!shared && <button
          type="button"
          onClick={() => setImportant(v => !v)}
          aria-pressed={important}
          className={cx(
            'mt-3 flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors',
            important ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300' : 'border-stone-200 text-stone-600 hover:bg-stone-50',
          )}
        >
          <Flag size={14} className={important ? 'fill-current' : ''} />
          {important ? 'Important' : 'Marquer comme important'}
        </button>}

        {!shared && <ReminderPicker value={reminders} onChange={setChosen} timed={!!start} date={day || undefined} time={start || undefined} />}

        {shared && shared.people.length > 1 && <PeoplePicker people={shared.people} value={people} onChange={setPeople} what="l’événement" />}
        <textarea value={details} onChange={e => setDetails(e.target.value)} placeholder={`Notes (${words.notesExample})`} aria-label="Notes" rows={3} className="field mt-3 h-auto w-full resize-none py-2" />

        {linked.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[12px] font-medium text-stone-600">Notes liées</p>
            <ul className="-mx-1.5">
              {linked.map(n => (
                <li key={n.id}>
                  <Link to={`/notes?note=${n.id}`} className="flex h-8 items-center gap-2 rounded-md px-1.5 text-[13px] text-stone-700 transition-colors hover:bg-stone-50 hover:text-ink">
                    <FileText size={14} className="shrink-0 text-stone-400" />
                    <span className="truncate">{n.title || 'Sans titre'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          {event && (
            <button
              type="button"
              className="btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={async () => {
                if (!(await confirmRemoveEvent(event, shared))) return;
                remove(event.id);
                onClose();
              }}
            >
              <Trash2 size={15} /> <span className="max-sm:sr-only">Supprimer</span>
            </button>
          )}
          <button type="button" className="btn-secondary ml-auto" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={!title.trim() || (!!end && !start) || timeError}>
            {event ? 'Enregistrer' : 'Ajouter'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
