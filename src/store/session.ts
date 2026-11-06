import { useDrive } from './drive';
import { applyUsage, guessCategory, useCalendar } from './calendar';
import { DEMO_KEY, demoPlan, readDemo } from '../lib/demoFirst';
import { spanDays } from '../lib/repeat';
import { newSeries } from '../lib/seriesId';
import { goTo, linkToDay } from '../copilot/actions';
import { useNotes } from './notes';
import { useCopilot } from './copilot';
import { useSettings, applyAppearance, storedStyle, storedTheme } from './settings';
import { getStorageUser, setStorageUser } from '../lib/userStorage';
import { cloudEnabled } from '../lib/supabase';
import { hasLocalCopy, pullAll, pushLeftovers, quietly, startSync, stopSync, updateCloudProfile } from '../lib/cloudSync';
import { useAuth } from './auth';
import { toast } from './ui';
import { useTodos } from './todos';
import { TOUR_TODO, isTourTodo } from './tour';
import { useFocusLog } from './focusLog';
import { useFocus, settleFocus } from './focus';
import { renameToKompa } from '../lib/renameToKompa';
import { readWelcomeDraft, welcomePending, type WelcomeAnswers } from '../lib/welcome';
import { navFromAnswers } from '../lib/navOrder';
import { useWelcome, welcomeKey } from './welcome';
import { useRecorder, useRecLive, stopHearing } from './recorder';
import { useGroups } from './groups';
import { lang, t } from '../i18n';

// Two tabs of the same account: what one saves, the other loads (else its next save would erase it).
const PERSISTED = { drive: useDrive, calendar: useCalendar, notes: useNotes, copilot: useCopilot, settings: useSettings, todos: useTodos, 'focus-log': useFocusLog, focus: useFocus, cours: useRecorder };
if (typeof window !== 'undefined')
  addEventListener('storage', e => {
    const prefix = `cop:${getStorageUser()}:`;
    if (!getStorageUser() || e.newValue === null || !e.key?.startsWith(prefix)) return;
    // What the other tab saved, it sends itself (synchronous storage: the whole reload is inside `quietly`).
    const name = e.key.slice(prefix.length) as keyof typeof PERSISTED;
    // The class being recorded here is this tab's own: only the other tabs follow it (« Terminé » there too).
    if (name === 'cours' && useRecLive.getState().hearing) return;
    const store = PERSISTED[name];
    quietly(() => void store?.persist.rehydrate());
  });

export { afterSignIn, markLocalWelcome, useWelcome } from './welcome';

function localWelcomePending(userId: string) {
  try {
    return localStorage.getItem(welcomeKey(userId)) === '1';
  } catch {
    return false;
  }
}

/** The questionnaire as the account's settings tell it (synced), with the profile's `onboarded` when it was read. */
function settleWelcome(onboarded: boolean | undefined, unknownMeans: 'done' | 'unsure') {
  const pending = welcomePending(onboarded, useSettings.getState());
  useWelcome.setState({ pending: pending === true, unsure: pending === null && unknownMeans === 'unsure' });
}

/** Questionnaire in progress (question shown and answers so far), kept in the account: picked up there on any device. */
export function saveWelcomeDraft(draft: { step: number; answers: WelcomeAnswers }) {
  const { pending, unsure } = useWelcome.getState();
  if (pending || unsure) useSettings.getState().set({ welcomeDraft: { step: draft.step, answers: { ...draft.answers } } });
}
/** The draft saved in the account, checked (null when there is none). */
export const loadWelcomeDraft = () => readWelcomeDraft(useSettings.getState().welcomeDraft);

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
  useWelcome.setState({ pending: false, unsure: false, checking: !!userId });
  try {
    await loadAccount(userId);
  } finally {
    if (getStorageUser() === userId) useWelcome.setState({ checking: false });
  }
}

