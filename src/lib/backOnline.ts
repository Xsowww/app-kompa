// The connection is back after a time offline: the changes made meanwhile leave at once, and a toast says so
// (« Hors ligne » had promised it: components/Overlays › ServiceBanner).

import { flushNow, pendingCount } from './cloudSync';
import { toast } from '../store/ui';
import { t, tn } from '../i18n';

/** What the toast says: with what was sent, when there was something and it all went. */
export const backOnlineText = (count: number, sent: boolean) =>
  count > 0 && sent ? tn(count, 'De retour en ligne · {n} changement envoyé', 'De retour en ligne · {n} changements envoyés') : t('De retour en ligne');

/** Watches the connection for the signed-in account; returns what stops it. */
export function watchBackOnline(): () => void {
  let offline = navigator.onLine === false;
  const onOffline = () => (offline = true);
  const onOnline = async () => {
    if (!offline) return;
    offline = false;
    const count = pendingCount();
    const sent = count > 0 && (await flushNow().catch(() => false));
    toast(backOnlineText(count, sent), 'success');
  };
  addEventListener('offline', onOffline);
  addEventListener('online', onOnline);
  return () => {
    removeEventListener('offline', onOffline);
    removeEventListener('online', onOnline);
  };
}
