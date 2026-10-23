import { useState, type FormEvent } from 'react';
import { DateField, TimeField } from '../../components/Pickers';
import { CalendarPlus, Check, Clock, Flag, MapPin, Trash2, Link2 } from 'lucide-react';
import { useCreateActions } from '../../store/create';
import { PlusHint } from '../../components/CreateButton';
import { ReportDialog } from '../../components/FeedbackDialogs';
import { useAuth } from '../../store/auth';
import { useGroups } from '../../store/groups';
import { useCalendar, guessCategory } from '../../store/calendar';
import { confirmAction, toast } from '../../store/ui';
import { createEvent, deleteEvent, groupError, setAttendance, type Group, type GroupEvent } from '../../lib/groups';
import { countdownLabel, fmt, fromKey, todayKey } from '../../lib/dates';
import { cx } from '../../lib/utils';
import { MemberDot, LoadFailed } from './shared';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { groupColor, useGroupWords, useMemberName, useRights } from './util';
import { useSettings } from '../../store/settings';
import { t, tn } from '../../i18n';

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());
const PLACE_EXAMPLE = { etudes: t('BU, salle B204… ou https://…'), travail: t('Salle de réunion… ou https://…'), perso: t('Chez Léa… ou https://…') };

function EventForm({ group, onDone }: { group: Group; onDone: () => void }) {
  const w = useGroupWords();
  const usage = useSettings(s => s.usage);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayKey());
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const badTime = !!start && !!end && end <= start;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date || badTime) return;
    setBusy(true);
    try {
      await createEvent(group.id, { title: title.trim(), date, start: start || null, end: end || null, place: place.trim() || null });
      await useGroups.getState().refresh(group.id, ['events']);
      toast(t('{proposed} dans {group}', { proposed: w.meet.proposed, group: w.this }), 'success');
      onDone();
    } catch (err) {
      toast(groupError(err), 'error');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card enter mb-4 p-4">
      <p className="text-[14px] font-semibold">{t('Proposer {a}', { a: w.meet.a })}</p>
      <input autoFocus value={title} maxLength={200} onChange={e => setTitle(e.target.value)} placeholder={w.meet.placeholder} className="field mt-3 w-full" />
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
      {badTime && <p className="mt-2 text-[12px] text-red-600">{t('L’heure de fin doit être après l’heure de début.')}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>{t('Annuler')}</button>
        <button type="submit" className="btn-primary" disabled={!title.trim() || !date || badTime || busy}>{t('Proposer')}</button>
      </div>
    </form>
  );
}

function EventCard({ group, ev }: { group: Group; ev: GroupEvent }) {
  const w = useGroupWords();
  const me = useAuth(s => s.user?.id ?? '');
  const nameOf = useMemberName(group.id);
  const attendance = useGroups(s => s.attendance[group.id]);
  const inCalendar = useCalendar(s => s.events.some(e => e.externalId === `groupe:${ev.id}`));
  const { canEdit } = useRights(group);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  // Soi-même en dernier : « Hugo, Inès et toi viennent ».
  const coming = (attendance ?? []).filter(a => a.eventId === ev.id).map(a => a.userId).sort((a, b) => Number(a === me) - Number(b === me));
  const iCome = coming.includes(me);
  // Comme la base : l'auteur (s'il est encore éditeur) ou le propriétaire.
  const canDelete = canEdit && (ev.createdBy === me || group.ownerId === me);

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
      details: [t('{meet} {of} « {name} »', { meet: w.meet.One, of: w.of, name: group.name }), ev.place].filter(Boolean).join('\n'),
      externalId: `groupe:${ev.id}`,
    });
    toast(t('Ajouté à ton calendrier'), 'success');
  };

  const remove = async () => {
    if (!(await confirmAction(t('Supprimer « {title} » ?', { title: ev.title }), t('{The} disparaît pour tous les membres {of}.', { The: w.meet.The, of: w.of }), t('Supprimer {the}', { the: w.meet.the })))) return;
    try {
      await deleteEvent(ev.id);
      await useGroups.getState().refresh(group.id, ['events']);
      toast(t('Supprimé {of}', { of: w.of }), 'success');
    } catch (e) {
      toast(groupError(e), 'error');
    }
  };

  const names = coming.map(id => nameOf(id));
  const who =
    coming.length === 0
      ? t('Personne n’a encore répondu')
      : coming.length === 1 && iCome
        ? t('Tu viens')
        : coming.length <= 3
          ? tn(coming.length, '{names} vient', '{names} viennent', { names: names.join(', ').replace(/, ([^,]*)$/, ` ${t('et')} $1`) })
          : t('{names} et {n} autres viennent', { names: names.slice(0, 2).join(', '), n: coming.length - 2 });

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
          {ev.place &&
            (isUrl(ev.place) ? (
              <a href={ev.place.trim()} target="_blank" rel="noreferrer noopener" className="flex min-w-0 items-center gap-1 text-ink underline decoration-stone-300 underline-offset-2">
                <Link2 size={12} /> <span className="truncate">{t('Lien de la visio')}</span>
              </a>
            ) : (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin size={12} /> <span className="truncate">{ev.place}</span>
              </span>
            ))}
        </p>
        <div className="mt-2 flex items-center gap-2">
          {coming.length > 0 && (
            <span className="flex -space-x-1.5">
              {coming.slice(0, 5).map(id => (
                <MemberDot key={id} userId={id} name={nameOf(id, t('Toi'))} size={20} />
              ))}
            </span>
          )}
          <span className="truncate text-[12px] text-stone-500">{who.charAt(0).toUpperCase() + who.slice(1)}</span>
        </div>
        <p className="mt-1 text-[11px] text-stone-500">{[t('une révision'), t('une réunion')].includes(w.meet.a) ? t('Proposée par {name}', { name: nameOf(ev.createdBy) }) : t('Proposé par {name}', { name: nameOf(ev.createdBy) })}</p>
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
        {canDelete && (
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
  const { canEdit } = useRights(group);
  // The « + » button (the sharing lines follow it, GroupShare).
  useCreateActions(canEdit ? [{ label: t('Proposer {a}', { a: w.meet.a }), icon: <CalendarPlus />, onClick: () => setAdding(true) }] : []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="eyebrow pb-3">{t('{Tab} à venir', { Tab: w.meet.Tab })}</p>
      <div className="min-h-0 flex-1 overflow-y-auto pb-room">
        {adding && canEdit && <EventForm group={group} onDone={() => setAdding(false)} />}
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
          {events?.map(ev => <EventCard key={ev.id} group={group} ev={ev} />)}
        </div>
      </div>
    </div>
  );
}
