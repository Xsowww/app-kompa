import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUi, type Toast } from '../store/ui';
import { cx } from '../lib/utils';
import { arrowNav, focusBeforeOverlay, focusables, trapTab } from '../lib/a11y';
import { locale, t } from '../i18n';

function ToastRow({ t: item }: { t: Toast }) {
  const dismiss = useUi(s => s.dismissToast);
  return (
    <div className="pop flex max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-[16px] bg-inverse px-4 py-2.5 font-medium text-[13px] text-on-inverse shadow-pop [overflow-wrap:break-word] sm:max-w-[560px]">
      {item.tone === 'success' ? <CheckCircle2 size={15} className="shrink-0 text-emerald-400" aria-hidden /> : item.tone === 'error' ? <XCircle size={15} className="shrink-0 text-red-400" aria-hidden /> : <Info size={15} className="shrink-0 text-stone-400" aria-hidden />}
      <span className="min-w-0 line-clamp-2">{item.text}</span>
      {item.action && (
        <button
          className="hit-sm pointer-events-auto -my-1 -mr-1.5 ml-1.5 shrink-0 whitespace-nowrap rounded-md px-2 py-1 font-medium text-brand-200 transition-colors hover:bg-on-inverse/10 hover:text-on-inverse dark:text-brand-700"
          onClick={() => {
            dismiss(item.id);
            item.action!.run();
            // This button goes away with the toast. Unless the action focused what it brought back,
            // the focus goes to the page, not to <body> (keyboard and screen readers would start over at the top).
            setTimeout(() => {
              const now = document.activeElement;
              if (!now || now === document.body) document.getElementById('contenu')?.focus({ preventScroll: true });
            }, 0);
          }}
          title={item.action.label === t('Annuler') ? t('Annuler (Ctrl+Z)') : undefined}
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}

/** Toasts are read out by screen readers: errors right away, everything else politely. */
export function Toasts() {
  const toasts = useUi(s => s.toasts).slice(-3);
  // Ctrl+Z (⌘Z) undoes what the last toast offers to undo: from the keyboard, its button is far down the Tab order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const at = document.activeElement as HTMLElement | null;
      if (at && (at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName))) return; // the field's own undo
      const { toasts: all, dismissToast } = useUi.getState();
      const last = [...all].reverse().find(x => x.action?.label === t('Annuler'));
      if (!last) return;
      e.preventDefault();
      dismissToast(last.id);
      last.action!.run();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    // Full width minus 16 px each side: centred with left-1/2 alone, the toast shrank to half the screen on phones.
    // --uploads-room: set by the upload card while it shows (from the bottom of the screen to above it), so that toasts
    // stack above it. --create-room: set on phones while the « + » button shows (components/CreateButton), toasts go above it.
    <div className="pointer-events-none fixed inset-x-4 bottom-[max(calc(6.5rem+var(--create-room,0px)+env(safe-area-inset-bottom)),var(--uploads-room,0px))] z-[70] flex flex-col items-center gap-2 lg:bottom-[max(1.5rem,var(--uploads-room,0px))]">
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
        {toasts.filter(t => t.tone !== 'error').map(t => <ToastRow key={t.id} t={t} />)}
      </div>
      <div role="alert" aria-live="assertive" className="flex flex-col items-center gap-2">
        {toasts.filter(t => t.tone === 'error').map(t => <ToastRow key={t.id} t={t} />)}
      </div>
    </div>
  );
}

/**
 * Modal dialog: keeps Tab inside, closes on Escape, gives the focus back to whatever had it
 * before, and takes its accessible name from its first heading.
 */
export function Modal({ open, onClose, children, width = 420, label }: { open: boolean; onClose: () => void; children: React.ReactNode; width?: number; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const headingId = useId();
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const el = ref.current!;
    const previous = focusBeforeOverlay(el);
    const heading = el.querySelector('h1, h2, h3');
    if (heading && !label) {
      heading.id ||= headingId;
      el.setAttribute('aria-labelledby', heading.id);
    }
    // Children focus their own field first (autoFocus, effects); otherwise the first control.
    if (!el.contains(document.activeElement)) (focusables(el)[0] ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      // Dialog over dialog (a confirmation over « Mes catégories »): only the one on top reacts.
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== el) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else trapTab(e, el);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const now = document.activeElement;
      if (previous?.isConnected && (!now || now === document.body || el.contains(now))) previous.focus();
    };
  }, [open, label, headingId]);
  if (!open) return null;
  // On <body>: a dialog opened from a page that is itself a stacking context (entrance animation) would
  // otherwise end up under Kompaly and the toasts.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#14161f]/40 p-4 backdrop-blur-[2px] dark:bg-black/70" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        // Taller than the screen (event form on a phone): it scrolls inside instead of being cut off.
        className="pop max-h-full w-full overflow-y-auto overscroll-contain rounded-[26px] bg-surface p-6 shadow-pop outline-none dark:ring-1 dark:ring-stone-200"
        style={{ maxWidth: width }}
        onMouseDown={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
    ,
    document.body,
  );
}

