import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, FileText, Flag, Link2, Plus, Trash2 } from 'lucide-react';
import SeriesIcon from './SeriesIcon';
import { Modal } from '../../components/Overlays';
import { ReportDialog } from '../../components/FeedbackDialogs';
import { useNotes } from '../../store/notes';
import { catOf, allCategories, guessCategory, isBigEvent, nextInSeries, type CalendarEvent, type EventCategory } from '../../store/calendar';
import { askSeriesScope, changedFields, removeEvent, useCalendarSource } from './source';
import PeoplePicker from './PeoplePicker';
import { useSettings } from '../../store/settings';
import { toast } from '../../store/ui';
import { AGENDA_EXAMPLES, WORDS } from '../../lib/usage';
import { cx } from '../../lib/utils';
import { NewCategory } from './CategoriesDialog';
import ReminderPicker from '../../components/ReminderPicker';
import { DateField, SelectField, TimeField } from '../../components/Pickers';
import { FieldError } from '../../components/Field';
import { fmtDay, fromKey, parseQuickAdd } from '../../lib/dates';
import { cleanReminders, earlyReminders, eventReminders, followMoments, reminderLabel } from '../../lib/reminders';
import { covers } from '../../lib/periods';
import { MAX_SPAN_DAYS, REPEATS, dayShift, defaultUntil, isSpan, repeatDays, shiftKey, spanDays, type Repeat } from '../../lib/repeat';
import { feedLabel, feedOf } from '../../lib/icsFeeds';
import { uid } from '../../lib/utils';
import { t, tn } from '../../i18n';

const NONE: number[] = [];
/** Periods a repeat skips at first (they can be ticked off): the holidays. */
const HOLIDAYS = /vacance|cong[ée]|holiday|vacation|ferien|urlaub|vacacion|vacanz|feri[ea]/i;

interface Props {
  event?: CalendarEvent;
  date: string;
  /** Prefilled times for a new event (click on the day view). */
  start?: string;
  end?: string;
  /** A new event from the calendar's bar: what was typed (« Sport tous les mardis 18h »). */
  title?: string;
  onClose: () => void;
  /** After « Ajouter » / « Enregistrer », with the saved event (the calendar goes to its day). */
  onSaved?: (ev: Pick<CalendarEvent, 'date' | 'category' | 'important'>) => void;
}

/** A reader of a shared calendar: the whole event (place, notes, for whom, reminders), with nothing to change. */
function EventView({ event: ev, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const shared = useCalendarSource().shared!;
  const [reporting, setReporting] = useState(false);
  const c = catOf(ev.category);
  const who = (id: string) => shared.people.find(p => p.id === id)?.name ?? shared.nameOf(id);
  const reminders = ev.reminders ?? [];
  const row = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-[12px] font-medium text-stone-600">{label}</dt>
      <dd className="mt-0.5 text-[13.5px]">{value}</dd>
    </div>
  );
  return (
    <Modal open onClose={onClose} width={460}>
      <h3 className="text-[15px] font-semibold [overflow-wrap:anywhere]">{ev.title}</h3>
      <p className="mt-1 text-[13px] text-stone-600 first-letter:uppercase">
        {fmtDay(fromKey(ev.date), 'EEEE d MMMM')} · {ev.start ? (ev.end ? `${ev.start}\u00a0–\u00a0${ev.end}` : ev.start) : t('Journée')}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[12px] text-stone-500">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
        <span style={{ color: c.text }}>{c.label}</span>
        <SeriesIcon series={ev.series} size={11} />
        <span className="min-w-0 truncate">· {t('par {name}', { name: shared.author(ev.id) })}</span>
      </p>
      <dl className="mt-4 grid gap-3">
        {row(t('Pour qui'), ev.people?.length ? ev.people.map(who).join(', ') : t('Tout le monde'))}
        {reminders.length > 0 &&
          row(
            t('Rappels'),
            <span className="inline-flex items-center gap-1.5">
              <Bell size={12} aria-hidden className="shrink-0 text-stone-500" />
              {reminders.map(m => reminderLabel(m, !!ev.start, ev.date, ev.start)).join(', ')}
            </span>,
          )}
        {ev.details && row(t('Notes'), <span className="block whitespace-pre-line [overflow-wrap:anywhere]">{ev.details}</span>)}
      </dl>
      <div className="mt-6 flex items-center gap-2">
        {!shared.byMe(ev.id) && (
          <button type="button" className="btn-ghost" onClick={() => setReporting(true)} aria-label={t('Signaler « {title} »', { title: ev.title })}>
            <Flag size={15} /> {t('Signaler')}
          </button>
        )}
        <button type="button" className="btn-secondary ml-auto" onClick={onClose}>
          {t('Fermer')}
        </button>
      </div>
      <ReportDialog target={reporting ? { kind: 'event', id: ev.id, title: ev.title } : null} onClose={() => setReporting(false)} />
    </Modal>
  );
}

