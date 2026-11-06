import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

// Test n°3, majeur n°8: every page in « net::ERR_FAILED » after an invitation link or the 2nd opening of a fresh
// profile, until sw.js was removed. public/sw.js run in a fake worker: it must never be what breaks the site.
const code = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://kompaly.test';

type Res = Response & { redirected: boolean; type: ResponseType };
/** A Response as the network gives it to a worker (same origin: « basic »; reached by a redirect or not). */
const net = (body: string, { status = 200, type = 'html', redirected = false, url = `${ORIGIN}/` } = {}) => {
  const r = new Response(body, { status, headers: { 'content-type': type === 'html' ? 'text/html; charset=utf-8' : 'text/javascript' } }) as Res;
  Object.defineProperties(r, { redirected: { value: redirected }, type: { value: 'basic' }, url: { value: url } });
  return r;
};

function worker(fetchImpl: (req: unknown, init?: unknown) => Promise<Response>, { brokenCache = false } = {}) {
  const store = new Map<string, Map<string, Response>>();
  const keyOf = (k: unknown) => (typeof k === 'string' ? new URL(k, ORIGIN).href : (k as { url: string }).url);
  const caches = {
    keys: async () => [...store.keys()],
    delete: async (n: string) => store.delete(n),
    open: async (n: string) => {
      if (!store.has(n)) store.set(n, new Map());
      const m = store.get(n)!;
      return {
        put: async (k: unknown, r: Response) => {
          if (brokenCache) throw new DOMException('Quota', 'QuotaExceededError');
          m.set(keyOf(k), r);
        },
        match: async (k: unknown) => m.get(keyOf(k))?.clone(),
      };
    },
    match: async (k: unknown) => {
      for (const m of store.values()) {
        const hit = m.get(keyOf(k));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    navigator: { userAgent: 'Chrome/130' },
    addEventListener: (t: string, f: (e: unknown) => void) => (handlers[t] ??= []).push(f),
    skipWaiting: () => undefined,
    registration: { navigationPreload: { enable: async () => undefined } },
    clients: { claim: async () => undefined },
  };
  runInNewContext(code, { self, caches, fetch: fetchImpl, Response, Headers, URL, MessageChannel, setTimeout, console });
  const waits: Promise<unknown>[] = [];
  const open = async (path: string, mode = 'navigate') => {
    let answer: Promise<Response> | undefined;
    const request = { url: `${ORIGIN}${path}`, method: 'GET', mode, headers: new Headers() };
    handlers.fetch.forEach(f => f({ request, respondWith: (p: Promise<Response>) => (answer = p), waitUntil: (p: Promise<unknown>) => waits.push(p), preloadResponse: Promise.resolve(undefined) }));
    const res = answer ? await answer : undefined;
    await Promise.all(waits);
    return res as Res | undefined;
  };
  const activate = async () => {
    const w: Promise<unknown>[] = [];
    handlers.activate.forEach(f => f({ waitUntil: (p: Promise<unknown>) => w.push(p) }));
    await Promise.all(w);
  };
  return { open, activate, store, caches };
}

let offline = false;
beforeEach(() => (offline = false));

describe('service worker (public/sw.js)', () => {
  it('ouvre la page par le réseau et la garde pour hors ligne', async () => {
    const w = worker(async () => (offline ? Promise.reject(new TypeError('Failed to fetch')) : net('<html>app</html>')));
    expect(await (await w.open('/agenda'))!.text()).toBe('<html>app</html>');
    offline = true;
    const res = await w.open('/notes');
    expect(res!.status).toBe(200);
    expect(await res!.text()).toBe('<html>app</html>');
  });

  it('un cache plein ou refusé ne casse jamais la page', async () => {
    const w = worker(async () => net('<html>ok</html>'), { brokenCache: true });
    const res = await w.open('/');
    expect(res!.status).toBe(200);
    expect(await res!.text()).toBe('<html>ok</html>');
  });

  it('ne garde jamais une redirection, une erreur ni une réponse opaque', async () => {
    let next: Response = net('<html>ailleurs</html>', { redirected: true, url: `${ORIGIN}/connexion` });
    const w = worker(async () => next);
    await w.open('/invitation/abc');
    next = net('Introuvable', { status: 404 });
    await w.open('/kit-media');
    next = Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaque' });
    await w.open('/x');
    const kept = [...w.store.values()].flatMap(m => [...m.keys()]);
    expect(kept).toEqual([]);
  });

  it('une page gardée par une ancienne version avec sa redirection est servie sans elle (sinon ERR_FAILED)', async () => {
    const w = worker(async () => Promise.reject(new TypeError('offline')));
    const old = net('<html>ancienne</html>', { redirected: true });
    await (await w.caches.open('kompaly-app-dev')).put('/__kompaly/page', old);
    const res = await w.open('/');
    expect(res!.redirected).toBe(false);
    expect(await res!.text()).toBe('<html>ancienne</html>');
  });

  it('le réseau qui échoue dans le worker : la page est redemandée par son adresse, une redirection suivie par le navigateur', async () => {
    let calls = 0;
    const w = worker(async (req: unknown) => {
      calls++;
      if (typeof req !== 'string') throw new TypeError('cannot replay');
      return net('<html>rejoindre</html>', { redirected: true, url: `${ORIGIN}/rejoindre` });
    });
    const res = await w.open('/i/abc');
    expect(calls).toBe(2);
    expect(res!.status).toBe(303);
    expect(res!.headers.get('location')).toBe(`${ORIGIN}/rejoindre`);
  });

  it('sans réseau ni page gardée : une page « Pas de connexion », jamais Response.error()', async () => {
    const w = worker(async () => Promise.reject(new TypeError('offline')));
    const res = await w.open('/');
    expect(res!.type).not.toBe('error');
    expect(res!.status).toBe(503);
    expect(await res!.text()).toContain('Pas de connexion');
  });

  it('ne touche ni /api/ ni les autres sites, et efface les anciennes versions à l’activation', async () => {
    const w = worker(async () => net('x'));
    expect(await w.open('/api/sante', 'cors')).toBeUndefined();
    await w.caches.open('kompaly-app-ancienne');
    await w.caches.open('kompaly-share');
    await w.activate();
    expect([...w.store.keys()].sort()).toEqual(['kompaly-share']);
  });
});
