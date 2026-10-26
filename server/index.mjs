// Production server: serves the built app (dist/) and Kompaly's API.
// Usage: npm run build && npm start   (reads the AI settings — AI_PROVIDER, AI_API_KEY… — from the environment or .env)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { brotliCompress, constants as zlibConst, gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleCopilot, copilotProvider, ipOf } from './copilot.mjs';
import { handleCours } from './cours.mjs';
import { handleIcs } from './icsFeed.mjs';
import { photoStatus, resolveVision } from './photo.mjs';
import { loadPublicEnv } from './publicEnv.mjs';
import { langOf, publicPage, robotsTxt, sitemapXml, withHead } from './seo.mjs';

try {
  process.loadEnvFile();
} catch {
  /* no .env file: rely on the real environment */
}
loadPublicEnv();
// After the environment is read: push.mjs and emails.mjs take their settings when loaded.
const { handlePush, startPushLoop, pushStatus, keyKind } = await import('./push.mjs');
const { mailStatus, startMailLoop } = await import('./emails.mjs');

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript', // pdf.js worker: refused by browsers under any other type
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// ── Security headers (every answer) ─────────────────────────────────────────
const SUPABASE = (() => {
  try {
    return new URL(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).origin;
  } catch {
    return '';
  }
})();
const CSP = [
  "default-src 'self'",
  // pdf.js decodes some images with WebAssembly; Cloudflare Turnstile: the anti-robot check at sign-in;
  // Cloudflare Web Analytics: the visit counter without cookies (its script, then where it sends the counts).
  "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  `connect-src 'self' blob: data: https://cloudflareinsights.com${SUPABASE ? ` ${SUPABASE} ${SUPABASE.replace(/^https:/, 'wss:')}` : ''}`,
  "worker-src 'self' blob:",
  "frame-src 'self' blob: https://challenges.cloudflare.com", // file previews; Turnstile's box
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const SECURITY = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self), display-capture=(self)', // microphone: dictation, « Enregistrer un cours »
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

// ── Static files ────────────────────────────────────────────────────────────
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.txt', '.webmanifest']);
/** Built files never change while the server runs: read and compressed once. */
const files = new Map();
/**
 * Cloudflare Web Analytics, the visit counter without cookies: its script in the page when the site's token
 * is set (CF_ANALYTICS_TOKEN, public: it shows in the page anyway). `spa`: the app's page changes count too.
 */
const CF_TOKEN = /^[a-f0-9]{32}$/i.test(process.env.CF_ANALYTICS_TOKEN ?? '') ? process.env.CF_ANALYTICS_TOKEN : '';
const BEACON = CF_TOKEN ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${CF_TOKEN}","spa":true}'></script>` : '';
/** The app's pages (src/App.tsx): any other address gets the page with a 404 status. */
const APP_ROUTES = new Set(['/', '/connexion', '/inscription', '/mot-de-passe-oublie', '/reinitialisation', '/securite', '/bienvenue', '/mentions-legales', '/confidentialite', '/conditions', '/drive', '/calendrier', '/notes', '/taches', '/progression', '/groupes', '/agendas', '/corbeille', '/profil', '/admin', '/enregistrer']);

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Méthode non autorisée');
  }
  let path;
  const search = (req.url ?? '').includes('?') ? (req.url ?? '').slice((req.url ?? '').indexOf('?')) : '';
  try {
    path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  } catch {
    res.statusCode = 400;
    return res.end('Adresse invalide');
  }
  path = normalize(path).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  /** A public page (home, sign-in, legal…): its own title, description and addresses (server/seo.mjs). */
  let page = null;
  if (!(await stat(file).then(s => s.isFile(), () => false))) {
    // A missing code file must get a 404, not the page: a tab opened before an update asks for
    // old files, and only a real error lets it reload itself (see src/page.ts).
    if (path.startsWith('/assets/') || extname(path)) {
      res.statusCode = 404;
      return res.end('Introuvable');
    }
    file = join(DIST, 'index.html'); // single-page app: every route is the page
    page = publicPage(path);
    // …but an address the app doesn't have says so (the page shows « introuvable »; search engines drop it).
    if (!APP_ROUTES.has(path.replace(/(.)\/+$/, '$1').toLowerCase())) res.statusCode = 404;
    // The app's own screens need an account: not for search results.
    else if (!page) res.setHeader('X-Robots-Tag', 'noindex');
  }
  const lang = page ? langOf(search) : null;
  const key = page ? `${file}|${page}|${lang}` : file;
  let entry = files.get(key);
  if (!entry) {
    let raw = await readFile(file);
    if (file.endsWith('index.html')) {
      let html = raw.toString('utf8');
      if (page) html = withHead(html, page, lang);
      if (BEACON) html = html.replace('</body>', `${BEACON}\n  </body>`);
      raw = Buffer.from(html);
    }
    entry = { raw, gzip: COMPRESSIBLE.has(extname(file)) && raw.length > 1024 ? gzipSync(raw) : null, br: null };
    files.set(key, entry);
    // Brotli is ~15 % smaller than gzip but slow at its best level: made in the background,
    // gzip is served until it is ready.
    if (entry.gzip) {
      const done = entry;
      brotliCompress(raw, { params: { [zlibConst.BROTLI_PARAM_QUALITY]: 11, [zlibConst.BROTLI_PARAM_SIZE_HINT]: raw.length } }, (err, out) => {
        if (!err) done.br = out;
      });
    }
  }
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  // Hashed file names change with each build; the page itself must always be checked again.
  res.setHeader('Cache-Control', file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  const accept = String(req.headers['accept-encoding'] ?? '');
  const br = entry.br && /\bbr\b/.test(accept);
  const gzip = !br && entry.gzip && /\bgzip\b/.test(accept);
  if (entry.gzip) res.setHeader('Vary', 'Accept-Encoding');
  if (br || gzip) res.setHeader('Content-Encoding', br ? 'br' : 'gzip');
  res.end(br ? entry.br : gzip ? entry.gzip : entry.raw);
}

