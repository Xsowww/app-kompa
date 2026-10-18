import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DateField } from '../../components/Pickers';
import { addDays, addMonths, differenceInCalendarDays, isSameMonth, startOfMonth } from 'date-fns';
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, Repeat, Trash2, X } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { confirmAction } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { FOLDER_COLORS } from '../../store/drive';
import { fmt, fromKey, toKey, fmtDay, todayKey, weekStart } from '../../lib/dates';
import { covers, daysBetween, periodDays, runsOf, MAX_DAYS, PERIOD_IDEAS, periodColor, periodLabel, periodRange, periodText, periodTint, repeatPeriod, sortPeriods, type Period } from '../../lib/periods';
import { cx, uid } from '../../lib/utils';
import { useCalendarSource } from './source';
import { catOf, sortEvents, type CalendarEvent } from '../../store/calendar';

type Draft = { id?: string; title: string; start: string; end: string; color: string; people?: string[]; skip?: string[] };

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const near = (key: string, n: number) => toKey(addDays(fromKey(key), n));

/**
 * The period's days, ticked right on the month: a tap ticks or unticks a day, a slide ticks every day it
 * passes over (or unticks them, when it starts on a ticked day). So « the 5th to the 9th, then the 12th to
 * the 18th », or a few days taken out of the middle. Shift + click ticks everything since the last day.
 */
