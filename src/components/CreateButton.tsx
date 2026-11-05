import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { allActions, useCreate } from '../store/create';
import { ContextMenu } from './Overlays';
import { cx } from '../lib/utils';
import { t } from '../i18n';

/** Controls the button may sit over: buttons, links, fields, ticks (and what a page marks with data-fab-avoid). */
const CONTROL = '[data-fab-avoid], button, a[href], input, textarea, select, [role="checkbox"], [role="button"], [role="switch"], [contenteditable="true"]';
const FIELD = 'input, textarea, select, [role="checkbox"], [role="switch"], [contenteditable="true"]';

/**
 * What it must not cover: a field, a tick, a named button (« Lancer »), what is marked (the focus timer's « Arrêter »).
 * A small icon beside a row (↗, a day's +, a pencil), a day number, a calendar grid (data-fab-ignore) do not count:
 * the « + » stays in sight for those.
 */
const matters = (el: HTMLElement) =>
  !el.closest('[data-fab-ignore]') && (el.matches(FIELD) || !!el.closest('[data-fab-avoid]') || /\p{L}{2}/u.test(el.textContent ?? ''));

/**
 * A control of the page under the « + » button at rest (Lancer, Arrêter, a pencil, a tick…): a few points of its round
 * area are looked at. Rows as wide as the screen don't count (they can be tapped anywhere else), nor what floats over
 * the page (Kompaly, the tab bar, the REC pill: outside #contenu or fixed).
 */
function coversControl(button: HTMLElement): boolean {
  const r = button.getBoundingClientRect();
  if (!r.width) return false;
  const page = document.getElementById('contenu');
  for (const fx of [0.2, 0.5, 0.8]) {
    for (const fy of [0.2, 0.5, 0.8]) {
      // The page's own element there (not the button, nor what floats over the page).
      const under = document.elementsFromPoint(r.left + r.width * fx, r.top + r.height * fy).find(el => el !== button && !button.contains(el) && !!page?.contains(el));
      const control = under?.closest<HTMLElement>(CONTROL);
      if (!control || control.closest('[aria-modal="true"], [role="menu"], [role="dialog"]')) continue;
      if (getComputedStyle(control).position === 'fixed' || !matters(control)) continue;
      if (control.getBoundingClientRect().width < window.innerWidth * 0.6) return true;
    }
  }
  return false;
}

/**
 * The « + » button, bottom right (above the tab bar on phones), like Google Drive's: it creates what the space on
 * screen holds (pages declare it with `useCreateActions`, store/create). One action: done at once; several: a menu
 * above it. No action (Enregistrer, Corbeille, Profil…): no button.
 */
export default function CreateButton() {
  const entries = useCreate(useShallow(s => s.entries));
  const actions = useMemo(() => allActions(entries), [entries]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const shown = actions.length > 0;
  // Out of the way while it would cover a control of the page (looked at once the page stops scrolling) or while a
  // field is being typed in on a touch screen (the keyboard is up, the field near it): it comes back once clear.
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    if (!shown) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const typing = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && window.matchMedia('(pointer: coarse)').matches && (a.matches('input:not([type="checkbox"]):not([type="radio"]), textarea') || a.isContentEditable);
    };
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const b = ref.current;
        if (b && b.getAttribute('aria-expanded') !== 'true') setTucked(typing() || coversControl(b));
      }, 140);
    };
    check();
    const every = setInterval(check, 1500); // a list that grew or shrank
    window.addEventListener('scroll', check, { capture: true, passive: true });
    window.addEventListener('resize', check);
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    return () => {
      clearTimeout(timer);
      clearInterval(every);
      window.removeEventListener('scroll', check, { capture: true });
      window.removeEventListener('resize', check);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
    };
  }, [shown]);

  // Phones: the toasts go up above it (components/Overlays › Toasts).
  useLayoutEffect(() => {
    if (!shown) return;
    const root = document.documentElement.style;
    root.setProperty('--create-room', '2.5rem');
    return () => void root.removeProperty('--create-room');
  }, [shown]);

  // Another page while the menu is open: its lines are gone, so is the menu.
  const [lastActions, setLastActions] = useState(actions);
  if (lastActions !== actions) {
    setLastActions(actions);
    if (menu) setMenu(null);
  }

  if (!shown) return null;
  const single = actions.length === 1 ? actions[0] : null;
  const open = !!menu;
  // Shortcuts are for keyboards: not shown on touch screens.
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  return (
    <>
      <button
        ref={ref}
        id="create-button"
        type="button"
        aria-label={single ? single.label : t('Créer')}
        title={single ? `${single.label} (${single.shortcut})` : t('Créer')}
        aria-keyshortcuts={single ? 'N' : undefined}
        aria-haspopup={single ? undefined : 'menu'}
        aria-expanded={single ? undefined : open}
        aria-hidden={tucked && !open ? true : undefined}
        tabIndex={tucked && !open ? -1 : undefined}
        // The menu closes on any press outside it: this one would reopen it at once (it closes it instead).
        onPointerDown={e => open && e.stopPropagation()}
        onClick={() => {
          if (single) return single.onClick();
          if (open) return setMenu(null);
          const r = ref.current!.getBoundingClientRect();
          // Right-aligned on the button, above it (the menu opens on the other side of the point when there is no room).
          setMenu({ x: r.right, y: r.top - 8 });
        }}
        className={cx(
          'fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-[max(16px,env(safe-area-inset-right))] z-40 short:bottom-[calc(4.25rem+env(safe-area-inset-bottom))] short:h-12 short:w-12 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-pop outline-none ring-2 ring-paper/80 transition-[opacity,background-color] duration-200 motion-reduce:transition-none hover:bg-stone-800',
          'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-paper lg:bottom-6 lg:right-6',
          // Faded where it is: its place is still the one looked at (see coversControl), taps go to the page.
          tucked && !open && 'pointer-events-none opacity-0',
        )}
      >
        <Plus size={26} strokeWidth={2.2} aria-hidden className={cx('transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-45')} />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          large
          above
          label={t('Créer')}
          onClose={() => setMenu(null)}
          items={actions.map(a => ({ label: a.label, icon: a.icon, shortcut: coarse ? undefined : a.shortcut, onClick: a.onClick }))}
        />
      )}
    </>
  );
}

/** Under an empty state where the « + » button now does the creating (no second button there). */
export function PlusHint() {
  return (
    <>
      <span className="pointer-coarse:hidden">{t('Clique sur + pour commencer.')}</span>
      <span className="hidden pointer-coarse:inline">{t('Touche + pour commencer.')}</span>
    </>
  );
}
