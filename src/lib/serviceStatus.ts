// Is Kompaly reachable? Every request to Supabase goes through serviceFetch (lib/supabase): two failures in a row
// (no answer, or a server error) and the banner says the service is disturbed; the first answer that works clears it.
// While disturbed, a light check runs every 30 s so the banner goes away on its own.

import { create } from 'zustand';

export type Health = 'ok' | 'offline' | 'down';

const isOffline = () => globalThis.navigator?.onLine === false;
export const useService = create<{ state: Health }>(() => ({ state: isOffline() ? 'offline' : 'ok' }));

/** Failures in a row before the banner: one lost request (a tunnel, a phone waking up) is not an outage. */
const FAILS = 2;
let fails = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let check: (() => Promise<unknown>) | undefined;

const set = (state: Health) => useService.getState().state !== state && useService.setState({ state });

/** A request's outcome: true when the service answered (even « not found » or « not allowed »). */
export function report(ok: boolean) {
  if (ok) {
    fails = 0;
    clearInterval(timer);
    timer = undefined;
    return set(isOffline() ? 'offline' : 'ok');
  }
  if (isOffline()) return set('offline');
  if (++fails < FAILS) return;
  set('down');
  timer ??= setInterval(() => void check?.().catch(() => {}), 30_000);
}

/** A server error, or Cloudflare's own pages when the server behind it doesn't answer (520-530). */
export const isOutage = (status: number) => status >= 500;

/** fetch, telling report() how it went. A request cancelled on purpose (AbortError) says nothing. */
export async function serviceFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(input, init);
    report(!isOutage(res.status));
    return res;
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') report(false);
    throw e;
  }
}

/** What the « Réessayer » button and the 30 s check run (lib/supabase: Supabase's own health page). */
export function setHealthCheck(fn: () => Promise<unknown>) {
  check = fn;
}
export const retryNow = () => check?.().catch(() => {});

globalThis.addEventListener?.('offline', () => set('offline'));
globalThis.addEventListener?.('online', () => {
  fails = 0;
  set('ok');
  void retryNow();
});
