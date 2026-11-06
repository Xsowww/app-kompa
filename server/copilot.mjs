// Kompaly's brain, server side. The AI key never reaches the browser: the page sends
// the conversation, this module adds Kompaly's personality and tools (copilotPrompt.mjs),
// calls the configured AI (Claude, or a free provider via aiProviders.mjs) and returns the
// answer in the Anthropic shape. Tools are executed in the browser (that's where the
// student's data lives), then sent back here.

import { BlockList, isIPv6 } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { resolveProvider, openAiChat, ProviderError } from './aiProviders.mjs';
import { chatSystem, chatSystemBlocks, toolsFor } from './copilotPrompt.mjs';

const MAX_BODY = 1_500_000; // bytes (file contents read by Kompaly travel in the history)
const RATE_WINDOW_MS = 60_000;
const PER_USER_PER_MIN = 40;
const PER_IP_PER_MIN = 120; // a school network puts many students behind one address
const BLOCK_TYPES = new Set(['text', 'tool_use', 'tool_result', 'thinking', 'redacted_thinking']);

let client = null;
let clientKey = '';

/** Provider name and model, for the start-up log and /status. */
export function copilotProvider(env = process.env) {
  const p = resolveProvider(env);
  return p ? { provider: p.id, label: p.label, model: p.model } : null;
}

function getClient(apiKey) {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

/** Server-side refusal fallback, for the models that accept the « default » form. */
const hasFallback = model => /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/.test(model);

/**
 * Claude reads again at a tenth of the price, and sooner, what it read in the last minutes: the tools and the rules
 * (marked in chatSystemBlocks), and here the conversation up to its last message, which the next step of the same
 * question (after its tools ran) starts with.
 */
export function withCacheMark(messages) {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') return messages;
  const content = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
  const i = content.length - 1;
  if (!['text', 'tool_result'].includes(content[i]?.type)) return messages;
  return [...messages.slice(0, -1), { ...last, content: content.map((b, j) => (j === i ? { ...b, cache_control: { type: 'ephemeral' } } : b)) }];
}

async function anthropicChat(p, { system, messages, tools, maxTokens }) {
  const response = await getClient(p.apiKey).beta.messages.create({
    model: p.model,
    max_tokens: maxTokens,
    output_config: { effort: 'low' },
    // trimHistory shortens earlier tool results and the [Contexte] changes each time: new accounts get a 400 for a
    // thinking block replayed after such an edit, so the API drops that old reasoning instead of refusing the request.
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    betas: ['thinking-binding-controls-2026-08-01', ...(hasFallback(p.model) ? ['server-side-fallback-2026-07-01'] : [])],
    ...(hasFallback(p.model) ? { fallbacks: 'default' } : {}),
    system,
    ...(tools ? { tools } : {}),
    messages: withCacheMark(messages),
  });
  return { content: response.content, stop_reason: response.stop_reason };
}

/** One model call, whatever the provider. Answer in the Anthropic shape: { content, stop_reason }. */
export function chat(p, req) {
  return p.id === 'anthropic' ? anthropicChat(p, req) : openAiChat(p, req);
}

// ── Who is calling? (cloud mode only) ───────────────────────────────────────
// With Supabase configured, only signed-in students can talk to Kompaly: the page sends
// its session token and we ask Supabase who it belongs to (cached one minute).
const tokenCache = new Map();
export async function authenticate(req, env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  // Local mode has no accounts: the AI then only answers this computer, never the internet.
  if (!url || !key) return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress) ? { id: null } : null;
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const cached = tokenCache.get(token);
  if (cached && cached.until > Date.now()) return cached.user;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    // Refused tokens are remembered too: a loop of fake tokens must not hammer Supabase Auth.
    const user = r.ok ? { id: (await r.json()).id } : null;
    if (tokenCache.size > 5000) for (const [k, v] of tokenCache) if (v.until <= Date.now() || tokenCache.size > 5000) tokenCache.delete(k); // oldest first, never all at once
    tokenCache.set(token, { user, until: Date.now() + 60_000 });
    return user;
  } catch {
    return null;
  }
}

