// « Répéter » of a new event (my calendar, a shared calendar, a team's meeting): the ready-made choices, or
// « Personnaliser… » — every N days/weeks/months/years, the days of the week, « le 1er lundi du mois » — and the
// end: « Sans fin » or « Jusqu’au ». The rule itself: lib/repeat (RepeatRule).

import { useState } from 'react';
import { Check } from 'lucide-react';
import { DateField, SelectField } from '../../components/Pickers';
import { REPEATS, nthLabel, nthOfMonth, ruleOf, unitWord, type Repeat, type RepeatRule, type RepeatUnit } from '../../lib/repeat';
import { fromKey } from '../../lib/dates';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';

type Choice = '' | Repeat | 'custom';
const CUSTOM = 'custom';
/** Lundi … dimanche, as in the calendar's columns (0 = Sunday in a rule). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const LETTERS = [t('D||dimanche'), t('L||lundi'), t('M||mardi'), t('M||mercredi'), t('J||jeudi'), t('V||vendredi'), t('S||samedi')];
const NAMES = [t('dimanche'), t('lundi'), t('mardi'), t('mercredi'), t('jeudi'), t('vendredi'), t('samedi')];

/** The ready-made choice a rule is, else « Personnaliser… ». */
const choiceOf = (rule: RepeatRule | null): Choice =>
  !rule ? '' : rule.interval === 1 ? rule.unit : rule.unit === 'week' && rule.interval === 2 ? '2weeks' : CUSTOM;

const segment = (on: boolean) =>
  cx('hit h-8 flex-1 whitespace-nowrap rounded-md px-2.5 text-[12.5px] font-medium transition-colors pointer-coarse:h-10', on ? 'bg-surface text-ink shadow-card' : 'text-stone-600 hover:text-ink');

export default function RepeatPicker({ value, onChange, from, label = t('Répéter') }: { value: RepeatRule | null; onChange: (rule: RepeatRule | null) => void; from: string; label?: string }) {
  // « Personnaliser… » chosen: its fields stay open even when they say « every 1 week ».
  const [custom, setCustom] = useState(() => choiceOf(value) === CUSTOM);
  const choice: Choice = custom && value ? CUSTOM : choiceOf(value);
  const set = (patch: Partial<RepeatRule>) => value && onChange({ ...value, ...patch });
  const weekday = from ? fromKey(from).getDay() : 1;
  const days = value?.unit === 'week' ? (value.days?.length ? value.days : [weekday]) : [];
  const nth = from ? nthOfMonth(from) : 1;

  const pick = (c: Choice) => {
    setCustom(c === CUSTOM);
    if (!c) return onChange(null);
    const until = value?.until;
    if (c === CUSTOM) return onChange(value ?? { unit: 'week', interval: 1, until });
    onChange({ ...ruleOf(c), ...(until && { until }) });
  };

  return (
    <div>
      <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{label}</span>
      <SelectField<Choice>
        className="w-full"
        label={label}
        value={choice}
        options={[{ value: '', label: t('Ne se répète pas') }, ...REPEATS.map(r => ({ value: r.key as Choice, label: r.label })), { value: CUSTOM, label: t('Personnaliser…') }]}
        onChange={pick}
      />
      {value && (
        <div className="mt-2.5 grid gap-2.5 rounded-2xl bg-stone-50 p-3">
          {choice === CUSTOM && (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-stone-700">
              <span>{t('Tous les')}</span>
              <input
                type="text"
                inputMode="numeric"
                value={String(value.interval)}
                onChange={e => {
                  const n = Number(e.target.value.replace(/\D/g, '').slice(0, 2));
                  set({ interval: Math.max(1, n || 1) });
                }}
                aria-label={t('Tous les combien')}
                className="field h-9 w-14 text-center"
              />
              <SelectField<RepeatUnit>
                className="h-9 w-32"
                label={t('Unité de la répétition')}
                value={value.unit}
                options={(['day', 'week', 'month', 'year'] as const).map(u => ({ value: u, label: unitWord(u, value.interval) }))}
                onChange={unit => onChange({ unit, interval: value.interval, ...(value.until && { until: value.until }) })}
              />
            </div>
          )}
          {value.unit === 'week' && (
            <div role="group" aria-label={t('Jours de la semaine')} className="grid max-w-[340px] grid-cols-7 gap-1">
              {WEEK.map(w => {
                const on = days.includes(w);
                return (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={on}
                    aria-label={NAMES[w]}
                    title={NAMES[w]}
                    // At least one day: the last one can't be taken off.
                    onClick={() => (on ? days.length > 1 && set({ days: days.filter(x => x !== w) }) : set({ days: [...days, w] }))}
                    className={cx(
                      'flex h-9 min-w-0 items-center justify-center rounded-full border text-[13px] font-semibold transition-colors pointer-coarse:h-11',
                      on ? 'border-ink bg-ink text-surface' : 'border-stone-200 text-stone-600 hover:bg-stone-100',
                    )}
                  >
                    {LETTERS[w]}
                  </button>
                );
              })}
            </div>
          )}
          {value.unit === 'month' && from && (
            <div className="flex gap-1 rounded-lg bg-stone-100 p-0.5" role="group" aria-label={t('Quel jour du mois')}>
              <button type="button" aria-pressed={!value.nth} onClick={() => set({ nth: undefined })} className={segment(!value.nth)}>
                {t('Le {day}', { day: fromKey(from).getDate() })}
              </button>
              <button type="button" aria-pressed={!!value.nth} onClick={() => set({ nth })} className={segment(!!value.nth)}>
                {nthLabel(nth, from).replace(/^./, c => c.toUpperCase())}
              </button>
            </div>
          )}
          <EndChoice until={value.until ?? null} onChange={until => set({ until: until ?? undefined })} from={from} />
        </div>
      )}
    </div>
  );
}

/** The end of a repeat: « Sans fin » or « Jusqu’au » a day (also in the window of an event that already repeats). */
export function EndChoice({ until, onChange, from }: { until: string | null; onChange: (until: string | null) => void; from: string }) {
  return (
    <div className="grid gap-2 min-[380px]:grid-cols-[auto_minmax(0,1fr)] min-[380px]:items-center">
      <div className="flex gap-1 rounded-lg bg-stone-100 p-0.5" role="group" aria-label={t('Fin de la répétition')}>
        <button type="button" aria-pressed={!until} onClick={() => onChange(null)} className={segment(!until)}>
          {!until && <Check size={12} strokeWidth={3} className="mr-1 inline-block -translate-y-px" aria-hidden />}
          {t('Sans fin')}
        </button>
        <button type="button" aria-pressed={!!until} onClick={() => !until && onChange(defaultEnd(from))} className={segment(!!until)}>
          {!!until && <Check size={12} strokeWidth={3} className="mr-1 inline-block -translate-y-px" aria-hidden />}
          {t('Jusqu’au')}
        </button>
      </div>
      {until && <DateField value={until} onChange={v => v && onChange(v)} min={from || undefined} label={t('Dernier jour de la répétition')} className="w-full" />}
    </div>
  );
}

/** « Jusqu’au » chosen: the end of the school year (30 June) when it is still to come in the next 10 months, else a year later. */
export function defaultEnd(from: string): string {
  const d = from ? fromKey(from) : new Date();
  const june = new Date(d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear(), 5, 30);
  const end = june.getTime() - d.getTime() < 300 * 864e5 && june > d ? june : new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}
