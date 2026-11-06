import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CalendarPlus, Check, Copy, FileText, Flag, Link2, MapPin, Plus, Trash2 } from 'lucide-react';
import SeriesIcon from './SeriesIcon';
import { Modal } from '../../components/Overlays';
import { ReportDialog } from '../../components/FeedbackDialogs';
import { useNotes } from '../../store/notes';
import { allCategories, guessCategory, isBigEvent, nextInSeries, useCalendar, type CalendarEvent, type EventCategory, type NewEvent } from '../../store/calendar';
// The colours of the categories, vivid in the Affichage Pro.
import { catOf } from './proColors';
import { askSeriesScope, changedFields, removeEvent, useCalendarSource } from './source';
import PeoplePicker from './PeoplePicker';
import { useSettings } from '../../store/settings';
import { toast } from '../../store/ui';
import { AGENDA_EXAMPLES, WORDS } from '../../lib/usage';
import { cx } from '../../lib/utils';
import { NewCategory } from './CategoriesDialog';
import ReminderPicker from '../../components/ReminderPicker';
import { DateField, TimeField } from '../../components/Pickers';
import { FieldError } from '../../components/Field';
import { fmtDay, fromKey, fromMinutes, parseQuickAdd, remindMinutes, todayKey, toMinutes } from '../../lib/dates';
import { cleanReminders, earlyReminders, eventReminders, followMoments, remindersText } from '../../lib/reminders';
import { covers } from '../../lib/periods';
import { MAX_SPAN_DAYS, dayShift, endlessUntil, guessRule, isSpan, ruleDays, ruleLabel, ruleOf, shiftKey, spanDays, spanTooLong, type RepeatRule } from '../../lib/repeat';
import { planNewEnd, rememberRule, savedRule } from '../../lib/repeatSeries';
import RepeatPicker, { EndChoice } from './RepeatPicker';
import { feedLabel, feedOf } from '../../lib/icsFeeds';
import { uid } from '../../lib/utils';
import { copyToMyCalendar } from './agendas';
import AgendaChoice from '../groups/AgendaChoice';
import { addToAgenda, useAgendaTargets } from '../groups/agendaAdd';
import { t, tn } from '../../i18n';