const hits = new Map();
export function rateLimited(key, max) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.delete(key); // re-added last: the map stays ordered from the oldest to the latest hit
  hits.set(key, list);
  if (hits.size > 10_000) {
    // Forget what is past the window, then the oldest addresses. Never clear all: a flood of
    // addresses would lift every account's limit too.
    for (const [k, l] of hits) if (now - l[l.length - 1] >= RATE_WINDOW_MS) hits.delete(k);
    for (const k of hits.keys()) {
      if (hits.size <= 10_000) break;
      if (k.includes('ip:') && k !== key) hits.delete(k);
    }
  }
  return list.length > max;
}

// Cloudflare's addresses (cloudflare.com/ips, October 2026).
const CLOUDFLARE = new BlockList();
for (const r of '173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22'.split(' '))
  CLOUDFLARE.addSubnet(r.split('/')[0], +r.split('/')[1], 'ipv4');
for (const r of '2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32'.split(' '))
  CLOUDFLARE.addSubnet(r.split('/')[0], +r.split('/')[1], 'ipv6');
const fromCloudflare = ip => {
  try {
    return CLOUDFLARE.check(ip.replace(/^::ffff:/, ''), isIPv6(ip.replace(/^::ffff:/, '')) ? 'ipv6' : 'ipv4');
  } catch {
    return false;
  }
};

/**
 * Behind a host's proxy every request comes from the proxy: TRUST_PROXY=1 reads the real address.
 * On by itself on Render (it sets RENDER=true), where forgetting it put every visitor under one limit.
 * The LAST address of X-Forwarded-For is the one the host's proxy saw; the ones before it are whatever the
 * visitor sent (a made-up address per request got round every limit).
 * With kompaly.com proxied by Cloudflare, that address is a Cloudflare server, shared by many visitors:
 * then CF-Connecting-IP holds the visitor's. Only then: from anywhere else, that header is made up.
 */
export const ipOf = (req, env) => {
  const peer = (env.TRUST_PROXY === '1' || (env.RENDER === 'true' && env.TRUST_PROXY !== '0')) && String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim();
  const visitor = String(req.headers['cf-connecting-ip'] ?? '').trim();
  return v6Block((peer && visitor && fromCloudflare(peer) ? visitor : peer) || req.socket?.remoteAddress || 'unknown');
};
/** An IPv6 address counts by its /64 block: one connection gets billions of addresses from it. */
export function v6Block(ip) {
  if (!isIPv6(ip) || ip.startsWith('::ffff:')) return ip;
  const [a, b = ''] = ip.split('::');
  const head = a ? a.split(':') : [], tail = b ? b.split(':') : [];
  return [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail].slice(0, 4).join(':') + '::/64';
}

// ── Daily quota ─────────────────────────────────────────────────────────────
// A free AI has a daily allowance for the whole site (Groq: 1 000 requests). Without a cap per
// student, one person could use it up in minutes. A « question » is a message the student typed;
// the tool calls that follow it count as calls. Counters reset at midnight, Paris time.
// shortcut: kept in this process's memory (one server; a restart resets the day).
let quotaDay = '';
let usage = new Map();
let siteCalls = 0;
// The month so far, for the admins (same shortcut: memory of this process).
let quotaMonth = '';
let month = { questions: 0, calls: 0 };
const parisDay = () => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
/** Calls a day for the whole site. Default: Groq's free tier, or well under 100 $ a month of Claude Haiku (a question is 2-3 calls). AI_DAILY_BUDGET overrides. */
const siteBudget = (provider, env) => Number(env.AI_DAILY_BUDGET) || (provider?.id === 'groq' ? 900 : provider?.id === 'anthropic' ? 1500 : Infinity);
export function secondsToParisMidnight() {
  const [h, m, s] = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').map(Number);
  return 86_400 - (h * 3600 + m * 60 + s);
}

/** Where the person stands today: questions asked and allowed (the bar in Kompaly's panel). */
export function quotaOf(who, env) {
  const max = Number(env.AI_DAILY_QUESTIONS) || 30;
  return { used: quotaDay === parisDay() ? Math.min(max, usage.get(who)?.questions ?? 0) : 0, max };
}

