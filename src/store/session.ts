import { useDrive } from './drive';
import { useCalendar } from './calendar';
import { useNotes } from './notes';
import { useCopilot } from './copilot';
import { useSettings, applyAppearance, storedTheme, type Settings } from './settings';
import { getStorageUser, setStorageUser } from '../lib/userStorage';
import { cloudEnabled } from '../lib/supabase';
import { pullAll, pushLeftovers, startSync, stopSync, updateCloudProfile } from '../lib/cloudSync';
import { useAuth } from './auth';
import { toast } from './ui';
import { useTodos } from './todos';
import { TOUR_TODO, isTourTodo } from './tour';
import { useFocusLog } from './focusLog';
import { useFocus, settleFocus } from './focus';
import { renameToKompa } from '../lib/renameToKompa';
import { applyUsage, USAGES } from '../lib/usage';
import { create } from 'zustand';
import { useRecorder, stopHearing } from './recorder';

// Two tabs of the same account: what one saves, the other loads (else its next save would erase it).
const PERSISTED = { drive: useDrive, calendar: useCalendar, notes: useNotes, copilot: useCopilot, settings: useSettings, todos: useTodos, 'focus-log': useFocusLog, focus: useFocus };
if (typeof window !== 'undefined')
  addEventListener('storage', e => {
    const prefix = `cop:${getStorageUser()}:`;
    if (!getStorageUser() || e.newValue === null || !e.key?.startsWith(prefix)) return;
    void PERSISTED[e.key.slice(prefix.length) as keyof typeof PERSISTED]?.persist.rehydrate();
  });

/** True while a brand-new account still has to answer the welcome questionnaire. */
export const useWelcome = create<{ pending: boolean }>(() => ({ pending: false }));

// Local mode has no profile row: a flag per account says the questionnaire is still to answer,
// so a reload in the middle of it doesn't skip it.
const welcomeKey = (userId: string) => `cop:${userId}:welcome`;
export function markLocalWelcome(userId: string) {
  try {
    localStorage.setItem(welcomeKey(userId), '1');
  } catch {
    /* private mode: the questionnaire still shows now, only a reload skips it */
  }
  useWelcome.setState({ pending: true });
}
function localWelcomePending(userId: string) {
  try {
    return localStorage.getItem(welcomeKey(userId)) === '1';
  } catch {
    return false;
  }
}

/** Questionnaire in progress (question shown and answers so far), so a reload picks it up where it was. */
export interface WelcomeDraft {
  step: number;
  answers: WelcomeAnswers;
}
const draftKey = (userId: string) => `cop:${userId}:welcome-draft`;
export function saveWelcomeDraft(userId: string, draft: WelcomeDraft) {
  try {
    sessionStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch {
    /* private mode: a reload starts the questionnaire again */
  }
}
/** The saved draft merged over `defaults`, or null when there is none (or it is unreadable). */
export function loadWelcomeDraft(userId: string, defaults: WelcomeAnswers, steps: number): WelcomeDraft | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(draftKey(userId)) ?? 'null') as Partial<WelcomeDraft> | null;
    if (!raw || typeof raw !== 'object') return null;
    const step = Number.isInteger(raw.step) ? Math.min(Math.max(raw.step as number, 0), steps - 1) : 0;
    const answers = { ...defaults };
    for (const k of Object.keys(defaults) as (keyof WelcomeAnswers)[]) {
      const v = raw.answers?.[k];
      if (typeof v === typeof defaults[k] && Array.isArray(v) === Array.isArray(defaults[k])) Object.assign(answers, { [k]: v });
    }
    if (!USAGES.some(u => u.key === answers.usage)) answers.usage = defaults.usage;
    return { step, answers };
  } catch {
    return null;
  }
}
function clearWelcomeDraft(userId: string) {
  try {
    sessionStorage.removeItem(draftKey(userId));
  } catch {
    /* nothing saved */
  }
}

let loading: Promise<void> = Promise.resolve();

/**
 * Load the signed-in user's data (or reset everything when signed out). Calls run one after the
 * other: two loads interleaved would reset the stores and the sync queue under each other.
 */
export function loadUserData() {
  const run = loading.then(load);
  loading = run.catch(() => undefined);
  return run;
}

