import { Minus, Plus } from 'lucide-react';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';

/** A settings card. Without a title (when it would only repeat the tab name), it is labelled by `label`. */
export function Section({ title, label, description, children, danger }: { title?: string; label?: string; description?: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={cx('card enter', danger && 'border-red-200')} aria-label={title ? undefined : label}>
      {title && (
        <header className="border-b border-stone-100 px-5 py-4">
          <h2 className={cx('text-[14px] font-semibold', danger && 'text-red-700')}>{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-stone-500">{description}</p>}
        </header>
      )}
      <div className="divide-y divide-stone-100">{children}</div>
    </section>
  );
}

/**
 * The label and its control side by side, the control on the right (a switch stays there on phones, like in the
 * phone's own settings); a control too wide for the line goes under the label instead of squeezing it.
 */
export function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-[1_1_11rem]">
        <p className="text-[13px] font-medium [overflow-wrap:anywhere]">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-stone-500">{hint}</p>}
      </div>
      {children && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('hit relative h-[22px] w-[38px] shrink-0 rounded-full p-0 transition-colors', checked ? 'bg-brand-500' : 'bg-stone-300')}
    >
      <span className={cx('absolute left-0 top-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[19px]' : 'translate-x-[3px]')} />
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    // The shared segmented control (index.css › seg): the chosen and the hovered choice have the frame's own shape.
    <div className="seg text-[12px]" role="group" aria-label={label}>
      {options.map(o => (
        <button
          key={String(o.value)}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="seg-item"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** `label` names the value (« Nombre de séances ») for screen readers: the buttons say what they change. */
export function Stepper({ value, min, max, onChange, suffix, label }: { value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string; label: string }) {
  return (
    <div className="flex h-9 items-center rounded-lg border border-stone-200 bg-surface shadow-card pointer-coarse:h-10" role="group" aria-label={label}>
      {/* aria-disabled, not disabled: a disabled button would drop the keyboard focus at the end of the range. */}
      <button className="hit flex h-full w-9 items-center justify-center text-stone-500 hover:text-ink aria-disabled:opacity-30 pointer-coarse:w-10" aria-disabled={value <= min} onClick={() => value > min && onChange(value - 1)} aria-label={t('{label}\u00a0: moins', { label })}>
        <Minus size={13} />
      </button>
      {/* Announced after each change (the button keeps the focus). */}
      <span className="tabular min-w-12 text-center text-[13px] font-medium" aria-live="polite" aria-atomic="true">
        {value}
        {suffix && <span className="font-normal text-stone-500"> {suffix}</span>}
      </span>
      <button className="hit flex h-full w-9 items-center justify-center text-stone-500 hover:text-ink aria-disabled:opacity-30 pointer-coarse:w-10" aria-disabled={value >= max} onClick={() => value < max && onChange(value + 1)} aria-label={t('{label}\u00a0: plus', { label })}>
        <Plus size={13} />
      </button>
    </div>
  );
}