function DialogBody() {
  const dialog = useUi(s => s.dialog)!;
  const close = useUi(s => s.closeDialog);
  const [value, setValue] = useState(dialog.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Everything, except the extension of a file name (« Chap. 3 », a link, a folder « v1.2 » are whole).
    const dot = dialog.fileName ? el.value.lastIndexOf('.') : -1;
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the dialog opens
  }, []);

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        close(dialog.kind === 'prompt' ? value : true);
      }}
    >
      <h3 className="text-[18px] font-extrabold tracking-[-0.02em]">{dialog.title}</h3>
      {dialog.message && <p className="mt-1 text-[13px] text-stone-500">{dialog.message}</p>}
      {dialog.kind === 'prompt' && (
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          aria-label={dialog.title}
          // Not type="url": « kompaly.com » (no https://) is accepted, the browser would refuse it.
          {...(dialog.url && { inputMode: 'url' as const, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false })}
          className="field mt-4 w-full"
        />
      )}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => close(null)}>
          {t('Annuler')}
        </button>
        <button type="submit" className={dialog.danger ? 'btn-danger' : 'btn-primary'} disabled={dialog.kind === 'prompt' && !value.trim()} autoFocus={dialog.kind === 'confirm'}>
          {dialog.confirmLabel}
        </button>
      </div>
    </form>
  );
}

export function DialogHost() {
  const dialog = useUi(s => s.dialog);
  const close = useUi(s => s.closeDialog);
  return (
    <Modal open={!!dialog} onClose={() => close(null)}>
      {dialog && <DialogBody key={dialog.title + (dialog.defaultValue ?? '')} />}
    </Modal>
  );
}

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  /** Custom row (e.g. a colour palette) rendered instead of a button. */
  content?: React.ReactNode;
}

/** Name of a menu for screen readers: `label`, else the name of the button that opened it, else « Actions ». */
function menuName(label?: string) {
  if (label) return label;
  const opener = document.activeElement as HTMLElement | null;
  if (!opener || opener === document.body) return t('Actions');
  return opener.getAttribute('aria-label') || opener.title || t('Actions');
}

