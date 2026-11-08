import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Coffee,
  FastForward,
  House,
  Info,
  ListChecks,
  Pause,
  Play,
  Plus,
  Search,
  Square,
  Timer,
  X,
  BellRing,
} from 'lucide-react';
import { useFocus, focusLeft, mmss } from '../store/focus';
import { useFocusLog } from '../store/focusLog';
import { useSettings } from '../store/settings';
import { useCalendar } from '../store/calendar';
import { useTodos } from '../store/todos';
import { toast, useUi, type Toast } from '../store/ui';
import { toggleKompaly, useCopilot } from '../store/copilot';
import { dayTasks, focusOn } from '../lib/proDashboard';
import { fmtDay, fromKey } from '../lib/dates';
import { useMinute, useToday } from '../lib/useToday';
import { relativeTime } from '../lib/utils';
import { arrowNav } from '../lib/a11y';
import { sober } from '../lib/sober';
import { stripMarkdown } from '../copilot/markdown';
import { catOf } from '../pages/calendar/proColors';
import { agendaLink, fromAgenda, useAgendaOverlay } from '../pages/calendar/agendas';
import { approach, minutesUntil, share, upcoming, useIslandLog, type IslandEntry } from './islandHub';
import { locale, t, tn } from '../i18n';

/** The hub's views, in the order of its tabs. */
export const HUB_VIEWS = ['accueil', 'agenda', 'taches', 'kompaly', 'minuteur', 'notifs'] as const;
export type HubView = (typeof HUB_VIEWS)[number];

/** Each view's colour: it tints the whole panel (one colour = one meaning, as everywhere in Pro). */
const TINT: Record<HubView, string> = {
  accueil: '#7d8bff',
  agenda: 'var(--pro-meet, #40c8e0)',
  taches: 'var(--pro-tasks, #ff375f)',
  kompaly: 'var(--pro-etudes, #5b8cff)',
  minuteur: 'var(--pro-timer, #ffb547)',
  notifs: '#b18cff',
};

const NAME: () => Record<HubView, string> = () => ({
  accueil: t('Accueil'),
  agenda: t('Agenda'),
  taches: t('Tâches'),
  kompaly: t('Assistant'),
  minuteur: t('Concentration'),
  notifs: t('Notifications'),
});

/** Kompaly's mark as two lights (you, the big one; your friend, the small blue one) that blink now and then. */
/** Kompaly's two eyes. `still`: no blink (a list of messages would otherwise blink by the dozen). */
export function Lights({ big, still }: { big?: boolean; still?: boolean }) {
  return (
    <span className="isl-lights" data-big={big || undefined} data-still={still || undefined} aria-hidden>
      <i />
      <i />
    </span>
  );
}

/** A ring that fills (0..1), its colour from --c. */
function Ring({ value, size, children }: { value: number; size: number; children?: ReactNode }) {
  const r = 15;
  const len = 2 * Math.PI * r;
  return (
    <span className="hub-ring" style={{ width: size, height: size }} aria-hidden>
      <svg className="hub-ring-svg" viewBox="0 0 36 36" width={size} height={size}>
        <circle cx="18" cy="18" r={r} className="hub-ring-track" />
        <circle cx="18" cy="18" r={r} className="hub-ring-bar" strokeDasharray={len} strokeDashoffset={len * (1 - value)} transform="rotate(-90 18 18)" />
      </svg>
      {children}
    </span>
  );
}

/** « 24:58 », each figure rolling in when it changes. */
export function Digits({ text }: { text: string }) {
  return (
    <>
      {[...text].map((c, i) => (
        <span key={`${i}-${c}`} className={/\d/.test(c) ? 'fi-digit' : 'fi-colon'}>
          {c}
        </span>
      ))}
    </>
  );
}

/** Re-draws every second while `on` (a countdown). */
function useSecond(on: boolean) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
}

/** The focus timer, read for the tiles and the view: its time, its words, how much is left (0..1). */
function useTimerNow() {
  const phase = useFocus(s => s.phase);
  const paused = useFocus(s => s.pausedLeft !== null);
  const label = useFocus(s => s.label);
  const planned = useFocus(s => s.minutes);
  const focusMinutes = useSettings(s => s.focusMinutes);
  const breakMinutes = useSettings(s => s.breakMinutes);
  useSecond(!!phase && !paused);
  const minutes = phase ? planned || (phase === 'focus' ? focusMinutes : breakMinutes) : focusMinutes;
  const leftMs = phase ? focusLeft(useFocus.getState()) : focusMinutes * 60_000;
  return { phase, paused, label, minutes, leftMs, time: mmss(leftMs), rest: share(leftMs, minutes * 60_000) };
}

