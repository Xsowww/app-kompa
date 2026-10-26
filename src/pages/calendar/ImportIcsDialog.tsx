import { useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarArrowDown, FileUp, Link2, Loader2, RefreshCw, X } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { catOf, timetableCategory, useCalendar, type EventCategory, type NewEvent } from '../../store/calendar';
import { cancelledBy, isIcsFile, parseIcs, type IcsEvent } from '../../lib/ics';
import { fmt, fromKey, todayKey } from '../../lib/dates';
import { confirmAction, toast } from '../../store/ui';
import { FeedError, MAX_FEEDS, feedLabel, feedErrorText, feedMark, refreshFeeds, subscribe, unsubscribe } from '../../lib/icsFeeds';
import { useSettings } from '../../store/settings';
import { WORDS } from '../../lib/usage';
import { cx } from '../../lib/utils';
import { t, tn } from '../../i18n';

export interface IcsSource {
  name: string;
  text: string;
}

/** Timetables followed by link: paste one, see them, read them again, stop following one (lib/icsFeeds). */
function Feeds({ onAdded }: { onAdded: (firstDate: string) => void }) {
  const feeds = useSettings(s => s.icsFeeds);
  // A timetable for studies (« cours », the school's ENT), any agenda otherwise.
  const study = (useSettings(s => s.usage) ?? 'etudes') === 'etudes';
  const events = useCalendar(s => s.events);
  const today = todayKey();
  const upcoming = (id: string) => events.some(e => e.date >= today && e.externalId?.startsWith(feedMark(id)));
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<'new' | 'all' | null>(null);
  const [error, setError] = useState('');

  // A link with only past events: offered anyway (to try a link, or keep last year's timetable).
  const [pastOnly, setPastOnly] = useState(false);
  const add = async (e?: FormEvent, pastToo = false) => {
    e?.preventDefault();
    if (!url.trim() || busy) return;
    setBusy('new');
    setError('');
    setPastOnly(false);
    try {
      const { feed, plan } = await subscribe(url, pastToo);
      setUrl('');
      toast(tn(plan.add.length, 'Abonné à « {name} » : {n} événement ajouté, mis à jour tout seul.', 'Abonné à « {name} » : {n} événements ajoutés, mis à jour tout seul.', { name: feedLabel(feed.name) }), 'success');
      if (plan.add[0]) onAdded(plan.add.reduce((a, b) => (b.date < a.date ? b : a)).date);
    } catch (err) {
      setError(err instanceof FeedError ? feedErrorText(err.code, err.last) : feedErrorText('unreachable'));
      setPastOnly(err instanceof FeedError && err.code === 'no_upcoming');
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setBusy('all');
    await refreshFeeds(true);
    setBusy(null);
    // A link that failed is said in the list: not « à jour ».
    const failed = (useSettings.getState().icsFeeds ?? []).filter(f => f.error).length;
    if (failed) toast(tn(failed, '{n} lien n’a pas pu être lu : voir la liste.', '{n} liens n’ont pas pu être lus : voir la liste.'), 'error');
    else toast(study ? t('Emplois du temps à jour') : t('Agendas à jour'), 'success');
  };

  const stop = async (id: string, name: string) => {
    const n = useCalendar.getState().events.filter(e => e.externalId?.startsWith(feedMark(id))).length;
    if (!(await confirmAction(t('Retirer « {name} » ?', { name }), tn(n, 'Son {n} événement est retiré du calendrier. Le reste de ton calendrier ne change pas.', 'Ses {n} événements sont retirés du calendrier. Le reste de ton calendrier ne change pas.'), t('Tout retirer')))) return;
    toast(tn(unsubscribe(id), '« {name} » retiré : {n} événement enlevé.', '« {name} » retiré : {n} événements enlevés.', { name }), 'success');
  };

  return (
    <div className="mt-4">
      <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium">
        <Link2 size={14} /> {t('S’abonner avec un lien')}
      </p>
      <form onSubmit={add} className="flex gap-2">
        <input
          value={url}
          onChange={e => (setUrl(e.target.value), setError(''), setPastOnly(false))}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://… .ics"
          aria-label={t('Lien du calendrier (.ics)')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'feed-error' : undefined}
          disabled={feeds.length >= MAX_FEEDS}
          className="field h-10 min-w-0 flex-1"
        />
        <button type="submit" className="btn-primary h-10 shrink-0" disabled={!url.trim() || !!busy || feeds.length >= MAX_FEEDS}>
          {busy === 'new' ? <Loader2 size={15} className="animate-spin" /> : null} {t('S’abonner')}
        </button>
      </form>
      {error && <p id="feed-error" role="alert" className="mt-1.5 text-[12.5px] font-medium text-red-600 dark:text-red-400">{error}</p>}
      {pastOnly && (
        <button type="button" className="btn-secondary mt-2 h-9" disabled={!!busy} onClick={() => void add(undefined, true)}>
          {study ? t('Ajouter quand même ses cours passés') : t('Ajouter quand même ses événements passés')}
        </button>
      )}
      <p className="mt-1.5 text-[12px] text-stone-500">{study ? t('Le lien « iCal » de ton ENT ou de Google Agenda. Mis à jour toutes les 3 h.') : t('Le lien « iCal » de ton agenda (Google Agenda, Outlook…). Mis à jour toutes les 3 h.')}</p>

      {feeds.length > 0 && (
        <div className="mt-3 rounded-xl border border-stone-200">
          <ul className="divide-y divide-stone-100">
            {feeds.map(f => (
              <li key={f.id} className="flex items-center gap-2 py-2 pl-3 pr-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{feedLabel(f.name)}</p>
                  {f.error ? (
                    <p className="text-[12px] text-red-600 dark:text-red-400">{feedErrorText(f.error)}</p>
                  ) : !upcoming(f.id) ? (
                    <p className="text-[12px] text-amber-700 dark:text-amber-400">{study ? t('Aucun cours à venir dans ce lien.') : t('Aucun événement à venir dans ce lien.')}</p>
                  ) : (
                    f.lastSync && <p className="text-[12px] text-stone-500">{t('Mis à jour le {when}', { when: fmt(new Date(f.lastSync), 'd MMM, HH:mm') })}</p>
                  )}
                </div>
                <button type="button" className="icon-btn shrink-0 hover:text-red-600" title={t('Retirer ce calendrier et ses événements')} aria-label={t('Retirer « {name} » et ses événements', { name: feedLabel(f.name) })} onClick={() => void stop(f.id, feedLabel(f.name))}>
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end border-t border-stone-100 px-1.5 py-1">
            <button type="button" className="btn-ghost h-8 shrink-0 px-2 text-[12.5px]" disabled={!!busy} onClick={() => void refresh()}>
              <RefreshCw size={13} className={cx(busy === 'all' && 'animate-spin')} /> {t('Actualiser')}
            </button>
          </div>
        </div>
      )}

      <p className="eyebrow mt-5">{t('Ou importer un fichier, une fois')}</p>
    </div>
  );
}

/** In a timetable, a TD or TP slot is a class, not homework. */
const categoryOf = (e: IcsEvent): EventCategory => timetableCategory(e.title, !!e.start);

interface Props {
  initial?: IcsSource;
  onClose: () => void;
  /** Called with the first imported day so the calendar can jump to it. */
  onImported: (firstDate: string) => void;
}

export default function ImportIcsDialog({ initial, onClose, onImported }: Props) {
  const usage = useSettings(s => s.usage);
  const words = WORDS[usage] ?? WORDS.etudes;
  const [source, setSource] = useState<IcsSource | undefined>(initial);
  const [skipPast, setSkipPast] = useState(true);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const events = useCalendar(s => s.events);
  const today = todayKey();

  const parsed = useMemo(() => {
    if (!source) return null;
    try {
      return parseIcs(source.text);
    } catch {
      return [];
    }
  }, [source]);

  const plan = useMemo(() => {
    if (!parsed || !source) return null;
    // Events in the trash count too: a deleted course must not come back with the next import.
    const all = [...events, ...useCalendar.getState().trash];
    const known = new Set(all.map(e => e.externalId).filter(Boolean));
    const ids = new Set(all.map(e => e.id));
    // Also recognise events exported from Kompaly itself (UID "<id>@cop-pilot").
    const dup = (e: IcsEvent) => known.has(e.externalId) || ids.has(e.externalId.replace(/@cop-pilot(_\d{8})?$/, ''));
    const fresh = parsed.filter(e => !dup(e));
    const todo = fresh.filter(e => !skipPast || e.date >= today);
    const cats = new Map<EventCategory, number>();
    for (const e of todo) cats.set(categoryOf(e), (cats.get(categoryOf(e)) ?? 0) + 1);
    // An updated timetable: courses moved or renamed are updated, cancelled ones go to the trash.
    const current = (e: { date: string }) => !skipPast || e.date >= today;
    const byExternal = new Map(events.filter(e => e.externalId).map(e => [e.externalId!, e]));
    const updates = parsed.flatMap(e => {
      const old = byExternal.get(e.externalId);
      if (!old || !(current(old) || current(e))) return [];
      const patch = { title: e.title, date: e.date, start: e.start, end: e.end, details: e.details, series: e.series };
      const same = (Object.keys(patch) as (keyof typeof patch)[]).every(k => (old[k] ?? undefined) === (patch[k] ?? undefined));
      return same ? [] : [{ id: old.id, patch }];
    });
    const cancelled = cancelledBy(source.text);
    const removals = events.filter(e => e.externalId && current(e) && cancelled(e.externalId));
    const duplicates = parsed.length - fresh.length - updates.length;
    return { todo, duplicates, updates, removals, past: fresh.filter(e => e.date < today).length, cats };
  }, [parsed, source, events, skipPast, today]);
  const changes = plan ? plan.todo.length + plan.updates.length + plan.removals.length : 0;

  const read = async (file: File | undefined) => {
    if (!file) return;
    if (!isIcsFile(file)) {
      toast(t('Choisis un fichier .ics'), 'error');
      return;
    }
    setSource({ name: file.name, text: await file.text() });
  };

  const submit = () => {
    if (!plan || !changes) return;
    const cal = useCalendar.getState();
    const list: NewEvent[] = plan.todo.map(e => ({ title: e.title, date: e.date, start: e.start, end: e.end, details: e.details, externalId: e.externalId, category: categoryOf(e), series: e.series }));
    if (list.length) cal.addMany(list);
    for (const u of plan.updates) cal.update(u.id, u.patch);
    for (const e of plan.removals) cal.remove(e.id);
    const parts = [
      list.length && tn(list.length, '{n} événement importé', '{n} événements importés'),
      plan.updates.length && t('{n} mis à jour', { n: plan.updates.length }),
      plan.removals.length && tn(plan.removals.length, '{n} annulé (dans la corbeille)', '{n} annulés (dans la corbeille)'),
      plan.duplicates > 0 && tn(plan.duplicates, '{n} déjà présent', '{n} déjà présents'),
    ].filter(Boolean);
    toast(parts.join(' · '), 'success');
    const first = list.find(e => e.date >= today)?.date ?? list[0]?.date ?? plan.updates[0]?.patch.date;
    if (first) onImported(first);
    onClose();
  };

  const range = plan?.todo.length ? [plan.todo[0].date, plan.todo[plan.todo.length - 1].date] : null;
  const sample = plan?.todo.slice(0, 6) ?? [];

  return (
    <Modal open onClose={onClose} width={500}>
      <h3 className="text-[15px] font-semibold">{t('Importer un {timetable}', { timetable: words.timetable })}</h3>

      {!source ? (
        <>
          <Feeds
            onAdded={d => {
              onImported(d);
              onClose();
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={e => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={e => {
              e.preventDefault();
              e.stopPropagation();
              setOver(false);
              void read(e.dataTransfer.files[0]);
            }}
            className={cx('mt-2 flex w-full flex-col items-center rounded-xl border-[1.5px] border-dashed px-4 py-6 text-center transition-colors', over ? 'border-brand-500 bg-brand-50' : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50')}
          >
            <FileUp size={22} className="text-stone-400" />
            <span className="mt-2 text-[14px] font-medium">{t('Choisir un fichier .ics')}</span>
            <span className="mt-0.5 text-[12px] text-stone-500">{t('ou glisse-le ici')}</span>
          </button>
          <input ref={inputRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={e => void read(e.target.files?.[0])} />

          <div className="mt-5 flex justify-end">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t('Annuler')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 truncate text-[12px] text-stone-500">{source.name}</p>

          {!parsed?.length ? (
            <div className="mt-4 rounded-lg border border-dashed border-stone-200 py-8 text-center">
              <p className="text-[14px] font-medium">{t('Aucun événement lisible dans ce fichier')}</p>
            </div>
          ) : (
            plan && (
              <>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="tabular text-[28px] font-semibold leading-none tracking-[-0.02em]">{plan.todo.length}</span>
                  <span className="text-[13px] text-stone-600">
                    {tn(plan.todo.length, 'événement à importer', 'événements à importer')}
                    {range && (
                      <>
                        {' '}
                        · {t('du {start} au {end}', { start: fmt(fromKey(range[0]), 'd MMM'), end: fmt(fromKey(range[1]), 'd MMM yyyy') })}
                      </>
                    )}
                  </span>
                </div>

                {plan.cats.size > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-stone-500">
                    {[...plan.cats].map(([k, n]) => (
                      <span key={k} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: catOf(k).color }} />
                        {catOf(k).label} <span className="tabular">{n}</span>
                      </span>
                    ))}
                  </div>
                )}

                {sample.length > 0 && (
                  <ul className="mt-4 divide-y divide-stone-100 rounded-lg border border-stone-200">
                    {sample.map(e => (
                      <li key={e.externalId} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                        <span className="w-20 shrink-0 text-[12px] text-stone-500 first-letter:uppercase">{fmt(fromKey(e.date), 'EEE d MMM')}</span>
                        <span className="tabular w-11 shrink-0 text-[12px] text-stone-500">{e.start ?? t('Journée')}</span>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: catOf(categoryOf(e)).color }} />
                        <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
                      </li>
                    ))}
                    {plan.todo.length > sample.length && <li className="px-3 py-2 text-[12px] text-stone-500">{tn(plan.todo.length - sample.length, 'et {n} autre…', 'et {n} autres…')}</li>}
                  </ul>
                )}

                <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[13px]">
                  <input type="checkbox" checked={skipPast} onChange={e => setSkipPast(e.target.checked)} className="h-4 w-4 accent-[var(--color-ink)]" />
                  {t('Ignorer les événements passés')}
                  {plan.past > 0 && <span className="tabular text-stone-500">({plan.past})</span>}
                </label>
                {(plan.updates.length > 0 || plan.removals.length > 0) && (
                  <p className="mt-2 text-[12px] text-stone-600">
                    {t('{timetable} mis à jour\u00a0: {changes}.', {
                      timetable: words.timetable.charAt(0).toUpperCase() + words.timetable.slice(1),
                      changes: [
                        plan.updates.length && tn(plan.updates.length, '{n} {slot} modifié', '{n} {slot} modifiés', { slot: plan.updates.length > 1 ? words.slots : words.slot }),
                        plan.removals.length && tn(plan.removals.length, '{n} {slot} annulé, mis à la corbeille', '{n} {slot} annulés, mis à la corbeille', { slot: plan.removals.length > 1 ? words.slots : words.slot }),
                      ]
                        .filter(Boolean)
                        .join(', '),
                    })}
                  </p>
                )}
                {plan.duplicates > 0 && (
                  <p className="mt-2 text-[12px] text-stone-500">
                    {tn(plan.duplicates, '{n} déjà dans ton calendrier, ignoré.', '{n} déjà dans ton calendrier, ignorés.')}
                  </p>
                )}
              </>
            )
          )}

          <div className="mt-5 flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => setSource(undefined)}>
              {t('Autre fichier')}
            </button>
            <button type="button" className="btn-secondary ml-auto" onClick={onClose}>
              {t('Annuler')}
            </button>
            <button type="button" className="btn-primary" disabled={!changes} onClick={submit}>
              <CalendarArrowDown size={15} /> {plan?.todo.length || !changes ? t('Importer') : t('Mettre à jour')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
