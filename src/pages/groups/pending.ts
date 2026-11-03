import { create } from 'zustand';
import { toast } from '../../store/ui';
import { groupError } from '../../lib/groups';
import { t } from '../../i18n';

// A shared note or file deleted for every member: hidden at once, sent to the server only after the « Annuler »
// of its toast (as a shared calendar's events, SharedCalendar). Leaving the app sends it at once.

const UNDO_MS = 6000;
const senders = new Map<string, () => void>();

/** Ids waiting for their « Annuler »: the lists leave them out. */
export const usePendingRemovals = create<{ ids: string[] }>(() => ({ ids: [] }));
const setIds = () => usePendingRemovals.setState({ ids: [...senders.keys()] });

/** Hides `ids`, says `message` with « Annuler » and, unless undone, runs `send` (a refusal is said, they come back). */
export function removeWithUndo(ids: string[], message: string, send: () => Promise<unknown>) {
  let done = false;
  const finish = () => {
    done = true;
    clearTimeout(timer);
    ids.forEach(id => senders.delete(id));
    setIds();
  };
  const go = () => {
    if (done) return;
    finish();
    void send().catch(e => toast(groupError(e), 'error'));
  };
  const timer = setTimeout(go, UNDO_MS);
  ids.forEach(id => senders.set(id, go));
  setIds();
  toast(message, 'info', { label: t('Annuler||l’action'), run: () => !done && finish() });
}

const flush = () => [...new Set(senders.values())].forEach(send => send());
if (typeof window !== 'undefined') {
  addEventListener('pagehide', flush);
  // Closing the tab right away: the deletion may not reach the server in time, so the browser asks first.
  addEventListener('beforeunload', e => {
    if (senders.size) e.preventDefault();
  });
}
