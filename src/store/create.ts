import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { create } from 'zustand';

/** One line of the « + » button (components/CreateButton): what the page on screen can create. */
export interface CreateAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** Shown on computers, beside the label (e.g. « Ctrl N »). */
  shortcut?: string;
}

interface Entry {
  id: string;
  order: number;
  actions: CreateAction[];
}

/** The actions declared by the components on screen (a page, its open tab…), in their `order`. */
export const useCreate = create<{ entries: Entry[] }>(() => ({ entries: [] }));

export const allActions = (entries: Entry[]) => [...entries].sort((a, b) => a.order - b.order).flatMap(e => e.actions);

/**
 * Declares what the « + » button creates while this component is on screen. Each page keeps its own functions
 * (its dialogs, its folder…): the latest ones run. `order`: where these lines go when several components declare
 * some (an open tab's before its page's). No action: no button.
 */
export function useCreateActions(actions: CreateAction[], order = 0) {
  const id = useId();
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  // Declared again only when the lines change, not at every render (their functions are read when clicked).
  const key = actions.map(a => `${a.label}\u0000${a.shortcut ?? ''}`).join('\u0001');
  useEffect(() => {
    const list = latest.current.map((a, i) => ({ ...a, onClick: () => latest.current[i]?.onClick() }));
    useCreate.setState(s => {
      const others = s.entries.filter(e => e.id !== id);
      return { entries: list.length ? [...others, { id, order, actions: list }] : others };
    });
  }, [id, key, order]);
  useEffect(() => () => useCreate.setState(s => ({ entries: s.entries.filter(e => e.id !== id) })), [id]);
}

const narrowQuery = typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)') : null;
const onNarrow = (f: () => void) => {
  narrowQuery?.addEventListener('change', f);
  return () => narrowQuery?.removeEventListener('change', f);
};
/** A phone: a note open there fills the screen, and the button would sit on its text (no button then). */
export const useNarrow = () => useSyncExternalStore(onNarrow, () => narrowQuery?.matches ?? false);
