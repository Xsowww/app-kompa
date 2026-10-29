// Which AI answers for Kompaly. Anthropic (Claude) goes through the official SDK;
// every other provider (free tiers of Gemini, Groq, OpenRouter, Mistral, a local Ollama…)
// speaks the OpenAI « chat completions » format. The adapter below converts Kompaly's
// Anthropic-shaped conversation to that format and the answer back, so the browser
// never needs to know which provider is behind.

export const PRESETS = {
  anthropic: { label: 'Claude (Anthropic)', model: 'claude-haiku-5-5' },
  gemini: { label: 'Gemini (Google)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.5-flash' },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  ollama: { label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', keyless: true },
  'openai-compatible': { label: 'Compatible OpenAI' },
};

/**
 * Reads the AI settings from the environment.
 * Returns null when Kompaly's AI is not configured (it then runs its built-in French command engine).
 */
export function resolveProvider(env = process.env) {
  const v = name => String(env[name] ?? '').trim();
  let id = v('AI_PROVIDER').toLowerCase();
  if (!id) {
    if (v('ANTHROPIC_API_KEY')) id = 'anthropic';
    else if (v('AI_BASE_URL')) id = 'openai-compatible';
    else return null;
  }
  const preset = PRESETS[id];
  if (!preset) return null;
  if (id === 'anthropic') {
    const apiKey = v('AI_API_KEY') || v('ANTHROPIC_API_KEY');
    return apiKey ? { id, label: preset.label, model: v('AI_MODEL') || preset.model, apiKey } : null;
  }
  const baseUrl = v('AI_BASE_URL') || preset.baseUrl;
  const model = v('AI_MODEL') || preset.model;
  const apiKey = v('AI_API_KEY');
  if (!baseUrl || !model || (!apiKey && !preset.keyless)) return null;
  return { id, label: preset.label, model, baseUrl, apiKey };
}

// ── Anthropic → OpenAI ──────────────────────────────────────────────────────

const blocksOf = content => (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []);

const resultText = c =>
  typeof c === 'string'
    ? c
    : blocksOf(c)
        .map(b => (b.type === 'text' ? b.text : ''))
        .join('\n');

const emptySchema = s => !s || !s.properties || Object.keys(s.properties).length === 0;

export function toOpenAiTools(tools) {
  return tools.map(t => ({
    type: 'function',
    // Some providers (Gemini) reject an object schema without properties: leave it out, it means "no arguments".
    function: { name: t.name, description: t.description, ...(emptySchema(t.input_schema) ? {} : { parameters: t.input_schema }) },
  }));
}

/** Anthropic-shaped history (text, tool_use, tool_result blocks) → OpenAI chat messages. */
export function toOpenAiMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    const blocks = blocksOf(m.content);
    if (m.role === 'assistant') {
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      const calls = blocks
        .filter(b => b.type === 'tool_use')
        .map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: 'assistant', content: text || (calls.length ? null : ''), ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // user: tool results first (they answer the previous assistant turn), then any text
    for (const b of blocks.filter(b => b.type === 'tool_result')) {
      const text = resultText(b.content);
      out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.is_error ? `Erreur : ${text}` : text || '(vide)' });
    }
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

// ── OpenAI → Anthropic ──────────────────────────────────────────────────────

