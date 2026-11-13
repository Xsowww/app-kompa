import { Check } from 'lucide-react';
import type { Group } from '../../lib/groups';
import { groupColor } from './util';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';

/**
 * « Agenda : Perso · Famille · Coloc » in the « + » form (calendar/EventForm): where a new event goes, one or several
 * (mine and the family's). Shown only with at least one shared calendar I can add to (groups/agendaAdd ›
 * useAgendaTargets). `value`: the ones ticked, '' for my own calendar, else the shared calendar's id; never none.
 */
export default function AgendaChoice({ targets, value, onChange }: { targets: Group[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (!targets.length) return null;
  const options = [{ id: '', name: t('Perso'), color: '#2f9e6b' }, ...targets.map(g => ({ id: g.id, name: g.name, color: groupColor(g) }))];
  return (
    <div className="mt-4" role="group" aria-labelledby="event-agenda-label">
      <p id="event-agenda-label" className="mb-1.5 text-[12px] font-medium text-stone-600">
        {t('Agenda')} <span className="font-normal text-stone-500">· {t('Plusieurs réponses possibles.')}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map(o => {
          const on = value.includes(o.id);
          return (
            <button
              key={o.id || 'perso'}
              type="button"
              aria-pressed={on}
              // The last one ticked stays: an event goes somewhere.
              onClick={() => onChange(on ? (value.length > 1 ? value.filter(x => x !== o.id) : value) : [...value, o.id])}
              className={cx(
                'hit flex h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors pointer-coarse:h-9',
                on ? 'border-ink/40 bg-stone-100 font-semibold text-ink' : 'border-stone-200 text-stone-600 hover:bg-stone-50',
              )}
            >
              {on ? <Check size={13} strokeWidth={3} aria-hidden className="shrink-0" /> : <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.color }} aria-hidden />}
              <span className="truncate">{o.name}</span>
            </button>
          );
        })}
      </div>
      {value.some(Boolean) && (
        <p className="mt-1.5 text-[12px] text-stone-500">
          {value.filter(Boolean).length > 1 ? t('Chaque membre de ces agendas le verra.') : t('Chaque membre de cet agenda le verra.')}
        </p>
      )}
    </div>
  );
}
