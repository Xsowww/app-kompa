import { useEffect, useRef, useState, type FormEvent } from 'react';
import { scrollMotion } from '../../lib/a11y';
import { DateField, TimeField } from '../../components/Pickers';
import ReminderPicker from '../../components/ReminderPicker';
import { CalendarPlus, Check, Clock, Flag, MapPin, Pencil, Repeat, Trash2, Link2 } from 'lucide-react';
import { useCreateActions } from '../../store/create';
import { PlusHint } from '../../components/CreateButton';
import { ReportDialog } from '../../components/FeedbackDialogs';
import { useAuth } from '../../store/auth';
import { useGroups } from '../../store/groups';
import { useCalendar, guessCategory, type CalendarEvent } from '../../store/calendar';
import { confirmAction, toast } from '../../store/ui';
import { createEvent, createEvents, deleteEvent, deleteEvents, groupError, setAttendance, updateEvent, updateEvents, type Group, type GroupEvent, type NewGroupEvent } from '../../lib/groups';
import { countdownLabel, fmt, fromKey, todayKey } from '../../lib/dates';
import { dayShift, endlessUntil, ruleDays, shiftKey, type RepeatRule } from '../../lib/repeat';
import RepeatPicker from '../calendar/RepeatPicker';
import { cx, relativeTime, uid } from '../../lib/utils';
import { askSeriesScope, changedFields } from '../calendar/source';
import { MemberDot, LoadFailed } from './shared';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { groupColor, useFinitions, useGroupWords, useMemberName, useMemberOf, useRights } from './util';
import { changedAfter } from './logic';
import { useSettings } from '../../store/settings';
import { t, tn } from '../../i18n';

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());
const PLACE_EXAMPLE = { etudes: t('BU, salle B204… ou https://…'), travail: t('Salle de réunion… ou https://…'), perso: t('Chez Léa… ou https://…') };

/** A meeting as the calendar's helpers see it (« celui-ci et les suivants »). */
const asCalendar = (e: GroupEvent): CalendarEvent => ({ id: e.id, title: e.title, date: e.date, category: 'perso', done: false, createdAt: e.createdAt, ...(e.series && { series: e.series }) });