async function load() {
  const userId = getStorageUser();
  useWelcome.setState({ pending: false });
  if (cloudEnabled) stopSync();
  // Detach storage while clearing memory, otherwise the reset would overwrite the saved data.
  setStorageUser(null);
  useDrive.setState({ items: [], trash: [], clipboard: null });
  useCalendar.setState({ events: [], trash: [] });
  useNotes.setState({ folders: [], notes: [], trashFolders: [], trashNotes: [] });
  useTodos.setState({ todos: [] });
  useFocusLog.setState({ sessions: [] });
  useFocus.setState({ phase: null, pausedLeft: null, label: '' });
  useCopilot.getState().reset();
  useSettings.getState().reset();
  // A class being recorded belongs to the account that started it: its sound stops, what's written stays saved.
  stopHearing();
  useRecorder.setState({ session: null, history: [], folders: {} });
  setStorageUser(userId);
  if (!userId) {
    // Logged out: last theme used on this device, otherwise the system's.
    applyAppearance({ ...useSettings.getState(), theme: storedTheme() ?? 'auto' }, false);
    return;
  }
  await Promise.all([
    useDrive.persist.rehydrate(),
    useCalendar.persist.rehydrate(),
    useNotes.persist.rehydrate(),
    useCopilot.persist.rehydrate(),
    useSettings.persist.rehydrate(),
    useTodos.persist.rehydrate(),
    useFocusLog.persist.rehydrate(),
    useFocus.persist.rehydrate(),
    useRecorder.persist.rehydrate(),
  ]);

  // Cloud mode: the local copy above is only a cache, the truth is in Supabase.
  if (cloudEnabled) {
    try {
      await pushLeftovers(userId); // never let the cloud copy overwrite unsent local changes
      const profile = await pullAll(userId);
      startSync(userId);
      // New account: the welcome questionnaire comes first, it seeds the account when done.
      useWelcome.setState({ pending: !profile.onboarded });
    } catch (e) {
      console.error('[sync] chargement', e);
      startSync(userId);
      toast('Impossible de charger tes données en ligne. Tu vois la dernière version enregistrée sur cet appareil.', 'error');
    }
  } else if (localWelcomePending(userId)) {
    useWelcome.setState({ pending: true });
  }
  // Trash: what has been there for more than 30 days goes for good.
  useDrive.getState().purgeExpired();
  useNotes.getState().purgeExpired();
  useCalendar.getState().purgeExpired();
  settleFocus();
  renameToKompa();
  applyUsage(useSettings.getState().usage);
  applyAppearance(useSettings.getState());
}

export type WelcomeAnswers = Pick<Settings, 'usage' | 'year' | 'school' | 'program' | 'needs' | 'persona' | 'revisionTime'>;

/** End of the welcome questionnaire: fill the profile, adapt Kompaly, seed the account, never ask again. */
export async function finishWelcome(answers: WelcomeAnswers) {
  const settings = useSettings.getState();
  settings.set({
    ...answers,
    // Someone who asked for help from the AI gets a Kompaly that speaks up more (the default is the quiet one);
    // someone who didn't keeps the quiet one (still one click away).
    chattiness: answers.needs.includes('ia') ? (settings.chattiness === 'calme' ? 'normal' : settings.chattiness) : answers.needs.length ? 'calme' : settings.chattiness,
  });
  applyUsage(answers.usage);
  const user = useAuth.getState().user;
  seedNewAccount();
  // Saved before leaving the page: switching to the home page first let a closed tab lose it (questionnaire again).
  if (cloudEnabled && user) {
    // Once more after a network hiccup: otherwise the questionnaire comes back at the next sign-in.
    await updateCloudProfile(user.id, { onboarded: true })
      .catch(() => new Promise(r => setTimeout(r, 1500)).then(() => updateCloudProfile(user.id, { onboarded: true })))
      .catch(() => undefined);
  }
  if (!cloudEnabled && user) localStorage.removeItem(welcomeKey(user.id));
  if (user) clearWelcomeDraft(user.id);
  useWelcome.setState({ pending: false });
}

/** A brand-new account starts empty: only the task that launches the guided tour. */
export function seedNewAccount() {
  if (!useTodos.getState().todos.some(t => isTourTodo(t.title))) useTodos.getState().add(TOUR_TODO); // no due date: it never turns red « En retard »
}
