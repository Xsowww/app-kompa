import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { BellRing, Check, CloudAlert, Coffee, FastForward, Info, Pause, Play, Square, Timer, WifiOff, X } from 'lucide-react';
import { useFocus, focusLeft, mmss, type FocusPhase } from '../store/focus';
import { useSettings } from '../store/settings';
import { toast, useUi, type ReminderAlert, type Toast } from '../store/ui';
import { toggleKompaly, useCopilot, type CopilotLink, type CopilotOffer } from '../store/copilot';
import { retryNow, useService, type Health } from '../lib/serviceStatus';
import { reminderItems, SNOOZE_MINUTES } from '../lib/reminders';
import { acceptOffer } from '../copilot/offers';
import { frenchSpacing, stripMarkdown } from '../copilot/markdown';
import KompalyMark from './KompalyMark';
import { sober } from '../lib/sober';
import { focusables } from '../lib/a11y';
import { useMinute, useToday } from '../lib/useToday';
import { useCalendar } from '../store/calendar';
import { useTodos } from '../store/todos';
import { dayTasks } from '../lib/proDashboard';
import { share, upcoming, useIslandLog } from './islandHub';
import { HUB_VIEWS, Lights, type HubView } from './IslandHub';
import { locale, t, tn } from '../i18n';
import './island.css';
import './islandHub.css';

/** The hub: the island opened by a tap (its views, tiles, the assistant…), loaded the first time. */
const IslandHub = lazy(() => import('./IslandHub'));

/**
 * Affichage Pro: everything that pops up comes in one place, the island at the top centre of the screen (under the
 * notch on an iPhone), like the iPhone's « Dynamic Island ». It has two sizes and springs from one to the other:
 * - open: a message with its buttons (a toast, Kompaly, a reminder, « Hors ligne », the timer's controls);
 * - small: a black pill for what goes on (the timer, a reminder waiting, Kompaly with something to say…), with a small
 *   circle beside it for a second one. A tap opens it; it shrinks by itself after a few seconds (not while the
 *   pointer or the keyboard is on it), on Échap or a tap elsewhere.
 * The toasts come one after the other, never stacked; the timer comes back once they are gone.
 * With nothing going on it stays, small (Kompaly's lights, the day's tasks as a ring, the next event's time or the
 * clock); a tap on it (or on the timer) opens the hub (components/IslandHub), a dialog grown from the pill.
 * Mounted by Toasts (components/Overlays) in Pro, for a signed-in account.
 */

/** What can stay in the island (the toasts only pass through it), first ones first in the pill. */
type Kind = 'timer' | 'reminder' | 'notice' | 'service' | 'kompaly';

/** How long it stays open after its news (ms), before shrinking back. */
const OPEN_FOR: Record<Kind, number> = { timer: 4000, reminder: 10000, notice: 9000, service: 6000, kompaly: 8000 };
/** The length of the shrinking spring (island.css › --isl-close-t): the island leaves the page after it. */
const LEAVE_MS = 440;
/** The face going away fades out meanwhile (island.css › isl-out-*, 160 ms): at the latest, it goes after this. */
const FADE_MS = 700;

interface KompalySaid {
  text: string;
  links?: CopilotLink[];
  offers?: CopilotOffer[];
}

interface Face {
  key: string;
  mode: 'mini' | 'full' | 'toast' | 'idle' | 'hub';
  el: ReactNode;
  /** Read out by screen readers when it comes (politely). */
  say?: string;
}

/** Re-draws every second (a countdown). */
function useSecond(on = true) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
}

/** The ring of the time left, emptying as the session goes, as on the iPhone's island. */
function Ring({ left, size, children }: { left: number; size: number; children?: ReactNode }) {
  const r = 15;
  const len = 2 * Math.PI * r;
  return (
    <span className="fi-ring" style={{ width: size, height: size }} aria-hidden>
      <svg className="fi-ring-svg" viewBox="0 0 36 36" width={size} height={size}>
        <circle cx="18" cy="18" r={r} className="fi-ring-track" />
        <circle cx="18" cy="18" r={r} className="fi-ring-bar" strokeDasharray={len} strokeDashoffset={len * (1 - left)} transform="rotate(-90 18 18)" />
      </svg>
      {children}
    </span>
  );
}

/** « 24:58 », each figure rolling in when it changes (the iPhone's countdowns do that). */
function Digits({ text }: { text: string }) {
  return (
    <>
      {[...text].map((c, i) => (
        <span key={`${i}-${c}`} className={c === ':' ? 'fi-colon' : 'fi-digit'}>
          {c}
        </span>
      ))}
    </>
  );
}