async function loadAccount(userId: string | null) {
  if (cloudEnabled) stopSync();
  // Detach storage while clearing memory, otherwise the reset would overwrite the saved data.
  setStorageUser(null);
  useDrive.setState({ items: [], trash: [], clipboard: null });
  useCalendar.setState({ events: [], trash: [] });
  useNotes.setState({ folders: [], notes: [], trashFolders: [], trashNotes: [] });
  useTodos.setState({ todos: [], trash: [] });
  useFocusLog.setState({ sessions: [] });
  useFocus.setState({ phase: null, pausedLeft: null, label: '' });
  useCopilot.getState().reset();
  useSettings.getState().reset();
  useGroups.getState().reset();
  // A class being recorded belongs to the account that started it: its sound stops, what's written stays saved.
  stopHearing();
  useRecorder.setState({ session: null, history: [], folders: {} });
  setStorageUser(userId);
  if (!userId) {
    // Logged out: last theme used on this device, otherwise the system's.
    applyAppearance({ ...useSettings.getState(), theme: storedTheme() ?? 'auto', style: storedStyle() ?? 'classique', pro: false }, false);
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
  // A regular on this device: their copy shows at once, the account is brought up to date behind it.
  if (cloudEnabled && hasLocalCopy()) {
    const left = pushLeftovers(userId); // first: its queue is loaded before the sync starts
    startSync(userId);
    // This device's copy tells (left half-way here, or synced from another device); the download confirms it.
    settleWelcome(undefined, 'done');
    void catchUp(userId, left);
  } else if (cloudEnabled) {
    try {
      await pushLeftovers(userId); // never let the cloud copy overwrite unsent local changes
      const profile = (await pullAll(userId))!;
      startSync(userId);
      // New account: the welcome questionnaire comes first, it seeds the account when done.
      settleWelcome(profile.onboarded, 'unsure');
    } catch (e) {
      console.error('[sync] chargement', e);
      startSync(userId);
      // Not known (new device, offline): the app opens, « Termine ton profil » offers the questionnaire.
      settleWelcome(undefined, 'unsure');
      toast(t('Impossible de charger tes données en ligne. Tu vois la dernière version enregistrée sur cet appareil.'), 'error');
    }
  } else {
    useWelcome.setState({ pending: localWelcomePending(userId) || welcomePending(undefined, useSettings.getState()) === true });
  }
  // Trash: what has been there for more than 30 days goes for good.
  useDrive.getState().purgeExpired();
  useNotes.getState().purgeExpired();
  useCalendar.getState().purgeExpired();
  useTodos.getState().purgeExpired();
  settleFocus();
  renameToKompa();
  applyUsage(useSettings.getState().usage);
  applyAppearance(useSettings.getState());
  keepLanguage();
}

/** The site's language goes on the account too: the server writes its e-mails in it. */
function keepLanguage() {
  if (useSettings.getState().language !== lang) useSettings.getState().set({ language: lang });
}

/** The download behind a copy already shown (load): what it changes (theme, usage…) applies when it lands. */
async function catchUp(userId: string, left: Promise<void>) {
  try {
    await left; // never let the cloud copy overwrite unsent local changes
    const profile = await pullAll(userId, true);
    if (!profile || getStorageUser() !== userId) return;
    settleWelcome(profile.onboarded, 'done');
    applyUsage(useSettings.getState().usage);
    applyAppearance(useSettings.getState());
    keepLanguage();
  } catch (e) {
    console.error('[sync] chargement', e);
    if (getStorageUser() === userId) toast(t('Impossible de charger tes données en ligne. Tu vois la dernière version enregistrée sur cet appareil.'), 'error');
  }
}

/** The profile's « onboarded », sent behind the page, tried again a few times (the settings already carry welcomeDone). */
async function markOnboarded(userId: string) {
  for (const wait of [0, 2000, 8000, 30000]) {
    await new Promise(r => setTimeout(r, wait));
    if (getStorageUser() !== userId) return;
    try {
      return await updateCloudProfile(userId, { onboarded: true });
    } catch {
      /* network: once more a little later */
    }
  }
}

/**
 * End of the welcome questionnaire: fill the profile, adapt Kompaly, order the navigation, seed the account, never ask
 * again. Nothing waits for the network (it made the last question spin for seconds): the settings (welcomeDone) go
 * with the next sync, the profile's flag behind the page.
 */
export function finishWelcome(answers: WelcomeAnswers) {
  const settings = useSettings.getState();
  const usages = answers.usages.length ? answers.usages : [answers.usage];
  // The order the former answers gave (or none): not reordered by the person, so the new answers order it again.
  const before = settings.navOrder?.length ? navFromAnswers(settings.usages.length ? settings.usages : settings.usage, settings.needs) : null;
  const custom = !!settings.navOrder?.length && settings.navOrder.join() !== before?.join();
  settings.set({
    ...answers,
    usage: usages[0],
    usages,
    welcomeDone: true,
    welcomeDraft: null,
    ...(custom ? {} : { navOrder: navFromAnswers(usages, answers.needs) }),
    // Someone who asked for help from the AI gets a Kompaly that speaks up more (the default is the quiet one);
    // someone who didn't keeps the quiet one (still one click away).
    chattiness: answers.needs.includes('ia') ? (settings.chattiness === 'calme' ? 'normal' : settings.chattiness) : answers.needs.length ? 'calme' : settings.chattiness,
  });
  applyUsage(usages[0]);
  const user = useAuth.getState().user;
  seedNewAccount();
  addDemoItem();
  if (cloudEnabled && user) void markOnboarded(user.id);
  if (!cloudEnabled && user) {
    try {
      localStorage.removeItem(welcomeKey(user.id));
    } catch {
      /* storage blocked: the settings say it too */
    }
  }
  useWelcome.setState({ pending: false, unsure: false });
}

/**
 * The sentence tried in the home page's demo, still there (a day at most): the account's first event or task, made
 * like the calendar's quick add, said with a toast. The demo's copy then goes, used or not.
 */
export function addDemoItem() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(DEMO_KEY);
    localStorage.removeItem(DEMO_KEY);
  } catch {
    return;
  }
  const demo = readDemo(raw);
  const plan = demo && demoPlan(demo.text, demo.at);
  if (!plan) return;
  if (plan.kind === 'task') {
    const todo = useTodos.getState().add(plan.title, plan.date);
    toast(t('Ta première tâche est prête : {title}', { title: plan.title }), 'success', { label: t('Voir'), run: () => goTo(`/taches?tache=${encodeURIComponent(todo.id)}`) });
    return;
  }
  const category = guessCategory(plan.title, true);
  const base = { title: plan.title, category, ...(plan.important && { important: true }) };
  let first;
  if (plan.endDate) {
    // « Congés du 22 au 26 décembre 9h »: one a day, linked, the first one keeping the reminders (as the calendar does).
    const series = newSeries(true); // short enough for the server (lib/seriesId)
    const days = spanDays(plan.date, plan.endDate, plan.start, plan.end);
    useCalendar.getState().addMany(days.map((d, i) => ({ ...base, ...d, series, ...(i > 0 && { reminders: [] }) })));
    first = useCalendar.getState().events.find(e => e.series === series && e.date === plan.date);
  } else first = useCalendar.getState().add({ ...base, date: plan.date, start: plan.start, ...(plan.end && { end: plan.end }) });
  toast(t('Ton premier événement est prêt : {title}', { title: plan.title }), 'success', { label: t('Voir'), run: () => goTo(linkToDay(plan.date, first?.id)) });
}

/** A brand-new account starts empty: only the task that launches the guided tour. */
export function seedNewAccount() {
  if (!useTodos.getState().todos.some(t => isTourTodo(t.title))) useTodos.getState().add(TOUR_TODO); // no due date: it never turns red « En retard »
}
