// « Installer Kompaly » on a computer or an Android phone: the browser's install offer (Chrome, Edge), kept for the
// button in Réglages › Notifications. Installed, Kompaly opens in its own window and its notifications carry its
// name and logo instead of the browser's.

import { useSyncExternalStore } from 'react';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(f => f());

/** Called once at start (main.tsx): the browser makes its offer only once per page. */
export function watchInstall() {
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // our button instead of the browser's bar at the bottom of phones
    offer = e as InstallPrompt;
    changed();
  });
  addEventListener('appinstalled', () => {
    offer = null;
    changed();
  });
}

export const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** Safari on a Mac: no offer to catch, but « Fichier › Ajouter au Dock » does the same. */
export const macSafari = () => /Macintosh/.test(navigator.userAgent) && /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Firefox/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;

export const useInstallOffer = () =>
  useSyncExternalStore(
    f => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => !!offer,
  );

/** Shows the browser's install window; true when the person accepted. */
export async function install(): Promise<boolean> {
  if (!offer) return false;
  const o = offer;
  offer = null;
  changed();
  await o.prompt();
  return (await o.userChoice).outcome === 'accepted';
}
