import { create } from 'zustand';
import { uid } from '../lib/utils';
import { t } from '../i18n';

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'success' | 'error';
  /** Optional button in the toast, e.g. « Annuler ». */
  action?: ToastAction;
  /** Stays until closed (`duration: 0`): « Nouvelle version disponible ». */
  sticky?: boolean;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

/** A reminder shown inside the app (lib/reminderScheduler): stays until closed. */
export interface ReminderAlert {
  key: string;
  title: string;
  body: string;
  url: string;
  /** The reminders it stands for (several due together): « Plus tard » and « Fait » act on them. */
  keys?: string[];
  /** When it came (ms). */
  at?: number;
}

interface DialogRequest {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** A second answer beside the main one (« Celui-ci et les suivants »): resolves 'other'. */
  otherLabel?: string;
  /** Text dialog: a file name (only the part before the extension is selected, like in a file manager). */
  fileName?: boolean;
  /** Text dialog: a web address (keyboard with « / » and « .com » on phones). */
  url?: boolean;
  /** Text dialog: the longest text it takes (a note's title field stops at 200). */
  maxLength?: number;
  resolve: (value: string | boolean | null) => void;
}

export interface ToastOptions {
  /** How long it stays (ms); 0: until closed (its ✕ or its button). */
  duration?: number;
}

/** Errors stay longer (read, then acted on); a toast with a button leaves time to reach it. */
export const toastDuration = (tone: Toast['tone'], action?: ToastAction) => (tone === 'error' ? 8000 : action ? 6000 : 3500);

/** Each toast's countdown: what is left of it, and since when it runs (none while paused). */
const timers = new Map<string, { left: number; since: number; timer?: ReturnType<typeof setTimeout> }>();
const stopTimer = (id: string) => {
  const c = timers.get(id);
  if (c?.timer) {
    clearTimeout(c.timer);
    c.left -= Date.now() - c.since;
    c.timer = undefined;
  }
};

interface UiState {
  toasts: Toast[];
  /**
   * Affichage Pro: the island at the top of the screen shows the toasts, one after the other (components/Island). A
   * toast's countdown then starts when it comes into view, not when it is made.
   */
  island: boolean;
  setIsland: (on: boolean) => void;
  alerts: ReminderAlert[];
  /** Reports and feedback still to handle (admins only): the badge on « Administration ». */
  adminPending: number;
  dialog: DialogRequest | null;
  toast: (text: string, tone?: Toast['tone'], action?: ToastAction, options?: ToastOptions) => void;
  dismissToast: (id: string) => void;
  /** The pointer or the focus is on the toast: it waits (it might be being read, or its button reached). */
  pauseToast: (id: string) => void;
  resumeToast: (id: string) => void;
  showAlert: (a: ReminderAlert) => void;
  dismissAlert: (key: string) => void;
  closeDialog: (value: string | boolean | null) => void;
}

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  island: false,
  alerts: [],
  adminPending: 0,
  dialog: null,
  toast(text, tone = 'info', action, options = {}) {
    const duration = options.duration ?? toastDuration(tone, action);
    const t: Toast = { id: uid(), text, tone, action, ...(duration <= 0 && { sticky: true }) };
    // A success makes an earlier error out of date (retried and done): it isn't left on screen beside it.
    // The same message again (a button pressed twice…): one toast, the new one, not two alike stacked.
    const gone = get().toasts.filter(x => (tone === 'success' && x.tone === 'error') || (x.text === text && x.tone === tone));
    gone.forEach(x => (stopTimer(x.id), timers.delete(x.id)));
    // The island shows one at a time: the one in view makes way sooner for the next (an error stays readable).
    const island = get().island;
    const shown = island && duration > 0 ? get().toasts.find(x => !x.sticky && !gone.includes(x)) : undefined;
    const c = shown && timers.get(shown.id);
    if (shown && c) {
      const running = !!c.timer;
      stopTimer(shown.id);
      c.left = Math.min(c.left, shown.tone === 'error' ? 3000 : 1600);
      if (running) get().resumeToast(shown.id);
    }
    set(s => ({ toasts: [...s.toasts.filter(x => !gone.includes(x)), t] }));
    if (duration > 0) {
      timers.set(t.id, { left: duration, since: 0 });
      if (!island) get().resumeToast(t.id);
    }
  },
  setIsland(on) {
    if (get().island === on) return;
    set({ island: on });
    // Back to the usual toasts: those waiting for their turn count down now.
    if (!on) get().toasts.forEach(x => get().resumeToast(x.id));
  },
  dismissToast(id) {
    stopTimer(id);
    timers.delete(id);
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
  },
  pauseToast: stopTimer,
  resumeToast(id) {
    const c = timers.get(id);
    if (!c || c.timer) return;
    c.since = Date.now();
    c.timer = setTimeout(() => get().dismissToast(id), Math.max(c.left, 1000)); // a moment to leave it, at least
  },
  showAlert: a => set(s => (s.alerts.some(x => x.key === a.key) ? s : { alerts: [...s.alerts, a].slice(-4) })),
  dismissAlert: key => set(s => ({ alerts: s.alerts.filter(a => a.key !== key) })),
  closeDialog(value) {
    get().dialog?.resolve(value);
    set({ dialog: null });
  },
}));

export const toast = (text: string, tone?: Toast['tone'], action?: ToastAction, options?: ToastOptions) => useUi.getState().toast(text, tone, action, options);

export function askText(title: string, defaultValue = '', confirmLabel = t('Valider'), options: { fileName?: boolean; url?: boolean; maxLength?: number } = {}): Promise<string | null> {
  return new Promise(resolve =>
    useUi.setState({ dialog: { kind: 'prompt', title, defaultValue, confirmLabel, ...options, resolve: v => resolve(typeof v === 'string' ? v : null) } }),
  );
}

/** Two answers and « Annuler »: 'confirm' (the main button), 'other', or null. */
export function askChoice(title: string, message: string, confirmLabel: string, otherLabel: string, danger = false): Promise<'confirm' | 'other' | null> {
  return new Promise(resolve =>
    useUi.setState({ dialog: { kind: 'confirm', title, message, confirmLabel, otherLabel, danger, resolve: v => resolve(v === true ? 'confirm' : v === 'other' ? 'other' : null) } }),
  );
}

export function confirmAction(title: string, message?: string, confirmLabel = t('Supprimer'), danger = true): Promise<boolean> {
  return new Promise(resolve =>
    useUi.setState({ dialog: { kind: 'confirm', title, message, confirmLabel, danger, resolve: v => resolve(v === true) } }),
  );
}
