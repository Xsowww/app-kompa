import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { allActions, useCreate } from '../store/create';
import { ContextMenu } from './Overlays';
import { cx } from '../lib/utils';
import { t } from '../i18n';

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
        title={single ? single.label : t('Créer')}
        aria-haspopup={single ? undefined : 'menu'}
        aria-expanded={single ? undefined : open}
        // The menu closes on any press outside it: this one would reopen it at once.
        onMouseDown={e => open && e.stopPropagation()}
        onClick={() => {
          if (single) return single.onClick();
          if (open) return setMenu(null);
          const r = ref.current!.getBoundingClientRect();
          // Right-aligned on the button, above it (the menu opens on the other side of the point when there is no room).
          setMenu({ x: r.right, y: r.top - 8 });
        }}
        className={cx(
          'fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-[max(16px,env(safe-area-inset-right))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-pop outline-none transition-colors hover:bg-stone-800',
          'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-paper lg:bottom-6 lg:right-6',
        )}
      >
        <Plus size={26} strokeWidth={2.2} aria-hidden className={cx('transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-45')} />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          large
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
