// « S'abonner à un emploi du temps par lien » : the page can't read an .ics link itself (other sites don't allow it),
// so it asks here: GET /api/ics?url=… → the calendar's text. Signed-in students only.
//
// The address comes from the student: the server must never be made to call its own network (SSRF). So: http(s)
// only, standard ports, and every address the name resolves to is checked AT CONNECTION TIME (the `lookup` given to
// the request), redirects included: a name that answers a public address to a check and a private one to the
// connection gets nowhere.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { authenticate, ipOf, rateLimited, send } from './copilot.mjs';

const MAX_BYTES = 5_000_000; // a school year of a big timetable is ~1-2 Mo
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;

// Addresses that are not the public internet.
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
])
  PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2001:db8::', 32], ['::', 96], ['::ffff:0:0:0', 96], ['2002::', 16], ['2001::', 32]]) PRIVATE.addSubnet(net, bits, 'ipv6');

export function isPublicAddress(address) {
  const kind = isIP(address);
  if (!kind) return false;
  // IPv4 written as IPv6 (::ffff:10.0.0.1): judged as the IPv4 it is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return !PRIVATE.check(mapped[1], 'ipv4');
  return !PRIVATE.check(address, kind === 4 ? 'ipv4' : 'ipv6');
}

/** The link as the server will call it, or null. webcal:// is the same as https://. */
export function feedUrl(raw) {
  let u;
  try {
    u = new URL(String(raw ?? '').trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
  if (u.port && !['80', '443'].includes(u.port)) return null;
  if (isIP(u.hostname.replace(/^\[|\]$/g, '')) && !isPublicAddress(u.hostname.replace(/^\[|\]$/g, ''))) return null;
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) return null;
  return u;
}

/** dns.lookup that refuses non-public addresses: used by the request itself, so nothing can swap the address after. */
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return callback(err);
    const ok = list.filter(a => isPublicAddress(a.address));
    if (!ok.length || ok.length !== list.length) return callback(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
    if (options?.all) return callback(null, ok);
    callback(null, ok[0].address, ok[0].family);
  });
}

function getOnce(u) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { lookup: safeLookup, timeout: TIMEOUT_MS, headers: { 'User-Agent': 'Kompaly (+https://kompaly.com)', Accept: 'text/calendar, */*;q=0.5' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, u) });
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error('status'), { code: 'http_' + res.statusCode }));
      }
      let size = 0;
      const chunks = [];
      res.on('data', c => {
        size += c.length;
        if (size > MAX_BYTES) {
          req.destroy();
          reject(Object.assign(new Error('too large'), { code: 'too_large' }));
        } else chunks.push(c);
      });
      res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'timeout' })));
    req.on('error', reject);
  });
}

/** Downloads a calendar link, following a few redirects (each one checked like the first). */
export async function fetchFeed(raw) {
  let u = feedUrl(raw);
  if (!u) throw Object.assign(new Error('bad url'), { code: 'bad_url' });
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const r = await getOnce(u);
    if (r.text !== undefined) {
      if (!/BEGIN:VCALENDAR/i.test(r.text.slice(0, 2000))) throw Object.assign(new Error('not ics'), { code: 'not_ics' });
      return r.text;
    }
    u = feedUrl(r.redirect.href);
    if (!u) throw Object.assign(new Error('bad redirect'), { code: 'bad_url' });
  }
  throw Object.assign(new Error('redirects'), { code: 'bad_url' });
}

/** Node-style handler for /api/ics. Returns false if the URL isn't ours. */
export async function handleIcs(req, res, env = process.env) {
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/api/ics') return false;
  if (req.method !== 'GET') return (send(res, 405, { error: 'method' }), true);
  if (rateLimited(`ics-ip:${ipOf(req, env)}`, 60)) return (send(res, 429, { error: 'rate_limited', retryAfter: 30 }), true);
  const caller = await authenticate(req, env);
  if (!caller) return (send(res, 401, { error: 'unauthorized' }), true);
  if (rateLimited(`ics:${caller.id ?? 'local'}`, 20)) return (send(res, 429, { error: 'rate_limited', retryAfter: 30 }), true);
  const raw = new URL(req.url, 'http://x').searchParams.get('url');
  try {
    const text = await fetchFeed(raw);
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(text);
  } catch (e) {
    const code = String(e?.code ?? '');
    const known = ['bad_url', 'not_ics', 'too_large', 'timeout'].includes(code) || code.startsWith('http_');
    send(res, code === 'EBLOCKED' ? 400 : 502, { error: code === 'EBLOCKED' ? 'bad_url' : known ? code : code === 'ENOTFOUND' ? 'not_found' : 'unreachable' });
  }
  return true;
}