const eventLink = (e: Parameters<typeof fromAgenda>[0]) => (fromAgenda(e) ? agendaLink(e) : `/calendrier?jour=${e.date}&evt=${e.id}`);

/** « dans 20 min », « dans 2 h 05 ». */
function inMinutes(n: number) {
  if (n < 60) return t('dans {n} min', { n });
  return n % 60 ? t('dans {h} h {m}', { h: Math.floor(n / 60), m: String(n % 60).padStart(2, '0') }) : t('dans {h} h', { h: n / 60 });
}

/** When an event is, short: « 14:00 », « Demain · 9:30 », « Lun. 9 nov. ». */
function whenOf(e: { date: string; start?: string }, today: string, tomorrow: string) {
  const day = e.date === today ? t('Aujourd’hui') : e.date === tomorrow ? t('Demain') : fmtDay(fromKey(e.date), 'EEE d MMM');
  return e.start ? `${day} · ${e.start}` : day;
}

interface HubProps {
  view: HubView;
  setView: (v: HubView) => void;
  onClose: () => void;
  /** A message passing while the hub is open: shown in it, at the top. */
  passing?: Toast;
}

/**
 * Affichage Pro: the island opened, a black panel grown from the pill. At the top Kompaly and the view, the date and the
 * time; in the middle the view (Accueil: three tiles, the next thing, the day's tasks, the timer; Agenda; Tâches;
 * Assistant; Minuteur; Notifications); at the bottom its tabs. The view's colour tints the panel. A dialog: the focus is
 * in it, Échap closes it (components/Island), Tab stays in it.
 */
