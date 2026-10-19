import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { userStorage } from '../lib/userStorage';
import { getSettings, useSettings } from './settings';
import { useCopilot } from './copilot';
import { notify, chime } from '../lib/notify';
import { useFocusLog } from './focusLog';
import { t, tn } from '../i18n';

export type FocusPhase = 'focus' | 'break';

interface FocusState {
  phase: FocusPhase | null; // null = idle
  endsAt: number;
  pausedLeft: number | null; // ms left while paused
  label: string;
  minutes: number; // planned length of the current phase: changing the setting mid-session changes nothing
  start: (label?: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  tick: () => void;
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** « Ta session sur « Maths » s’est terminée pendant ton absence : 25 min comptées. » */
const endedAway = (label: string, minutes: number) =>
  label
    ? t('Ta session sur «\u00a0{label}\u00a0» s’est terminée pendant ton absence\u00a0: {minutes}\u00a0min comptées.', { label, minutes })
    : t('Ta session s’est terminée pendant ton absence\u00a0: {minutes}\u00a0min comptées.', { minutes });

// Kept on the device: a reload (often on phones, coming back to the tab) doesn't lose the session.
export const useFocus = create<FocusState>()(
  persist(
    (set, get) => ({
      phase: null,
      endsAt: 0,
      pausedLeft: null,
      label: '',
      minutes: 0,

      start(label = '') {
        const minutes = getSettings().focusMinutes;
        set({ phase: 'focus', endsAt: Date.now() + minutes * 60_000, pausedLeft: null, label, minutes });
      },
      pause() {
        const s = get();
        if (s.phase && s.pausedLeft === null) set({ pausedLeft: Math.max(0, s.endsAt - Date.now()) });
      },
      resume() {
        const s = get();
        if (s.phase && s.pausedLeft !== null) set({ endsAt: Date.now() + s.pausedLeft, pausedLeft: null });
      },
      stop: () => set({ phase: null, pausedLeft: null, label: '' }),

      /** Called every second by the timer widget; switches phases when time is up (even long after, tab closed). */
      tick() {
        const s = get();
        if (!s.phase || s.pausedLeft !== null || Date.now() < s.endsAt) return;
        const settings = getSettings();
        if (s.phase === 'focus') {
          const minutes = s.minutes || settings.focusMinutes;
          useSettings.getState().set({
            focusSessions: settings.focusSessions + 1,
            focusTotalMinutes: settings.focusTotalMinutes + minutes,
          });
          useFocusLog.getState().log(s.label, minutes, new Date(s.endsAt - minutes * 60_000).toISOString());
          // The break starts when the session really ended, not when the tab comes back.
          const breakEndsAt = s.endsAt + settings.breakMinutes * 60_000;
          if (Date.now() >= breakEndsAt) {
            useCopilot.getState().say({ text: endedAway(s.label, minutes), mood: 'happy' });
            set({ phase: null, pausedLeft: null, label: '' });
            return;
          }
          if (settings.focusSound) chime();
          // Back after the end (tab closed, phone asleep): part of the break is already gone.
          const breakLeft = Math.ceil((breakEndsAt - Date.now()) / 60_000);
          const late = breakLeft < settings.breakMinutes;
          const pause = settings.breakMinutes;
          const text = late
            ? `${endedAway(s.label, minutes)} ${t('Il te reste {n}\u00a0min de pause.', { n: breakLeft })}`
            : pick([
                t('{minutes}\u00a0minutes de concentration, bien joué. Pause de {pause}\u00a0min\u00a0: lève-toi, bois un verre d’eau.', { minutes, pause }),
                s.label
                  ? tn(pause, 'Session terminée sur «\u00a0{label}\u00a0». Tu as mérité ta pause de {n}\u00a0minute.', 'Session terminée sur «\u00a0{label}\u00a0». Tu as mérité ta pause de {n}\u00a0minutes.', { label: s.label })
                  : tn(pause, 'Session terminée. Tu as mérité ta pause de {n}\u00a0minute.', 'Session terminée. Tu as mérité ta pause de {n}\u00a0minutes.'),
              ]);
          useCopilot.getState().say({ text, mood: 'happy' });
          notify(t('Session terminée'), late ? tn(breakLeft, 'Il reste {n}\u00a0minute de pause.', 'Il reste {n}\u00a0minutes de pause.') : tn(pause, 'Pause de {n}\u00a0minute.', 'Pause de {n}\u00a0minutes.'));
          set({ phase: 'break', endsAt: breakEndsAt, minutes: settings.breakMinutes });
        } else {
          if (settings.focusSound) chime();
          notify(t('Fin de la pause'), t('On repart pour une session\u00a0?'));
          useCopilot.getState().say({ text: t('Fin de la pause. On repart pour une session\u00a0?'), mood: 'alert' });
          set({ phase: null, label: '' });
        }
      },
    }),
    {
      name: 'focus',
      storage: userStorage,
      skipHydration: true,
      partialize: s => ({ phase: s.phase, endsAt: s.endsAt, pausedLeft: s.pausedLeft, label: s.label, minutes: s.minutes }),
    },
  ),
);

/**
 * After loading an account. A session that ended while the tab was closed is still counted
 * (its break runs from the real end); a break that is long over is simply gone.
 */
export function settleFocus() {
  const s = useFocus.getState();
  if (!s.phase || s.pausedLeft !== null || Date.now() < s.endsAt) return;
  if (s.phase === 'focus') s.tick();
  else if (Date.now() > s.endsAt + getSettings().breakMinutes * 60_000) s.stop();
}

export function focusLeft(s: Pick<FocusState, 'endsAt' | 'pausedLeft'>) {
  return s.pausedLeft ?? Math.max(0, s.endsAt - Date.now());
}

export const mmss = (ms: number) => {
  const t = Math.ceil(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
