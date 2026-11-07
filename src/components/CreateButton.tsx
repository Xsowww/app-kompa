import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { allActions, useCreate } from '../store/create';
import { ContextMenu } from './Overlays';
import { cx } from '../lib/utils';
import { t } from '../i18n';

/**
 * What a page marked as never to be covered (data-fab-avoid: the focus timer's « Arrêter »…) under the « + » button at
 * rest: a few points of its round area are looked at. Only what is marked: stepping aside for any link, tick or field it
 * passed over (« Toutes les tâches », a note's text on a tablet) made it come and go as the page scrolled, as if it were
 * broken. The pages end with room under their last line (pb-room): scrolled to the end, nothing is under it. What
 * floats over the page (Kompaly, the tab bar, a dialog) doesn't count.
 */
function coversControl(button: HTMLElement): boolean {
  const r = button.getBoundingClientRect();
  if (!r.width) return false;
  const page = document.getElementById('contenu');
  for (const fx of [0.2, 0.5, 0.8]) {
    for (const fy of [0.2, 0.5, 0.8]) {
      // The page's own element there (not the button, nor what floats over the page).
      const under = document.elementsFromPoint(r.left + r.width * fx, r.top + r.height * fy).find(el => el !== button && !button.contains(el) && !!page?.contains(el));
      const marked = under?.closest<HTMLElement>('[data-fab-avoid]');
      if (marked && !marked.closest('[aria-modal="true"], [role="menu"], [role="dialog"]') && getComputedStyle(marked).position !== 'fixed') return true;
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
  // Out of the way while it would cover what a page marked (looked at once the page stops scrolling) or while a field is
  // being typed in on a touch screen (the keyboard is up, the field near it): it comes back once clear.
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
