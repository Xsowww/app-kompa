import { Check } from 'lucide-react';
import { cx } from '../../lib/utils';

/**
 * « Pour qui » on a shared calendar (an event, a period): everyone, or some members, named next to it
 * (« Léa · Dentiste »). `value` empty: the whole calendar.
 */
export default function PeoplePicker({ people, value, onChange, what }: { people: { id: string; name: string }[]; value: string[]; onChange: (ids: string[]) => void; what: string }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  return (
    <div className="mt-4">
      <p className="eyebrow">Pour qui</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Pour qui">
        <button type="button" aria-pressed={value.length === 0} onClick={() => onChange([])} className={cx('h-8 rounded-full px-3 text-[12.5px] font-semibold transition-colors pointer-coarse:h-9', value.length === 0 ? 'bg-ink text-paper' : 'bg-surface text-stone-600 ring-1 ring-inset ring-stone-200 hover:text-ink')}>
          Tout le monde
        </button>
        {people.map(m => {
          const on = value.includes(m.id);
          return (
            <button key={m.id} type="button" aria-pressed={on} onClick={() => toggle(m.id)} className={cx('flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors pointer-coarse:h-9', on ? 'bg-ink text-paper' : 'bg-surface text-stone-600 ring-1 ring-inset ring-stone-200 hover:text-ink')}>
              {on && <Check size={12} strokeWidth={3} aria-hidden />}
              {m.name}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[12px] text-stone-500">{value.length ? `Son nom s’affiche avec ${what}, pour que tout le monde sache qui est concerné.` : `${what.replace(/^./, c => c.toUpperCase())} concerne tout l’agenda.`}</p>
    </div>
  );
}
