// Pause of the AI brain after the provider's quota was reached or a technical problem (simple mode meanwhile).
// shortcut: kept in this tab's sessionStorage, each tab finds the limit by itself (one failed call); fine for now.
const PAUSE_KEY = 'cop-ai-paused-until';
const REASON_KEY = 'cop-ai-paused-why';

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
  try {
    const t = Number(sessionStorage.getItem(PAUSE_KEY));
    return t > Date.now() ? t : 0;
  } catch {
    return 0;
  }
}

export function aiPauseReason(): PauseReason {
  try {
    const r = sessionStorage.getItem(REASON_KEY);
    return r === 'error' || r === 'mine' ? r : 'limit';
  } catch {
    return 'limit';
  }
}
