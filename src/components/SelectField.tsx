// The list picker in Kompaly's look, and the panel under a button that the date and time pickers share (Pickers.tsx).
// Apart from them: the language menu of the home page needs this one without the date code.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from '../lib/utils';
import { t } from '../i18n';

// ── The panel ───────────────────────────────────────────────────────────────
/**
 * A panel under (or above, when there is no room) the button that opened it. On <body>, over dialogs;
 * Échap closes it (not the dialog under it), a click elsewhere too, and the focus goes back to the button.
 */
export function Popover({ anchor, onClose, label, children, className }: { anchor: HTMLElement; onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const a = anchor.getBoundingClientRect();
      // Its size without the opening zoom (a scale animation makes the box smaller for a moment).
      const r = { width: el.offsetWidth, height: el.offsetHeight };
      let top = a.bottom + 6;
      if (top + r.height > innerHeight - 8 && a.top - 6 - r.height > 8) top = a.top - 6 - r.height;
      setPos({ left: Math.max(8, Math.min(a.left, innerWidth - r.width - 8)), top: Math.max(8, Math.min(top, innerHeight - r.height - 8)) });
    };
    place();
    // A dialog that scrolls under it: the panel follows its button.
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    return () => {
      removeEventListener('scroll', place, true);
      removeEventListener('resize', place);
    };
  }, [anchor]);

  useEffect(() => {
    const close = (refocus: boolean) => {
      closeRef.current();
      if (refocus) anchor.focus();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) close(false);
    };
    // On window, in the capture phase: before the dialog's own keys (Échap would close it, Tab trap the focus).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close(true);
      } else if (e.key === 'Tab' && ref.current?.contains(document.activeElement)) {
        e.stopPropagation();
        e.preventDefault();
        close(true);
      }
    };
    addEventListener('pointerdown', onDown, true);
    addEventListener('keydown', onKey, true);
    return () => {
      removeEventListener('pointerdown', onDown, true);
      removeEventListener('keydown', onKey, true);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cx('pop fixed z-[90] rounded-[18px] bg-surface p-2 shadow-pop ring-1 ring-stone-200 outline-none', className)}
      style={pos ?? { left: -9999, top: 0 }}
      onMouseDown={e => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── List ────────────────────────────────────────────────────────────────────
export interface Choice<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
}

/** One choice among a few, in a list under the button (instead of the browser's « select »). */
export function SelectField<T extends string | number>({ value, options, onChange, label, className, disabled, bare, icon }: {
  value: T;
  options: Choice<T>[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  disabled?: boolean;
  /** A small text button (page header) instead of a form field. */
  bare?: boolean;
  icon?: ReactNode;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  // The button the panel hangs from while open (null: closed).
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = !!anchor;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setAnchor(a => ((typeof v === 'function' ? v(!!a) : v) ? btn.current : null));
  const current = options.find(o => o.value === value);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) (list.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.current?.querySelector<HTMLElement>('button'))?.focus();
  }, [open]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('{label} : {value}', { label, value: current?.label ?? '—' })}
        onClick={() => setOpen(o => !o)}
        className={cx(
          bare
            ? 'hit inline-flex items-center gap-1.5 rounded-lg px-1.5 text-[12px] font-medium text-stone-500 transition-colors hover:text-ink'
            : cx('field flex items-center gap-2 text-left', open && 'border-focus ring-1 ring-focus'),
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        {icon}
        <span className={cx('min-w-0 truncate', !bare && 'flex-1')}>{current?.label ?? '—'}</span>
        <ChevronDown size={bare ? 13 : 15} className={cx('shrink-0 text-stone-400 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} label={label} className="p-1">
          <div
            ref={list}
            role="listbox"
            aria-label={label}
            className="max-h-72 min-w-48 overflow-y-auto"
            style={{ minWidth: anchor.offsetWidth }}
            onKeyDown={e => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              const items = [...(list.current?.querySelectorAll<HTMLElement>('button') ?? [])];
              const i = items.indexOf(document.activeElement as HTMLElement);
              items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
            }}
          >
            {options.map(o => (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  btn.current?.focus();
                }}
                className={cx('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-stone-100 focus-visible:bg-stone-100', o.value === value && 'font-semibold')}
              >
                <span className="min-w-0 flex-1">
                  <span className="block">{o.label}</span>
                  {o.hint && <span className="block text-[12px] font-normal text-stone-500">{o.hint}</span>}
                </span>
                {o.value === value && <Check size={15} className="shrink-0 text-brand-600" aria-hidden />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