export default function IslandHub({ view, setView, onClose, passing }: HubProps) {
  const navigate = useNavigate();
  const today = useToday();
  const now = useMinute();
  const tabsId = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const names = NAME();
  const unseen = useIslandLog(s => s.entries.filter(e => e.at > s.seen).length);
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const time = now.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
  const icons: Record<HubView, ReactNode> = {
    accueil: <House size={16} strokeWidth={2.2} />,
    agenda: <CalendarDays size={16} strokeWidth={2.2} />,
    taches: <ListChecks size={16} strokeWidth={2.2} />,
    kompaly: <Lights />,
    minuteur: <Timer size={16} strokeWidth={2.2} />,
    notifs: <Bell size={16} strokeWidth={2.2} />,
  };

  return (
    <div className="hub" style={{ '--hub-c': TINT[view] } as CSSProperties}>
      <span className="hub-tint" aria-hidden />
      <div className="hub-top">
        <p className="hub-title">
          <span>Kompaly</span> <b>{names[view]}</b>
        </p>
        <p className="hub-clock tabular">
          <Lights />
          <span className="hub-date">{date}</span> <b>{time}</b>
        </p>
        <div className="hub-tools">
          <button
            type="button"
            className="hub-icon"
            onClick={() => {
              onClose();
              // The search of the page (Ctrl+K), once the hub is closed.
              setTimeout(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })), 60);
            }}
            aria-label={t('Rechercher')}
            title={t('Rechercher')}
          >
            <Search size={15} strokeWidth={2.4} aria-hidden />
          </button>
          <button type="button" className="hub-icon" onClick={onClose} aria-label={t('Fermer (Échap)')} title={t('Fermer (Échap)')}>
            <X size={16} strokeWidth={2.6} aria-hidden />
          </button>
        </div>
      </div>

      {passing && <Flash toast={passing} />}

      <div key={view} id={`${tabsId}-panel`} role="tabpanel" aria-label={names[view]} className="hub-body">
        {view === 'accueil' && <HomeView today={today} now={now} go={go} setView={setView} />}
        {view === 'agenda' && <AgendaView today={today} now={now} go={go} />}
        {view === 'taches' && <TasksView today={today} go={go} />}
        {view === 'kompaly' && <KompalyView go={go} onClose={onClose} />}
        {view === 'minuteur' && <TimerView today={today} />}
        {view === 'notifs' && <NotifsView go={go} />}
      </div>

      <div ref={tabs} className="hub-tabs" role="tablist" aria-label={t('Vues de l’île')} onKeyDown={e => arrowNav(e, tabs.current!, '[role="tab"]', 'horizontal')}>
        {HUB_VIEWS.map(v => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={v === view}
            aria-controls={`${tabsId}-panel`}
            tabIndex={v === view ? 0 : -1}
            data-hub-tab={v}
            className="hub-tab"
            onClick={() => setView(v)}
            title={names[v]}
            aria-label={v === 'notifs' && unseen ? `${names[v]}, ${tn(unseen, '{n} nouvelle', '{n} nouvelles')}` : names[v]}
          >
            <span aria-hidden>{icons[v]}</span>
            <span className="hub-tab-name" aria-hidden>
              {names[v]}
            </span>
            {v === 'notifs' && unseen > 0 && v !== view && <i className="hub-badge" aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A message that came while the hub is open: a line at its top, with its button. */
function Flash({ toast: item }: { toast: Toast }) {
  return (
    <div className="hub-flash" data-tone={item.tone}>
      <span className="isl-ticon" aria-hidden>
        {item.tone === 'success' ? <Check size={14} strokeWidth={3} /> : item.tone === 'error' ? <X size={14} strokeWidth={3} /> : <Info size={14} strokeWidth={2.4} />}
      </span>
      <span className="hub-flash-text">{sober(item.text)}</span>
      {item.action && (
        <button
          type="button"
          className="isl-btn"
          onClick={() => {
            useUi.getState().dismissToast(item.id);
            item.action!.run();
          }}
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}

/** The day's events with those of the shared agendas shown in the calendar. */
function useEvents() {
  const events = useCalendar(s => s.events);
  const overlay = useAgendaOverlay().events;
  return overlay.length ? [...events, ...overlay] : events;
}

const tomorrowOf = (today: string) => {
  const d = fromKey(today);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Three tiles: what comes next, the day's tasks, the timer. */
function HomeView({ today, now, go, setView }: { today: string; now: Date; go: (to: string) => void; setView: (v: HubView) => void }) {
  const events = useEvents();
  const todos = useTodos(s => s.todos);
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const next = upcoming(events, today, nowTime, 1)[0];
  const until = next ? minutesUntil(next, today, now) : null;
  const tasks = dayTasks(todos, today);
  const done = tasks.done.length;
  const timer = useTimerNow();
  const tomorrow = tomorrowOf(today);
  // Its time today; else its day (« Aujourd’hui » for the whole day, « Demain », « lun. 9 »).
  const bigNext = next ? (next.date === today && next.start ? next.start : next.date === today ? t('Aujourd’hui') : next.date === tomorrow ? t('Demain') : fmtDay(fromKey(next.date), 'EEE d')) : t('Libre');
  const toggle = () => {
    const f = useFocus.getState();
    if (!f.phase) f.start();
    else {
      const n = f.stop();
      if (n) toast(tn(n, '{n} minute de concentration comptée', '{n} minutes de concentration comptées'), 'success');
    }
  };
  return (
    <div className="hub-tiles">
      <button type="button" className="hub-tile" style={{ '--c': 'var(--pro-meet, #40c8e0)' } as CSSProperties} onClick={() => (next ? go(eventLink(next)) : setView('agenda'))}>
        <span className="hub-tile-head">
          <small>{t('Prochain')}</small>
          <Ring value={next ? approach(until) : 0} size={34}>
            <CalendarDays size={13} strokeWidth={2.4} />
          </Ring>
        </span>
        <span className="hub-tile-foot">
          <strong className="tabular" data-long={(bigNext.length > 6) || undefined}>
            {bigNext}
          </strong>
          <span>{next ? (until !== null && until <= 120 ? `${inMinutes(until)} · ${sober(next.title)}` : sober(next.title)) : t('Rien de prévu')}</span>
        </span>
      </button>
      <button type="button" className="hub-tile" style={{ '--c': 'var(--pro-tasks, #ff375f)' } as CSSProperties} onClick={() => setView('taches')}>
        <span className="hub-tile-head">
          <small>{t('Tâches')}</small>
          <Ring value={share(done, tasks.total)} size={34}>
            <Check size={13} strokeWidth={3} />
          </Ring>
        </span>
        <span className="hub-tile-foot">
          <strong className="tabular">
            {done}
            <em>/{tasks.total}</em>
          </strong>
          <span>{t('faites aujourd’hui')}</span>
        </span>
      </button>
      <div className="hub-tile" style={{ '--c': timer.phase === 'break' ? '#5ee6c4' : 'var(--pro-timer, #ffb547)' } as CSSProperties}>
        <span className="hub-tile-head">
          <small>{timer.phase === 'break' ? t('Pause') : t('Concentration')}</small>
          <button type="button" className="hub-play" data-on={timer.phase ? '' : undefined} onClick={toggle} aria-label={timer.phase ? t('Arrêter la session') : t('Démarrer une session de {n} min', { n: timer.minutes })}>
            {timer.phase ? <Square size={12} strokeWidth={2.6} fill="currentColor" aria-hidden /> : <Play size={14} strokeWidth={2.6} fill="currentColor" aria-hidden />}
          </button>
        </span>
        <span className="hub-tile-foot">
          <strong className="tabular">
            <Digits text={timer.time} />
          </strong>
          <span>{timer.phase ? (timer.paused ? t('En pause') : tn(Math.ceil(timer.leftMs / 60_000), '{n} min restante', '{n} min restantes')) : t('Prêt à démarrer')}</span>
        </span>
      </div>
    </div>
  );
}

/** The next events, each opening its day. */
function AgendaView({ today, now, go }: { today: string; now: Date; go: (to: string) => void }) {
  const events = useEvents();
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const list = upcoming(events, today, nowTime, 5);
  const tomorrow = tomorrowOf(today);
  return (
    <div className="hub-view">
      {list.length ? (
        <ul className="hub-list">
          {list.map(e => {
            const until = minutesUntil(e, today, now);
            return (
              <li key={`${e.id}-${e.date}`}>
                <button type="button" className="hub-row" onClick={() => go(eventLink(e))}>
                  <span className="hub-bar" style={{ background: catOf(e.category).color }} aria-hidden />
                  <span className="hub-row-text">
                    <strong>{sober(e.title)}</strong>
                    <small className="tabular">{whenOf(e, today, tomorrow)}{e.place ? ` · ${e.place}` : ''}</small>
                  </span>
                  {until !== null && until <= 180 && <span className="hub-soon tabular">{inMinutes(until)}</span>}
                  <ChevronRight size={15} className="hub-chev" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hub-empty">{t('Rien de prévu pour l’instant.')}</p>
      )}
      <div className="hub-actions">
        <button type="button" className="isl-btn isl-primary" onClick={() => go('/calendrier?ajout=1')}>
          <Plus size={15} strokeWidth={2.6} aria-hidden /> {t('Nouvel événement')}
        </button>
        <button type="button" className="isl-btn" onClick={() => go('/calendrier')}>
          {t('Calendrier')}
        </button>
      </div>
    </div>
  );
}

/** Today's tasks (late first), ticked here. */
function TasksView({ today, go }: { today: string; go: (to: string) => void }) {
  const todos = useTodos(s => s.todos);
  const day = dayTasks(todos, today);
  const open = [...day.late, ...day.due];
  const shown = open.length ? [...open.slice(0, 5), ...day.done.slice(-Math.max(0, 5 - open.length)).slice(-2)] : day.next.slice(0, 4);
  return (
    <div className="hub-view">
      {!open.length && !day.done.length && <p className="hub-kicker">{day.next.length ? t('Rien pour aujourd’hui. Ensuite :') : t('Rien à faire. Profite !')}</p>}
      {shown.length > 0 && (
        <ul className="hub-list">
          {shown.map(x => {
            const late = !x.done && !!x.due && x.due < today;
            return (
              <li key={x.id} className="hub-task" data-done={x.done || undefined}>
                <button
                  type="button"
                  className="hub-check"
                  role="checkbox"
                  aria-checked={x.done}
                  aria-label={x.title}
                  onClick={() => useTodos.getState().toggle(x.id)}
                >
                  {x.done && <Check size={13} strokeWidth={3.2} aria-hidden />}
                </button>
                <span className="hub-row-text">
                  <strong>{sober(x.title)}</strong>
                  {(late || x.time || (x.due && x.due !== today)) && (
                    <small className="tabular" data-late={late || undefined}>
                      {late ? t('En retard') : x.due && x.due !== today ? fmtDay(fromKey(x.due), 'EEE d MMM') : x.time}
                    </small>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="hub-actions">
        <button type="button" className="isl-btn isl-primary" onClick={() => go('/taches?ajout=1')}>
          <Plus size={15} strokeWidth={2.6} aria-hidden /> {t('Nouvelle tâche')}
        </button>
        <button type="button" className="isl-btn" onClick={() => go('/taches')}>
          {t('Toutes les tâches')}
        </button>
      </div>
    </div>
  );
}

/** Ask Kompaly from the island: a few ideas, the field, the last answer (the store's conversation, panel closed). */
function KompalyView({ go, onClose }: { go: (to: string) => void; onClose: () => void }) {
  const thinking = useCopilot(s => s.thinking);
  const messages = useCopilot(s => s.messages);
  const bubble = useCopilot(s => s.bubble);
  const [asked, setAsked] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const field = useRef<HTMLInputElement>(null);
  // Read here: his answer doesn't come again as a message of the island.
  useEffect(() => {
    if (bubble || useCopilot.getState().unread) {
      useCopilot.setState({ unread: false });
      useCopilot.getState().clearBubble();
    }
  }, [bubble]);
  const ask = (q: string) => {
    const clean = q.trim();
    if (!clean || thinking) return;
    setAsked(clean);
    setInput('');
    useCopilot.getState().askKompaly(clean, true);
  };
  // The answer: the last message of Kompaly after the question asked here.
  const at = asked ? messages.map(m => m.role === 'user' && m.text === asked).lastIndexOf(true) : -1;
  const answer = at >= 0 ? messages.slice(at + 1).find(m => m.role === 'bot') : undefined;
  const ideas = [
    { label: t('Ma journée'), ask: t('Qu’est-ce que j’ai aujourd’hui ?') },
    { label: t('Mes tâches'), ask: t('Mes tâches') },
    { label: t('Ajouter un rendez-vous'), fill: t('Ajoute un rendez-vous ') },
  ];
  return (
    <div className="hub-view hub-chat">
      {asked ? (
        <div className="hub-thread" aria-live="polite">
          <p className="hub-me">{asked}</p>
          {answer ? (
            <div className="hub-answer">
              <p>{sober(stripMarkdown(answer.text))}</p>
              {!!answer.links?.length && (
                <div className="hub-actions" data-start>
                  {answer.links.slice(0, 2).map(l => (
                    <button key={l.to + l.label} type="button" className="isl-btn" onClick={() => go(l.to)}>
                      {sober(l.label)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="hub-typing">
              <span className="hub-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {t('Je regarde…')}
            </p>
          )}
        </div>
      ) : (
        <div className="hub-hello">
          <Lights big />
          <strong>{t('Que puis-je faire pour toi ?')}</strong>
          <span>{t('Ajoute, retrouve, organise : demande-moi.')}</span>
          <div className="hub-chips">
            {ideas.map(i => (
              <button
                key={i.label}
                type="button"
                className="hub-chip"
                onClick={() => {
                  if (i.ask) ask(i.ask);
                  else {
                    setInput(i.fill!);
                    field.current?.focus();
                  }
                }}
              >
                {i.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <form
        className="hub-ask"
        onSubmit={e => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input ref={field} value={input} onChange={e => setInput(e.target.value)} placeholder={asked ? t('Continuer…') : t('Écris à Kompaly…')} aria-label={t('Écris à Kompaly')} maxLength={2000} />
        <button type="submit" className="hub-send" disabled={!input.trim() || thinking} aria-label={t('Envoyer')} title={t('Envoyer')}>
          <ArrowUp size={16} strokeWidth={2.6} aria-hidden />
        </button>
      </form>
      <button
        type="button"
        className="hub-link"
        onClick={() => {
          onClose();
          toggleKompaly(true);
        }}
      >
        {t('Ouvrir toute la conversation')} <ChevronRight size={14} aria-hidden />
      </button>
    </div>
  );
}

/** The focus timer: its time, the day's blocks as bars, its buttons. */
function TimerView({ today }: { today: string }) {
  const timer = useTimerNow();
  const sessions = useFocusLog(s => s.sessions);
  const focusMinutes = useSettings(s => s.focusMinutes);
  const doneToday = focusOn(sessions, today);
  const BLOCKS = 4;
  const ran = timer.phase === 'focus' ? Math.max(0, timer.minutes - timer.leftMs / 60_000) : 0;
  const blocks = Array.from({ length: BLOCKS }, (_, i) => Math.max(0, Math.min(1, (doneToday + ran) / focusMinutes - i)));
  const stop = () => {
    const n = useFocus.getState().stop();
    if (n) toast(tn(n, '{n} minute de concentration comptée', '{n} minutes de concentration comptées'), 'success');
  };
  const focusing = timer.phase !== 'break';
  return (
    <div className="hub-view hub-timer" style={{ '--c': focusing ? 'var(--pro-timer, #ffb547)' : '#5ee6c4' } as CSSProperties}>
      <div className="hub-timer-top">
        <div>
          <strong className="hub-big tabular" role="timer" aria-label={t('Temps restant : {time}', { time: timer.time })} data-paused={timer.paused || undefined}>
            <Digits text={timer.time} />
          </strong>
          <p className="hub-timer-sub">
            {!timer.phase ? t('Prêt à démarrer · bloc de {n} min', { n: focusMinutes }) : timer.phase === 'break' ? t('Temps de pause') : timer.label ? `${timer.paused ? t('En pause') : t('Concentration')} · ${timer.label}` : timer.paused ? t('En pause') : t('Concentration')}
          </p>
        </div>
        <div className="fi-ctl">
          {!timer.phase ? (
            <button type="button" className="isl-btn isl-primary hub-start" onClick={() => useFocus.getState().start()}>
              <Play size={14} strokeWidth={2.6} fill="currentColor" aria-hidden /> {t('Démarrer')}
            </button>
          ) : (
            <>
              {timer.phase === 'focus' ? (
                <button type="button" className="fi-btn" onClick={() => useFocus.getState().extend(5)} aria-label={t('Ajouter 5 minutes')}>
                  {t('+5 min')}
                </button>
              ) : (
                <button type="button" className="fi-btn" onClick={() => useFocus.getState().skipBreak()}>
                  <FastForward size={14} strokeWidth={2.4} aria-hidden /> {t('Passer la pause')}
                </button>
              )}
              <button
                type="button"
                className="fi-btn fi-round fi-pause"
                onClick={() => (timer.paused ? useFocus.getState().resume() : useFocus.getState().pause())}
                aria-label={timer.paused ? t('Reprendre') : t('Pause')}
                title={timer.paused ? t('Reprendre') : t('Pause')}
              >
                {timer.paused ? <Play size={16} strokeWidth={2.6} fill="currentColor" aria-hidden /> : <Pause size={16} strokeWidth={2.6} fill="currentColor" aria-hidden />}
              </button>
              <button type="button" className="fi-btn fi-round fi-stop" onClick={stop} aria-label={t('Arrêter')} title={t('Arrêter')}>
                <Square size={13} strokeWidth={2.6} fill="currentColor" aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="hub-steps" role="img" aria-label={t('{n} min de concentration aujourd’hui', { n: Math.round(doneToday + ran) })}>
        {blocks.map((v, i) => (
          <span key={i} className="hub-step" data-now={(v > 0 && v < 1) || undefined}>
            <i style={{ '--v': v } as CSSProperties} />
            <small>{t('Bloc {n}', { n: i + 1 })}</small>
          </span>
        ))}
      </div>
      {timer.phase === 'break' && (
        <p className="hub-timer-note">
          <Coffee size={14} aria-hidden /> {t('Lève-toi, bois un verre d’eau.')}
        </p>
      )}
    </div>
  );
}

/** What the island said, latest first. */
function NotifsView({ go }: { go: (to: string) => void }) {
  const entries = useIslandLog(s => s.entries);
  useEffect(() => useIslandLog.getState().markSeen(), [entries.length]);
  const icon = (e: IslandEntry) =>
    e.kind === 'reminder' ? <BellRing size={14} strokeWidth={2.4} /> : e.kind === 'kompaly' ? <Lights still /> : e.tone === 'success' ? <Check size={14} strokeWidth={3} /> : e.tone === 'error' ? <X size={14} strokeWidth={3} /> : <Info size={14} strokeWidth={2.4} />;
  return (
    <div className="hub-view">
      {entries.length ? (
        <>
          <div className="hub-view-head">
            <small>{tn(entries.length, '{n} message', '{n} messages')}</small>
            <button type="button" className="hub-link" onClick={() => useIslandLog.getState().clear()}>
              {t('Tout effacer')}
            </button>
          </div>
          <ul className="hub-list hub-notifs">
            {entries.map(e => (
              <li key={e.id} className="hub-note" data-kind={e.kind} data-tone={e.tone}>
                <span className="hub-note-icon" aria-hidden>
                  {icon(e)}
                </span>
                <span className="hub-row-text">
                  <strong>{e.kind === 'kompaly' ? sober(stripMarkdown(e.text)) : sober(e.text)}</strong>
                  <small>
                    {e.sub ? `${e.sub} · ` : ''}
                    {relativeTime(new Date(e.at).toISOString())}
                  </small>
                </span>
                {e.url && (
                  <button type="button" className="isl-btn" onClick={() => go(e.url!)}>
                    {t('Voir')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="hub-empty">{t('Rien de nouveau. Ce que l’île t’a dit s’affichera ici.')}</p>
      )}
    </div>
  );
}
