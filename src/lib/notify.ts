import { deviceState, serviceWorker } from './push';
import { locale, t } from '../i18n';

/** True when this device may show system notifications (allowed by the browser and in Profil › Notifications). */
export const canNotify = () => typeof window !== 'undefined' && deviceState() === 'on';

/**
 * System notification (computer's notification centre, phone's lock screen). Through the service worker:
 * Android and installed apps only accept that way. `tag`: a second one with the same tag replaces the first.
 */
export async function showSystemNotification(title: string, body: string, tag?: string, url = '/') {
  if (!canNotify()) return false;
  try {
    const reg = await serviceWorker();
    // Same look as the service worker's (public/sw.js › notificationOptions): logo, badge, « Voir » / « OK ».
    const options = { body, tag, lang: locale(), icon: '/icon-192.png', badge: '/notification-badge.png', data: { url }, timestamp: Date.now() };
    if (reg) await reg.showNotification(title, { ...options, actions: [{ action: 'voir', title: t('Voir') }, { action: 'ok', title: t('OK') }] } as NotificationOptions);
    else new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

/** Notification for something that happened in the app, only when the tab is in the background (or `force`). */
export function notify(title: string, body: string, force = false) {
  if (!canNotify() || (!force && !document.hidden)) return;
  void showSystemNotification(title, body, title);
}

/** Short soft chime with the Web Audio API (no audio file needed). */
export function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* audio not available */
  }
}