/**
 * Gives back a question that got no answer (the AI failed, or said nothing): the student sees an error with
 * « Réessayer », that try must not cost one of their questions.
 */
export function refundQuestion(who) {
  const u = usage.get(who);
  if (!u || u.questions <= 0) return;
  u.questions--;
  month.questions = Math.max(0, month.questions - 1);
}

/** « Je suis là », « merci », « salut »: small talk, answered but not counted as one of the day's questions. */
const SMALL_TALK = /^(?:je suis (?:la|ici)|(?:merci|thanks?|thank you)(?: beaucoup| bien| a toi| kompaly)?|ok(?:ay)?|d'?accord|dac|super|cool|top|parfait|genial|nickel|(?:salut|coucou|bonjour|bonsoir|hello|hey|yo)(?: kompaly)?|ca va|(?:a|bonne) (?:plus|demain|soiree|journee|nuit)|bye|au revoir)$/;
export function isSmallTalk(text) {
  const q = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return !!q && SMALL_TALK.test(q);
}

/** Counts one call. Returns the error code when a limit is reached, else null. */
export function overQuota(who, question, provider, env) {
  if (quotaDay !== parisDay()) {
    quotaDay = parisDay();
    usage = new Map();
    siteCalls = 0;
  }
  if (quotaMonth !== parisDay().slice(0, 7)) {
    quotaMonth = parisDay().slice(0, 7);
    month = { questions: 0, calls: 0 };
  }
  const perStudent = Number(env.AI_DAILY_QUESTIONS) || 30;
  const site = siteBudget(provider, env);
  const u = usage.get(who) ?? { questions: 0, calls: 0 };
  if (siteCalls >= site) return 'site_limit';
  if ((question && u.questions >= perStudent) || u.calls >= perStudent * 6) return 'daily_limit';
  if (question) u.questions++;
  u.calls++;
  siteCalls++;
  if (question) month.questions++;
  month.calls++;
  usage.set(who, u);
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The AI's use today and this month, for the admins: calls, questions, what is left of the site's daily budget, and
 * the accounts that ask the most. Account ids only (the admin page puts the names on them): never an e-mail here,
 * and a visitor counted by address (local mode) is not shown by it.
 */
export function aiUsage(provider, env) {
  const today = quotaDay === parisDay();
  const rows = today ? [...usage.entries()] : [];
  const site = siteBudget(provider, env);
  const calls = today ? siteCalls : 0;
  return {
    day: parisDay(),
    today: { questions: rows.reduce((n, [, u]) => n + u.questions, 0), calls, accounts: rows.length },
    month: quotaMonth === parisDay().slice(0, 7) ? { ...month } : { questions: 0, calls: 0 },
    budget: Number.isFinite(site) ? { calls: site, left: Math.max(0, site - calls) } : null,
    perAccount: Number(env.AI_DAILY_QUESTIONS) || 30,
    top: rows
      .sort((a, b) => b[1].questions - a[1].questions || b[1].calls - a[1].calls)
      .slice(0, 10)
      .map(([who, u]) => ({ id: UUID.test(who) ? who : null, questions: u.questions, calls: u.calls })),
  };
}

/**
 * Admins only, decided by Supabase like the admin_stats() function of schema.sql: listed in public.admins (is_admin(),
 * run with the caller's own token, so auth.uid() is theirs) AND signed in with their phone's code (aal2).
 * 'ok', 'mfa' (an admin who still has to type the code) or 'forbidden'.
 */
export async function adminCheck(req, env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!url || !key || !token || !(await authenticate(req, env))?.id) return 'forbidden';
  let admin = false;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
    admin = r.ok && (await r.json()) === true;
  } catch {
    return 'forbidden';
  }
  if (!admin) return 'forbidden';
  // The token was just accepted by Supabase twice (Auth, then the database): its claims can be read as they are.
  let aal = '';
  try {
    aal = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).aal ?? '';
  } catch {
    /* unreadable: not aal2 */
  }
  return aal === 'aal2' ? 'ok' : 'mfa';
}

// ── Conversation size ───────────────────────────────────────────────────────