export default function EventForm(props: Props) {
  const { shared } = useCalendarSource();
  return props.event && shared && !shared.canEdit ? <EventView event={props.event} onClose={props.onClose} /> : <EventEditor {...props} />;
}

function EventEditor({ event, date, start: initialStart, end: initialEnd, title: initialTitle, onClose, onSaved }: Props) {
  // My calendar or a shared one (no « important » there; its own categories, and reminders for each member it is for).
  const source = useCalendarSource();
  const { add, addMany, update, updateSeries, shared, categories: custom, periods, events: allEvents } = source;
  const [title, setTitle] = useState(event?.title ?? initialTitle ?? '');
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
  const feeds = useSettings(s => s.icsFeeds);
  // My usual reminder isn't imposed on the members of a shared calendar: none until one is chosen.
  const defaults = shared ? NONE : mine;
  const words = { ...(WORDS[useSettings(s => s.usage)] ?? WORDS.etudes), ...(shared && AGENDA_EXAMPLES) };
  const [creating, setCreating] = useState(false);
  // A new event: « Dentiste demain 16h » fills the day and the times (as the calendar's bar), unless they were set by
  // hand; saved as « Dentiste ». Editing one leaves its title as it is.
  const touched = useRef({ day: false, start: false, end: false, important: false, repeat: false });
  const parsed = !event && title.trim() ? parseQuickAdd(title) : null;
  const understood = !!parsed && !parsed.impossible && !!(parsed.date || parsed.start || parsed.important);
  // « 31/11 »: said and blocked, unless the day was chosen by hand.
  const [dayByHand, setDayByHand] = useState(false);
  const impossible = !!parsed?.impossible && !dayByHand;
  const cleanTitle = understood ? parsed.title : title.trim();
  // Repeating: my own calendar, a new event (« tous les mardis » in the title chooses « Chaque semaine »).
  const canRepeat = !event;
  const [repeat, setRepeat] = useState<Repeat | ''>(() => (canRepeat && initialTitle && parseQuickAdd(initialTitle).weekly ? 'week' : ''));
  const [until, setUntil] = useState('');
  const lastDay = until || (day ? defaultUntil(day) : '');
  const around = repeat && day ? periods.filter(p => p.start <= lastDay && p.end >= day) : [];
  // Ticked: not on those days (the holidays at first).
  const [skipped, setSkipped] = useState<string[] | null>(null);
  const skipIds = skipped ?? around.filter(p => HOLIDAYS.test(p.title)).map(p => p.id);
  const series = repeat && day ? repeatDays(day, repeat, lastDay, k => periods.some(p => skipIds.includes(p.id) && covers(p, k))) : null;
  // Over several days (a seminar, a trip): one event a day, linked (lib/repeat spanDays). Not with a repeat.
  const canSpan = !event && !repeat;
  const [endDay, setEndDay] = useState<string | null>(null); // null: ends the same day
  const spanning = canSpan && !!endDay && !!day && endDay > day;
  const endDayMsg = canSpan && endDay && day && endDay <= day ? t('Le jour de fin doit être après le jour de début.') : '';
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
    if (canRepeat && !was.repeat) setRepeat(ok?.weekly ? 'week' : '');
  };
  const effective = category ?? guessCategory(cleanTitle || title, !!start, custom);
  // My usual reminder and, for a big day, a week before and the day before (lib/reminders); a shared calendar: the chosen ones.
  const reminders = shared ? (chosen ?? NONE) : eventReminders({ reminders: chosen, date: day, start, externalId: event?.externalId, category: effective, important }, defaults);
  // Becoming a big day with reminders already chosen: the early ones are added (removable).
  const becomeBig = (big: boolean) => {
    if (!shared && big && chosen && day && !isBigEvent({ category: effective, important })) setChosen(cleanReminders([...chosen, ...earlyReminders(day, start || undefined)]));
  };
  const notes = useNotes(s => s.notes);
  // Someone else's event in a shared calendar: it can be reported to the administrator.
  const [reporting, setReporting] = useState(false);
  const linked = event ? notes.filter(n => n.links?.some(l => l.kind === 'event' && l.id === event.id)) : [];

  const timeError = !spanning && !!start && !!end && end <= start;
  // The title is required: said when leaving it empty after typing, or at the submit (the focus goes back to it).
  const [titleError, setTitleError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const timeMsg = end && !start && !spanning ? t('Indique le début, ou efface la fin.') : timeError ? t('La fin est avant le début.') : '';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cleanTitle) {
      setTitleError(understood ? t('Ajoute un titre avant le jour et l’heure.') : t('Donne un titre.'));
      return titleRef.current?.focus();
    }
    if (!day || timeMsg || endDayMsg || impossible || (series && !series.days.length)) return;
    // An end without a start can't be sent: the start field is required then (see below).
    const data = { title: cleanTitle, date: day, start: start || undefined, end: start && end ? end : undefined, category: effective, details: details.trim() || undefined, important: important || undefined, reminders: chosen, ...(shared && { people }) };
    // A shared calendar: only what was changed here, so that what another member changed meanwhile isn't undone.
    const changes: Partial<typeof data> = event && shared ? changedFields(data, event) : data;
    if (event && !Object.keys(changes).length) {
      // Nothing changed: nothing to send.
    } else if (event?.series) {
      const scope = await askSeriesScope(event, 'edit', allEvents);
      if (!scope) return;
      if (scope === 'next' && isSpan(event.series)) {
        // The next days of an event over several days keep their own times and days: only the rest follows.
        const { start: _s, end: _e, date: _d, reminders: _r, ...rest } = changes;
        if (Object.keys(rest).length) updateSeries(event.id, rest);
        if (Object.keys(rest).length < Object.keys(changes).length) update(event.id, changes);
      } else if (scope === 'next') updateSeries(event.id, changes);
      else update(event.id, changes);
    } else if (event) update(event.id, changes);
    else if (series) {
      const id = uid();
      addMany(series.days.map(d => ({ ...data, date: d, series: id })));
    } else if (spanning) {
      const id = `span-${uid()}`;
      // The first day keeps the reminders; the others none (« 15 min avant » 0:00 would ring at midnight).
      addMany(spanDays(day, endDay!, start || undefined, end || undefined).map((p, i) => ({ ...data, ...p, start: p.start, end: p.end, series: id, reminders: i ? [] : data.reminders })));
    } else add(data);
    toast(
      event
        ? t('Enregistré : {title}', { title: data.title })
        : series
          ? t('Ajouté {n} fois, jusqu’au {day}', { n: series.days.length, day: fmtDay(fromKey(series.days.at(-1)!), 'EEEE d MMMM') })
          : spanning
            ? t('Ajouté du {from} au {to}', { from: fmtDay(fromKey(day), 'EEEE d MMMM'), to: fmtDay(fromKey(endDay!), 'EEEE d MMMM') })
          : understood && parsed.weekly
            ? t('Ajouté pour {day}, une seule fois (pas encore de répétition)', { day: fmtDay(fromKey(day), 'EEEE d MMMM') })
            : t('Ajouté : {title}', { title: data.title }),
      'success',
    );
    onSaved?.({ ...data, date: series?.days[0] ?? data.date });
    onClose();
  };

  return (
    <Modal open onClose={onClose} width={460}>
      <form onSubmit={submit}>
        <h3 className="text-[15px] font-semibold">{event ? t('Modifier l’événement') : t('Nouvel événement')}</h3>
        {event && !shared && (f => f && (
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-stone-500">
            <Link2 size={12} aria-hidden />
            <span className="min-w-0 truncate">{t('Vient de l’emploi du temps « {name} » : mis à jour par le lien.', { name: feedLabel(f.name) })}</span>
          </p>
        ))(feedOf(event, feeds))}
        {event?.series && (
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-stone-500">
            <SeriesIcon series={event.series} size={12} />
            {(n =>
              isSpan(event.series)
                ? n
                  ? tn(n, 'Sur plusieurs jours : encore {n} jour après celui-ci', 'Sur plusieurs jours : encore {n} jours après celui-ci')
                  : t('Dernier jour de l’événement')
                : n
                  ? t('Se répète : encore {n} fois après celui-ci', { n })
                  : t('Dernier d’une répétition'))(nextInSeries(event, allEvents).length)}
          </p>
        )}
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
            {/* Only what will be saved: a day or a time changed by hand is no longer the one read in the title. */}
            {t('Compris : {what}', {
              what: [
                parsed.title && t('« {title} »', { title: parsed.title }),
                parsed.date && day === parsed.date && fmtDay(fromKey(parsed.date), 'EEEE d MMMM'),
                parsed.start && start === parsed.start && (parsed.end && end === parsed.end ? `${parsed.start}\u00a0–\u00a0${parsed.end}` : parsed.start),
                parsed.important && important && t('important'),
              ]
                .filter(Boolean)
                .join(' · '),
            })}
          </p>
        )}
        {impossible && !titleError && <p className="mt-1.5 text-[12px] font-medium text-red-600 dark:text-red-400" role="alert">{t('Cette date n’existe pas : corrige-la pour ajouter.')}</p>}

        <p className="mb-1.5 mt-4 text-[12px] font-medium text-stone-600">{t('Catégorie')}</p>
        <div className="flex flex-wrap gap-2">
          {allCategories(custom).map(k => {
            const c = catOf(k);
            const active = effective === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => (becomeBig(k === 'examen'), setCategory(k))}
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
                setDayByHand(true);
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

        {canSpan &&
          (endDay === null ? (
            <button type="button" className="btn-ghost mt-2 h-8 px-2 text-[12.5px]" onClick={() => setEndDay(day ? shiftKey(day, 1) : '')}>
              <Plus size={13} /> {t('Finit un autre jour')}
            </button>
          ) : (
            <div className="mt-3 grid grid-cols-1 items-end gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Jour de fin')}</span>
                <DateField value={endDay} onChange={v => setEndDay(v)} min={day || undefined} max={day ? shiftKey(day, MAX_SPAN_DAYS - 1) : undefined} label={t('Jour de fin de l’événement')} invalid={!!endDayMsg} className="w-full" />
              </div>
              <button type="button" className="btn-ghost h-10 px-2.5 text-[12.5px]" onClick={() => setEndDay(null)}>
                {t('Finit le même jour')}
              </button>
              {endDayMsg ? (
                <FieldError id="event-endday-err">{endDayMsg}</FieldError>
              ) : (
                spanning && <p className="text-[12px] text-stone-500 min-[360px]:col-span-2">{t('{n} jours, du début à la fin.', { n: dayShift(day, endDay!) + 1 })}</p>
              )}
            </div>
          ))}

        {/* What makes it a « big day » for the home page and Kompaly, whatever its category. */}
        {!shared && <button
          type="button"
          onClick={() => ((touched.current.important = true), becomeBig(!important), setImportant(v => !v))}
          aria-pressed={important}
          className={cx(
            'hit mt-4 flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors',
            important ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300' : 'border-stone-200 text-stone-600 hover:bg-stone-50',
          )}
        >
          <Flag size={14} className={important ? 'fill-current' : ''} />
          {important ? t('Important') : t('Marquer comme important')}
        </button>}

        {canRepeat && !spanning && (
          <div className="mt-4">
            <div className="grid grid-cols-1 gap-x-2 gap-y-4 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Répéter')}</span>
                <SelectField<Repeat | ''>
                  className="w-full"
                  label={t('Répéter')}
                  value={repeat}
                  options={[{ value: '', label: t('Ne se répète pas') }, ...REPEATS.map(r => ({ value: r.key, label: r.label }))]}
                  onChange={v => ((touched.current.repeat = true), setRepeat(v))}
                />
              </div>
              {repeat && (
                <div>
                  <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Jusqu’au')}</span>
                  <DateField value={lastDay} onChange={v => v && setUntil(v)} min={day || undefined} label={t('Dernier jour de la répétition')} className="w-full" />
                </div>
              )}
            </div>
            {around.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px] text-stone-600">
                <span>{t('Pas pendant :')}</span>
                {around.map(p => {
                  const on = skipIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSkipped(on ? skipIds.filter(x => x !== p.id) : [...skipIds, p.id])}
                      className={cx('hit flex h-7 items-center gap-1 rounded-md border px-2 font-medium transition-colors', on ? 'border-ink/30 bg-stone-100 text-ink' : 'border-stone-200 text-stone-500 hover:bg-stone-50')}
                    >
                      {on && <Check size={12} strokeWidth={3} aria-hidden />}
                      {p.title}
                    </button>
                  );
                })}
              </div>
            )}
            {series && (
              <p className={cx('mt-1.5 text-[12px]', series.days.length ? 'text-stone-500' : 'font-medium text-red-600 dark:text-red-400')} aria-live="polite">
                {!series.days.length
                  ? t('Aucun jour entre ces dates.')
                  : series.capped
                    ? t('{n} fois au plus : jusqu’au {day}.', { n: series.days.length, day: fmtDay(fromKey(series.days.at(-1)!), 'd MMMM') })
                    : t('{n} fois, jusqu’au {day}.', { n: series.days.length, day: fmtDay(fromKey(series.days.at(-1)!), 'd MMMM') })}
              </p>
            )}
          </div>
        )}

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
                if (!(await removeEvent(event, source))) return;
                onClose();
              }}
            >
              <Trash2 size={15} /> <span className="max-sm:sr-only">{t('Supprimer')}</span>
            </button>
          )}
          {event && shared && !shared.byMe(event.id) && (
            <button type="button" className="icon-btn" title={t('Signaler')} aria-label={t('Signaler « {title} »', { title: event.title })} onClick={() => setReporting(true)}>
              <Flag size={15} />
            </button>
          )}
          <button type="button" className="btn-secondary ml-auto" onClick={onClose}>
            {t('Annuler')}
          </button>
          {/* Not disabled for an empty title: the submit says what is missing, under the field. */}
          <button type="submit" className="btn-primary" disabled={!!timeMsg || impossible}>
            {event ? t('Enregistrer||sauver') : t('Ajouter')}
          </button>
        </div>
      </form>
      {event && <ReportDialog target={reporting ? { kind: 'event', id: event.id, title: event.title } : null} onClose={() => setReporting(false)} />}
    </Modal>
  );
}
