// The app's global keyboard shortcuts (layout/AppShell), as listed in Réglages › Raccourcis:
//   ?  the shortcuts · /  the search (like Ctrl+K) · N  the page's « + » · G then A C T N D E P  a space
//   Ctrl+J (⌘J)  opens or closes Kompaly, even when his character is hidden.
// Single keys never fire while typing (field, text area, list, editable text), with another modifier, or under a
// dialog or a menu: they belong to it then.

import { useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { allActions, useCreate } from '../store/create';
import { useCopilot } from '../store/copilot';

/** G then this letter: where it goes. */
export const GO_TO: Record<string, string> = { a: '/', c: '/calendrier', t: '/taches', n: '/notes', d: '/drive', e: '/enregistrer', p: '/profil' };
/** After G, the second key is awaited this long (ms). */
export const G_WAIT = 1500;

export type Shortcut = { kind: 'go'; to: string } | { kind: 'search' | 'help' | 'create' | 'kompaly' | 'g' };

type Keys = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** What a key does, `afterG`: G was just pressed. null: nothing (the key stays the page's). */
export function shortcutOf(e: Keys, afterG = false): Shortcut | null {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j') return { kind: 'kompaly' };
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  // ? and / need Shift on many keyboards (French: Maj + , and Maj + :): Shift is theirs, not the letters'.
  if (afterG) return !e.shiftKey && GO_TO[e.key.toLowerCase()] ? { kind: 'go', to: GO_TO[e.key.toLowerCase()] } : null;
  if (e.key === '?') return { kind: 'help' };
  if (e.key === '/') return { kind: 'search' };
  if (e.shiftKey) return null;
  const k = e.key.toLowerCase();
  return k === 'n' ? { kind: 'create' } : k === 'g' ? { kind: 'g' } : null;
}

/** Where a typed key belongs to the field, not to a shortcut. */
const typing = (el: EventTarget | null) => el instanceof Element && !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

export function useGlobalShortcuts(navigate: NavigateFunction) {
  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing || /^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) return;
      const afterG = Date.now() - gAt < G_WAIT;
      gAt = 0;
      const action = shortcutOf(e, afterG);
      if (!action) return;
      // Kompaly's panel is a dialog on phones: Ctrl+J still closes it; any other dialog or menu keeps its keys.
      const covered = document.querySelector(action.kind === 'kompaly' ? '[aria-modal="true"]:not(#copilot-panel), [role="menu"]' : '[aria-modal="true"], [role="menu"]');
      if (covered || (action.kind !== 'kompaly' && typing(e.target))) return;
      e.preventDefault();
      // The page's own keys (the calendar's T for today…) don't also take the second key of G + letter.
      e.stopPropagation();
      if (action.kind === 'g') gAt = Date.now();
      else if (action.kind === 'go') navigate(action.to);
      else if (action.kind === 'help') navigate('/profil?onglet=raccourcis');
      else if (action.kind === 'create') allActions(useCreate.getState().entries)[0]?.onClick();
      // The very same as Ctrl+K: the search field on screen (header on computers, under it on narrow screens).
      // From the page's body, like a key pressed there (the pages' own key handlers expect an element).
      else if (action.kind === 'search') document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
      else {
        const { pose, setPose, clearBubble } = useCopilot.getState();
        clearBubble();
        setPose(pose === 'open' ? 'hidden' : 'open');
      }
    };
    // Capture: before the pages' own keys (and a dialog's, which this leaves alone anyway).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [navigate]);
}