function DaysPicker({ days, color, around, others, events, onChange }: {
  days: Set<string>;
  color: string;
  around: string;
  /** The calendar's other periods and its events, shown on the days (a line, a dot) to see what is already there. */
  others: Period[];
  events: CalendarEvent[];
  onChange: (next: Set<string>) => void;
}) {
  const today = todayKey();
  const [month, setMonth] = useState(() => startOfMonth(fromKey([...days].sort()[0] ?? around)));
  // The slide in progress: where it started, where it is, ticking or unticking, and the days before it.
  const drag = useRef<{ from: string; to: string; add: boolean; base: Set<string> } | null>(null);
  const last = useRef<string | null>(null);
  const first = weekStart(month);
  const grid = Array.from({ length: 42 }, (_, i) => toKey(addDays(first, i)));
  const eventsOn = new Map<string, CalendarEvent[]>();
  for (const e of events) if (e.date >= grid[0] && e.date <= grid[41]) eventsOn.set(e.date, [...(eventsOn.get(e.date) ?? []), e]);
  const shownOthers = others.filter(p => p.start <= grid[41] && p.end >= grid[0]);
  const keyAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('[data-day]') as HTMLElement | null)?.dataset.day;
  const paint = (from: string, to: string, add: boolean, base: Set<string>) => {
    const next = new Set(base);
    for (const k of daysBetween(from, to)) {
      if (add) next.add(k);
      else next.delete(k);
    }
    onChange(next);
  };
  // A slide that ends outside the month still ends.
  useEffect(() => {
    const end = () => {
      if (drag.current) last.current = drag.current.to;
      drag.current = null;
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
    return () => {
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
    };
  }, []);

  return (
    <div className="mt-1.5 select-none rounded-2xl bg-surface p-2 ring-1 ring-inset ring-stone-200">
      <div className="mb-1 flex items-center justify-between">
        <button type="button" className="icon-btn" onClick={() => setMonth(m => addMonths(m, -1))} aria-label="Mois précédent">
          <ChevronLeft size={16} />
        </button>
        <span className="text-[13.5px] font-bold first-letter:uppercase" aria-live="polite">{fmt(month, 'MMMM yyyy')}</span>
        <button type="button" className="icon-btn" onClick={() => setMonth(m => addMonths(m, 1))} aria-label="Mois suivant">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-stone-500" aria-hidden>
        {WEEKDAYS.map((d, i) => <span key={i} className="pb-1">{d}</span>)}
      </div>
      <div
        role="group"
        aria-label="Jours de la période"
        className="grid touch-none grid-cols-7 gap-y-0.5"
        onPointerDown={e => {
          const key = keyAt(e.clientX, e.clientY);
          if (!key || e.button > 0) return;
          e.preventDefault();
          // A finger is held by the day it touched first: let it go, it slides over the other days.
          const el = e.target as HTMLElement;
          if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
          if (e.shiftKey && last.current) return paint(last.current, key, true, days);
          const add = !days.has(key);
          drag.current = { from: key, to: key, add, base: new Set(days) };
          paint(key, key, add, days);
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d) return;
          const key = keyAt(e.clientX, e.clientY);
          if (!key || key === d.to) return;
          d.to = key;
          paint(d.from, key, d.add, d.base);
        }}
      >
        {grid.map((key, i) => {
          const on = days.has(key);
          const dayEvents = (eventsOn.get(key) ?? []).sort(sortEvents);
          const dayPeriods = shownOthers.filter(p => covers(p, key));
          const already = [...dayPeriods.map(p => p.title), ...dayEvents.map(e => `${e.start ? `${e.start.replace(':', 'h').replace(/h00$/, 'h').replace(/^0(?=\d)/, '')} ` : ''}${e.title}`)];
          const before = days.has(near(key, -1));
          const after = days.has(near(key, 1));
          const d = fromKey(key);
          return (
            <button
              key={key}
              type="button"
              data-day={key}
              aria-pressed={on}
              aria-label={`${fmt(d, 'EEEE d MMMM yyyy')}${already.length ? ` — déjà : ${already.join(', ')}` : ''}`}
              title={already.length ? already.join('\n') : undefined}
              // The keyboard has no pointer: Entrée / Espace ticks or unticks the day.
              onKeyDown={e => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                last.current = key;
                paint(key, key, !on, days);
              }}
              className={cx(
                'tabular relative flex h-10 items-center justify-center pb-1 text-[13px] pointer-coarse:h-11',
                on ? 'font-semibold' : 'rounded-xl hover:bg-stone-100',
                // Days in a row join into a band, round at its ends and at the ends of the week.
                on && (!before || i % 7 === 0) && 'rounded-l-xl',
                on && (!after || i % 7 === 6) && 'rounded-r-xl',
                !isSameMonth(d, month) && !on && 'text-stone-500',
                key === today && !on && 'text-brand-600',
              )}
              // Every ticked day the same soft tint (no solid ends): the band reads as one.
              style={on ? { background: periodTint({ color }, 22), color: periodText({ color }) } : undefined}
            >
              {d.getDate()}
              {/* What is already there: a dot per event, a line per other period. */}
              {dayEvents.length > 0 && (
                <span className="pointer-events-none absolute bottom-[7px] left-1/2 flex -translate-x-1/2 gap-[2px]" aria-hidden>
                  {dayEvents.slice(0, 3).map(e => <span key={e.id} className="h-1 w-1 rounded-full" style={{ background: catOf(e.category).color }} />)}
                </span>
              )}
              {dayPeriods.length > 0 && (
                <span className="pointer-events-none absolute inset-x-1.5 bottom-[2px] flex gap-[2px]" aria-hidden>
                  {dayPeriods.slice(0, 3).map(p => <span key={p.id} className="h-[3px] flex-1 rounded-full" style={{ background: periodColor(p) }} />)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {shownOthers.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11.5px] font-medium text-stone-600" aria-label="Autres périodes ce mois-ci">
          {shownOthers.map(p => (
            <span key={p.id} className="flex items-center gap-1.5">
              <span className="h-[3px] w-3 rounded-full" style={{ background: periodColor(p) }} aria-hidden />
              {p.title}
            </span>
          ))}
        </div>
      )}
      <p className="mt-1.5 px-1 text-[12px] text-stone-500">
        Touche un jour pour le cocher ou le décocher, glisse pour en prendre plusieurs d’un coup.
        {(shownOthers.length > 0 || eventsOn.size > 0) && ' Les traits sont tes autres périodes, les points tes événements.'}
      </p>
    </div>
  );
}

function PeriodForm({ draft, around, onDone }: { draft: Draft; around: string; onDone: () => void }) {
  const source = useCalendarSource();
  const usage = useSettings(s => s.usage);
  const [d, setD] = useState(draft);
  const [repeat, setRepeat] = useState(false);
  // As typed (it can be empty for a moment while the number is changed), kept between 1 and 52 for the copies.
  const [everyText, setEveryText] = useState('4');
  const every = Math.max(1, Math.min(52, Math.round(Number(everyText)) || 1));
  const [until, setUntil] = useState(() => toKey(addDays(fromKey(draft.start || around), 7 * 26)));
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }));
  // The days ticked: each run of days in a row is saved as one period.
  // The days ticked: one period from the first to the last, the days left out in between are skipped.
  const [days, setDays] = useState(() => new Set(draft.start && draft.end ? daysBetween(draft.start, draft.end).filter(k => !draft.skip?.includes(k)) : []));
  const runs = runsOf(days);
  // What the chosen days already hold: the calendar's other periods, its events.
  const others = source.periods.filter(p => p.id !== d.id);
  const clash = {
    periods: others.map(p => ({ title: p.title, n: [...days].filter(k => covers(p, k)).length })).filter(c => c.n > 0),
    events: source.events.filter(e => days.has(e.date)).sort(sortEvents),
  };
  const [longFrom, setLongFrom] = useState('');
  const [longTo, setLongTo] = useState('');
  const [long, setLong] = useState(false);
  const span = runs.length ? { start: runs[0].start, end: runs[runs.length - 1].end } : null;
  const error = !span ? 'Choisis au moins un jour.' : differenceInCalendarDays(fromKey(span.end), fromKey(span.start)) > MAX_DAYS ? 'Une période dure au plus un peu plus d’un an.' : '';
  const skip = span && !error ? daysBetween(span.start, span.end).filter(k => !days.has(k)) : [];
  const people = source.shared ? d.people ?? [] : [];
  const base = { title: d.title.trim(), color: d.color, ...(people.length && { people }) };
  const togglePerson = (id: string) => set({ people: people.includes(id) ? people.filter(x => x !== id) : [...people, id] });
  const one = { ...base, start: span?.start ?? '', end: span?.end ?? '', ...(skip.length && { skip }) };
  const copies = !d.id && repeat && !error ? repeatPeriod(one, every, until) : [one];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!base.title || error) return;
    source.savePeriods(copies.map((p, i) => ({ ...p, id: i === 0 && d.id ? d.id : uid() })));
    onDone();
  };

  return (
    <form onSubmit={submit} className="mt-4 rounded-2xl bg-stone-50 p-4">
      <label className="eyebrow block" htmlFor="periode-nom">Nom</label>
      <input id="periode-nom" autoFocus value={d.title} maxLength={60} onChange={e => set({ title: e.target.value })} placeholder="Ex. En entreprise" className="field mt-1.5 w-full" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(PERIOD_IDEAS[usage] ?? PERIOD_IDEAS.etudes).map(idea => (
          <button
            key={idea.title}
            type="button"
            onClick={() => set({ title: idea.title, color: idea.color })}
            className={cx('h-7 rounded-full px-3 text-[12px] font-semibold transition-colors pointer-coarse:h-9', d.title === idea.title ? 'ring-2 ring-inset' : 'hover:brightness-95')}
            style={{ background: periodTint(idea, 18), color: `color-mix(in srgb, ${periodColor(idea)} 72%, var(--color-ink))`, ['--tw-ring-color' as string]: periodColor(idea) }}
          >
            {idea.title}
          </button>
        ))}
      </div>

      {source.shared && source.shared.people.length > 1 && (
        <div className="mt-4">
          <p className="eyebrow">Pour qui</p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Pour qui">
            <button type="button" aria-pressed={people.length === 0} onClick={() => set({ people: [] })} className={cx('h-8 rounded-full px-3 text-[12.5px] font-semibold transition-colors pointer-coarse:h-9', people.length === 0 ? 'bg-ink text-paper' : 'bg-surface text-stone-600 ring-1 ring-inset ring-stone-200 hover:text-ink')}>
              Tout le monde
            </button>
            {source.shared.people.map(m => {
              const on = people.includes(m.id);
              return (
                <button key={m.id} type="button" aria-pressed={on} onClick={() => togglePerson(m.id)} className={cx('flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors pointer-coarse:h-9', on ? 'bg-ink text-paper' : 'bg-surface text-stone-600 ring-1 ring-inset ring-stone-200 hover:text-ink')}>
                  {on && <Check size={12} strokeWidth={3} aria-hidden />}
                  {m.name}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[12px] text-stone-500">{people.length ? 'Son nom s’affiche avec la période, pour que tout le monde sache qui est concerné.' : 'La période concerne tout l’agenda.'}</p>
        </div>
      )}

      <p className="eyebrow mt-4">Jours</p>
      <DaysPicker days={days} color={d.color} around={around} others={others} events={source.events} onChange={setDays} />
      {(clash.periods.length > 0 || clash.events.length > 0) && (
        <p className="mt-2 rounded-xl bg-surface px-3 py-2 text-[12.5px] leading-snug text-stone-600 ring-1 ring-inset ring-stone-200" aria-live="polite">
          <span className="font-semibold text-ink">Déjà sur ces jours : </span>
          {[
            ...clash.periods.map(c => `« ${c.title} » (${c.n} jour${c.n > 1 ? 's' : ''})`),
            ...(clash.events.length ? [`${clash.events.length} événement${clash.events.length > 1 ? 's' : ''} (${clash.events.slice(0, 3).map(e => `${e.title}, ${fmtDay(fromKey(e.date), 'EEE d')}`).join(' ; ')}${clash.events.length > 3 ? '…' : ''})`] : []),
          ].join(' · ')}
          . Ils restent visibles : la période se met dessous.
        </p>
      )}
      {runs.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-live="polite">
          {runs.map(r => (
            <span key={r.start} className="flex h-7 items-center gap-1 rounded-full pl-2.5 pr-1 text-[12px] font-semibold pointer-coarse:h-9" style={{ background: periodTint(d, 18), color: periodText(d) }}>
              {periodRange(r, fmtDay)}
              <button
                type="button"
                className="hit-sm flex h-5 w-5 items-center justify-center rounded-full hover:bg-black/10"
                aria-label={`Retirer les jours ${periodRange(r, fmtDay)}`}
                onClick={() => {
                  const next = new Set(days);
                  for (const k of daysBetween(r.start, r.end)) next.delete(k);
                  setDays(next);
                }}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </span>
          ))}
          <span className="text-[12px] text-stone-500">{days.size} jour{days.size > 1 ? 's' : ''}{runs.length > 1 ? ` en ${runs.length} morceaux, une seule période` : ''}</span>
        </div>
      )}
      {long ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[8.5rem] flex-1">
            <span className="eyebrow">Du</span>
            <DateField value={longFrom} onChange={setLongFrom} label="Premier jour à ajouter" className="mt-1.5 w-full" />
          </div>
          <div className="min-w-[8.5rem] flex-1">
            <span className="eyebrow">Au (inclus)</span>
            <DateField value={longTo} min={longFrom || undefined} onChange={setLongTo} label="Dernier jour à ajouter" className="mt-1.5 w-full" />
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={!longFrom || !longTo}
            onClick={() => {
              setDays(new Set([...days, ...daysBetween(longFrom, longTo)]));
              setLongFrom('');
              setLongTo('');
            }}
          >
            <Plus size={15} /> Ajouter ces jours
          </button>
        </div>
      ) : (
        <button type="button" className="mt-2 text-[12.5px] font-semibold text-brand-600 hover:text-brand-700" onClick={() => setLong(true)}>
          Sur plusieurs mois ? Choisir le premier et le dernier jour
        </button>
      )}

      <p className="eyebrow mt-4">Couleur</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Couleur">
        {Object.entries(FOLDER_COLORS).map(([key, c]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={d.color === key}
            aria-label={c.label}
            title={c.label}
            onClick={() => set({ color: key })}
            className={cx('hit-sm flex h-6 w-6 items-center justify-center rounded-full ring-offset-2 ring-offset-stone-50 transition', d.color === key && 'ring-2 ring-stone-400')}
            style={{ background: c.color }}
          >
            {d.color === key && <Check size={12} strokeWidth={3} className="text-white" />}
          </button>
        ))}
      </div>

      {!d.id && (
        <div className="mt-4">
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} className="check-hit h-4 w-4 accent-[var(--color-ink)]" />
            <Repeat size={14} className="text-stone-500" aria-hidden /> Se répète (alternance, garde…)
          </label>
          {repeat && (
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-6 text-[13px]">
              <span>toutes les</span>
              <input type="number" min={1} max={52} value={everyText} onChange={e => setEveryText(e.target.value)} onBlur={() => setEveryText(String(every))} aria-label="Nombre de semaines entre deux débuts" className="field h-9 w-16 text-center" />
              <span>semaines, jusqu’au</span>
              <DateField value={until} min={runs[0]?.start} onChange={setUntil} label="Dernier début possible" className="h-9 w-40" />
              <span className="w-full text-[12px] text-stone-500">
                {copies.length > 1 ? `${copies.length} périodes, la dernière ${periodRange(copies[copies.length - 1], fmtDay)}.` : 'Une seule période avec ces dates.'}
              </span>
            </div>
          )}
        </div>
      )}

      {error && runs.length > 0 && <p className="mt-3 text-[12.5px] text-red-600">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={!base.title || !!error}>
          {d.id ? 'Enregistrer' : copies.length > 1 ? `Ajouter ${copies.length} périodes` : 'Ajouter'}
        </button>
      </div>
    </form>
  );
}

