// Date, time and list pickers in Kompaly's look (the browser's own ones are square and grey, and differ
// from one browser to the next). Each is a field-like button that opens a small panel under it.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, addMonths, isSameMonth, startOfMonth } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { fmt, fmtDay, fromKey, parseTime, toKey, todayKey, validKey, weekStart } from '../lib/dates';
import { cx } from '../lib/utils';
import { locale, t } from '../i18n';
import { Popover } from './SelectField';

// The panel and the list picker live in SelectField.tsx (the home page's language menu needs them alone).
export { Popover, SelectField, type Choice } from './SelectField';

/** The button that looks like a field (same height, border and focus ring as `field`). */
function FieldButton({ open, onOpen, icon, children, placeholder, className, label, invalid, describedBy, buttonRef, disabled }: {
  open: boolean;
  onOpen: () => void;
  icon: ReactNode;
  children?: ReactNode;
  placeholder: string;
  className?: string;
  label: string;
  invalid?: boolean;
  /** The id of the error (or hint) under the field. */
  describedBy?: string;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  disabled?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onClick={onOpen}
      className={cx('field flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50', open && 'border-focus ring-1 ring-focus', className)}
    >
      <span className="shrink-0 text-stone-400" aria-hidden>{icon}</span>
      <span className={cx('min-w-0 flex-1 truncate', !children && 'text-stone-500')}>{children ?? placeholder}</span>
    </button>
  );
}

// ── Date ────────────────────────────────────────────────────────────────────
/** « L M M J V S D » in the site's language (1 January 2024 was a Monday). */
// Made when a date picker first opens (7 formatters at start-up cost a slow phone ~45 ms).
let weekdays: string[] | undefined;
const WEEKDAYS = () => {
  const f = new Intl.DateTimeFormat(locale(), { weekday: 'narrow' });
  return (weekdays ??= Array.from({ length: 7 }, (_, i) => f.format(new Date(2024, 0, 1 + i))));
};