/** Where the session is: its words, its time, how much of it is left (0..1). */
function useTimer(phase: FocusPhase) {
  useSecond();
  const paused = useFocus(s => s.pausedLeft !== null);
  const label = useFocus(s => s.label);
  const planned = useFocus(s => s.minutes);
  const focusMinutes = useSettings(s => s.focusMinutes);
  const breakMinutes = useSettings(s => s.breakMinutes);
  const left = focusLeft(useFocus.getState());
  const focusing = phase === 'focus';
  const minutes = planned || (focusing ? focusMinutes : breakMinutes);
  const status = focusing ? (paused ? t('En pause') : t('Concentration')) : paused ? t('Pause suspendue') : t('Temps de pause');
  return { paused, label, focusing, minutes, status, time: mmss(left), rest: Math.min(1, Math.max(0, left / (minutes * 60_000))) };
}

function TimerMini({ phase, onOpen }: { phase: FocusPhase; onOpen: (keyboard: boolean) => void }) {
  const { paused, status, time, rest } = useTimer(phase);
  return (
    <button
      type="button"
      className="isl-mini fi-face"
      data-kind="timer"
      data-phase={phase}
      data-paused={paused || undefined}
      aria-label={t('{status}, encore {time}. Ouvrir le minuteur', { status, time })}
      onClick={e => onOpen(e.detail === 0)}
    >
      <span>
        <Ring left={rest} size={20} />
      </span>
      <Lights />
      <span className="fi-mini-time tabular">
        <Digits text={time} />
      </span>
    </button>
  );
}