/** « Périodes » : weeks that mean something (en cours / en entreprise, vacances…), tinted on the calendar. */
export default function PeriodsDialog({ day, onClose }: { day: string; onClose: () => void }) {
  const source = useCalendarSource();
  const canEdit = !source.shared || source.shared.canEdit;
  const list = sortPeriods(source.periods);
  // A new period starts with no day ticked: the days are picked on the month.
  const fresh = (): Draft => ({ title: '', start: '', end: '', color: 'bleu' });
  const [draft, setDraft] = useState<Draft | null>(() => (list.length === 0 && canEdit ? fresh() : null));

  const remove = async (p: Period) => {
    if (await confirmAction(`Supprimer « ${p.title} » ?`, `La période ${periodRange(p, fmtDay)} disparaît du calendrier ; les événements restent.`, 'Supprimer')) source.removePeriod(p.id);
  };

  return (
    <Modal open onClose={onClose} width={500}>
      <h3 className="text-[18px]">Périodes</h3>
      <p className="mt-1 text-[13px] text-stone-500">
        Des semaines qui comptent : en cours, en entreprise, en vacances… Les jours concernés sont teintés et la période est nommée au-dessus, sans cacher les événements.
      </p>

      {list.length > 0 && (
        <ul className="mt-4 max-h-[38vh] space-y-1 overflow-y-auto pr-1">
          {list.map(p => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl px-2.5 py-2" style={{ background: periodTint(p, 10) }}>
              <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: periodColor(p) }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{periodLabel(p, source.shared?.nameOf)}</span>
                <span className="block text-[12px] text-stone-500">{periodRange(p, fmtDay)}{p.skip?.length ? ` · ${periodDays(p)} jours` : ''}</span>
              </span>
              {canEdit && (
                <>
                  <button className="icon-btn" title="Modifier" aria-label={`Modifier « ${p.title} »`} onClick={() => setDraft({ ...p })}>
                    <Pencil size={14} />
                  </button>
                  <button className="icon-btn hover:text-red-600" title="Supprimer" aria-label={`Supprimer « ${p.title} »`} onClick={() => void remove(p)}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.length === 0 && !draft && <p className="mt-4 text-[13px] text-stone-500">Aucune période pour l’instant.</p>}

      {draft ? (
        <PeriodForm key={draft.id ?? 'nouvelle'} draft={draft} around={day} onDone={() => setDraft(null)} />
      ) : (
        <div className="mt-5 flex flex-wrap justify-between gap-2">
          {canEdit ? (
            <button className="btn-secondary" onClick={() => setDraft(fresh())}>
              <Plus size={15} /> Ajouter une période
            </button>
          ) : <span />}
          <button className="btn-primary" onClick={onClose}>Terminé</button>
        </div>
      )}
    </Modal>
  );
}
