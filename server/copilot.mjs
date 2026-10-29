// Kompaly's brain, server side. The AI key never reaches the browser: the page sends
// the conversation, this module adds Kompaly's personality and tools (copilotPrompt.mjs),
// calls the configured AI (Claude, or a free provider via aiProviders.mjs) and returns the
// answer in the Anthropic shape. Tools are executed in the browser (that's where the
// student's data lives), then sent back here.

import { BlockList, isIPv6 } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { resolveProvider, openAiChat, ProviderError } from './aiProviders.mjs';
import { chatSystem, nudgeSystem, TOOLS, NUDGE_MAX_CHARS } from './copilotPrompt.mjs';

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
    messages,
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
const parisDay = () => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
export function secondsToParisMidnight() {
  const [h, m, s] = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').map(Number);
  return 86_400 - (h * 3600 + m * 60 + s);
}

/** Counts one call. Returns the error code when a limit is reached, else null. */
export function overQuota(who, question, provider, env) {
  if (quotaDay !== parisDay()) {
    quotaDay = parisDay();
    usage = new Map();
    siteCalls = 0;
  }
  const perStudent = Number(env.AI_DAILY_QUESTIONS) || 30;
  // Default site ceiling: Groq's free tier, or ~100 € a month of Claude (a question is 2-3 calls). AI_DAILY_BUDGET overrides.
  const site = Number(env.AI_DAILY_BUDGET) || (provider.id === 'groq' ? 900 : provider.id === 'anthropic' ? 250 : Infinity);
  const u = usage.get(who) ?? { questions: 0, calls: 0 };
  if (siteCalls >= site) return 'site_limit';
  if ((question && u.questions >= perStudent) || u.calls >= perStudent * 6) return 'daily_limit';
  if (question) u.questions++;
  u.calls++;
  siteCalls++;
  usage.set(who, u);
  return null;
}

// ── Conversation size ───────────────────────────────────────────────────────

const isQuestion = m => m.role === 'user' && (typeof m.content === 'string' || m.content.some(b => b.type === 'text'));
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
  if (req.method !== 'POST' || (url !== '/api/copilot/chat' && url !== '/api/copilot/nudge')) {
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

  try {
    const body = await readJson(req);

    if (url === '/api/copilot/nudge') {
      // Free providers have a tight quota (Groq: 8 000 tokens/min): keep it for the student's own
      // requests, spontaneous remarks are then phrased by the app itself. AI_NUDGES=1 turns them back on.
      if (provider.id !== 'anthropic' && env.AI_NUDGES !== '1') {
        send(res, 200, { text: '' });
        return true;
      }
      if (overQuota(who, false, provider, env)) {
        send(res, 200, { text: '' });
        return true;
      }
      const kind = Object.hasOwn(NUDGE_MAX_CHARS, body.kind) ? body.kind : 'remark';
      const situation = JSON.stringify(body.situation ?? {}).slice(0, 4000);
      const response = await chat(provider, {
        system: nudgeSystem({ ...body, kind }),
        messages: [{ role: 'user', content: situation }],
        maxTokens: 2000,
        timeoutMs: 20_000,
      });
      const text = response.stop_reason === 'refusal' ? '' : response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      send(res, 200, { text });
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
    const limit = overQuota(who, messages.at(-1) && isQuestion(messages.at(-1)), provider, env);
    if (limit) {
      send(res, 429, { error: limit, retryAfter: secondsToParisMidnight() });
      return true;
    }
    const response = await chat(provider, { system: chatSystem(body), tools: TOOLS, messages, maxTokens: provider.id === 'anthropic' ? 16000 : 8000 });
    send(res, 200, response);
  } catch (e) {
    if (e instanceof ProviderError) send(res, { timeout: 504, rate_limited: 429, too_large: 413 }[e.code] ?? 502, { error: e.code, status: e.status, retryAfter: e.retryAfter });
    else if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) send(res, 502, { error: 'bad_key' });
    else if (e instanceof Anthropic.RateLimitError) send(res, 429, { error: 'rate_limited' });
    else if (e instanceof Anthropic.APIConnectionTimeoutError) send(res, 504, { error: 'timeout' });
    else if (e instanceof Anthropic.APIError) send(res, 502, { error: 'upstream', status: e.status });
    else send(res, e?.status ?? 500, { error: e?.message ?? 'server_error' });
  }
  return true;
}
