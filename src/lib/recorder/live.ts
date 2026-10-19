// The quick lane, with the microphone: the browser's own speech recognition shows the words as they are said
// (about 1 s late) and spots the keywords at once. The text kept comes from the precise lane (the server).
// Absent in Firefox: only the precise lane then, about 20 s late.

import { locale } from '../../i18n';
import { recognitionCtor } from '../../copilot/voice';

export const canHearLive = () => typeof window !== 'undefined' && recognitionCtor() !== null;

export interface LiveLane {
  stop: () => void;
}

/** Listens until `stop()`, starting again by itself after each pause (the browser stops after a silence). */
export function startLive(onText: (text: string, final: boolean) => void, onFatal: () => void): LiveLane | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  let stopped = false;
  let failures = 0;
  let current: InstanceType<typeof Ctor> | null = null;

  const run = () => {
    if (stopped) return;
    const r = new Ctor();
    r.lang = locale();
    r.interimResults = true;
    r.continuous = true;
    r.onresult = e => {
      failures = 0;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) onText(res[0].transcript.trim(), true);
        else interim += res[0].transcript;
      }
      onText(interim.trim(), false);
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') {
        stopped = true;
        onFatal();
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') failures++;
    };
    r.onend = () => {
      current = null;
      if (stopped) return;
      // Network trouble: wait a little longer each time, give up after a while (the precise lane goes on).
      if (failures > 8) return onFatal();
      setTimeout(run, failures ? Math.min(30_000, 1000 * 2 ** failures) : 150);
    };
    current = r;
    try {
      r.start();
    } catch {
      failures++;
      setTimeout(run, 2000);
    }
  };
  run();
  return {
    stop: () => {
      stopped = true;
      current?.abort();
    },
  };
}