/** `large`: rows of 44 px with bigger icons (the « + » button's menu, components/CreateButton). */
export function ContextMenu({ x, y, items, onClose, label, large }: { x: number; y: number; items: MenuItem[]; onClose: () => void; label?: string; large?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: Math.max(8, x), y: Math.max(8, y) });
  const [name] = useState(() => menuName(label));

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const el = ref.current;
    if (el) {
      // Always on screen, 8 px from the edges (a keyboard opening could give x = 0 or less). Measured
      // at its widest (no right edge squeezing it), else it grows once moved and touches the edge.
      // (Its own position put back after: when it already fits, React has nothing new to write and the
      // menu fell back to the left edge of the page.)
      const left = el.style.left;
      el.style.left = '0px';
      const r = el.getBoundingClientRect();
      el.style.left = left;
      // No room right of / below the point: the menu opens on the other side of it (its corner at the
      // point, like everywhere else), so the pointer is not left in the middle of the menu.
      const fx = x + r.width > window.innerWidth - 8 ? x - r.width : x;
      const fy = y + r.height > window.innerHeight - 8 ? y - r.height : y;
      setPos({ x: Math.max(8, Math.min(fx, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(fy, window.innerHeight - r.height - 8)) });
    }
    const close = () => closeRef.current();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [x, y]);

  // Keyboard: focus the first entry, arrows to move, Tab closes, focus goes back to the trigger.
  useEffect(() => {
    const el = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    el.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    return () => {
      const now = document.activeElement;
      if (previous?.isConnected && previous !== document.body && (!now || now === document.body || el.contains(now))) previous.focus();
    };
  }, []);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={name}
      className={cx('enter fixed z-[65] border border-stone-200 bg-surface shadow-pop', large ? 'min-w-60 rounded-[18px] p-1.5' : 'min-w-52 rounded-xl p-1')}
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => {
        if (e.key === 'Tab') {
          e.preventDefault();
          closeRef.current();
        } else arrowNav(e, e.currentTarget, 'button');
      }}
    >
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} role="separator" className="my-1 h-px bg-stone-100" />
        ) : it.content ? (
          <div key={i} role="group" aria-label={it.label || undefined}>{it.content}</div>
        ) : (
          <button
            key={i}
            role="menuitem"
            tabIndex={-1}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick();
            }}
            className={cx(
              'flex w-full items-center text-left transition-colors outline-none disabled:opacity-40',
              large ? 'h-11 gap-3 rounded-[12px] px-3 text-[14px] font-medium' : 'h-8 gap-2.5 rounded-md px-2 text-[13px] pointer-coarse:h-10',
              it.danger ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50' : 'text-stone-700 hover:bg-stone-100 focus-visible:bg-stone-100',
              // The background alone is too faint to show the keyboard position.
              'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
            )}
          >
            <span className={cx('flex justify-center', large ? 'w-5 text-stone-500 [&>svg]:h-[18px] [&>svg]:w-[18px]' : 'w-4 text-stone-400 [&>svg]:h-[15px] [&>svg]:w-[15px]')} aria-hidden>{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <span className="font-mono text-[10px] text-stone-500" aria-hidden>{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * Reminders that came due while the app is in view (lib/reminderScheduler): a notification banner,
 * centred at the top of the screen. It stays until closed.
 */
export function ReminderAlerts() {
  const alerts = useUi(s => s.alerts);
  const dismiss = useUi(s => s.dismissAlert);
  const navigate = useNavigate();
  // Échap closes the newest card, like every other window — unless a dialog is open or a field has the focus: Échap is theirs.
  const last = alerts[alerts.length - 1]?.key;
  useEffect(() => {
    if (!last) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      dismiss(last);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last, dismiss]);
  if (!alerts.length) return null;
  return (
    <div
      role="alert"
      className="pointer-events-none fixed inset-x-3 top-[calc(env(safe-area-inset-top)+10px)] z-[75] flex flex-col items-center gap-2.5 lg:top-4"
    >
      {alerts.map(a => (
        <div
          key={a.key}
          className="notif-in pointer-events-auto w-full max-w-[400px] overflow-hidden rounded-[18px] border border-stone-200/80 bg-surface shadow-pop lg:w-[360px]"
        >
          <div className="flex gap-3 px-3.5 pb-3 pt-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-solid text-on-brand" aria-hidden>
              <BellRing size={18} strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline justify-between gap-2 text-[12px] leading-4 text-stone-500">
                {/* My own reminders: « Rappel ». News (shared calendar, administration): where from, its 2nd line. */}
                <span className="truncate font-medium">{/^(event|task):/.test(a.key) ? t('Rappel') : a.body.split('\n')[1] || 'Kompaly'}</span>
                {a.at && <time className="tabular">{new Date(a.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</time>}
              </p>
              <p className="mt-1 line-clamp-2 text-[14.5px] font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{a.title}</p>
              {/* Line 1: when; line 2 (« Agenda »): the system notification's, the card already says it */}
              {a.body && <p className="mt-0.5 text-[13px] leading-snug text-stone-600">{a.body.split('\n')[0]}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-stone-100 text-[13px] font-medium">
            <button type="button" className="h-10 text-stone-600 transition-colors hover:bg-stone-50 hover:text-ink" onClick={() => dismiss(a.key)}>
              {t('Fermer')}
            </button>
            <button
              type="button"
              className="h-10 border-l border-stone-100 text-brand-600 transition-colors hover:bg-brand-50"
              onClick={() => {
                dismiss(a.key);
                navigate(a.url);
              }}
            >
              {t('Voir')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