// ── Search engines (server/seo.mjs) ─────────────────────────────────────────
function serveSeo(req, res) {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/robots.txt') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(robotsTxt());
    return true;
  }
  if (path === '/sitemap.xml') {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.end(sitemapXml());
    return true;
  }
  return false;
}

// ── Errors reported by the browsers (src/lib/reportError.ts) → this server's log ──
const reported = new Map();
setInterval(() => reported.clear(), 3_600_000).unref();

async function serveErrorReport(req, res) {
  if (req.method !== 'POST' || req.url !== '/api/erreurs') return false;
  const ip = ipOf(req, process.env); // behind the host's proxy, the socket address is the proxy's, the same for everyone
  const count = (reported.get(ip) ?? 0) + 1;
  if (reported.size > 5000) reported.clear();
  reported.set(ip, count);
  let body = '';
  for await (const chunk of req) {
    body += String(chunk).slice(0, 8192 - body.length); // never more than 8 KB kept
    if (body.length >= 8192) break;
  }
  if (count <= 50) {
    try {
      const e = JSON.parse(body);
      // Line breaks and control characters out (a report could write fake lines in the log); the stack stays indented.
      const s = (v, n) => String(v ?? '').slice(0, n).replace(/[\u0000-\u001f\u007f]+/g, ' ');
      const stack = String(e.stack ?? '').slice(0, 2000).split(/\r?\n/).map(l => '    | ' + l.replace(/[\u0000-\u001f\u007f]+/g, ' ')).join('\n');
      console.error(`[navigateur] ${s(e.page, 200)} (${s(e.where, 30)}) ${s(e.message, 500)}\n${stack}`);
    } catch {
      /* not a report */
    }
  }
  res.statusCode = 204;
  res.end();
  return true;
}

// ── Health check for the monitoring (UptimeRobot, GitHub Actions « Surveillance ») ──
// GET /api/sante → 200 {"ok":true,…} when the server answers AND the database does, else 503.
// The database is asked at most every 30 s: a monitor hitting this every 5 min also keeps the
// free Supabase project from being paused for inactivity.
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
let health = { at: 0, base: 'inconnue' };
async function databaseHealth() {
  if (Date.now() - health.at < 30_000) return health.base;
  let base = 'absente';
  if (SUPABASE && SUPABASE_KEY) {
    try {
      // Any table: the access rules answer an empty list to an anonymous visitor, but the query reaches the database.
      const r = await fetch(`${SUPABASE}/rest/v1/profiles?select=id&limit=1`, { headers: { apikey: SUPABASE_KEY }, signal: AbortSignal.timeout(8000) });
      base = r.ok ? 'ok' : `erreur ${r.status}`;
    } catch {
      base = 'injoignable';
    }
  }
  health = { at: Date.now(), base };
  return base;
}

async function serveHealth(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if ((req.url ?? '').split('?')[0] !== '/api/sante') return false;
  const base = await databaseHealth();
  const ok = base === 'ok' || base === 'absente'; // local mode: no database to check
  res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(
    req.method === 'HEAD'
      ? undefined
      : // Public: a word per service, never an error's text nor the kind of key (in Render's logs instead).
        JSON.stringify({ ok, serveur: 'ok', base: ok ? base : 'erreur', ia: copilotProvider() ? 'configurée' : 'absente', rappels: pushStatus.active ? (pushStatus.lastError ? 'erreur' : 'actifs') : 'désactivés', emails: mailStatus.active ? (mailStatus.lastError ? 'erreur' : 'actifs') : 'désactivés', photo: resolveVision() ? (photoStatus.lastError ? 'erreur' : 'prête') : 'désactivée', version: (process.env.RENDER_GIT_COMMIT ?? '').slice(0, 7) || undefined, heure: new Date().toISOString() }),
  );
  return true;
}

// The app's former address: everything moves to the new one, same path (old links and e-mails keep working).
const OLD_HOSTS = new Set(['kompa-app.com', 'www.kompa-app.com']);
const NEW_ORIGIN = 'https://kompaly.com';

const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
  if (OLD_HOSTS.has((req.headers.host ?? '').toLowerCase())) {
    res.writeHead(301, { Location: NEW_ORIGIN + (req.url ?? '/') });
    res.end();
    return;
  }
  try {
    if (serveSeo(req, res)) return;
    if (await serveHealth(req, res)) return;
    if (await serveErrorReport(req, res)) return;
    if (await handlePush(req, res)) return;
    if (await handleCopilot(req, res)) return;
    if (await handleCours(req, res)) return;
    if (await handleIcs(req, res)) return;
    await serveStatic(req, res);
  } catch (e) {
    console.error('[serveur]', req.method, req.url, e);
    if (!res.headersSent) res.statusCode = 500;
    res.end('Erreur serveur');
  }
}).listen(PORT, () => {
  startPushLoop();
  startMailLoop();
  const ai = copilotProvider();
  console.log(`Kompaly sur http://localhost:${PORT} — Kompaly IA ${ai ? `activé (${ai.label}, ${ai.model})` : 'désactivé (voir AI_PROVIDER / AI_API_KEY dans .env.example)'}`);
});

process.on('unhandledRejection', e => console.error('[serveur] promesse non gérée', e));
// The host stops the server to deploy a new version: finish the requests in progress first.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
