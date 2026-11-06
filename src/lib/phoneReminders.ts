// « Recevoir les rappels sur ce téléphone » (components/PhoneReminders): what this device needs for the reminders to
// ring, said for it (an iPhone in Safari, Kompaly opened from its icon, Android, a computer). Pure: tested in
// tests/phoneReminders.test.ts.

import { t } from '../i18n';

/**
 * - ios-browser: iPhone or iPad in a browser tab (Safari, Chrome…): notifications only once added to the home screen
 * - ios-app: opened from its icon on the home screen
 * - android: Android phone or tablet
 * - computer: everything else
 */
export type ReminderDevice = 'ios-browser' | 'ios-app' | 'android' | 'computer';

export interface DeviceInfo {
  userAgent: string;
  /** Opened from its icon (display-mode standalone, or navigator.standalone on iOS). */
  standalone: boolean;
  /** navigator.maxTouchPoints: an iPad says « Macintosh », but it has a touch screen. */
  touchPoints: number;
}

export function reminderDevice({ userAgent: ua, standalone, touchPoints }: DeviceInfo): ReminderDevice {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  if (ios) return standalone ? 'ios-app' : 'ios-browser';
  if (/Android/.test(ua)) return 'android';
  return 'computer';
}

/** This browser, as read from the device (the real one only matters for the computer's words). */
export function deviceInfo(): DeviceInfo {
  if (typeof navigator === 'undefined') return { userAgent: '', standalone: false, touchPoints: 0 };
  const standalone = (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true;
  return { userAgent: navigator.userAgent, standalone, touchPoints: navigator.maxTouchPoints ?? 0 };
}

/** « ce téléphone », « cette tablette », « cet ordinateur ». */
export function deviceWord(d: ReminderDevice, ua: string, touchPoints = 0): string {
  if (d === 'computer') return t('cet ordinateur');
  const tablet = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1) || (/Android/.test(ua) && !/Mobile/.test(ua));
  return tablet ? t('cette tablette') : t('ce téléphone');
}

/** The browser of a computer, for the way to allow notifications again. */
function computerBrowser(ua: string): 'firefox' | 'safari' | 'chrome' {
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'safari';
  return 'chrome';
}

/** Notifications refused once: where to allow them again, step by step for this device. */
export function unblockSteps(d: ReminderDevice, ua: string): string[] {
  if (d === 'ios-app' || d === 'ios-browser')
    return [t('Ouvre les Réglages de l’iPhone, puis Notifications.'), t('Choisis Kompaly dans la liste.'), t('Active «\u00a0Autoriser les notifications\u00a0», puis reviens ici.')];
  if (d === 'android')
    return [t('Dans Chrome, touche ⋮ en haut à droite, puis Paramètres.'), t('Choisis Paramètres des sites, puis Notifications.'), t('Autorise Kompaly, puis reviens ici.')];
  const b = computerBrowser(ua);
  if (b === 'safari') return [t('Dans la barre du haut : Safari › Réglages › Sites web.'), t('Choisis Notifications dans la liste de gauche.'), t('Mets Kompaly sur «\u00a0Autoriser\u00a0», puis reviens ici.')];
  if (b === 'firefox') return [t('Clique sur l’icône à gauche de l’adresse du site.'), t('Retire le blocage des notifications.'), t('Recharge la page, puis reviens ici.')];
  return [t('Clique sur l’icône à gauche de l’adresse du site (réglages du site).'), t('Mets Notifications sur «\u00a0Autoriser\u00a0».'), t('Recharge la page, puis reviens ici.')];
}

/** The offer after the first reminder is made: once per account on a device. */
export const offerKey = (userId: string) => `cop:${userId}:reminders-offered`;

/** A reminder just made by the person (not imported, not shared): what brings the offer. */
export function freshReminder(items: { reminders?: number[]; createdAt?: string; externalId?: string }[], now: number, within = 120_000): boolean {
  return items.some(x => !!x.reminders?.length && !x.externalId && !!x.createdAt && now - new Date(x.createdAt).getTime() <= within && now - new Date(x.createdAt).getTime() >= -60_000);
}

/**
 * When « Ton rappel est enregistré » may open (test n°3: it came at bad moments): a reminder saved on this visit (not
 * one already there when the app opened, nor one arriving from another device), no other window, menu or Kompaly's
 * panel open, the person not typing, and no key pressed for 1.5 s.
 */
export function offerMomentOk(s: { typing: boolean; overlay: boolean; lastInput: number; newReminder: boolean }, now: number): boolean {
  return s.newReminder && !s.overlay && !s.typing && now - s.lastInput >= 1500;
}
