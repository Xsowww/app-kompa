import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, FileText, Flag, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { useNotes } from '../../store/notes';
import { catOf, allCategories, guessCategory, type CalendarEvent, type EventCategory } from '../../store/calendar';
import { confirmRemoveEvent, useCalendarSource } from './source';
import PeoplePicker from './PeoplePicker';
import { useSettings } from '../../store/settings';
import { toast } from '../../store/ui';
import { AGENDA_EXAMPLES, WORDS } from '../../lib/usage';
import { cx } from '../../lib/utils';
import { NewCategory } from './CategoriesDialog';
import ReminderPicker from '../../components/ReminderPicker';
import { DateField, TimeField } from '../../components/Pickers';
import { FieldError } from '../../components/Field';
import { fmt, fromKey, parseQuickAdd } from '../../lib/dates';
import { eventReminders, followMoments } from '../../lib/reminders';
import { t } from '../../i18n';

const NONE: number[] = [];

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
  // My calendar or a shared one (no « important » there; its own categories, and reminders for each member it is for).
  const { add, update, remove, shared, categories: custom } = useCalendarSource();
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
  const mine = useSettings(s => s.defaultReminders);
  // My usual reminder isn't imposed on the members of a shared calendar: none until one is chosen.
  const defaults = shared ? NONE : mine;
  const reminders = eventReminders({ reminders: chosen, start, externalId: event?.externalId }, defaults);
  const words = { ...(WORDS[useSettings(s => s.usage)] ?? WORDS.etudes), ...(shared && AGENDA_EXAMPLES) };
  const [creating, setCreating] = useState(false);
  // A new event: « Dentiste demain 16h » fills the day and the times (as the calendar's bar), unless they were set by
  // hand; saved as « Dentiste ». Editing one leaves its title as it is.
  const parsed = !event && title.trim() ? parseQuickAdd(title) : null;
  const understood = !!parsed && !parsed.impossible && !!(parsed.date || parsed.start || parsed.important);
  const cleanTitle = understood ? parsed.title : title.trim();
  const touched = useRef({ day: false, start: false, end: false, important: false });
  const onTitle = (v: string) => {
    setTitle(v);
    if (v.trim()) setTitleError('');
    if (event) return;
    const p = v.trim() ? parseQuickAdd(v) : null;
    const ok = p && !p.impossible ? p : null;
    const was = touched.current;
    if (!was.day) setDay(ok?.date ?? date);
    if (!was.start) setStart(ok?.start ?? initialStart ?? '');
    if (!was.end) setEnd(ok?.end ?? (ok?.start ? '' : (initialEnd ?? '')));
    if (!was.important) setImportant(!!ok?.important);
  };
  const effective = category ?? guessCategory(cleanTitle || title, !!start, custom);
  const notes = useNotes(s => s.notes);
  const linked = event ? notes.filter(n => n.links?.some(l => l.kind === 'event' && l.id === event.id)) : [];

  const timeError = !!start && !!end && end <= start;
  // The title is required: said when leaving it empty after typing, or at the submit (the focus goes back to it).
  const [titleError, setTitleError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const timeMsg = end && !start ? t('Indique le début, ou efface la fin.') : timeError ? t('La fin est avant le début.') : '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!cleanTitle) {
      setTitleError(understood ? t('Ajoute un titre avant le jour et l’heure.') : t('Donne un titre.'));
      return titleRef.current?.focus();
    }
    if (!day || timeMsg) return;
    // An end without a start can't be sent: the start field is required then (see below).
    const data = { title: cleanTitle, date: day, start: start || undefined, end: start && end ? end : undefined, category: effective, details: details.trim() || undefined, important: important || undefined, reminders: chosen, ...(shared && { people }) };
    if (event) update(event.id, data);
    else add(data);
    toast(event ? t('Enregistré : {title}', { title: data.title }) : t('Ajouté : {title}', { title: data.title }), 'success');
    onSaved?.(data);
    onClose();
  };

  return (
    <Modal open onClose={onClose} width={460}>
      <form onSubmit={submit}>
        <h3 className="text-[15px] font-semibold">{event ? t('Modifier l’événement') : t('Nouvel événement')}</h3>
        <input
          ref={titleRef}
          autoFocus
          value={title}
          onChange={e => onTitle(e.target.value)}
          onBlur={() => title && !title.trim() && setTitleError(t('Donne un titre.'))}
          aria-label={t('Titre de l’événement')}
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? 'event-title-err' : undefined}
          placeholder={t('Titre (ex. {example})', { example: words.titleExample })}
          className="field mt-4 h-10 w-full text-[14px]"
        />
        <FieldError id="event-title-err">{titleError}</FieldError>
        {understood && !titleError && (
          <p className="mt-1.5 text-[12px] text-stone-500" aria-live="polite">
            {t('Compris : {what}', { what: [parsed.title && `« ${parsed.title} »`, parsed.date && fmt(fromKey(parsed.date), 'EEEE d MMMM'), parsed.start && (parsed.end ? `${parsed.start} – ${parsed.end}` : parsed.start), parsed.important && t('important')].filter(Boolean).join(' · ') })}
          </p>
        )}

        <p className="mb-1.5 mt-4 text-[12px] font-medium text-stone-600">{t('Catégorie')}</p>
        <div className="flex flex-wrap gap-2">
          {allCategories(custom).map(k => {
            const c = catOf(k);
            const active = effective === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCategory(k)}
                aria-pressed={active}
                // The chosen one in its own colours, with a tick: seen at a glance (and not by colour alone).
                className={cx('hit flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors pointer-coarse:h-9', active ? 'font-semibold' : 'border-stone-200 text-stone-500 hover:bg-stone-50')}
                style={active ? { borderColor: c.color, background: c.soft, color: c.text } : undefined}
              >
                {active ? <Check size={13} strokeWidth={3} aria-hidden /> : <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />}
                {c.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCreating(v => !v)}
            aria-expanded={creating}
            className="hit flex h-8 items-center gap-1 rounded-md border border-dashed border-stone-300 px-2.5 text-[13px] pointer-coarse:h-9 text-stone-500 transition-colors hover:border-stone-400 hover:text-ink"
          >
            <Plus size={14} /> {t('Nouvelle')}
          </button>
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

        {/* At 320 px one field per line: « Sans heure » was cut in two columns. */}
        <div className="mt-4 grid grid-cols-1 gap-x-2 gap-y-4 min-[360px]:grid-cols-2 sm:grid-cols-3">
          <div className="min-[360px]:col-span-2 sm:col-span-1">
            <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Jour')}</span>
            <DateField
              value={day}
              onChange={v => {
                // « La veille à 9h » follows the event to its new day.
                if (chosen && day && v) setChosen(followMoments(chosen, { date: day, time: start || undefined }, { date: v, time: start || undefined }, chosen));
                setDay(v);
                touched.current.day = true;
              }}
              label={t('Jour de l’événement')}
              className="w-full"
            />
          </div>
          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Début')}</span>
            <TimeField
              value={start}
              label={t('Heure de début')}
              placeholder={t('Sans heure')}
              clearable
              invalid={!!end && !start}
              describedBy={end && !start ? 'event-time-err' : undefined}
              onChange={v => {
                // « 15 min avant » follows the new time, « La veille à 9h » stays at 9:00 (lib/reminders).
                if (chosen && day && v !== start) setChosen(followMoments(chosen, { date: day, time: start || undefined }, { date: day, time: v || undefined }, v ? defaults : [0]));
                setStart(v);
                touched.current.start = true;
              }}
              className="w-full"
            />
          </div>
          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Fin')}</span>
            <TimeField value={end} onChange={v => ((touched.current.end = true), setEnd(v))} label={t('Heure de fin')} placeholder={t('Facultatif')} clearable invalid={timeError} describedBy={timeError ? 'event-time-err' : undefined} className="w-full" />
          </div>
        </div>
        {/* Said as soon as the times are chosen, under them. */}
        <FieldError id="event-time-err">{timeMsg}</FieldError>

        {/* What makes it a « big day » for the home page and Kompaly, whatever its category. */}
        {!shared && <button
          type="button"
          onClick={() => ((touched.current.important = true), setImportant(v => !v))}
          aria-pressed={important}
          className={cx(
            'hit mt-4 flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors',
            important ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300' : 'border-stone-200 text-stone-600 hover:bg-stone-50',
          )}
        >
          <Flag size={14} className={important ? 'fill-current' : ''} />
          {important ? t('Important') : t('Marquer comme important')}
        </button>}

        <ReminderPicker value={reminders} onChange={setChosen} timed={!!start} date={day || undefined} time={start || undefined} />
        {shared && reminders.length > 0 && (
          <p className="mt-1.5 text-[12px] text-stone-500">{people.length ? t('Envoyé à chaque personne choisie ci-dessous.') : t('Envoyé à chaque membre de l’agenda.')}</p>
        )}

        {shared && shared.people.length > 1 && <PeoplePicker people={shared.people} value={people} onChange={setPeople} what={t('l’événement')} />}
        <textarea value={details} onChange={e => setDetails(e.target.value)} placeholder={t('Notes ({example})', { example: words.notesExample })} aria-label={t('Notes')} rows={3} className="field mt-4 h-auto w-full resize-none py-2" />

        {linked.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[12px] font-medium text-stone-600">{t('Notes liées')}</p>
            <ul className="-mx-1.5">
              {linked.map(n => (
                <li key={n.id}>
                  <Link to={`/notes?note=${n.id}`} className="flex h-8 items-center pointer-coarse:h-11 gap-2 rounded-md px-1.5 text-[13px] text-stone-700 transition-colors hover:bg-stone-50 hover:text-ink">
                    <FileText size={14} className="shrink-0 text-stone-400" />
                    <span className="truncate">{n.title || t('Sans titre')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex items-center gap-2">
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
              <Trash2 size={15} /> <span className="max-sm:sr-only">{t('Supprimer')}</span>
            </button>
          )}
          <button type="button" className="btn-secondary ml-auto" onClick={onClose}>
            {t('Annuler')}
          </button>
          {/* Not disabled for an empty title: the submit says what is missing, under the field. */}
          <button type="submit" className="btn-primary" disabled={!!timeMsg}>
            {event ? t('Enregistrer||sauver') : t('Ajouter')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
