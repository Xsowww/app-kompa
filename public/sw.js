// Kompaly's service worker: the app's files kept for offline starts (installed app), what other apps share to
// Kompaly, and the notifications. Registered at start by src/boot.tsx (src/lib/push.ts › serviceWorker).
// A push comes from server/push.mjs: { title, body, url, tag, user, keys } (`keys`: several reminders due
// together, sent as one). With several accounts on the device, its last line names the account (« Compte Léa »).

// ── Offline: the app's own files ────────────────────────────────────────────
// The build writes its id here (vite.config.ts › swVersion): a new version online is a new worker, with a cache of
// its own; the former one is deleted once it takes over. Only the site's files: never /api/ (answers, accounts)
// nor Supabase (another address: not touched at all), and only GET.
const VERSION = 'dev';
const APP = `kompaly-app-${VERSION}`;
/** The page itself (every address of the app is the same page), kept under one key. */
const SHELL = '/__kompaly/page';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e =>
  e.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith('kompaly-app-') && name !== APP) await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);

/** Kept when the answer is whole and ours (no error page, no redirect, no partial content). */
async function keep(key, res) {
  if (res.ok && res.status === 200 && res.type === 'basic') await (await caches.open(APP)).put(key, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__kompaly/')) return;
  if (req.method === 'POST' && url.pathname === '/partage') return e.respondWith(receiveShare(req));
  if (req.method !== 'GET' || req.headers.has('range')) return;
  if (req.mode === 'navigate') {
    // The network first (a new version shows at once); offline, the page kept from the last visit.
    e.respondWith(
      fetch(req)
        .then(res => (res.headers.get('content-type')?.includes('text/html') ? keep(SHELL, res) : res))
        .catch(async () => (await caches.match(SHELL)) ?? Response.error()),
    );
    return;
  }
  // Built files carry their content's hash in their name: one kept is the right one, no need to ask again.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit ?? fetch(req).then(res => keep(req, res))));
    return;
  }
  // The site's other files (theme.js, icons, Kompaly's pictures…): the kept copy at once, refreshed behind. Only those
  // at the top (and Kompaly's folder): in development the sources are files too, and must never come from a cache.
  if (/^\/(kompaly\/)?[^/]+\.(js|css|png|svg|webp|ico|woff2|webmanifest)$/.test(url.pathname) && url.pathname !== '/sw.js') {
    const fresh = fetch(req).then(res => keep(req, res));
    e.waitUntil(fresh.catch(() => {}));
    e.respondWith(caches.match(req).then(hit => hit ?? fresh));
  }
});

// The page tells what it loaded before this worker was there (its first visit, or a new version): kept too.
self.addEventListener('message', e => {
  if (e.data?.type !== 'kompaly-keep' || !Array.isArray(e.data.urls)) return;
  e.waitUntil(
    (async () => {
      const cache = await caches.open(APP);
      for (const u of e.data.urls.slice(0, 300)) {
        const url = new URL(u, self.location.origin);
        if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || (await cache.match(url.href, { ignoreSearch: true }))) continue;
        await fetch(url.href).then(res => keep(url.href, res)).catch(() => {});
      }
      if (!(await cache.match(SHELL))) await fetch('/', { credentials: 'same-origin' }).then(res => keep(SHELL, res)).catch(() => {});
    })(),
  );
});

// ── Shared to Kompaly (manifest's share_target): kept here, read by the page /partage (src/pages/SharePage) ──
const SHARED = 'kompaly-share';
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const cache = await caches.open(SHARED);
    const text = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '' };
    await cache.put('/__kompaly/partage/texte', new Response(JSON.stringify(text), { headers: { 'Content-Type': 'application/json' } }));
    let i = 0;
    for (const f of form.getAll('fichiers')) {
      if (typeof f === 'string' || !f.size) continue;
      const headers = { 'Content-Type': f.type || 'application/octet-stream', 'X-Name': encodeURIComponent(f.name || 'fichier') };
      await cache.put(`/__kompaly/partage/fichier-${i++}`, new Response(f, { headers }));
    }
  } catch {
    /* nothing readable: the page says nothing arrived */
  }
  return Response.redirect('/partage?recu=1', 303);
}

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

// Shown here while no page was open: the app, opened later, doesn't show them again (src/lib/reminderScheduler.ts).
const SHOWN = '/__kompaly/vus';
async function rememberShown(data) {
  if (!data.user || data.test) return;
  try {
    const cache = await caches.open(META);
    const res = await cache.match(SHOWN);
    const list = res ? await res.json() : [];
    const keys = Array.isArray(data.keys) ? data.keys : data.tag ? [data.tag] : [];
    const next = [...(Array.isArray(list) ? list : []), { user: data.user, keys }].slice(-50);
    await cache.put(SHOWN, new Response(JSON.stringify(next), { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    /* no cache: at worst the app shows it once more */
  }
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
      await rememberShown(data);
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