/** Proposes a meeting, or changes one (`event`): when, where, its agenda, every week, reminders for every member. */
function EventForm({ group, event, onDone }: { group: Group; event?: GroupEvent; onDone: () => void }) {
  const w = useGroupWords();
  const usage = useSettings(s => s.usage);
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.date ?? todayKey());
  const [start, setStart] = useState(event?.start ?? '');
  const [end, setEnd] = useState(event?.end ?? '');
  const [place, setPlace] = useState(event?.place ?? '');
  const [details, setDetails] = useState(event?.details ?? '');
  const [reminders, setReminders] = useState<number[]>(event?.reminders ?? []);
  // Test n°3: every N weeks or months, several days, « le 1er lundi du mois », with or without end — as in the calendar.
  const [rule, setRule] = useState<RepeatRule | null>(null);
  // Reminders of a group's meetings are sent by the server once migration 2026-11-03 is there: not offered before.
  const canRemind = useFinitions() || !!event?.reminders.length;
  const [busy, setBusy] = useState(false);
  const badTime = !!start && !!end && end <= start;
  const repeat = rule && !event && date ? ruleDays(date, rule, rule.until ?? endlessUntil(rule, todayKey())) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date || badTime) return;
    const row: NewGroupEvent = { title: title.trim(), date, start: start || null, end: end || null, place: place.trim() || null, details: details.trim() || null, reminders: reminders.slice(0, 5) };
    setBusy(true);
    try {
      if (!event) {
        if (repeat && repeat.days.length > 1) {
          const series = `rev-${uid()}`;
          await createEvents(group.id, repeat.days.map(d => ({ ...row, date: d, series })));
        } else await createEvent(group.id, row);
        toast(t('{proposed} dans {group}', { proposed: w.meet.proposed, group: w.this }), 'success');
      } else {
        // Only what was changed here: what another member changed meanwhile isn't undone.
        const patch = changedFields(row, event);
        if (Object.keys(patch).length) {
          const all = (useGroups.getState().events[group.id] ?? []).map(asCalendar);
          const scope = await askSeriesScope(asCalendar(event), 'edit', all);
          if (!scope) return setBusy(false);
          const next = scope === 'next' ? (useGroups.getState().events[group.id] ?? []).filter(x => x.series === event.series && x.date > event.date) : [];
          const shift = patch.date ? dayShift(event.date, patch.date) : 0;
          const { date: _d, ...rest } = patch;
          if (!next.length) await updateEvent(event.id, patch);
          else if (!shift) await updateEvents([event.id, ...next.map(x => x.id)], patch);
          // A new day moves each of the next ones by as many days.
          else await Promise.all([updateEvent(event.id, patch), ...next.map(x => updateEvent(x.id, { ...rest, date: shiftKey(x.date, shift) }))]);
          toast(t('Enregistré : {title}', { title: row.title }), 'success');
        }
      }
      await useGroups.getState().refresh(group.id, ['events']);
      onDone();
    } catch (err) {
      toast(groupError(err), 'error');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card enter mb-4 p-4">
      <p className="text-[14px] font-semibold">{event ? t('Modifier « {title} »', { title: event.title }) : t('Proposer {a}', { a: w.meet.a })}</p>
      <input autoFocus value={title} maxLength={200} onChange={e => setTitle(e.target.value)} placeholder={w.meet.placeholder} aria-label={t('Titre')} className="field mt-3 w-full" />
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="col-span-2 sm:col-span-1">
          <span className="eyebrow">{t('Date')}</span>
          <DateField value={date} min={todayKey()} onChange={setDate} label={t('Date')} className="mt-1 w-full" />
        </div>
        <div>
          <span className="eyebrow">{t('Début')}</span>
          <TimeField value={start} onChange={setStart} label={t('Heure de début')} clearable className="mt-1 w-full" />
        </div>
        <div>
          <span className="eyebrow">{t('Fin')}</span>
          <TimeField value={end} onChange={setEnd} label={t('Heure de fin')} clearable invalid={badTime} className="mt-1 w-full" />
        </div>
      </div>
      <label className="mt-2 block">
        <span className="eyebrow">{t('Lieu ou lien de visio')}</span>
        <input value={place} maxLength={300} onChange={e => setPlace(e.target.value)} placeholder={PLACE_EXAMPLE[usage] ?? PLACE_EXAMPLE.etudes} className="field mt-1 w-full" />
      </label>
      <label className="mt-2 block">
        <span className="eyebrow">{t('Ordre du jour')}</span>
        <textarea value={details} maxLength={2000} rows={2} onChange={e => setDetails(e.target.value)} placeholder={t('Ce qu’on fera, ce qu’il faut apporter…')} className="field mt-1 h-auto w-full resize-none py-2" />
      </label>
      {badTime && <p className="mt-2 text-[12px] text-red-600">{t('L’heure de fin doit être après l’heure de début.')}</p>}
      {/* Said before « Proposer »: a meeting without a time is noted for the whole day (Nadia's had none, unnoticed). */}
      {!start && !badTime && <p className="mt-2 text-[12px] text-stone-500">{t('Pas d’heure choisie : ce sera noté pour toute la journée.')}</p>}
      {!event && (
        <div className="mt-3">
          <RepeatPicker value={rule} onChange={setRule} from={date} />
          {repeat && (
            <p className="mt-1.5 text-[12px] text-stone-500" aria-live="polite">
              {!repeat.days.length
                ? t('Aucun jour entre ces dates.')
                : rule?.until
                  ? t('{n} fois, jusqu’au {day}.', { n: repeat.days.length, day: fmt(fromKey(repeat.days.at(-1)!), 'd MMMM') })
                  : t('Sans fin : {n} fois prévues pour l’instant, jusqu’au {day}.', { n: repeat.days.length, day: fmt(fromKey(repeat.days.at(-1)!), 'd MMMM') })}
            </p>
          )}
        </div>
      )}
      {canRemind && (
        <>
          <ReminderPicker value={reminders} onChange={v => setReminders(v.slice(0, 5))} timed={!!start} date={date || undefined} time={start || undefined} item={{ kind: 'event', id: event?.id, title, end: end || undefined }} />
          {reminders.length > 0 && <p className="mt-1.5 text-[12px] text-stone-500">{t('Envoyé à chaque membre {of}.', { of: w.of })}</p>}
        </>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>{t('Annuler')}</button>
        <button type="submit" className="btn-primary" disabled={!title.trim() || !date || badTime || busy}>{event ? t('Enregistrer||sauver') : t('Proposer')}</button>
      </div>
    </form>
  );
}

function EventCard({ group, ev, onEdit }: { group: Group; ev: GroupEvent; onEdit: () => void }) {
  const w = useGroupWords();
  const me = useAuth(s => s.user?.id ?? '');
  const nameOf = useMemberName(group.id);
  const memberOf = useMemberOf(group.id);
  const attendance = useGroups(s => s.attendance[group.id]);
  const inCalendar = useCalendar(s => s.events.some(e => e.externalId === `groupe:${ev.id}`));
  const { canEdit } = useRights(group);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  // Soi-même en dernier : « Hugo, Inès et toi viennent ».
  const coming = (attendance ?? []).filter(a => a.eventId === ev.id).map(a => a.userId).sort((a, b) => Number(a === me) - Number(b === me));
  const iCome = coming.includes(me);
  // Comme la base : l'auteur (s'il est encore éditeur) ou le propriétaire modifie et supprime.
  const canChange = canEdit && (ev.createdBy === me || group.ownerId === me);

  const toggle = async () => {
    setBusy(true);
    try {
      await setAttendance(group.id, ev.id, !iCome);
      await useGroups.getState().refresh(group.id, ['events']);
    } catch (e) {
      toast(groupError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addToCalendar = () => {
    const c = guessCategory(ev.title);
    useCalendar.getState().add({
      title: ev.title,
      date: ev.date,
      start: ev.start ?? undefined,
      end: ev.end ?? undefined,
      // Studies: a revision session (homework colour); work and personal: a meeting / get-together.
      category: useSettings.getState().usage !== 'etudes' || c === 'cours' ? 'cours' : 'devoir',
      details: [t('{meet} {of} « {name} »', { meet: w.meet.One, of: w.of, name: group.name }), ev.place, ev.details].filter(Boolean).join('\n'),
      externalId: `groupe:${ev.id}`,
    });
    toast(t('Ajouté à ton calendrier'), 'success');
  };

  const remove = async () => {
    // Repeated: this one, or with the next ones (asked); else asked plainly. The members are told by the server.
    const all = (useGroups.getState().events[group.id] ?? []).map(asCalendar);
    const scope = await askSeriesScope(asCalendar(ev), 'delete', all);
    if (!scope) return;
    if (scope === 'one' && !all.some(x => x.series && x.series === ev.series && x.date > ev.date)) {
      if (!(await confirmAction(t('Supprimer «\u00a0{title}\u00a0»\u00a0?', { title: ev.title }), t('{The} disparaît pour tous les membres {of}.', { The: w.meet.The, of: w.of }), t('Supprimer {the}', { the: w.meet.the })))) return;
    }
    try {
      if (scope === 'next') await deleteEvents([ev.id, ...all.filter(x => x.series === ev.series && x.date > ev.date).map(x => x.id)]);
      else await deleteEvent(ev.id);
      await useGroups.getState().refresh(group.id, ['events']);
      toast(t('Supprimé {of}', { of: w.of }), 'success');
    } catch (e) {
      toast(groupError(e), 'error');
    }
  };

  const names = coming.map(id => nameOf(id, t('toi')));
  const who =
    coming.length === 0
      ? t('Personne n’a encore répondu')
      : coming.length === 1 && iCome
        ? t('Tu viens')
        : coming.length <= 3
          ? tn(coming.length, '{names} vient', '{names} viennent', { names: names.join(', ').replace(/, ([^,]*)$/, ` ${t('et')} $1`) })
          : t('{names} et {n} autres viennent', { names: names.slice(0, 2).join(', '), n: coming.length - 2 });
  // « Révision » and « réunion » are feminine, « rendez-vous » masculine.
  const feminine = [t('une révision'), t('une réunion')].includes(w.meet.a);
  const proposed = feminine ? t('Proposée par {name}', { name: nameOf(ev.createdBy) }) : t('Proposé par {name}', { name: nameOf(ev.createdBy) });

  return (
    <div className="card group flex flex-wrap items-start gap-3 p-4 sm:flex-nowrap sm:items-center">
      <div className="flex w-14 shrink-0 flex-col items-center rounded-lg py-1.5 text-center" style={{ background: `${groupColor(group)}14`, color: `color-mix(in srgb, ${groupColor(group)} 65%, var(--color-ink))` }}>
        <span className="text-[11px] font-medium uppercase">{fmt(fromKey(ev.date), 'MMM')}</span>
        <span className="tabular text-[20px] leading-tight font-semibold">{fmt(fromKey(ev.date), 'd')}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="truncate text-[14px] font-medium">{ev.title}</span>
          <span className="shrink-0 text-[11px] font-medium text-stone-500">{countdownLabel(ev.date)}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-stone-500">
          <span className="flex items-center gap-1 capitalize">
            <Clock size={12} /> {fmt(fromKey(ev.date), 'EEEE')}
            {ev.start ? ` · ${ev.start}${ev.end ? `–${ev.end}` : ''}` : ''}
          </span>
          {ev.series && (
            <span className="flex items-center gap-1" title={t('Chaque semaine')}>
              <Repeat size={12} aria-hidden /> {t('Chaque semaine')}
            </span>
          )}
          {ev.place &&
            (isUrl(ev.place) ? (
              <a href={ev.place.trim()} target="_blank" rel="noreferrer noopener" className="hit flex min-w-0 items-center gap-1 text-ink underline decoration-stone-300 underline-offset-2">
                <Link2 size={12} /> <span className="truncate">{t('Lien de la visio')}</span>
              </a>
            ) : (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin size={12} /> <span className="truncate">{ev.place}</span>
              </span>
            ))}
        </p>
        {ev.details && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[12.5px] text-stone-600 [overflow-wrap:anywhere]">{ev.details}</p>}
        <div className="mt-2 flex items-center gap-2">
          {coming.length > 0 && (
            <span className="flex -space-x-1.5">
              {coming.slice(0, 5).map(id => (
                <MemberDot key={id} userId={id} name={nameOf(id, t('Toi'))} photo={memberOf(id)?.photo} color={memberOf(id)?.color} size={20} />
              ))}
            </span>
          )}
          <span className="truncate text-[12px] text-stone-500">{who.charAt(0).toUpperCase() + who.slice(1)}</span>
        </div>
        <p className="mt-1 text-[11px] text-stone-500">
          {proposed}
          {changedAfter(ev) && ` · ${(feminine ? t('modifiée par {name} {when}', { name: nameOf(ev.updatedBy), when: relativeTime(ev.updatedAt!) }) : t('modifié par {name} {when}', { name: nameOf(ev.updatedBy), when: relativeTime(ev.updatedAt!) }))}`}
        </p>
      </div>
      <div className="flex shrink-0 basis-full items-center gap-1.5 pl-[68px] sm:basis-auto sm:pl-0">
        <button
          className={cx('btn h-8 px-3', iCome ? 'border border-transparent text-white' : 'btn-secondary')}
          style={iCome ? { background: groupColor(group) } : undefined}
          disabled={busy}
          aria-pressed={iCome}
          onClick={() => void toggle()}
        >
          {iCome && <Check size={14} />} {t('Je viens')}
        </button>
        <button className="icon-btn" title={inCalendar ? t('Déjà dans ton calendrier') : t('Ajouter à mon calendrier')} aria-label={inCalendar ? t('Déjà dans ton calendrier') : t('Ajouter à mon calendrier')} disabled={inCalendar} onClick={addToCalendar}>
          {inCalendar ? <Check size={15} className="text-emerald-600" /> : <CalendarPlus size={15} />}
        </button>
        {ev.createdBy !== me && (
          <button className="icon-btn" title={t('Signaler')} aria-label={t('Signaler « {title} »', { title: ev.title })} onClick={() => setReporting(true)}>
            <Flag size={15} />
          </button>
        )}
        <ReportDialog target={reporting ? { kind: 'event', id: ev.id, title: ev.title } : null} onClose={() => setReporting(false)} />
        {canChange && (
          <button className="icon-btn" title={t('Modifier')} aria-label={t('Modifier « {title} »', { title: ev.title })} onClick={onEdit}>
            <Pencil size={15} />
          </button>
        )}
        {canChange && (
          <button className="icon-btn hover:text-red-600" title={t('Supprimer {the}', { the: w.meet.the })} aria-label={t('Supprimer {the}', { the: w.meet.the })} onClick={() => void remove()}>
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function GroupEvents({ group }: { group: Group }) {
  const w = useGroupWords();
  const events = useGroups(s => s.events[group.id]);
  const failed = useGroups(s => s.loadFailed[`${group.id}:events`]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const { canEdit } = useRights(group);
  // The « + » button (the sharing lines follow it, GroupShare).
  // Already open (scrolled out of sight, a second press): brought back in view with its title field, never « nothing ».
  const formRef = useRef<HTMLDivElement>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!asked) return;
    formRef.current?.scrollIntoView({ block: 'nearest', behavior: scrollMotion() });
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [asked]);
  useCreateActions(canEdit ? [{ label: t('Proposer {a}', { a: w.meet.a }), icon: <CalendarPlus />, onClick: () => (setEditing(null), setAdding(true), setAsked(n => n + 1)) }] : []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="eyebrow pb-3">{t('{Tab} à venir', { Tab: w.meet.Tab })}</p>
      <div className="shadow-room min-h-0 flex-1 overflow-y-auto pb-room">
        {adding && canEdit && (
          <div ref={formRef} className="scroll-mt-2">
            <EventForm group={group} onDone={() => setAdding(false)} />
          </div>
        )}
        {!events && (failed ? <LoadFailed groupId={group.id} part="events" className="card" /> : <Skeleton shape="slots" className="card p-4" />)}
        {events && events.length === 0 && !adding && (
          <EmptyState
            className="card"
            icon={CalendarPlus}
            title={w.meet.none}
            text={canEdit ? <PlusHint /> : undefined}
            preview="slots"
          />
        )}
        <div className="flex flex-col gap-2">
          {events?.map(ev =>
            editing === ev.id ? (
              <EventForm key={ev.id} group={group} event={ev} onDone={() => setEditing(null)} />
            ) : (
              <EventCard key={ev.id} group={group} ev={ev} onEdit={() => (setAdding(false), setEditing(ev.id))} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
