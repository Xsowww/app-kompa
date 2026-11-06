// Pause of the AI brain after the provider's quota was reached or a technical problem (simple mode meanwhile).
// shortcut: kept in this tab's sessionStorage, each tab finds the limit by itself (one failed call); fine for now.
const PAUSE_KEY = 'cop-ai-paused-until';
const REASON_KEY = 'cop-ai-paused-why';
/** Today's questions as the server counted them (claudeBrain keeps it): { used, max, day }. */
export const QUOTA_KEY = 'kompaly-ai-quota';

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * All of today's questions are used (30/30): the AI is off until midnight, in every tab and after a reload — the
 * header said « Mode intelligent » with its green dot until a 31st question failed (test n°3). 0 otherwise.
 */
export function quotaFullUntil(now = new Date()): number {
  try {
    const q = JSON.parse(localStorage.getItem(QUOTA_KEY) ?? 'null') as { used?: number; max?: number; day?: string } | null;
    if (!q || q.day !== localDay(now) || typeof q.used !== 'number' || typeof q.max !== 'number' || q.used < q.max) return 0;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  } catch {
    return 0;
  }
}

/** Why the AI is paused: the site's quota (« limite »), the student's own questions of the day, or a problem. */
export type PauseReason = 'limit' | 'mine' | 'error';

export function pauseAi(seconds: number, reason: PauseReason = 'limit') {
  try {
    sessionStorage.setItem(PAUSE_KEY, String(Date.now() + seconds * 1000));
    sessionStorage.setItem(REASON_KEY, reason);
  } catch {
    /* storage unavailable: the next call will simply hit the limit again */
  }
}

/** Time (ms) until which the AI is paused, or 0. */
export function aiPausedUntil(): number {
  let t = 0;
  try {
    t = Number(sessionStorage.getItem(PAUSE_KEY));
  } catch {
    /* storage unavailable */
  }
  return Math.max(t > Date.now() ? t : 0, quotaFullUntil());
}

/** « Réessayer » after a technical problem: the AI is asked again at once (a limit still waits its time). */
export function resumeAfterError() {
  try {
    if (aiPauseReason() === 'error') sessionStorage.removeItem(PAUSE_KEY);
  } catch {
    /* storage unavailable: nothing was kept either */
  }
}

export function aiPauseReason(): PauseReason {
  if (quotaFullUntil()) return 'mine';
  try {
    const r = sessionStorage.getItem(REASON_KEY);
    return r === 'error' || r === 'mine' ? r : 'limit';
  } catch {
    return 'limit';
  }
}
