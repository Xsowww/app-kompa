import { create } from 'zustand';
import { uid } from '../lib/utils';
import { t } from '../i18n';

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'success' | 'error';
  /** Optional button in the toast, e.g. « Annuler ». */
  action?: ToastAction;
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
  /** Text dialog: a file name (only the part before the extension is selected, like in a file manager). */
  fileName?: boolean;
  /** Text dialog: a web address (keyboard with « / » and « .com » on phones). */
  url?: boolean;
  resolve: (value: string | boolean | null) => void;
}

interface UiState {
  toasts: Toast[];
  alerts: ReminderAlert[];
  /** Reports and feedback still to handle (admins only): the badge on « Administration ». */
  adminPending: number;
  dialog: DialogRequest | null;
  toast: (text: string, tone?: Toast['tone'], action?: ToastAction) => void;
  dismissToast: (id: string) => void;
  showAlert: (a: ReminderAlert) => void;
  dismissAlert: (key: string) => void;
  closeDialog: (value: string | boolean | null) => void;
}

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  alerts: [],
  adminPending: 0,
  dialog: null,
  toast(text, tone = 'info', action) {
    const t: Toast = { id: uid(), text, tone, action };
    set(s => ({ toasts: [...s.toasts, t] }));
    setTimeout(() => get().dismissToast(t.id), action ? 6000 : 3500);
  },
  dismissToast: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  showAlert: a => set(s => (s.alerts.some(x => x.key === a.key) ? s : { alerts: [...s.alerts, a].slice(-4) })),
  dismissAlert: key => set(s => ({ alerts: s.alerts.filter(a => a.key !== key) })),
  closeDialog(value) {
    get().dialog?.resolve(value);
    set({ dialog: null });
  },
}));

export const toast = (text: string, tone?: Toast['tone'], action?: ToastAction) => useUi.getState().toast(text, tone, action);

export function askText(title: string, defaultValue = '', confirmLabel = t('Valider'), options: { fileName?: boolean; url?: boolean } = {}): Promise<string | null> {
  return new Promise(resolve =>
    useUi.setState({ dialog: { kind: 'prompt', title, defaultValue, confirmLabel, ...options, resolve: v => resolve(typeof v === 'string' ? v : null) } }),
  );
}

export function confirmAction(title: string, message?: string, confirmLabel = t('Supprimer'), danger = true): Promise<boolean> {
  return new Promise(resolve =>
    useUi.setState({ dialog: { kind: 'confirm', title, message, confirmLabel, danger, resolve: v => resolve(v === true) } }),
  );
}
