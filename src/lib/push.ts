// This device's notifications: the permission, the service worker (public/sw.js) and the push
// subscription that lets the server (server/push.mjs) reach it while the site is closed.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getStorageUser } from './userStorage';
import { t } from '../i18n';

/**
 * - unsupported: this browser can't show notifications
 * - install: iPhone/iPad, only once the site is added to the home screen
 * - denied: refused (only the browser's site settings can undo it)
 * - off: not asked yet, or turned off in Kompaly
 * - on: notifications allowed (push: also while the site is closed)
 */
export type DeviceState = 'unsupported' | 'install' | 'denied' | 'off' | 'on';

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const supported = () => 'serviceWorker' in navigator && typeof Notification !== 'undefined';

let registration: Promise<ServiceWorkerRegistration | null> | null = null;
/** The service worker, registered once (it only handles notifications, no offline cache). */
export function serviceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  registration ??= navigator.serviceWorker.register('/sw.js').catch(e => {
    console.warn('[notifications] service worker', e);
    return null;
  });
  return registration;
}

let serverKey: Promise<string | null> | null = null;
/** The server's public push key, or null when push isn't set up there (reminders then only show while the app is open). */
function pushKey(): Promise<string | null> {
  serverKey ??= fetch('/api/push/cle')
    .then(r => (r.ok ? r.json() : null))
    .then((b: { key?: string } | null) => b?.key ?? null)
    .catch(() => null);
  return serverKey;
}

// Turned off in Kompaly on this device, for this account (the browser's permission stays given).
const offKey = () => `cop:${getStorageUser()}:notifications-off`;
function turnedOff() {
  try {
    return localStorage.getItem(offKey()) === '1';
  } catch {
    return false;
  }
}
function setTurnedOff(off: boolean) {
  try {
    if (off) localStorage.setItem(offKey(), '1');
    else localStorage.removeItem(offKey());
  } catch {
    /* private mode: only for this visit */
  }
}

export function deviceState(): DeviceState {
  if (!supported()) return ios() && !installed() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && !turnedOff() ? 'on' : 'off';
}

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || ios() ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : t('Appareil');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) || /CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : t('Navigateur');
  return `${os} · ${browser}`;
}

/** This browser's push subscription (made with the server's current key), or null. */
async function subscription(create: boolean): Promise<PushSubscription | null> {
  const reg = await serviceWorker();
  const key = await pushKey();
  if (!reg?.pushManager || !key) return null;
  const want = fromB64url(key);
  let sub = await reg.pushManager.getSubscription();
  // The server's key changed (new PUSH_SECRET): the old subscription can't receive anything any more.
  if (sub && !sameKey(sub.options.applicationServerKey, want)) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  return sub;
}

/** Tells the server this device receives the account's notifications. */
async function saveSubscription(sub: PushSubscription) {
  const userId = (await supabase?.auth.getSession())?.data.session?.user.id;
  if (!supabase || !userId) return;
  const j = sub.toJSON();
  // This device is now the signed-in account's: another account kept on it stops getting its notifications here
  // (else, with two accounts on one phone, you'd be told of what you just did yourself).
  let { error } = await supabase.rpc('claim_push_endpoint', { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_device: deviceName() });
  if (error?.code === 'PGRST202')
    ({ error } = await supabase
      .from('push_subscriptions')
      .upsert({ user_id: userId, endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, device: deviceName() }, { onConflict: 'user_id,endpoint' }));
  // Server without the 2026-10-17 migration yet: reminders still show while the app is open.
  if (error && !/push_subscriptions|PGRST205|42P01/.test(`${error.code} ${error.message}`)) console.warn('[notifications]', error.message);
}

/**
 * Asks for the permission (must follow a click), then subscribes this device to push.
 * Returns the state after: 'on' even when push isn't available (the app still notifies while open).
 */
export async function enableDevice(): Promise<DeviceState> {
  if (!supported()) return deviceState();
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return deviceState();
  setTurnedOff(false);
  await serviceWorker();
  try {
    const sub = await subscription(true);
    if (sub) await saveSubscription(sub);
  } catch (e) {
    console.warn('[notifications] abonnement push', e);
  }
  return 'on';
}

/** Turned off in Kompaly: no more notifications from this account on this device. */
export async function disableDevice() {
  setTurnedOff(true);
  await forgetThisDevice().catch(() => undefined);
}

/** At each start: keeps the server's list of this device up to date (new key, account added on this device…). */
export async function refreshDevice() {
  if (deviceState() !== 'on') return;
  await serviceWorker();
  const sub = await subscription(true).catch(() => null);
  if (sub) await saveSubscription(sub);
}

/** This account stops receiving notifications on this device (other accounts on it keep theirs). */
export async function forgetThisDevice(client: SupabaseClient | null = supabase) {
  if (!client || !supported()) return;
  const sub = await subscription(false).catch(() => null);
  if (sub) await client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
}

/** True when this device gets the reminders from the server too (so the app waits a little before showing them itself). */
export async function pushActive(): Promise<boolean> {
  if (deviceState() !== 'on') return false;
  return !!(await subscription(false).catch(() => null));
}

/** Test from the server: proves the whole chain, also with the site closed (`delay` seconds to close it). */
export async function sendTestPush(delay = 0): Promise<'ok' | 'unavailable' | 'error'> {
  const sub = await subscription(true).catch(() => null);
  if (!sub) return 'unavailable';
  const r = await fetch('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), delay }) }).catch(() => null);
  return r?.ok ? 'ok' : 'error';
}