const isQuestion = m => m.role === 'user' && (typeof m.content === 'string' || m.content.some(b => b.type === 'text'));
/** What the person typed: the last text of the turn (the first one is the page's [Contexte]). */
const typedText = m => (typeof m.content === 'string' ? m.content : (m.content.filter(b => b.type === 'text').at(-1)?.text ?? ''));

// Questions counted and still being answered (their tools run in the page between two calls), by the page's id of the
// turn: when a later step fails, the question is given back. shortcut: in memory, like the quota.
const openTurns = new Map();
const OPEN_TURNS_MAX = 5000;
const validMessage = m =>
  (m?.role === 'user' || m?.role === 'assistant') &&
  (typeof m.content === 'string' || (Array.isArray(m.content) && m.content.length > 0 && m.content.every(b => BLOCK_TYPES.has(b?.type))));

/**
 * Keeps the most recent exchanges that fit in `budget` characters, always starting on a question
 * (never between a tool call and its result). Tool results of earlier exchanges are cut short:
 * the AI already used them, it can read again if needed. In the current exchange they are cut
 * at `toolChars` (a whole course PDF doesn't fit in a free AI's per-minute allowance).
 */
export function trimHistory(messages, { budget, toolChars }) {
  const starts = messages.flatMap((m, i) => (isQuestion(m) ? [i] : []));
  if (!starts.length) return [];
  const last = starts.at(-1);
  // A pasted course can make the question itself huge: cut it like a tool result.
  const QUESTION_NOTE = "\n[… message coupé : trop long, seul le début a été lu. Dis-le à l'utilisateur.]";
  const cutText = t => (t.length > toolChars ? t.slice(0, toolChars) + QUESTION_NOTE : t);
  const out = messages.map((m, i) => {
    if (m.role !== 'user') return m;
    if (typeof m.content === 'string') return { ...m, content: cutText(m.content) };
    const max = i < last ? 300 : toolChars;
    const note = i < last ? ' […]' : "\n[… coupé : trop long pour l'IA, seul le début a été lu. Dis-le à l'utilisateur.]";
    return {
      ...m,
      content: m.content.map(b =>
        b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > max
          ? { ...b, content: b.content.slice(0, max) + note }
          : b.type === 'text' && typeof b.text === 'string'
            ? { ...b, text: cutText(b.text) }
            : b,
      ),
    };
  });
  let from = last;
  let size = JSON.stringify(out.slice(last)).length;
  for (let k = starts.length - 2; k >= 0; k--) {
    size += JSON.stringify(out.slice(starts[k], from)).length;
    if (size > budget) break;
    from = starts[k];
  }
  return out.slice(from);
}

// Groq's free tier allows 8 000 tokens per minute and the prompt with its tools already takes ~3 700.
// Claude reads more history and longer files, but within a paid budget (~25 000 tokens a request at most).
const sizeFor = provider => (provider.id === 'anthropic' ? { budget: 80_000, toolChars: 20_000 } : { budget: 10_000, toolChars: 6_000 });

