// Kompaly's service worker: only for notifications (no offline cache, every request goes to the network).
// Registered by src/lib/push.ts. A push comes from server/push.mjs: { title, body, url, tag, user }.
// With several accounts on the device, its last line names the account (« Compte Léa »).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Chrome, Edge…: a push may be shown inside an open page instead of as a system notification.
// Safari (Mac, iPhone) and Firefox count a push without a notification against the site: there, always one.
const inPageAllowed = /Chrome\//.test(self.navigator.userAgent) && !/iPhone|iPad|iPod/.test(self.navigator.userAgent);

/** Asks the open pages to show it themselves; true when one of them did (visible, same account). */
function shownInPage(windows, data) {
  if (!windows.length) return Promise.resolve(false);
  return new Promise(resolve => {
    let left = windows.length;
    const done = ok => {
      if (ok) resolve(true);
      else if (--left === 0) resolve(false);
    };
    for (const w of windows) {
      const ch = new MessageChannel();
      ch.port1.onmessage = e => done(e.data === 'shown');
      w.postMessage({ type: 'kompaly-reminder', reminder: data, mayShow: inPageAllowed }, [ch.port2]);
      setTimeout(() => done(false), 1500);
    }
  });
}

// This device's accounts ({ id, label }), sent by the app (src/lib/reminderScheduler.ts). Kept in a cache:
// the worker is stopped between two pushes and loses its variables.
const META = 'kompaly-meta';
const ACCOUNTS = '/__kompaly/comptes';
async function deviceAccounts() {
  try {
    const res = await (await caches.open(META)).match(ACCOUNTS);
    const list = res ? await res.json() : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
self.addEventListener('message', e => {
  if (e.data?.type !== 'kompaly-accounts' || !Array.isArray(e.data.accounts)) return;
  const list = e.data.accounts.filter(a => a && typeof a.id === 'string' && typeof a.label === 'string').slice(0, 20);
  e.waitUntil(caches.open(META).then(c => c.put(ACCOUNTS, new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }))));
});

/** With two accounts or more on this device: the last line says which one the notification is for. */
async function withAccount(data) {
  if (!data.user) return data;
  const list = await deviceAccounts();
  const mine = list.find(a => a.id === data.user);
  if (list.length < 2 || !mine) return data;
  // `line`: written by the page in the site's language (older pages: the French one).
  const line = typeof mine.line === 'string' ? mine.line : `Compte ${mine.label}`;
  return { ...data, body: `${data.body ? `${data.body}\n` : ''}${line}` };
}

/** Same look as the app's own notifications (src/lib/notify.ts): keep the two in step. */
function notificationOptions(data) {
  return {
    body: data.body || '',
    tag: data.tag || undefined, // the same reminder from the page and from the server: shown once
    lang: 'fr',
    icon: '/icon-192.png', // the Kompaly logo
    badge: '/notification-badge.png', // Android status bar: one colour, the logo's two circles
    data: { url: data.url || '/', user: data.user || null },
    timestamp: Date.now(),
    // Computers and Android (Chrome, Edge): two buttons under the notification; elsewhere a tap opens it.
    actions: [
      { action: 'voir', title: 'Voir' },
      { action: 'ok', title: 'OK' },
    ],
  };
}

self.addEventListener('push', e => {
  let data;
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { body: e.data ? e.data.text() : '' };
  }
  const title = data.title || 'Kompaly';
  e.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if ((await shownInPage(windows, data)) && inPageAllowed) return;
      await self.registration.showNotification(title, notificationOptions(await withAccount(data)));
    })(),
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'ok') return; // « OK » : seen, nothing to open
  const target = new URL(e.notification.data?.url || '/', self.location.origin);
  // Only Kompaly's own pages (« //ailleurs.example » would leave the site).
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/`;
  e.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = windows.find(w => new URL(w.url).origin === self.location.origin);
      const user = e.notification.data?.user || undefined;
      if (tab) {
        // The app goes to the page itself (no reload), in the notification's account: src/lib/reminderScheduler.ts.
        tab.postMessage({ type: 'kompaly-open', url, user });
        await tab.focus();
        return;
      }
      // No tab: the app opens on that account (« compte » in the address, read once signed in).
      const open = new URL(url);
      if (user) open.searchParams.set('compte', user);
      await self.clients.openWindow(open.href);
    })(),
  );
});
