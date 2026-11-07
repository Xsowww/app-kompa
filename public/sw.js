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
      // Only the former versions of the app's files go (never the shared files waiting, nor the accounts' words).
      for (const name of await caches.keys()) if (name.startsWith('kompaly-app-') && name !== APP) await caches.delete(name).catch(() => false);
      // The page's request starts while this worker wakes up (a phone saves ~0,1 s at each opening).
      await self.registration.navigationPreload?.enable().catch(() => undefined);
      await self.clients.claim();
    })(),
  ),
);

/**
 * Fit to keep: whole, ours, 200, and not reached through a redirect. A redirected answer given back to a page's
 * opening is refused by the browser (« net::ERR_FAILED » on every page, test n°3): never kept, never served.
 */
const keepable = res => !!res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected;

/** Kept when fit. A full or refused cache never breaks the answer. */
const keep = (key, res) => (keepable(res) ? store(key, res) : Promise.resolve());
/** Stores an answer already checked (a copy, made while the original goes to the page). */
async function store(key, res) {
  try {
    await (await caches.open(APP)).put(key, res);
  } catch {
    /* cache full or refused: the page works, only not offline */
  }
}

/** A copy kept by an older version may still carry its redirect: served as a plain answer. */
const plain = res => (res && res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res);

const fromCache = (key, opts) => caches.match(key, opts).then(plain, () => undefined);

