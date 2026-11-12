// Calls to Kompaly's server for a recorded class (server/cours.mjs).

import { accessToken } from '../supabase';
import { getSettings } from '../../store/settings';
import { lang } from '../../i18n';

export class CoursError extends Error {
  /** disabled | daily_limit | site_limit | rate_limited | unauthorized | network | timeout | … */
  code: string;
  retryAfter?: number;
  constructor(code: string, retryAfter?: number) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** The server can't help (not set up, or today's allowance used): no use trying again soon. */
export const isFinal = (e: unknown) => e instanceof CoursError && ['disabled', 'daily_limit', 'site_limit', 'bad_audio', 'bad_task', 'http_404', 'simple_only'].includes(e.code); // 404: no transcription server here at all

async function call<T>(path: string, init: RequestInit, timeoutMs: number, stop?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  stop?.addEventListener('abort', () => ctrl.abort());
  try {
    // « Mode simple uniquement » (Réglages › Kompaly): the sound, the text and the photos go to an AI, so nothing leaves.
    if (getSettings().simpleOnly && path !== 'etat' && path !== 'alerte') throw new CoursError('simple_only');
    const token = await accessToken();
    const res = await fetch(`/api/cours/${path}`, { ...init, headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new CoursError(data.error ?? `http_${res.status}`, Number(data.retryAfter) || undefined);
    // A long reading answers 200 at once and its outcome at the end (server/cours.mjs › sendSlowly): an error then too.
    if (typeof data?.error === 'string') throw new CoursError(data.error, Number(data.retryAfter) || undefined);
    return data as T;
  } catch (e) {
    if (e instanceof CoursError) throw e;
    throw new CoursError((e as Error).name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

export interface Heard {
  start: number;
  end: number;
  text: string;
}

/** One piece of sound (FLAC or WAV) → what was said, times from the start of the piece. `hint`: words to expect, the end of what came before. */
export const transcribe = (audio: Blob, hint: string) =>
  call<{ segments: Heard[] }>('transcrire', { method: 'POST', headers: { 'Content-Type': audio.type || 'audio/wav', 'X-Indice': encodeURIComponent(hint.slice(0, 600)), 'X-Langue': lang }, body: audio }, 60_000).then(r => r.segments ?? []);

export interface WrittenPart {
  title: string;
  text: string;
  points: string[];
}

export const writePart = (body: { title: string; text: string; keywords: string[]; before?: string }) => call<WrittenPart>('rediger', json({ task: 'partie', usage: getSettings().usage, ...body }), 120_000);
export const listPoints = (body: { title: string; text: string }) => call<{ points: string[] }>('rediger', json({ task: 'points', usage: getSettings().usage, ...body }), 120_000).then(r => r.points ?? []);
export const writeDoc = (task: 'fiche' | 'examen', body: { title: string; points: string[]; parts?: string[]; moments?: string[] }) =>
  call<{ text: string }>('rediger', json({ task, usage: getSettings().usage, ...body }), 120_000).then(r => r.text);
export const alertOtherDevices = (body: { title: string; body: string; except?: string }) => call<{ ok: boolean }>('alerte', json(body), 15_000).catch(() => null);
/** `audioLeft` / `audioMax`: seconds of recording left today and allowed a day (signed in). */
export const serverState = () => call<{ transcription: boolean; redaction: boolean; photo?: boolean; audioLeft?: number; audioMax?: number }>('etat', { method: 'GET' }, 10_000);
/** Photos (JPEG data URLs) → the sheet they hold, in Markdown (server/photo.mjs). */
export const readPhotoSheet = (photos: string[], stop?: AbortSignal) =>
  call<{ text?: string }>('photo', json({ photos }), 110_000, stop).then(r => {
    if (!r.text) throw new CoursError('empty_answer');
    return r.text;
  });

/** A slot read on a planning's photo (server/photo.mjs › cleanSlots). */
export interface PlanningSlot {
  title: string;
  date: string;
  start?: string;
  end?: string;
  place?: string;
}
/** Photo(s) of a planning → the slots it holds (nothing is added: the page shows them first). `name`: whose line. */
export const readPlanningPhoto = (photos: string[], body: { today: string; name?: string; hint?: string }, stop?: AbortSignal) =>
  call<{ slots?: PlanningSlot[]; note?: string }>('planning', json({ photos, ...body }), 110_000, stop).then(r => ({ slots: Array.isArray(r.slots) ? r.slots : [], note: r.note ?? '' }));

function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(body as object), lang }) };
}

/** Waits until the server accepts again (rate limit), or `ms`, but stops early when `cancelled()`. */
export async function pause(ms: number, cancelled: () => boolean = () => false) {
  const until = Date.now() + ms;
  while (Date.now() < until && !cancelled()) await new Promise(r => setTimeout(r, Math.min(500, until - Date.now())));
}

/** Does `fn`, trying again after a short wait when the server is busy or the network drops (not when it's final). */
export async function withRetry<T>(fn: () => Promise<T>, opts: { tries?: number | (() => number); onWait?: (seconds: number) => void; cancelled?: () => boolean } = {}): Promise<T> {
  // `tries` as a function is read at each failure: a limit that changes along the way (e.g. once recording ends).
  const tries = () => (typeof opts.tries === 'function' ? opts.tries() : (opts.tries ?? 6));
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (isFinal(e) || i >= tries() - 1 || opts.cancelled?.()) throw e;
      const wait = e instanceof CoursError && e.retryAfter ? e.retryAfter : Math.min(60, 3 * 2 ** i);
      opts.onWait?.(wait);
      await pause(wait * 1000, opts.cancelled);
    }
  }
}