const NONE: number[] = [];
/** The repeat a sentence asks for: « tous les mardis » every week, « tous les 3 mois », « le 1er lundi du mois ». */
const repeatSaid = (p: ReturnType<typeof parseQuickAdd>): RepeatRule | null => p.rule ?? (p.every ? ruleOf(p.every) : null);
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
  /** « Dupliquer »: a new event filled in as this one (nothing is added before « Ajouter »). */
  template?: CalendarEvent;
  /** « Dupliquer » in the window of an event: the parent opens the new one, filled in. */
  onDuplicate?: (ev: CalendarEvent) => void;
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
      {shared.changed(ev.id) && <p className="mt-0.5 text-[12px] text-stone-500">{shared.changed(ev.id)}</p>}
      <dl className="mt-4 grid gap-3">
        {ev.place && row(t('Lieu'), <span className="[overflow-wrap:anywhere]">{ev.place}</span>)}
        {row(t('Pour qui'), ev.people?.length ? ev.people.map(who).join(', ') : t('Tout le monde'))}
        {reminders.length > 0 &&
          row(
            t('Rappels'),
            <span className="inline-flex items-center gap-1.5">
              <Bell size={12} aria-hidden className="shrink-0 text-stone-500" />
              {remindersText(reminders, ev.date, ev.start)}
            </span>,
          )}
        {ev.details && row(t('Notes'), <span className="block whitespace-pre-line [overflow-wrap:anywhere]">{ev.details}</span>)}
      </dl>
      <div className="modal-foot">
        <button type="button" className="btn-ghost" onClick={() => (copyToMyCalendar(ev), onClose())} title={t('Copier dans mon agenda')}>
          <CalendarPlus size={15} /> <span className="max-sm:sr-only">{t('Copier dans mon agenda')}</span>
        </button>
        {!shared.byMe(ev.id) && (
          <button type="button" className="btn-ghost" onClick={() => setReporting(true)} aria-label={t('Signaler « {title} »', { title: ev.title })}>
            <Flag size={15} /> <span className="max-sm:sr-only">{t('Signaler')}</span>
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={onClose}>
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

function EventEditor({ event, date, start: initialStart, end: initialEnd, title: initialTitle, template, onDuplicate, onClose, onSaved }: Props) {
  // My calendar or a shared one (no « important » there; its own categories, and reminders for each member it is for).
  const source = useCalendarSource();
  const { add, addMany, update, updateSeries, shared, categories: custom, periods, events: allEvents } = source;
  // A new event of my calendar can go straight to one of my shared calendars (« Agenda : Perso · Famille »).
  const targets = useAgendaTargets(!event && !shared);
  const [agendaId, setAgendaId] = useState('');
  const into = targets.find(g => g.id === agendaId) ?? null;
  // An event changed, or the one duplicated (its times and all, on the day it is opened for).
  const base = event ?? template;
  const [title, setTitle] = useState(base?.title ?? initialTitle ?? '');
  const [day, setDay] = useState(event?.date ?? date);
  const [start, setStart] = useState(base?.start ?? initialStart ?? '');
  const [end, setEnd] = useState(base?.end ?? initialEnd ?? '');
  const [category, setCategory] = useState<EventCategory | null>(base?.category ?? null);
  const [details, setDetails] = useState(base?.details ?? '');
  // What the calendar's bar typed (« Kiné mardi 14h chez le kiné rappel la veille »): read once for the fields below.
  const [said] = useState(() => (initialTitle && !base ? parseQuickAdd(initialTitle, undefined, undefined, true) : null));
  const [place, setPlace] = useState(base?.place ?? said?.place ?? '');
  const [important, setImportant] = useState(!!base?.important);
  // Shared calendar: who it is for (none: everyone).
  const [people, setPeople] = useState<string[]>(base?.people ?? []);
  // undefined = not chosen: the usual reminder (Profil › Notifications) for an event with a time.
  const [chosen, setChosen] = useState<number[] | undefined>(base?.reminders ?? (said ? remindMinutes(said.remind, said.date ?? date, said.start) : undefined));
  // A duplicate's title is read as a sentence only once changed (« Cours 8h » duplicated stays « Cours 8h »).
  const [retyped, setRetyped] = useState(false);
  const mine = useSettings(s => s.defaultReminders);
  const feeds = useSettings(s => s.icsFeeds);
  // My usual reminder isn't imposed on the members of a shared calendar: none until one is chosen.
  const defaults = shared || into ? NONE : mine;
  const words = { ...(WORDS[useSettings(s => s.usage)] ?? WORDS.etudes), ...(shared && AGENDA_EXAMPLES) };
  const [creating, setCreating] = useState(false);
  // A new event: « Dentiste demain 16h » fills the day and the times (as the calendar's bar), unless they were set by
  // hand; saved as « Dentiste ». Editing one leaves its title as it is.
  const touched = useRef({ day: false, start: false, end: false, important: false, repeat: false, endDay: false, place: false, reminders: !!base?.reminders });
  const parsed = !event && (!template || retyped) && title.trim() ? parseQuickAdd(title, undefined, undefined, true) : null;
  const understood = !!parsed && !parsed.impossible && !!(parsed.date || parsed.start || parsed.important || parsed.every || parsed.rule || parsed.place || parsed.remind);
  // « 31/11 »: said and blocked, unless the day was chosen by hand.
  const [dayByHand, setDayByHand] = useState(false);
  const impossible = !!parsed?.impossible && !dayByHand;
  const cleanTitle = understood ? parsed.title : title.trim();
  // Repeating: my own calendar, a new event (« tous les mardis » in the title chooses « Chaque semaine »).
  const canRepeat = !event;
  const [repeat, setRepeat] = useState<RepeatRule | null>(() => (canRepeat && said ? repeatSaid(said) : null));
  // Without end (the default, test n°3: no end forced in February): made a horizon ahead, then as time goes (lib/repeatSeries).
  const lastDay = repeat && day ? (repeat.until ?? endlessUntil(repeat, todayKey())) : '';
  const around = repeat && day ? periods.filter(p => p.start <= lastDay && p.end >= day) : [];
  // Ticked: not on those days (the holidays at first).
  const [skipped, setSkipped] = useState<string[] | null>(null);
  const skipIds = skipped ?? around.filter(p => HOLIDAYS.test(p.title)).map(p => p.id);
  const series = repeat && day ? ruleDays(day, repeat, lastDay, k => periods.some(p => skipIds.includes(p.id) && covers(p, k))) : null;
  // An event that already repeats (not one over several days): its rule, and its end, which can be changed here.
  const inSeries = event?.series && !isSpan(event.series) ? allEvents.filter(e => e.series === event.series) : null;
  const saved = inSeries && !shared ? savedRule(event!.series!) : null;
  const seriesRule = inSeries ? (saved?.rule ?? guessRule(inSeries.map(e => e.date))) : null;
  const seriesEnd = inSeries ? (saved ? (saved.rule.until ?? null) : inSeries.reduce((a, e) => (e.date > a ? e.date : a), '')) : null;
  // undefined: not changed here.
  const [newEnd, setNewEnd] = useState<string | null | undefined>(undefined);
  // Over several days (a seminar, a trip): one event a day, linked (lib/repeat spanDays). Not with a repeat.
  const canSpan = !event && !repeat;
  // null: ends the same day. « Congés du 22 au 26 décembre » typed in the calendar's bar: the 26th.
  const [endDay, setEndDay] = useState<string | null>(() => (canSpan && said ? (said.endDate ?? null) : null));
  // A night (a new event from 21:00 to 07:00): it ends the next morning, one piece on each day (as « 21h-7h » typed).
  const night = canSpan && !(endDay && day && endDay > day) && !!day && !!start && !!end && end < start;
  const spanning = (canSpan && !!endDay && !!day && endDay > day) || night;
  // Longer than MAX_SPAN_DAYS: said and blocked (a day typed past the little calendar's end), never cut without a word.
  const endDayMsg = canSpan && endDay && day ? (endDay <= day ? t('Le jour de fin doit être après le jour de début.') : spanTooLong(day, endDay) ? t('{n} jours au plus.', { n: MAX_SPAN_DAYS }) : '') : '';
  const onTitle = (v: string) => {
    setTitle(v);
    setRetyped(true);
    if (v.trim()) setTitleError('');
    if (event) return;
    const p = v.trim() ? parseQuickAdd(v, undefined, undefined, true) : null;
    const ok = p && !p.impossible ? p : null;
    const was = touched.current;
    if (!was.day) setDay(ok?.date ?? date);
    if (!was.start) setStart(ok?.start ?? initialStart ?? '');
    if (!was.end) setEnd(ok?.end ?? (ok?.start ? '' : (initialEnd ?? '')));
    if (!was.important) setImportant(!!ok?.important);
    if (canRepeat && !was.repeat) setRepeat(ok ? repeatSaid(ok) : null);
    if (!was.endDay) setEndDay(ok?.endDate ?? null);
    // « à la mairie », « rappel 1h avant » said in the title: in their fields (unless changed by hand).
    if (!was.place) setPlace(ok?.place ?? '');
    if (!was.reminders) setChosen(ok ? remindMinutes(ok.remind, ok.date ?? date, ok.start) : undefined);
  };
  const effective = category ?? guessCategory(cleanTitle || title, !!start, custom);
  // My usual reminder and, for a big day, a week before and the day before when still to come (lib/reminders); a shared calendar: the chosen ones.
  const reminders = shared || into ? (chosen ?? NONE) : eventReminders({ reminders: chosen, date: day, start, externalId: event?.externalId, category: effective, important }, defaults, new Date());
  // Becoming a big day with reminders already chosen: the early ones are added (removable).
  const becomeBig = (big: boolean) => {
    if (!shared && big && chosen && day && !isBigEvent({ category: effective, important })) setChosen(cleanReminders([...chosen, ...earlyReminders(day, start || undefined, new Date())]));
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
    const data = { title: cleanTitle, date: day, start: start || undefined, end: start && end ? end : undefined, category: effective, details: details.trim() || undefined, place: place.trim() || undefined, important: important || undefined, reminders: chosen, ...(shared && { people }) };
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
      (into ? (l: NewEvent[]) => addToAgenda(into, l) : addMany)(series.days.map(d => ({ ...data, date: d, series: id })));
      // My calendar: the rule is kept, a series without end goes on by itself (lib/repeatSeries).
      if (!into && !shared && repeat) rememberRule(id, repeat, day);
    } else if (spanning) {
      const id = `span-${uid()}`;
      // The first day keeps the reminders; the others none (« 15 min avant » 0:00 would ring at midnight).
      (into ? (l: NewEvent[]) => addToAgenda(into, l) : addMany)(spanDays(day, night ? shiftKey(day, 1) : endDay!, start || undefined, end || undefined).map((p, i) => ({ ...data, ...p, start: p.start, end: p.end, series: id, reminders: i ? [] : data.reminders })));
    } else if (into) addToAgenda(into, [data]);
    else add(data);
    // A new end for the series (« Sans fin », a later or earlier « Jusqu’au »): the days after it go, the missing ones are made.
    if (event?.series && inSeries && newEnd !== undefined && newEnd !== seriesEnd) {
      const now = shared ? inSeries : useCalendar.getState().events.filter(e => e.series === event.series);
      const plan = planNewEnd(now, newEnd, saved);
      if (plan.remove.length) source.removeMany(plan.remove);
      if (plan.add.length) addMany(plan.add);
      if (!shared && plan.rule) rememberRule(event.series, plan.rule, plan.from);
    }
    toast(
      event
        ? t('Enregistré : {title}', { title: data.title })
        : series
          ? t('Ajouté {n} fois, jusqu’au {day}', { n: series.days.length, day: fmtDay(fromKey(series.days.at(-1)!), 'EEEE d MMMM') })
          : night
            ? t('Ajouté : {title}, jusqu’au lendemain {time}', { title: data.title, time: end })
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
        {/* A shared calendar: who changed it last (pages/groups/SharedCalendar). */}
        {event && shared?.changed(event.id) && <p className="mt-1 text-[12px] text-stone-500">{shared.changed(event.id)}</p>}
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
                  ? tn(n, 'Se répète : encore {n} fois après celui-ci||une fois', 'Se répète : encore {n} fois après celui-ci')
                  : t('Dernier d’une répétition'))(nextInSeries(event, allEvents).length)}
          </p>
        )}
        {inSeries && seriesRule && (!shared || shared.canEdit) && (
          <div className="mt-2 rounded-2xl bg-stone-50 p-3">
            <p className="mb-2 text-[12.5px] font-medium text-stone-700">{ruleLabel(seriesRule, inSeries.reduce((a, e) => (e.date < a ? e.date : a), event!.date))}</p>
            <EndChoice until={newEnd === undefined ? seriesEnd : newEnd} onChange={setNewEnd} from={event!.date} />
          </div>
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
                parsed.yearly && repeat?.unit === 'year' && t('chaque année'),
                parsed.rule && repeat && ruleLabel(repeat, day).toLowerCase(),
                parsed.place && place === parsed.place && t('lieu : {place}', { place: parsed.place }),
                parsed.remind && t('rappel'),
              ]
                .filter(Boolean)
                .join(' · '),
            })}
          </p>
        )}
        {impossible && !titleError && <p className="mt-1.5 text-[12px] font-medium text-red-600 dark:text-red-400" role="alert">{t('Cette date n’existe pas : corrige-la pour ajouter.')}</p>}
        <AgendaChoice targets={targets} value={agendaId} onChange={setAgendaId} />

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
                // A new start moves the end with it: the length stays (a night too, across midnight).
                if (start && end && v && v !== start) {
                  const length = (toMinutes(end) - toMinutes(start) + 1440) % 1440;
                  setEnd(fromMinutes((toMinutes(v) + length) % 1440));
                }
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
        {night && <p className="mt-1.5 text-[12px] text-stone-500">{t('Finit le lendemain à {time} : il sera sur les deux jours.', { time: end })}</p>}

        <label className="relative mt-4 block">
          <MapPin size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden />
          <input value={place} onChange={e => ((touched.current.place = true), setPlace(e.target.value))} maxLength={300} placeholder={t('Lieu (facultatif)')} aria-label={t('Lieu')} className="field h-10 w-full pl-9 text-[14px]" />
        </label>

        {canSpan &&
          (endDay === null ? (
            <button type="button" className="btn-ghost mt-2 h-8 px-2 text-[12.5px]" onClick={() => ((touched.current.endDay = true), setEndDay(day ? shiftKey(day, 1) : ''))}>
              <Plus size={13} /> {t('Finit un autre jour')}
            </button>
          ) : (
            <div className="mt-3 grid grid-cols-1 items-end gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Jour de fin')}</span>
                <DateField value={endDay} onChange={v => ((touched.current.endDay = true), setEndDay(v))} min={day || undefined} max={day ? shiftKey(day, MAX_SPAN_DAYS - 1) : undefined} label={t('Jour de fin de l’événement')} invalid={!!endDayMsg} className="w-full" />
              </div>
              <button type="button" className="btn-ghost h-10 px-2.5 text-[12.5px]" onClick={() => ((touched.current.endDay = true), setEndDay(null))}>
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
        {!shared && !into && <button
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
            <RepeatPicker value={repeat} onChange={r => ((touched.current.repeat = true), setRepeat(r))} from={day} />
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
                  : !repeat?.until
                    ? into || shared
                      ? t('Sans fin : {n} fois prévues, jusqu’au {day}. Tu pourras prolonger depuis l’événement.', { n: series.days.length, day: fmtDay(fromKey(series.days.at(-1)!), 'd MMMM') })
                      : t('Sans fin : {n} fois prévues jusqu’au {day}, la suite s’ajoute toute seule.', { n: series.days.length, day: fmtDay(fromKey(series.days.at(-1)!), 'd MMMM') })
                  : series.capped
                    ? t('{n} fois au plus : jusqu’au {day}.', { n: series.days.length, day: fmtDay(fromKey(series.days.at(-1)!), 'd MMMM') })
                    : t('{n} fois, jusqu’au {day}.', { n: series.days.length, day: fmtDay(fromKey(series.days.at(-1)!), 'd MMMM') })}
              </p>
            )}
          </div>
        )}

        <ReminderPicker value={reminders} onChange={v => ((touched.current.reminders = true), setChosen(v))} timed={!!start} date={day || undefined} time={start || undefined} item={{ kind: 'event', id: event?.id, title: cleanTitle || title, end: end || undefined }} />
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

        {/* The secondary actions as icons (their names on hover): « Supprimer Dupliquer Annuler Enregistrer » cut the last
            one off the window. Square buttons of the same height and corners as « Annuler ». Too narrow for all of them
            (a shared calendar adds two): « Annuler Enregistrer » go whole on a row of their own, at the right (modal-foot). */}
        <div className="modal-foot">
          <div className="mr-auto flex items-center gap-1">
          {event && (
            <button
              type="button"
              className="btn-ghost w-10 px-0 text-red-600 hover:bg-red-50 hover:text-red-700"
              title={t('Supprimer')}
              aria-label={t('Supprimer')}
              onClick={async () => {
                if (!(await removeEvent(event, source))) return;
                onClose();
              }}
            >
              <Trash2 size={16} />
            </button>
          )}
          {event && onDuplicate && (
            <button type="button" className="btn-ghost w-10 px-0" title={t('Dupliquer')} aria-label={t('Dupliquer')} onClick={() => (onClose(), onDuplicate(event))}>
              <Copy size={16} />
            </button>
          )}
          {event && shared && (
            <button type="button" className="btn-ghost w-10 px-0" title={t('Copier dans mon agenda')} aria-label={t('Copier dans mon agenda')} onClick={() => (copyToMyCalendar(event), onClose())}>
              <CalendarPlus size={15} />
            </button>
          )}
          {event && shared && !shared.byMe(event.id) && (
            <button type="button" className="btn-ghost w-10 px-0" title={t('Signaler')} aria-label={t('Signaler « {title} »', { title: event.title })} onClick={() => setReporting(true)}>
              <Flag size={15} />
            </button>
          )}
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
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
