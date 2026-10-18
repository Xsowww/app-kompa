import { useState, type FormEvent } from 'react';
import { DateField } from '../../components/Pickers';
import { addDays, differenceInCalendarDays } from 'date-fns';
import { Check, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { confirmAction } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { FOLDER_COLORS } from '../../store/drive';
import { fromKey, toKey, fmtDay, weekStart } from '../../lib/dates';
import { MAX_DAYS, PERIOD_IDEAS, periodColor, periodLabel, periodRange, periodTint, repeatPeriod, sortPeriods, type Period } from '../../lib/periods';
import { cx, uid } from '../../lib/utils';
import { useCalendarSource } from './source';

type Draft = { id?: string; title: string; start: string; end: string; color: string; people?: string[] };

function PeriodForm({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const source = useCalendarSource();
  const usage = useSettings(s => s.usage);
  const [d, setD] = useState(draft);
  const [repeat, setRepeat] = useState(false);
  // As typed (it can be empty for a moment while the number is changed), kept between 1 and 52 for the copies.
  const [everyText, setEveryText] = useState('4');
  const every = Math.max(1, Math.min(52, Math.round(Number(everyText)) || 1));
  const [until, setUntil] = useState(() => toKey(addDays(fromKey(draft.start), 7 * 26)));
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }));
  const days = d.start && d.end ? differenceInCalendarDays(fromKey(d.end), fromKey(d.start)) : -1;
  const error = !d.start || !d.end ? 'Choisis le premier et le dernier jour.' : days < 0 ? 'Le dernier jour est avant le premier.' : days > MAX_DAYS ? 'Une période dure au plus un peu plus d’un an.' : '';
  const people = source.shared ? d.people ?? [] : [];
  const base = { title: d.title.trim(), start: d.start, end: d.end, color: d.color, ...(people.length && { people }) };
  const togglePerson = (id: string) => set({ people: people.includes(id) ? people.filter(x => x !== id) : [...people, id] });
  const copies = !d.id && repeat && !error ? repeatPeriod(base, every, until) : [base];

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

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <span className="eyebrow">Du</span>
          <DateField value={d.start} onChange={start => set({ start, ...(start > d.end && { end: start }) })} label="Premier jour" className="mt-1.5 w-full" />
        </div>
        <div>
          <span className="eyebrow">Au (inclus)</span>
          <DateField value={d.end} min={d.start} onChange={end => set({ end })} label="Dernier jour" className="mt-1.5 w-full" />
        </div>
      </div>

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
              <DateField value={until} min={d.start} onChange={setUntil} label="Dernier début possible" className="h-9 w-40" />
              <span className="w-full text-[12px] text-stone-500">
                {copies.length > 1 ? `${copies.length} périodes, la dernière ${periodRange(copies[copies.length - 1], fmtDay)}.` : 'Une seule période avec ces dates.'}
              </span>
            </div>
          )}
        </div>
      )}

      {error && d.start && d.end && <p className="mt-3 text-[12.5px] text-red-600">{error}</p>}
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
  const monday = weekStart(fromKey(day));
  const fresh = (): Draft => ({ title: '', start: toKey(monday), end: toKey(addDays(monday, 6)), color: 'bleu' });
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
                <span className="block text-[12px] text-stone-500">{periodRange(p, fmtDay)}</span>
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
        <PeriodForm key={draft.id ?? 'nouvelle'} draft={draft} onDone={() => setDraft(null)} />
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