/** No network and no page kept: a page that says so, instead of the browser's error (or ERR_FAILED). */
const offlinePage = () =>
  new Response(
    '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kompaly · Pas de connexion</title>' +
      '<body style="font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:1rem;text-align:center;color:#1c1917;background:#faf8f5">' +
      '<main><h1 style="font-size:1.25rem">Pas de connexion</h1><p>Kompaly s’ouvrira dès que le réseau revient.</p>' +
      '<p><a href="" style="display:inline-block;padding:.75rem 1.25rem;border-radius:.75rem;background:#1c1917;color:#fff;text-decoration:none">Réessayer</a></p></main></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );

/**
 * Opening a page: the network first (a new version shows at once), the page kept from the last visit without network.
 * Whatever goes wrong in this worker, the page is asked again by its address before giving up: the worker never
 * blocks the site (before, a refused cache or a redirect kept made every page fail until the worker was removed).
 */
async function openPage(e) {
  const req = e.request;
  try {
    const res = (await e.preloadResponse?.catch(() => undefined)) || (await fetch(req));
    if (keepable(res) && res.headers.get('content-type')?.includes('text/html')) e.waitUntil(store(SHELL, res.clone()));
    return res;
  } catch {
    try {
      const res = await fetch(req.url, { credentials: 'same-origin' });
      // Reached through a redirect: the browser goes there itself (a redirected answer can't open a page).
      return res.redirected ? Response.redirect(res.url, 303) : res;
    } catch {
      return (await fromCache(SHELL)) ?? offlinePage();
    }
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__kompaly/')) return;
  if (req.method === 'POST' && url.pathname === '/partage') return e.respondWith(receiveShare(req));
  if (req.method !== 'GET' || req.headers.has('range')) return;
  if (req.mode === 'navigate') return e.respondWith(openPage(e));
  // Built files carry their content's hash in their name: one kept is the right one, no need to ask again.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      fromCache(req, { ignoreSearch: true }).then(
        hit =>
          hit ??
          fetch(req).then(res => {
            if (keepable(res)) e.waitUntil(store(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }
  // The site's other files (theme.js, icons, Kompaly's pictures, the Pro wallpapers…): the kept copy at once, refreshed
  // behind. Only those at the top (and the folders of pictures): in development the sources are files too, and must
  // never come from a cache.
  if (/^\/((kompaly|pro|landing)\/)?[^/]+\.(js|css|png|svg|webp|ico|woff2|webmanifest)$/.test(url.pathname) && url.pathname !== '/sw.js') {
    const fresh = fetch(req).then(res => {
      if (keepable(res)) e.waitUntil(store(req, res.clone()));
      return res;
    });
    e.waitUntil(fresh.catch(() => {}));
    e.respondWith(fromCache(req).then(hit => hit ?? fresh));
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
      // The page itself, only as a plain page (« / » redirected elsewhere is not kept: keep() checks it).
      if (!(await cache.match(SHELL))) await fetch('/', { credentials: 'same-origin' }).then(res => (res.headers.get('content-type')?.includes('text/html') ? keep(SHELL, res) : undefined)).catch(() => {});
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
// With them, the site's language and the words of the buttons (the server's pushes don't carry them).
const WORDS = '/__kompaly/mots';
const metaJson = v => new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });
self.addEventListener('message', e => {
  if (e.data?.type !== 'kompaly-accounts' || !Array.isArray(e.data.accounts)) return;
  const list = e.data.accounts.filter(a => a && typeof a.id === 'string' && typeof a.label === 'string').slice(0, 20);
  const b = e.data.buttons && typeof e.data.buttons === 'object' ? e.data.buttons : {};
  const text = v => (typeof v === 'string' ? v.slice(0, 40) : undefined);
  const words = { lang: text(e.data.lang), voir: text(b.voir), ok: text(b.ok), later: text(b.later), done: text(b.done) };
  e.waitUntil(caches.open(META).then(c => Promise.all([c.put(ACCOUNTS, metaJson(list)), c.put(WORDS, metaJson(words))])));
});
async function deviceWords() {
  try {
    const res = await (await caches.open(META)).match(WORDS);
    const w = res ? await res.json() : null;
    return w && typeof w === 'object' ? w : {};
  } catch {
    return {};
  }
}

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

/** The reminders a push stands for: several sent as one (`keys`), else its tag. */
const keysOf = data => (Array.isArray(data.keys) && data.keys.length ? data.keys.map(String) : data.tag ? [String(data.tag)] : []);
/** A reminder of a task or an event of mine (not the morning summary « task:matin:… »): as src/lib/reminders › reminderItem. */
const isItem = key => /^(task|event):[^:]+:/.test(key) && !key.startsWith('task:matin:');

/**
 * Same look as the app's own notifications (src/lib/notify.ts, lib/reminders › notificationButtons): keep them in step.
 * `words`: the site's language and its words (French until a page has given them).
 */
function notificationOptions(data, words = {}) {
  const keys = keysOf(data);
  const mine = keys.length > 0 && keys.every(isItem);
  const voir = { action: 'voir', title: words.voir || 'Voir' };
  return {
    body: data.body || '',
    tag: data.tag || undefined, // the same reminder from the page and from the server: shown once
    lang: words.lang || 'fr',
    icon: '/icon-192.png', // the Kompaly logo
    badge: '/notification-badge.png', // Android status bar: one colour, the logo's two circles
    data: { url: data.url || '/', user: data.user || null, keys },
    timestamp: Date.now(),
    // Computers and Android (Chrome, Edge): two buttons under the notification; elsewhere a tap opens it.
    // A reminder of mine: « Plus tard » (10 min) and « Fait » (« Voir » for several); the others: « Voir » and « OK ».
    actions: mine
      ? [{ action: 'plus-tard', title: words.later || 'Plus tard' }, new Set(keys.map(k => k.split(':').slice(0, 2).join(':'))).size === 1 && keys[0].startsWith('task:') ? { action: 'fait', title: words.done || 'Fait' } : voir] // « Fait »: a task only
      : [voir, { action: 'ok', title: words.ok || 'OK' }],
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
      await self.registration.showNotification(title, notificationOptions(await withAccount(data), await deviceWords()));
      await rememberShown(data);
    })(),
  );
});

/** Asks the open page to do « Plus tard » or « Fait » (src/lib/reminderScheduler); true once it said it did. */
function doneInPage(tab, message) {
  return new Promise(resolve => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve(true);
    tab.postMessage(message, [ch.port2]);
    setTimeout(() => resolve(false), 1000);
  });
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'ok') return; // « OK » : seen, nothing to open
  const target = new URL(e.notification.data?.url || '/', self.location.origin);
  // Only Kompaly's own pages (« //ailleurs.example » would leave the site).
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/`;
  // « Plus tard », « Fait »: the app does it (its tasks, events and reminders), the page staying where it is.
  const action = e.action === 'plus-tard' || e.action === 'fait' ? e.action : '';
  const keys = Array.isArray(e.notification.data?.keys) ? e.notification.data.keys : [];
  e.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = windows.find(w => new URL(w.url).origin === self.location.origin);
      const user = e.notification.data?.user || undefined;
      if (tab && action) {
        // A page asleep in the background (phone) answers once woken: brought forward then (the message waits for it).
        if (!(await doneInPage(tab, { type: 'kompaly-action', action, keys, url, user }))) await tab.focus().catch(() => undefined);
        return;
      }
      if (tab) {
        // The app goes to the page itself (no reload), in the notification's account: src/lib/reminderScheduler.ts.
        tab.postMessage({ type: 'kompaly-open', url, user });
        await tab.focus();
        return;
      }
      // No tab: the app opens on that account (« compte » in the address, read once signed in), and does the action.
      const open = new URL(url);
      if (user) open.searchParams.set('compte', user);
      if (action) {
        open.searchParams.set('action', action);
        open.searchParams.set('cles', keys.join(','));
      }
      await self.clients.openWindow(open.href);
    })(),
  );
});