export function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too_large'), { status: 413 }));
        // Drain the rest instead of cutting the socket, so the browser gets the 413 answer.
        chunks.length = 0;
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        req.resume();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** Node-style handler for `/api/copilot` and `/api/copilot/status`. Returns false if the URL isn't ours. */
export async function handleCopilot(req, res, env = process.env) {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/api/copilot')) return false;

  if (url === '/api/copilot/status') {
    const p = resolveProvider(env);
    send(res, 200, p ? { enabled: true, provider: p.id, label: p.label, model: p.model } : { enabled: false });
    return true;
  }
  // The admins' figures (pages/admin): never in the public /api/sante.
  if (url === '/api/copilot/admin' && req.method === 'GET') {
    if (rateLimited(`ip:${ipOf(req, env)}`, PER_IP_PER_MIN)) {
      send(res, 429, { error: 'rate_limited', retryAfter: 60 });
      return true;
    }
    const check = await adminCheck(req, env);
    if (check !== 'ok') {
      send(res, 403, { error: check === 'mfa' ? 'mfa_required' : 'forbidden' });
      return true;
    }
    const { audioUsage } = await import('./cours.mjs');
    res.setHeader('Cache-Control', 'no-store');
    send(res, 200, { ai: aiUsage(resolveProvider(env), env), audio: audioUsage(env) });
    return true;
  }
  if (req.method !== 'POST' || url !== '/api/copilot/chat') {
    send(res, 404, { error: 'not_found' });
    return true;
  }
  const ip = ipOf(req, env);
  if (rateLimited(`ip:${ip}`, PER_IP_PER_MIN)) {
    send(res, 429, { error: 'rate_limited', retryAfter: 60 });
    return true;
  }
  const caller = await authenticate(req, env);
  if (!caller) {
    send(res, 401, { error: 'unauthorized' });
    return true;
  }
  const provider = resolveProvider(env);
  if (!provider) {
    send(res, 503, { error: 'disabled' });
    return true;
  }
  const who = caller.id ?? ip;
  if (rateLimited(`user:${who}`, PER_USER_PER_MIN)) {
    send(res, 429, { error: 'rate_limited', retryAfter: 60 });
    return true;
  }

  /** Gives the question back when its answer fails (set once it is counted). */
  let refund = null;
  try {
    const body = await readJson(req);

    // « Mode simple uniquement » (Profil › Kompaly): the page doesn't ask, and an old tab that still would is refused here.
    if (body.simpleOnly === true) {
      send(res, 403, { error: 'simple_only' });
      return true;
    }

    if (!Array.isArray(body.messages) || !body.messages.every(validMessage)) {
      send(res, 400, { error: 'bad_messages' });
      return true;
    }
    const messages = trimHistory(body.messages, sizeFor(provider));
    if (!messages.length) {
      send(res, 400, { error: 'bad_messages' });
      return true;
    }
    const last = messages.at(-1);
    const counted = !!last && isQuestion(last) && !isSmallTalk(typedText(last));
    const turn = typeof body.turn === 'string' ? body.turn.slice(0, 64) : '';
    const limit = overQuota(who, counted, provider, env);
    if (limit) {
      send(res, 429, { error: limit, retryAfter: secondsToParisMidnight(), quota: quotaOf(who, env) });
      return true;
    }
    const key = `${who}|${turn}`;
    if (counted) {
      refund = () => (openTurns.delete(key), refundQuestion(who));
      if (turn) {
        if (openTurns.size >= OPEN_TURNS_MAX) openTurns.delete(openTurns.keys().next().value);
        openTurns.set(key, true);
      }
    } else if (turn && openTurns.has(key)) {
      // A later step of a counted question: if it fails, the question had no answer.
      refund = () => openTurns.delete(key) && refundQuestion(who);
    }
    const facts = { provider, env };
    const response = await chat(provider, { system: provider.id === 'anthropic' ? chatSystemBlocks(body, facts) : chatSystem(body, facts), tools: toolsFor(body), messages, maxTokens: provider.id === 'anthropic' ? 16000 : 8000 });
    const said = response.content?.some(b => (b.type === 'text' && b.text?.trim()) || b.type === 'tool_use');
    if (!said && response.stop_reason !== 'pause_turn') refund?.();
    // Answered (no more tools to run): nothing left to give back.
    else if (turn && !response.content?.some(b => b.type === 'tool_use')) openTurns.delete(key);
    refund = null;
    send(res, 200, { ...response, quota: quotaOf(who, env) });
  } catch (e) {
    refund?.();
    if (e instanceof ProviderError) send(res, { timeout: 504, rate_limited: 429, too_large: 413 }[e.code] ?? 502, { error: e.code, status: e.status, retryAfter: e.retryAfter });
    else if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) send(res, 502, { error: 'bad_key' });
    else if (e instanceof Anthropic.RateLimitError) send(res, 429, { error: 'rate_limited' });
    else if (e instanceof Anthropic.APIConnectionTimeoutError) send(res, 504, { error: 'timeout' });
    else if (e instanceof Anthropic.APIError) send(res, 502, { error: 'upstream', status: e.status });
    else send(res, e?.status ?? 500, { error: e?.message ?? 'server_error' });
  }
  return true;
}
