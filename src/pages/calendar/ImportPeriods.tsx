import { useEffect, useState } from 'react';
import { CalendarDays, Users } from 'lucide-react';
import { useSettings } from '../../store/settings';
import { useGroups } from '../../store/groups';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/ui';
import { fetchPeriods, groupError } from '../../lib/groups';
import { copyPeriods, periodColor, periodDays, periodLabel, periodRange, samePeriod, sortPeriods, type Period } from '../../lib/periods';
import { fmtDay, todayKey } from '../../lib/dates';
import { cx, uid } from '../../lib/utils';
import { PERSO, useCalendarSource, useImportSources } from './source';
import PeoplePicker from './PeoplePicker';

/** « Importer des périodes » : copies some periods of another calendar (my own, another shared one) into this one. */
export default function ImportPeriods({ onDone }: { onDone: () => void }) {
  const source = useCalendarSource();
  const sources = useImportSources();
  const me = useAuth(s => s.user?.id);
  const [from, setFrom] = useState(sources[0]?.id ?? PERSO);
  const [list, setList] = useState<Period[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // My own periods are about me: on a shared calendar they show my name (« Moi · En entreprise »).
  const fromPerso = from === PERSO;
  const [people, setPeople] = useState<string[]>(() => (fromPerso && me && source.shared?.people.some(m => m.id === me) ? [me] : []));
  const fromName = sources.find(s => s.id === from)?.name ?? '';
  const there = (p: Period) => source.periods.some(q => samePeriod(p, q));

  useEffect(() => {
    let live = true;
    const show = (l: Period[]) => {
      if (!live) return;
      const sorted = sortPeriods(l);
      setList(sorted);
      // Ticked at first: what isn't here yet and isn't over.
      setPicked(new Set(sorted.filter(p => !source.periods.some(q => samePeriod(p, q)) && p.end >= todayKey()).map(p => p.id)));
    };
    setList(null);
    if (from === PERSO) show(useSettings.getState().periods);
    else {
      const loaded = useGroups.getState().periods[from];
      if (loaded) show(loaded);
      else
        fetchPeriods(from)
          .then(show)
          .catch(e => {
            if (!live) return;
            toast(groupError(e), 'error');
            setList([]);
          });
    }
    return () => {
      live = false;
    };
    // Read again only when the calendar changes (not at each change of this one's periods).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  const pickFrom = (id: string) => {
    setFrom(id);
    setPeople(id === PERSO && me && source.shared?.people.some(m => m.id === me) ? [me] : []);
  };
  const toggle = (id: string) => setPicked(s => {
    const n = new Set(s);
    if (!n.delete(id)) n.add(id);
    return n;
  });
  const free = (list ?? []).filter(p => !there(p));
  const chosen = free.filter(p => picked.has(p.id));
  const all = free.length > 0 && chosen.length === free.length;

  const run = () => {
    if (!chosen.length) return;
    source.savePeriods(copyPeriods(chosen, source.shared ? people : [], uid));
    toast(chosen.length > 1 ? `${chosen.length} périodes importées` : 'Période importée', 'success');
    onDone();
  };

  return (
    <div className="mt-4 rounded-2xl bg-stone-50 p-4">
      <p className="text-[14px] font-semibold">Importer des périodes</p>
      <p className="mt-0.5 text-[12.5px] text-stone-500">Une copie arrive ici : la période d’origine ne change pas.</p>

      <p className="eyebrow mt-4">Depuis</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Importer depuis">
        {sources.map(s => (
          <button
            key={s.id}
            type="button"
            aria-pressed={from === s.id}
            onClick={() => pickFrom(s.id)}
            className={cx(
              'flex h-8 max-w-full items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors pointer-coarse:h-9',
              from === s.id ? 'bg-ink text-paper' : 'bg-surface text-stone-600 ring-1 ring-inset ring-stone-200 hover:text-ink',
            )}
          >
            {s.id === PERSO ? <CalendarDays size={13} aria-hidden /> : <Users size={13} aria-hidden />}
            <span className="truncate">{s.name}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-2">
        <p className="eyebrow">Périodes</p>
        {free.length > 1 && (
          <button type="button" className="text-[12.5px] font-semibold text-brand-600 hover:underline pointer-coarse:-my-2 pointer-coarse:py-2" onClick={() => setPicked(all ? new Set() : new Set(free.map(p => p.id)))}>
            {all ? 'Tout décocher' : 'Tout cocher'}
          </button>
        )}
      </div>
      {list === null ? (
        <p className="mt-2 text-[13px] text-stone-500" role="status">Chargement…</p>
      ) : list.length === 0 ? (
        <p className="mt-2 text-[13px] text-stone-500">Aucune période dans « {fromName} ».</p>
      ) : (
        <ul className="mt-2 max-h-[30vh] space-y-1 overflow-y-auto pr-1">
          {list.map(p => {
            const dup = there(p);
            return (
              <li key={p.id}>
                <label className={cx('flex items-center gap-3 rounded-xl bg-surface px-2.5 py-2 ring-1 ring-inset ring-stone-200', dup ? 'opacity-60' : 'cursor-pointer hover:ring-stone-300')}>
                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--color-ink)]" checked={!dup && picked.has(p.id)} disabled={dup} onChange={() => toggle(p.id)} />
                  <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ background: periodColor(p) }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13.5px] font-semibold [overflow-wrap:anywhere]">{periodLabel(p, fromPerso ? undefined : nameIn(from))}</span>
                    <span className="block text-[12px] text-stone-500">
                      {periodRange(p, fmtDay)}
                      {p.skip?.length ? ` · ${periodDays(p)} jours` : ''}
                      {dup ? ' · déjà ici' : p.end < todayKey() ? ' · passée' : ''}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {source.shared && source.shared.people.length > 1 && free.length > 0 && <PeoplePicker people={source.shared.people} value={people} onChange={setPeople} what="ces périodes" />}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>
          Annuler
        </button>
        <button type="button" className="btn-primary" disabled={!chosen.length} onClick={run}>
          {chosen.length > 1 ? `Importer ${chosen.length} périodes` : 'Importer'}
        </button>
      </div>
    </div>
  );
}

/** Names of another shared calendar's members, for its periods « pour qui » (none if they aren't read yet). */
function nameIn(groupId: string) {
  const members = useGroups.getState().members[groupId];
  if (!members?.length) return undefined;
  const me = useAuth.getState().user?.id;
  return (id: string) => (id === me ? 'Moi' : (members.find(m => m.userId === id)?.name ?? 'Un membre'));
}