let seq = 0;
const newId = () => `toolu_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Tolerant JSON parsing of tool arguments (code fences, trailing commas, empty string). */
export function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  const s = String(raw ?? '').trim();
  if (!s) return {};
  const attempts = [s, s.replace(/^```(?:json)?\s*|\s*```$/g, ''), s.replace(/,\s*([}\]])/g, '$1')];
  for (const a of attempts) {
    try {
      const v = JSON.parse(a);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      /* next attempt */
    }
  }
  return null;
}

/** OpenAI chat completion → Anthropic-shaped `{ content, stop_reason }`. */
export function fromOpenAiResponse(data, toolNames = null) {
  const choice = data?.choices?.[0];
  const msg = choice?.message ?? {};
  const content = [];
  const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map(p => p?.text ?? '').join('') : '';
  // Some reasoning models leak their thoughts between tags: keep only the answer.
  const visible = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (visible) content.push({ type: 'text', text: visible });
  const used = new Set();
  for (const call of msg.tool_calls ?? []) {
    const name = call?.function?.name;
    if (!name || (toolNames && !toolNames.has(name))) continue;
    let id = typeof call.id === 'string' && call.id ? call.id : newId();
    if (used.has(id)) id = newId();
    used.add(id);
    const input = parseArgs(call.function.arguments);
    // Unreadable arguments: keep the call so the conversation stays valid; the browser
    // will report the problem back to the model as a tool error.
    content.push({ type: 'tool_use', id, name, input: input ?? { _invalid_arguments: String(call.function.arguments).slice(0, 500) } });
  }
  const hasTools = content.some(b => b.type === 'tool_use');
  const finish = choice?.finish_reason;
  const stop_reason = hasTools ? 'tool_use' : finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'end_turn';
  return { content, stop_reason };
}

// ── HTTP call ──────────────────────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(code, status, detail) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
    /** Seconds before the provider accepts requests again (quota reached), when it says so. */
    this.retryAfter = undefined;
  }
}

/** « 30 », « 2m59.5s », « 7h3m » (Retry-After / x-ratelimit-reset-*) → seconds. */
export function parseWait(v) {
  if (!v) return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.ceil(Number(v));
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?$/.exec(v.trim());
  if (!m || !m[0]) return undefined;
  return Math.ceil(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0));
}

/** HTTP status from the provider → Kompaly's error codes (bad_key, rate_limited, upstream). */
export function mapStatus(status) {
  if (status === 401 || status === 403) return 'bad_key';
  if (status === 429) return 'rate_limited';
  if (status === 413) return 'too_large'; // Groq: request bigger than the per-minute token allowance
  return 'upstream';
}

function endpoint(baseUrl) {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

export async function callOnce(p, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(endpoint(p.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
        ...(p.id === 'openrouter' ? { 'HTTP-Referer': 'https://kompaly.com', 'X-Title': 'Kompaly' } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ProviderError(e?.name === 'AbortError' ? 'timeout' : 'upstream', e?.name === 'AbortError' ? 504 : 502, e?.message);
  } finally {
    clearTimeout(timer);
  }
  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* not JSON */
  }
  // Gemini returns a list of errors, others an object.
  const err = Array.isArray(data) ? data[0]?.error : data?.error;
  if (!res.ok || err) {
    const status = res.ok ? Number(err?.code) || 502 : res.status;
    const detail = String(err?.message ?? raw).slice(0, 300) + (err?.code ? ` [${err.code}]` : '');
    // Gemini answers 400 (not 401) to an invalid key.
    const code = status === 400 && /api[ _]?key/i.test(detail) ? 'bad_key' : mapStatus(status);
    const error = new ProviderError(code, status, detail);
    if (code === 'rate_limited') {
      // Retry-After is the real wait. The reset-* headers say when a counter is FULL again
      // (reset-requests is often 15 min while 8 s are enough): only fall back to them.
      const h = (n) => res.headers.get(n);
      error.retryAfter =
        parseWait(h('retry-after')) ??
        (h('x-ratelimit-remaining-requests') === '0' ? parseWait(h('x-ratelimit-reset-requests')) : parseWait(h('x-ratelimit-reset-tokens')));
    }
    throw error;
  }
  if (!data?.choices?.length) throw new ProviderError('upstream', 502, 'réponse vide');
  return data;
}

/** One request to an OpenAI-compatible provider, answer in the Anthropic shape. */
export async function openAiChat(p, { system, messages, tools, maxTokens = 8000, timeoutMs = 60_000 }) {
  const body = {
    model: p.model,
    messages: toOpenAiMessages(system, messages),
    max_tokens: maxTokens,
    temperature: 0.6,
    ...(tools?.length ? { tools: toOpenAiTools(tools), tool_choice: 'auto' } : {}),
    // Gemini 2.5 thinks by default and counts it in max_tokens: keep it short.
    ...(p.id === 'gemini' ? { reasoning_effort: 'low' } : {}),
    // gpt-oss reasons before answering and those tokens count in Groq's per-minute quota.
    ...(/gpt-oss/.test(p.model ?? '') ? { reasoning_effort: 'low' } : {}),
  };
  let data;
  try {
    data = await callOnce(p, body, timeoutMs);
  } catch (e) {
    // Groq answers 400 "tool_use_failed" when the model wrote a malformed call: one retry usually works.
    if (e instanceof ProviderError && e.status === 400 && /tool_use_failed|failed to call a function/i.test(e.detail ?? '')) data = await callOnce(p, body, timeoutMs);
    // Per-minute quota (Groq TPM): the provider asks for a few seconds, wait once instead of giving up.
    else if (e instanceof ProviderError && e.code === 'rate_limited' && e.retryAfter && e.retryAfter <= 20) {
      await new Promise(r => setTimeout(r, e.retryAfter * 1000 + 250));
      data = await callOnce(p, body, timeoutMs);
    } else throw e;
  }
  return fromOpenAiResponse(data, tools ? new Set(tools.map(t => t.name)) : null);
}
