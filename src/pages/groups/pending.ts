import { create } from 'zustand';
import { toast } from '../../store/ui';
import { groupError } from '../../lib/groups';
import { t } from '../../i18n';
import { forgetDelete, rememberDelete, sendOnLeave, type WaitingDelete } from '../../lib/pendingDeletes';

// A shared note or file deleted for every member: hidden at once, sent to the server only after the « Annuler »
// of its toast (as a shared calendar's events, SharedCalendar). Leaving the app sends it at once; `durable` writes it on
// this device first, so a reload during the toast doesn't lose it (lib/pendingDeletes: sent at the next start).

const UNDO_MS = 6000;
const senders = new Map<string, () => void>();
/** The deletions written on this device (lib/pendingDeletes), by id. */
const durables = new Map<string, string>();

/** Ids waiting for their « Annuler »: the lists leave them out. */
export const usePendingRemovals = create<{ ids: string[] }>(() => ({ ids: [] }));
const setIds = () => usePendingRemovals.setState({ ids: [...senders.keys()] });

/** Hides `ids`, says `message` with « Annuler » and, unless undone, runs `send` (a refusal is said, they come back). */
export function removeWithUndo(ids: string[], message: string, send: () => Promise<unknown>, durable?: Omit<WaitingDelete, 'key'>) {
  let done = false;
  const key = durable && rememberDelete(durable);
  const finish = () => {
    done = true;
    clearTimeout(timer);
    ids.forEach(id => (senders.delete(id), durables.delete(id)));
    setIds();
  };
  const go = () => {
    if (done) return;
    finish();
    void send()
      .catch(e => toast(groupError(e), 'error')) // said: it comes back, and is not sent again later
      .finally(() => key && forgetDelete(key));
  };
  const timer = setTimeout(go, UNDO_MS);
  ids.forEach(id => (senders.set(id, go), key && durables.set(id, key)));
  setIds();
  toast(message, 'info', {
    label: t('Annuler||l’action'),
    run: () => {
      if (done) return;
      finish();
      if (key) forgetDelete(key);
    },
  });
}

const flush = () => {
  // The page is going: the requests must outlive it (kept on this device too, sent again at the next start).
  sendOnLeave([...new Set(durables.values())]);
  [...new Set(senders.values())].forEach(send => send());
};
if (typeof window !== 'undefined') {
  addEventListener('pagehide', flush);
  // Closing the tab right away: the deletion may not reach the server in time, so the browser asks first.
  addEventListener('beforeunload', e => {
    if (senders.size) e.preventDefault();
  });
}