function MonthGrid({ value, min, max, onPick }: { value: string; min?: string; max?: string; onPick: (key: string) => void }) {
  const today = todayKey();
  const [month, setMonth] = useState(() => startOfMonth(fromKey(validKey(value) ?? validKey(min) ?? today)));
  const [focusKey, setFocusKey] = useState(() => validKey(value) ?? today);
  const grid = useRef<HTMLDivElement>(null);
  const first = weekStart(month);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const allowed = (k: string) => (!min || k >= min) && (!max || k <= max);

  useEffect(() => {
    grid.current?.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
  }, [focusKey, month]);

  const move = (n: number) => {
    const next = toKey(addDays(fromKey(focusKey), n));
    if (!isSameMonth(fromKey(next), month)) setMonth(startOfMonth(fromKey(next)));
    setFocusKey(next);
  };

  return (
    <div className="w-[276px] p-1">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="icon-btn" onClick={() => setMonth(m => addMonths(m, -1))} aria-label={t('Mois précédent')}>
          <ChevronLeft size={16} />
        </button>
        <span className="text-[14px] font-bold first-letter:uppercase" aria-live="polite">{fmt(month, 'MMMM yyyy')}</span>
        <button type="button" className="icon-btn" onClick={() => setMonth(m => addMonths(m, 1))} aria-label={t('Mois suivant')}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-stone-400" aria-hidden>
        {WEEKDAYS().map((d, i) => <span key={i} className="pb-1">{d}</span>)}
      </div>
      <div
        ref={grid}
        role="group"
        aria-label={t('Jours du mois')}
        className="grid grid-cols-7 gap-0.5"
        onKeyDown={e => {
          const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (step) {
            e.preventDefault();
            move(step);
          }
        }}
      >
        {days.map(d => {
          const key = toKey(d);
          const sel = key === value;
          const ok = allowed(key);
          return (
            <button
              key={key}
              type="button"
              data-key={key}
              tabIndex={key === focusKey ? 0 : -1}
              disabled={!ok}
              aria-pressed={sel}
              aria-label={fmt(d, 'EEEE d MMMM yyyy')}
              onClick={() => onPick(key)}
              className={cx(
                'tabular flex h-9 items-center justify-center rounded-xl text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-30',
                sel ? 'bg-ink font-bold text-paper' : key === today ? 'font-bold text-brand-600 ring-1 ring-inset ring-brand-200 hover:bg-stone-100' : 'hover:bg-stone-100',
                !isSameMonth(d, month) && !sel && 'text-stone-500',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The small calendar under a button, with « Aujourd’hui », « Demain » (and « Effacer »). */
export function DatePopover({ anchor, value, onPick, onClose, min, max, label, clearable }: {
  anchor: HTMLElement;
  value: string;
  onPick: (key: string) => void;
  onClose: () => void;
  min?: string;
  max?: string;
  label: string;
  clearable?: boolean;
}) {
  const today = todayKey();
  const tomorrow = toKey(addDays(new Date(), 1));
  return (
    <Popover anchor={anchor} onClose={onClose} label={label}>
      <MonthGrid value={value} min={min} max={max} onPick={onPick} />
      <div className="mt-1 flex flex-wrap gap-1.5 border-t border-stone-100 px-1 pt-2">
        {[
          [today, t('Aujourd’hui')],
          [tomorrow, t('Demain')],
        ]
          .filter(([k]) => (!min || k >= min) && (!max || k <= max))
          .map(([k, l]) => (
            <button key={k} type="button" onClick={() => onPick(k)} className="h-8 rounded-full bg-stone-100 px-3 text-[12.5px] font-semibold transition-colors hover:bg-stone-200 pointer-coarse:h-9">
              {l}
            </button>
          ))}
        {clearable && value && (
          <button type="button" onClick={() => onPick('')} className="ml-auto flex h-8 items-center gap-1 rounded-full px-3 text-[12.5px] font-semibold text-stone-500 transition-colors hover:bg-stone-100 hover:text-ink pointer-coarse:h-9">
            <X size={13} /> {t('Effacer')}
          </button>
        )}
      </div>
    </Popover>
  );
}

/** A day (YYYY-MM-DD), chosen on a small calendar. */
export function DateField({ value, onChange, min, max, label, placeholder = t('Choisir un jour'), className, clearable, invalid, describedBy, disabled }: {
  value: string;
  onChange: (key: string) => void;
  min?: string;
  max?: string;
  label: string;
  placeholder?: string;
  className?: string;
  clearable?: boolean;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  // The button the panel hangs from while open (null: closed).
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = !!anchor;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setAnchor(a => ((typeof v === 'function' ? v(!!a) : v) ? btn.current : null));
  const pick = (k: string) => {
    onChange(k);
    setOpen(false);
    btn.current?.focus();
  };
  const shown = validKey(value);
  return (
    <>
      <FieldButton buttonRef={btn} open={open} onOpen={() => setOpen(o => !o)} icon={<CalendarDays size={15} />} placeholder={placeholder} className={className} label={shown ? t('{label} : {value}', { label, value: fmt(fromKey(shown), 'EEEE d MMMM yyyy') }) : label} invalid={invalid} describedBy={describedBy} disabled={disabled}>
        {shown && <span className="inline-block first-letter:uppercase">{fmtDay(fromKey(shown), 'EEE d MMM')}</span>}
      </FieldButton>
      {anchor && <DatePopover anchor={anchor} value={value} min={min} max={max} label={label} clearable={clearable} onPick={pick} onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Time ────────────────────────────────────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

function TimePanel({ value, onPick, clearable }: { value: string; onPick: (v: string, done: boolean) => void; clearable?: boolean }) {
  const [text, setText] = useState(value ? value.replace(':', 'h') : '');
  const [h, m] = value ? value.split(':') : ['', ''];
  const lists = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // The chosen hour and minute in view (else 8:00, the start of a usual day).
    for (const col of lists.current?.querySelectorAll<HTMLElement>('[data-col]') ?? []) {
      const on = col.querySelector<HTMLElement>('[aria-pressed="true"]') ?? col.querySelector<HTMLElement>('[data-v="08"]');
      if (on) col.scrollTop = on.offsetTop - col.clientHeight / 2 + on.clientHeight / 2;
    }
  }, []);
  const typed = parseTime(text);
  // A time typed and then left (Tab, a click elsewhere) is kept, not lost; Échap still cancels it, and a
  // pick made after typing (a minute in the list, « OK », « Sans heure ») is the one that counts.
  const leave = useRef({ typed, value, onPick, escaped: false, typing: false });
  useEffect(() => {
    leave.current = { ...leave.current, typed, value, onPick };
  });
  useEffect(() => {
    // Before the panel's own Échap (child effects are set up first).
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (leave.current.escaped = true);
    addEventListener('keydown', onKey, true);
    return () => {
      removeEventListener('keydown', onKey, true);
      const l = leave.current;
      if (!l.escaped && l.typing && l.typed && l.typed !== l.value) l.onPick(l.typed, false);
    };
  }, []);
  const pick = (v: string, done: boolean) => {
    leave.current.typing = false;
    onPick(v, done);
  };
  const pickFromList = (v: string, done: boolean) => {
    setText(v.replace(':', 'h'));
    leave.current.typing = false;
    onPick(v, done);
  };
  const minutes = m && !MINUTES.includes(m) ? [...MINUTES, m].sort() : MINUTES;
  return (
    <div className="w-[208px]">
      <form
        className="flex gap-1.5 p-1"
        onSubmit={e => {
          e.preventDefault();
          e.stopPropagation();
          if (typed) pick(typed, true);
        }}
      >
        <input
          autoFocus
          value={text}
          onChange={e => {
            leave.current.typing = true;
            setText(e.target.value);
          }}
          inputMode="numeric"
          spellCheck={false}
          autoComplete="off"
          placeholder={t('14h30')}
          aria-label={t('Heure, à taper (14h30, 9h…)')}
          className={cx('field h-9 min-w-0 flex-1 text-center text-[14px] font-semibold', text && !typed && 'border-red-400')}
        />
        <button type="submit" disabled={!typed} className="btn-primary h-9 px-3">
          {t('OK')}
        </button>
      </form>
      <div ref={lists} className="mt-1 grid grid-cols-2 gap-1 border-t border-stone-100 pt-1">
        {[
          // The hour keeps the panel open (the minutes come next) and shows in the box above, where « OK » takes it.
          { hours: true, list: HOURS, current: h, label: t('Heure') },
          { hours: false, list: minutes, current: m, label: t('Minutes') },
        ].map(col => (
          <div key={col.label} data-col role="group" aria-label={col.label} className="max-h-52 space-y-0.5 overflow-y-auto overscroll-contain p-0.5">
            {col.list.map(v => (
              <button
                key={v}
                type="button"
                data-v={v}
                aria-pressed={v === col.current}
                onClick={() => (col.hours ? pickFromList(`${v}:${m || '00'}`, false) : pickFromList(`${h || '08'}:${v}`, true))}
                className={cx('tabular flex h-8 w-full items-center justify-center rounded-lg text-[13.5px] transition-colors pointer-coarse:h-9', v === col.current ? 'bg-ink font-bold text-paper' : 'hover:bg-stone-100')}
              >
                {col.hours ? t('{n} h||heure', { n: Number(v) }) : v}
              </button>
            ))}
          </div>
        ))}
      </div>
      {clearable && value && (
        <button type="button" onClick={() => pick('', true)} className="mt-1 flex h-8 w-full items-center justify-center gap-1 rounded-lg text-[12.5px] font-semibold text-stone-500 transition-colors hover:bg-stone-100 hover:text-ink">
          <X size={13} /> {t('Sans heure')}
        </button>
      )}
    </div>
  );
}

/** A time (HH:mm), typed (« 14h30 ») or picked from an hours / minutes list. */
export function TimeField({ value, onChange, label, placeholder = t('Heure'), className, clearable, invalid, describedBy, disabled }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  clearable?: boolean;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  // The button the panel hangs from while open (null: closed).
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = !!anchor;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setAnchor(a => ((typeof v === 'function' ? v(!!a) : v) ? btn.current : null));
  return (
    <>
      <FieldButton buttonRef={btn} open={open} onOpen={() => setOpen(o => !o)} icon={<Clock size={15} />} placeholder={placeholder} className={className} label={value ? t('{label} : {value}', { label, value }) : label} invalid={invalid} describedBy={describedBy} disabled={disabled}>
        {/* Shown as in the lists (« 14:30 »); typed as one likes (« 14h30 »). */}
        {value ? <span className="tabular">{value}</span> : undefined}
      </FieldButton>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} label={label}>
          <TimePanel
            value={value}
            clearable={clearable}
            onPick={(v, done) => {
              onChange(v);
              if (done) {
                setOpen(false);
                btn.current?.focus();
              }
            }}
          />
        </Popover>
      )}
    </>
  );
}