function TimerFull({ phase, onUsed }: { phase: FocusPhase; onUsed: () => void }) {
  const { paused, label, focusing, minutes, status, time, rest } = useTimer(phase);
  const block = focusing ? t('Bloc de {n} min', { n: minutes }) : t('Pause de {n} min', { n: minutes });
  // With a subject, it is the title, and the length goes up with the state (« Concentration · 25 min »).
  const kicker = label ? `${status} · ${focusing ? t('{n} min', { n: minutes }) : label}` : status;
  const title = label && focusing ? label : block;
  const stop = () => {
    const n = useFocus.getState().stop();
    if (n) toast(tn(n, '{n} minute de concentration comptée', '{n} minutes de concentration comptées'), 'success');
  };
  return (
    <div className="isl-full fi-full fi-face" data-phase={phase} data-paused={paused || undefined} role="group" aria-label={t('Concentration')}>
      <div className="fi-head">
        <Ring left={rest} size={44}>
          {focusing ? <Timer size={16} strokeWidth={2.4} /> : <Coffee size={16} strokeWidth={2.4} />}
        </Ring>
        <div className="fi-text">
          <small>{kicker}</small>
          <strong>{title}</strong>
        </div>
        <span className="fi-time tabular" role="timer" aria-label={t('Temps restant : {time}', { time })}>
          <Digits text={time} />
        </span>
      </div>
      <div className="fi-ctl">
        {focusing ? (
          <button
            type="button"
            className="fi-btn"
            onClick={() => {
              useFocus.getState().extend(5);
              onUsed();
            }}
            aria-label={t('Ajouter 5 minutes')}
          >
            {t('+5 min')}
          </button>
        ) : (
          // Ready before the end of the break: the next session at once.
          <button
            type="button"
            className="fi-btn"
            onClick={() => {
              useFocus.getState().skipBreak();
              onUsed();
            }}
          >
            <FastForward size={14} strokeWidth={2.4} aria-hidden /> {t('Passer la pause')}
          </button>
        )}
        <button
          type="button"
          data-isl-main
          className="fi-btn fi-round fi-pause"
          onClick={() => {
            const f = useFocus.getState();
            if (paused) f.resume();
            else f.pause();
            onUsed();
          }}
          aria-label={paused ? t('Reprendre') : focusing ? t('Pause') : t('Suspendre')}
          title={paused ? t('Reprendre') : focusing ? t('Pause') : t('Suspendre')}
        >
          {paused ? <Play size={16} strokeWidth={2.6} fill="currentColor" aria-hidden /> : <Pause size={16} strokeWidth={2.6} fill="currentColor" aria-hidden />}
        </button>
        <button type="button" className="fi-btn fi-round fi-stop" onClick={stop} aria-label={t('Arrêter')} title={t('Arrêter')}>
          <Square size={13} strokeWidth={2.6} fill="currentColor" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** A toast: its icon, its words, its button (« Annuler »…). */
function ToastFace({ toast: item }: { toast: Toast }) {
  const icon = item.tone === 'success' ? <Check size={17} strokeWidth={3} /> : item.tone === 'error' ? <X size={17} strokeWidth={3} /> : <Info size={17} strokeWidth={2.4} />;
  return (
    <div className="isl-toast" data-tone={item.tone}>
      <span className="isl-ticon" aria-hidden>
        {icon}
      </span>
      <span className="isl-ttext">{sober(item.text)}</span>
      {item.action && (
        <button
          type="button"
          className="isl-btn"
          data-isl-main
          onClick={() => {
            useUi.getState().dismissToast(item.id);
            item.action!.run();
          }}
          title={item.action.label === t('Annuler') ? t('Annuler (Ctrl + Z)') : undefined}
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}

/** A message that stays until closed (« Nouvelle version disponible · Recharger »). */
function NoticeFace({ toast: item }: { toast: Toast }) {
  const dismiss = () => useUi.getState().dismissToast(item.id);
  return (
    <div className="isl-full">
      <div className="isl-head">
        <span className="isl-icon" data-tone="blue" aria-hidden>
          <Info size={19} strokeWidth={2.2} />
        </span>
        <div className="isl-text">
          <small>
            <span>Kompaly</span>
          </small>
          <strong>{sober(item.text)}</strong>
        </div>
      </div>
      <div className="isl-ctl">
        <button type="button" className="isl-btn" onClick={dismiss}>
          {t('Fermer')}
        </button>
        {item.action && (
          <button
            type="button"
            className="isl-btn isl-primary"
            data-isl-main
            onClick={() => {
              dismiss();
              item.action!.run();
            }}
          >
            {item.action.label}
          </button>
        )}
      </div>
    </div>
  );
}

/** « Rappel » for my reminders; for news (a shared calendar, the administration): where from, its 2nd line. */
const reminderFrom = (a: ReminderAlert) => (/^(event|task):/.test(a.key) ? t('Rappel') : a.body.split('\n')[1] || 'Kompaly');

/** A reminder that came due while the app is in view (lib/reminderScheduler): « Plus tard », « Fait », « Voir ». */
function ReminderFace({ alert: a, more }: { alert: ReminderAlert; more: number }) {
  const navigate = useNavigate();
  const dismiss = () => useUi.getState().dismissAlert(a.key);
  const keys = a.keys?.length ? a.keys : [a.key];
  const items = reminderItems(keys);
  const mine = items.length;
  // « Fait » only for a single task: events aren't ticked.
  const tickable = mine === 1 && items[0].kind === 'task';
  const act = (action: 'later' | 'done') => {
    dismiss();
    void import('../lib/reminderActions').then(m => m.reminderAction(action, keys));
  };
  const when = a.at ? new Date(a.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className="isl-full">
      <div className="isl-head">
        <span className="isl-icon" data-tone="amber" aria-hidden>
          <BellRing size={19} strokeWidth={2.2} />
        </span>
        <div className="isl-text">
          <small>
            <span>{more > 0 ? `${reminderFrom(a)} · ${tn(more, '{n} autre', '{n} autres')}` : reminderFrom(a)}</span>
            {when && <time className="tabular">{when}</time>}
          </small>
          <strong>{sober(a.title)}</strong>
          {/* Line 1: when; line 2 (« Agenda »): the system notification's, the kicker already says it. */}
          {a.body && <p>{a.body.split('\n')[0]}</p>}
        </div>
      </div>
      <div className="isl-ctl" data-grid>
        <button type="button" className="isl-btn" onClick={dismiss}>
          {t('Fermer')}
        </button>
        {mine > 0 && (
          <button type="button" className="isl-btn" title={t('Me le rappeler dans {n} min', { n: SNOOZE_MINUTES })} onClick={() => act('later')}>
            {t('Plus tard')}
          </button>
        )}
        {tickable && (
          <button type="button" className="isl-btn isl-done" onClick={() => act('done')}>
            {t('Fait||coché')}
          </button>
        )}
        <button
          type="button"
          className="isl-btn isl-primary"
          data-isl-main
          onClick={() => {
            dismiss();
            navigate(a.url);
          }}
        >
          {t('Voir')}
        </button>
      </div>
    </div>
  );
}

/** « Hors ligne » or « Service perturbé », while it lasts (lib/serviceStatus). */
function ServiceFace({ state }: { state: Health }) {
  const down = state === 'down';
  return (
    <div className="isl-full">
      <div className="isl-head">
        <span className="isl-icon" data-tone="amber" aria-hidden>
          {down ? <CloudAlert size={19} strokeWidth={2.2} /> : <WifiOff size={19} strokeWidth={2.2} />}
        </span>
        <div className="isl-text">
          <strong>{down ? t('Service perturbé') : t('Hors ligne')}</strong>
          <span className="isl-msg">{down ? t('Tes changements restent sur cet appareil et partiront dès que ça revient.') : t('Tes changements restent sur cet appareil et partiront au retour de la connexion.')}</span>
        </div>
      </div>
      {down && (
        <div className="isl-ctl">
          <button type="button" className="isl-btn isl-primary" data-isl-main onClick={() => void retryNow()}>
            {t('Réessayer')}
          </button>
        </div>
      )}
    </div>
  );
}

/** What Kompaly says (copilot/proactive, an answer while his panel was closed): his words, his buttons, « Ouvrir ». */
function KompalyFace({ said, onDone }: { said: KompalySaid; onDone: () => void }) {
  const navigate = useNavigate();
  const read = () => useCopilot.setState({ unread: false });
  const open = () => toggleKompaly(true);
  const close = () => {
    read();
    useCopilot.getState().clearBubble();
    onDone();
  };
  const offers = said.offers?.slice(0, 2) ?? [];
  const links = said.links?.slice(0, offers.length ? 1 : 2) ?? [];
  return (
    <div className="isl-full">
      <div className="isl-head">
        <span className="isl-icon" data-tone="kompaly" aria-hidden>
          <KompalyMark size={26} />
        </span>
        <button type="button" className="isl-text" onClick={open} aria-label={t('Ouvrir la conversation avec Kompaly')}>
          <small>
            <span>Kompaly</span>
          </small>
          <span className="isl-msg">{sober(stripMarkdown(said.text))}</span>
        </button>
        <button type="button" className="isl-x" onClick={close} title={t('Fermer')} aria-label={t('Fermer le message')}>
          <X size={15} strokeWidth={2.6} aria-hidden />
        </button>
      </div>
      <div className="isl-ctl">
        {offers.map((o, i) => (
          <button
            key={o.label}
            type="button"
            className={i === 0 ? 'isl-btn isl-primary' : 'isl-btn'}
            data-isl-main={i === 0 || undefined}
            onClick={() => {
              read();
              useCopilot.getState().clearBubble();
              acceptOffer(
                o,
                said.offers!.filter(x => x !== o && x.kind === 'confirm_change'),
              );
            }}
          >
            {sober(frenchSpacing(o.label))}
          </button>
        ))}
        {links.map((l, i) => (
          <button
            key={l.to + l.label}
            type="button"
            className={!offers.length && i === 0 ? 'isl-btn isl-primary' : 'isl-btn'}
            data-isl-main={(!offers.length && i === 0) || undefined}
            onClick={() => {
              close();
              navigate(l.to);
            }}
          >
            {sober(frenchSpacing(l.label))}
          </button>
        ))}
        {/* Two buttons already: the message itself opens the conversation. */}
        {offers.length + links.length < 2 && (
          <button type="button" className="isl-btn" data-isl-main={(!offers.length && !links.length) || undefined} onClick={open}>
            {t('Ouvrir')}
          </button>
        )}
      </div>
    </div>
  );
}

/** The last thing he said, while it is not read: what the island shows of him. */
function lastSaid(messages: ReturnType<typeof useCopilot.getState>['messages']): KompalySaid | null {
  const m = [...messages].reverse().find(x => x.role === 'bot');
  return m ? { text: m.text, links: m.links, offers: m.offers } : null;
}

/**
 * Nothing going on: the small pill stays. At its left the day's tasks as a ring, Kompaly's lights in the middle, at its
 * right the time of today's next event (its colour) or the clock.
 */
function IdleFace({ onOpen }: { onOpen: (keyboard: boolean) => void }) {
  const today = useToday();
  const now = useMinute();
  const events = useCalendar(s => s.events);
  const todos = useTodos(s => s.todos);
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const next = upcoming(events, today, nowTime, 4).find(e => e.date === today && e.start);
  const day = dayTasks(todos, today);
  const done = day.done.length;
  const clock = now.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const r = 15;
  const len = 2 * Math.PI * r;
  return (
    <button
      type="button"
      className="isl-mini isl-idle"
      data-kind="idle"
      aria-label={
        next
          ? t('Kompaly. Prochain : {title} à {time}. {done} sur {total} tâches faites. Ouvrir', { title: next.title, time: next.start!, done, total: day.total })
          : t('Kompaly. {done} sur {total} tâches faites aujourd’hui. Ouvrir', { done, total: day.total })
      }
      onClick={e => onOpen(e.detail === 0)}
    >
      <span className="fi-ring isl-day-ring" style={{ width: 20, height: 20 }} aria-hidden>
        <svg className="fi-ring-svg" viewBox="0 0 36 36" width={20} height={20}>
          <circle cx="18" cy="18" r={r} className="fi-ring-track" />
          <circle cx="18" cy="18" r={r} className="fi-ring-bar" strokeDasharray={len} strokeDashoffset={len * (1 - share(done, day.total))} transform="rotate(-90 18 18)" />
        </svg>
      </span>
      <Lights />
      <span className={next ? 'isl-idle-num is-next tabular' : 'isl-idle-num tabular'} aria-hidden>
        {next ? next.start : clock}
      </span>
    </button>
  );
}

/**
 * The hub closed over a dialog (the island is over dialogs, island.css): the keyboard goes back into the dialog, where
 * it was (Échap then closes the dialog, Tab goes round its fields), not to the island's pill. False: no dialog.
 */
function backToDialog(): boolean {
  const dialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]:not(.isl-face)');
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) return false;
  // The dialog itself (tabIndex -1), not its first field: no keyboard popping up on a phone.
  dialog.focus({ preventScroll: true });
  return true;
}

export default function Island() {
  const phase = useFocus(s => s.phase);
  const toasts = useUi(s => s.toasts);
  const alerts = useUi(s => s.alerts);
  const service = useService(s => s.state);
  const bubble = useCopilot(s => s.bubble);
  const unread = useCopilot(s => s.unread);
  const panelOpen = useCopilot(s => s.pose === 'open');
  const messages = useCopilot(s => s.messages);

  // The toasts wait for their turn here (store/ui › island).
  useEffect(() => {
    useUi.getState().setIsland(true);
    return () => useUi.getState().setIsland(false);
  }, []);

  // What goes on, first ones first in the pill.
  const passing = toasts.find(x => !x.sticky);
  const notice = [...toasts].reverse().find(x => x.sticky);
  const alert = alerts.at(-1);
  const said: KompalySaid | null = panelOpen || !(bubble || unread) ? null : (bubble ?? lastSaid(messages));
  const present: Kind[] = [];
  if (phase) present.push('timer');
  if (alert) present.push('reminder');
  if (notice) present.push('notice');
  if (service !== 'ok') present.push('service');
  if (said) present.push('kompaly');

  // News opens the island to say it: a session that starts or changes phase, a reminder, Kompaly speaking… What is
  // already there when the app opens comes as the small pill.
  // The hub (a tap on the small pill): its view while it is open.
  const [hub, setHub] = useState<HubView | null>(null);
  const [expanded, setExpanded] = useState<Kind | null>(null);
  const [poke, setPoke] = useState(0);
  const news = { timer: phase, reminder: alert?.key ?? null, notice: notice?.id ?? null, service, kompaly: bubble };
  const [seen, setSeen] = useState(news);
  if (news.timer !== seen.timer || news.reminder !== seen.reminder || news.notice !== seen.notice || news.service !== seen.service || news.kompaly !== seen.kompaly) {
    let fresh: Kind | null = null;
    if (news.kompaly && news.kompaly !== seen.kompaly) fresh = 'kompaly';
    if (news.service !== 'ok' && news.service !== seen.service) fresh = 'service';
    if (news.notice && news.notice !== seen.notice) fresh = 'notice';
    if (news.reminder && news.reminder !== seen.reminder) fresh = 'reminder';
    if (news.timer && news.timer !== seen.timer) fresh = 'timer';
    setSeen(news);
    // The hub open: it shows them itself (its Minuteur, its Notifications), nothing springs open over it.
    if (fresh && !hub) {
      setExpanded(fresh);
      setPoke(p => p + 1);
    }
  }
  const open = expanded && present.includes(expanded) ? expanded : null;

  const [lastView, setLastView] = useState<HubView>('accueil');
  // Said politely while the hub is open (what would have opened the island meanwhile).
  const [announce, setAnnounce] = useState('');

  // Its history (the hub's « Notifications »): each toast, reminder, Kompaly's words and lasting message, once.
  const logged = useRef(new Set<string>());
  useEffect(() => {
    const log = useIslandLog.getState();
    const add = (id: string, entry: Omit<Parameters<typeof log.add>[0], 'id' | 'at'>) => {
      if (logged.current.has(id)) return;
      logged.current.add(id);
      log.add({ id, at: Date.now(), ...entry });
      if (hub && entry.kind !== 'toast') setAnnounce(entry.kind === 'kompaly' ? `Kompaly : ${sober(stripMarkdown(entry.text))}` : entry.text);
    };
    for (const x of toasts) add(`toast-${x.id}`, { kind: x.sticky ? 'notice' : 'toast', tone: x.tone, text: x.text });
    for (const a of alerts) add(`reminder-${a.key}-${a.at ?? ''}`, { kind: 'reminder', text: a.title, sub: a.body.split('\n')[0], url: a.url });
    if (bubble) add(`kompaly-${bubble.text.slice(0, 60)}`, { kind: 'kompaly', text: bubble.text });
  }, [toasts, alerts, bubble, hub]);

  const [hover, setHover] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const hold = hover || keyboard;
  const wrap = useRef<HTMLDivElement>(null);
  const shape = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLDivElement>(null);
  // Keyboard: the buttons once it opens; the island keeps the focus while what it shows changes.
  const toMain = useRef(false);

  // The countdown of the session, every second. It also ends the phase when the time is up.
  useEffect(() => {
    if (!phase) return;
    const timer = setInterval(() => useFocus.getState().tick(), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // A toast counts down while it is in view, not while the pointer or the keyboard is on it.
  const passingId = passing?.id;
  useEffect(() => {
    if (!passingId || hold) return;
    useUi.getState().resumeToast(passingId);
    // (Not once the island is gone: the toasts count down on their own again.)
    return () => void (useUi.getState().island && useUi.getState().pauseToast(passingId));
  }, [passingId, hold]);

  // Open: back to the small pill after a few seconds (longer for a long message), not while it is used or covered by a
  // toast.
  const openFor = open === 'kompaly' && said ? Math.min(16000, OPEN_FOR.kompaly + said.text.length * 30 + (said.offers?.length ? 4000 : 0)) : open ? OPEN_FOR[open] : 0;
  useEffect(() => {
    if (!open || hold || passingId) return;
    const timer = setTimeout(() => setExpanded(null), openFor);
    return () => clearTimeout(timer);
  }, [open, hold, passingId, poke, openFor]);

  // Open: a press elsewhere or Échap shrinks it (Échap on a toast in it: the toast goes).
  useEffect(() => {
    if (!open && !passingId && !hub) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current?.contains(e.target as Node)) return;
      if (open) setExpanded(null);
      // The hub closes on a press elsewhere, not under a dialog or a menu opened from it.
      if (hub && !(e.target as HTMLElement | null)?.closest?.('[aria-modal="true"], [role="menu"], [role="listbox"]')) setHub(null);
    };
    const onKey = (e: KeyboardEvent) => {
      // The hub is a dialog: Tab stays in it.
      if (hub && e.key === 'Tab' && wrap.current?.contains(document.activeElement)) {
        const box = wrap.current.querySelector<HTMLElement>('.isl-face:not([data-leave]) .hub');
        // (Its tabs other than the chosen one are reached with the arrows: not in Tab's round.)
        const els = box ? focusables(box).filter(el => el.tabIndex >= 0) : [];
        if (!els.length) return;
        const at = els.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey ? at <= 0 : at === els.length - 1 || at < 0) {
          e.preventDefault();
          (e.shiftKey ? els[els.length - 1] : els[0]).focus();
        }
        return;
      }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const inside = !!wrap.current?.contains(document.activeElement);
      if (hub && (inside || !document.querySelector('[aria-modal="true"]:not(.isl-face)'))) {
        e.stopPropagation();
        e.preventDefault();
        setHub(null);
        toMain.current = inside && !backToDialog();
        return;
      }
      if (inside) {
        e.stopPropagation();
        if (passingId) useUi.getState().dismissToast(passingId);
        else setExpanded(null);
        toMain.current = true;
        return;
      }
      // Elsewhere: unless a dialog or a field takes Échap.
      if (!open || document.querySelector('[aria-modal="true"]') || (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      setExpanded(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, passingId, hub]);

  const expand = (kind: Kind, keyboard: boolean) => {
    setExpanded(kind);
    setPoke(p => p + 1);
    toMain.current = keyboard;
  };
  const used = () => setPoke(p => p + 1);
  const toHub = useRef(false);
  /** Opens the hub on a view (the last one seen, for the small pill); the focus goes into it. */
  const openHub = (view: HubView) => {
    setExpanded(null);
    setHub(view);
    setLastView(view);
    toHub.current = true;
  };
  // Another part of the app asks for a view of the hub (the dashboard's « Concentration » tile → the timer).
  useEffect(() => {
    const onAsk = (e: Event) => {
      const view = (e as CustomEvent<HubView>).detail;
      if (HUB_VIEWS.includes(view)) openHub(view);
    };
    window.addEventListener('kompaly:hub', onAsk);
    return () => window.removeEventListener('kompaly:hub', onAsk);
  });
  const closeHub = () => {
    const inside = !!wrap.current?.contains(document.activeElement);
    setHub(null);
    toMain.current = inside && !backToDialog();
  };

  const full = (kind: Kind): Face => {
    switch (kind) {
      case 'timer':
        return { key: 'timer', mode: 'full', el: <TimerFull phase={phase!} onUsed={used} /> };
      case 'reminder':
        return { key: `reminder-${alert!.key}`, mode: 'full', el: <ReminderFace alert={alert!} more={alerts.length - 1} />, say: `${reminderFrom(alert!)} : ${alert!.title}` };
      case 'notice':
        return { key: `notice-${notice!.id}`, mode: 'full', el: <NoticeFace toast={notice!} />, say: sober(notice!.text) };
      case 'service':
        return { key: `service-${service}`, mode: 'full', el: <ServiceFace state={service} />, say: service === 'down' ? t('Service perturbé') : t('Hors ligne') };
      case 'kompaly':
        return { key: `kompaly-${said!.text.length}-${said!.text.slice(0, 24)}`, mode: 'full', el: <KompalyFace said={said!} onDone={() => setExpanded(null)} />, say: `Kompaly : ${sober(stripMarkdown(said!.text))}` };
    }
  };
  // The small pill's words for each, and its icon (also the second one's circle).
  const icon = (kind: Kind) =>
    kind === 'reminder' ? <BellRing size={16} strokeWidth={2.4} color="var(--isl-amber)" /> : kind === 'notice' ? <Info size={16} strokeWidth={2.4} color="#8fa8ff" /> : kind === 'service' ? service === 'down' ? <CloudAlert size={16} strokeWidth={2.4} color="var(--isl-amber)" /> : <WifiOff size={16} strokeWidth={2.4} color="var(--isl-amber)" /> : <Lights />;
  const miniText = (kind: Kind) =>
    kind === 'reminder' ? (alerts.length > 1 ? tn(alerts.length, '{n} rappel', '{n} rappels') : reminderFrom(alert!)) : kind === 'notice' ? sober(notice!.text) : kind === 'service' ? (service === 'down' ? t('Service perturbé') : t('Hors ligne')) : 'Kompaly';
  const miniLabel = (kind: Kind) =>
    kind === 'reminder' ? t('{what} : {title}. Afficher', { what: reminderFrom(alert!), title: alert!.title }) : kind === 'kompaly' ? t('Kompaly a quelque chose à te dire. Afficher') : t('{what}. Afficher', { what: miniText(kind) });
  const mini = (kind: Kind): Face =>
    kind === 'timer'
      ? { key: 'timer-mini', mode: 'mini', el: <TimerMini phase={phase!} onOpen={() => openHub('minuteur')} /> }
      : {
          key: `${kind}-mini`,
          mode: 'mini',
          el: (
            <button type="button" className="isl-mini" data-kind={kind} aria-label={miniLabel(kind)} onClick={e => expand(kind, e.detail === 0)}>
              <span aria-hidden>{icon(kind)}</span>
              <span className="isl-mini-text" aria-hidden>
                {miniText(kind)}
              </span>
            </button>
          ),
        };

  const face: Face | null = hub
    ? {
        key: 'hub',
        mode: 'hub',
        el: (
          <Suspense fallback={<div className="hub-wait" />}>
            <IslandHub
              view={hub}
              setView={v => {
                setHub(v);
                setLastView(v);
              }}
              onClose={closeHub}
              passing={passing}
            />
          </Suspense>
        ),
        say: passing ? sober(passing.text) : announce || undefined,
      }
    : passing
      ? { key: `toast-${passing.id}`, mode: 'toast', el: <ToastFace toast={passing} />, say: sober(passing.text) }
      : open
        ? full(open)
        : present[0]
          ? mini(present[0])
          : { key: 'idle', mode: 'idle', el: <IdleFace onOpen={() => openHub(lastView === 'minuteur' && !phase ? 'accueil' : lastView)} /> };
  // A second thing going on: its circle beside the pill.
  const second = face?.mode === 'mini' ? present[1] : undefined;
  const [lastSecond, setLastSecond] = useState(second);
  if (second && second !== lastSecond) setLastSecond(second);

  // Its life: `in` the first frame (tiny, at the notch), `on`, `out` (going back into the notch), `gone`.
  const [stage, setStage] = useState<'gone' | 'in' | 'on' | 'out'>('gone');
  if (face && (stage === 'gone' || stage === 'out')) setStage('in');
  if (!face && (stage === 'in' || stage === 'on')) setStage('out');
  useEffect(() => {
    if (stage !== 'in') return;
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => setStage('on'))));
    return () => cancelAnimationFrame(raf);
  }, [stage]);
  useEffect(() => {
    if (stage !== 'out') return;
    const timer = setTimeout(() => setStage('gone'), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [stage]);

  // The face going away stays a moment, fading, while the new one comes.
  const [shown, setShown] = useState<{ key: string; el: ReactNode } | null>(null);
  const [leaving, setLeaving] = useState<{ key: string; el: ReactNode }[]>([]);
  const faceKey = face?.key;
  if (faceKey !== shown?.key) {
    if (shown) setLeaving(l => [...l.filter(x => x.key !== shown.key && x.key !== faceKey), shown]);
    setShown(face ? { key: face.key, el: face.el } : null);
  }
  // (It goes at the end of its fade; this is in case none plays: reduced motion, a hidden tab.)
  useEffect(() => {
    if (!leaving.length) return;
    const timer = setTimeout(() => setLeaving([]), FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  // Gone: what the pointer or the keyboard was doing on it is over.
  if (stage === 'gone' && (hover || keyboard)) {
    setHover(false);
    setKeyboard(false);
  }

  // The shape takes the size of what it shows, and springs to it: bigger with a little bounce, smaller calmer.
  useLayoutEffect(() => {
    const el = current.current;
    const box = shape.current;
    if (!el || !box) return;
    let area = box.offsetWidth * box.offsetHeight;
    const fit = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w || !h) return;
      box.dataset.dir = w * h >= area ? 'grow' : 'shrink';
      area = w * h;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
      box.style.borderRadius = `${box.dataset.mode === 'mini' || box.dataset.mode === 'idle' ? h / 2 : Math.min(h / 2, box.dataset.mode === 'hub' ? 34 : 38)}px`;
      wrap.current?.style.setProperty('--isl-w', `${w}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [faceKey, stage]);

  // The keyboard stays in the island while what it shows changes (a toast after « Fait »…), on its main button.
  useLayoutEffect(() => {
    const now = document.activeElement;
    const lost = !now || now === document.body || !!now.closest('[data-leave]');
    if (!toMain.current && !(lost && keyboard)) return;
    toMain.current = false;
    const el = current.current;
    const main = el?.querySelector<HTMLElement>('[data-isl-main]') ?? el?.querySelector<HTMLElement>('button');
    // Nothing left in it: on with the page, not from the top of <body>.
    if (main) main.focus();
    else if (lost) {
      document.getElementById('contenu')?.focus({ preventScroll: true });
      // The keyboard has left it (a removed button sends no blur): it counts down again.
      queueMicrotask(() => setKeyboard(false));
    }
  }, [faceKey, keyboard]);

  // The hub opened: the focus goes to its chosen tab (it may still be loading the first time). Closed: no announcement left.
  useEffect(() => {
    if (!hub) {
      setAnnounce('');
      return;
    }
    if (!toHub.current) return;
    let tries = 0;
    let raf = 0;
    const put = () => {
      const tab = wrap.current?.querySelector<HTMLElement>('.isl-face:not([data-leave]) .hub [role="tab"][aria-selected="true"]');
      if (tab) {
        toHub.current = false;
        tab.focus({ preventScroll: true });
      } else if (++tries < 60) raf = requestAnimationFrame(put);
    };
    put();
    return () => cancelAnimationFrame(raf);
  }, [hub]);

  const live = (
    // What comes is read out, politely: the focus stays where it is.
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {face?.say ?? ''}
    </p>
  );
  if (stage === 'gone' && !face) return createPortal(live, document.body);

  return createPortal(
    <>
      {live}
      <div
        ref={wrap}
        className="isl-wrap"
        // Kompaly's panel open on a phone or a short screen: it takes the top of the screen, the island steps aside.
        data-yield={panelOpen || undefined}
        onPointerEnter={e => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={() => setHover(false)}
        onPointerDown={() => setKeyboard(false)}
        // Keyboard only: a finger's tap leaves the focus on the button (Android) and would keep it open.
        onFocus={e => setKeyboard((e.target as HTMLElement).matches(':focus-visible'))}
        onBlur={e => !wrap.current?.contains(e.relatedTarget as Node) && setKeyboard(false)}
      >
        {/* The hub open: the page behind a little dimmed (a press on it closes the hub). */}
        <div className="isl-scrim" data-on={hub ? '' : undefined} aria-hidden onPointerDown={() => hub && setHub(null)} />
        <div ref={shape} className="isl" role={face?.mode === 'hub' ? undefined : 'group'} aria-label={face?.mode === 'hub' ? undefined : t('Notifications')} data-stage={stage === 'gone' ? 'in' : stage} data-mode={face?.mode ?? 'mini'}>
          {leaving.map(l => (
            <div
              key={l.key}
              className="isl-face"
              data-leave
              aria-hidden
              inert
              onAnimationEnd={e => e.target === e.currentTarget && setLeaving(all => all.filter(x => x.key !== l.key))}
            >
              {l.el}
            </div>
          ))}
          {face && (
            <div
              key={face.key}
              ref={current}
              className="isl-face"
              // The hub is a dialog (its tabs, its views): the island's other faces are its messages.
              {...(face.mode === 'hub' && { role: 'dialog', 'aria-modal': true, 'aria-label': t('Kompaly, ta journée') })}
            >
              {face.el}
            </div>
          )}
        </div>
        {lastSecond && (
          <button
            type="button"
            className="isl-sat fi-face"
            data-phase={phase ?? undefined}
            data-hidden={!second || stage !== 'on' || undefined}
            tabIndex={second ? undefined : -1}
            aria-hidden={!second || undefined}
            aria-label={!second ? undefined : second === 'timer' ? t('Concentration. Ouvrir le minuteur') : miniLabel(second)}
            onClick={e => (second === 'timer' ? openHub('minuteur') : second && expand(second, e.detail === 0))}
          >
            {lastSecond === 'timer' ? <SatelliteRing phase={phase} /> : present.includes(lastSecond) && icon(lastSecond)}
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}

/** The timer as the second thing going on: its ring alone. */
function SatelliteRing({ phase }: { phase: FocusPhase | null }) {
  useSecond(!!phase);
  const s = useFocus.getState();
  const minutes = s.minutes || (phase === 'focus' ? useSettings.getState().focusMinutes : useSettings.getState().breakMinutes);
  return <Ring left={phase ? Math.min(1, Math.max(0, focusLeft(s) / (minutes * 60_000))) : 0} size={20} />;
}
