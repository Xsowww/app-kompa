import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cx } from '../lib/utils';

// Spacing of every form (one scale): label → field 6 px (mb-1.5), field → field 16 px (space-y-4 / gap-4),
// before the main button 24 px (mt-6). Errors sit 6 px under their field.

/** A field's error, right under it (red, with an icon), read out as it appears. Nothing when there is no error. */
export function FieldError({ id, children, className }: { id?: string; children?: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className={cx('mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-red-600', className)}>
      <AlertCircle size={14} className="mt-px shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

type Input = ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;

/** Label, the field (its only child: it gets the id and the aria-* attributes), an optional hint, and its error under it. */
export default function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string; children: Input; className?: string }) {
  const auto = useId();
  const id = children.props.id ?? auto;
  const describedBy = [children.props['aria-describedby'], error ? `${id}-err` : hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-stone-600">
        {label}
      </label>
      {cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <FieldError id={`${id}-err`}>{error}</FieldError>
      ) : (
        hint && (
          <div id={`${id}-hint`} className="mt-1.5 text-[11.5px] text-stone-500">
            {hint}
          </div>
        )
      )}
    </div>
  );
}
