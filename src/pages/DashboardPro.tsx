import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addDays } from 'date-fns';
import { AlarmClock, Check, ChevronRight, FastForward, Flag, MapPin, NotebookPen, Pause, Play, Plus, Square } from 'lucide-react';
import { firstOfSeries, firstOfSpans } from '../lib/repeat';
import { useMinute, useToday } from '../lib/useToday';
import { useAuth } from '../store/auth';
import { useNotes } from '../store/notes';
import { useCalendar, catOf, isBigEvent, sortEvents, type CalendarEvent } from '../store/calendar';
import { useTodos, type Todo } from '../store/todos';
import { useFocusLog } from '../store/focusLog';
import { useFocus, focusLeft, mmss } from '../store/focus';
import { useSettings } from '../store/settings';
import { isTourTodo, startTour } from '../store/tour';
import { toast } from '../store/ui';
import { fmt, fmtDay, toKey, fromKey, weekStart, daysUntil, hasStarted, isOver, countdownLabel, toMinutes } from '../lib/dates';
import { relativeTime, cx } from '../lib/utils';
import { WORDS } from '../lib/usage';
import { periodColor, periodText, periodTint, periodUntil, periodsOn } from '../lib/periods';
import { weekItems, cheer } from '../lib/weekProgress';
import { axisMarks, dayTasks, focusOn, ringRatio, subjectsOf, taskBigDay, taskSubject, weekDays, weekDelta, type Subject } from '../lib/proDashboard';
import { hasRevisionPlan, revisionNote, revisionSessions, linkToDay, linkToNote } from '../copilot/actions';
import { runOffer } from '../copilot/offers';
import { formatMinutes, subjectSuggestions } from './tasks/focusStats';
import { agendaLink, fromAgenda, useAgendaOverlay } from './calendar/agendas';
import HomeShortcuts from './HomeShortcuts';
import { t, tn } from '../i18n';
import './dashboardPro.css';

/** Today's concentration goal: four blocks of the person's own length (4 × 25 min). */
const GOAL_BLOCKS = 4;

const eventLink = (e: CalendarEvent) => (fromAgenda(e) ? agendaLink(e) : linkToDay(e.date, e.id));

/** « dans 20 min », « dans 2 h 05 », « dans 3 h ». */
function inMinutes(n: number) {
  if (n < 60) return t('dans {n} min', { n });
  return n % 60 ? t('dans {h} h {m}', { h: Math.floor(n / 60), m: String(n % 60).padStart(2, '0') }) : t('dans {h} h', { h: n / 60 });
}

/** A glass panel of the grid: title, a line under it, a link at the right; `i` sets its place in the blur-in. */
function Panel({ title, sub, to, linkLabel, link, extra, i, className, style, children }: { title: string; sub?: ReactNode; to?: string; linkLabel?: string; link?: string; extra?: ReactNode; i: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <section className={cx('card dpro-panel', className)} style={{ '--i': i, ...style } as CSSProperties}>
      <header className="dpro-head">
        <div className="min-w-0">
          <h2>{title}</h2>
          {sub && <p className="dpro-sub">{sub}</p>}
        </div>
        {extra}
        {to && (
          <Link to={to} className="dpro-link" aria-label={linkLabel}>
            {link}
            <ChevronRight size={14} aria-hidden />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/* ── Rings ─────────────────────────────────────────────────────── */

const RINGS = [
  { r: 52, color: 'var(--pro-tasks)' },
  { r: 38, color: 'var(--pro-focus)' },
  { r: 24, color: 'var(--pro-meet)' },
];

function Rings({ values }: { values: number[] }) {
  return (
    <svg viewBox="0 0 120 120" className="dpro-rings" aria-hidden shapeRendering="geometricPrecision">
      {RINGS.map(({ r, color }, i) => {
        const c = 2 * Math.PI * r;
        return (
          <g key={r} style={{ '--c': c, '--off': c * (1 - values[i]), '--d': `${i * 120}ms` } as CSSProperties}>
            <circle cx="60" cy="60" r={r} className="dpro-ring-bg" style={{ stroke: color }} />
            {/* Nothing yet: no dot of round cap at the top. */}
            {values[i] > 0 && <circle cx="60" cy="60" r={r} className="dpro-ring-fg" style={{ stroke: color }} transform="rotate(-90 60 60)" strokeDasharray={c} />}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Focus timer card ──────────────────────────────────────────── */

function TimerCard({ i }: { i: number }) {
  const phase = useFocus(s => s.phase);
  const paused = useFocus(s => s.pausedLeft !== null);
  const label = useFocus(s => s.label);
  const planned = useFocus(s => s.minutes);
  const focusMinutes = useSettings(s => s.focusMinutes);
  const breakMinutes = useSettings(s => s.breakMinutes);
  const usage = useSettings(s => s.usage);
  const sessions = useFocusLog(s => s.sessions);
  const events = useCalendar(s => s.events);
  const [, setNow] = useState(0);

  // Every second while a session runs (the store moves to the break, or ends, on time).
  useEffect(() => {
    if (!phase) return;
    const timer = setInterval(() => {
      useFocus.getState().tick();
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const total = (planned || (phase === 'break' ? breakMinutes : focusMinutes)) * 60_000;
  const left = phase ? focusLeft(useFocus.getState()) : focusMinutes * 60_000;
  const ratio = phase ? Math.min(1, Math.max(0, 1 - left / total)) : 0;
  const R = 44;
  const C = 2 * Math.PI * R;
  const subjects = phase ? [] : subjectSuggestions(sessions, events, 3);
  const start = (subject: string) => {
    useFocus.getState().start(subject);
    setTimeout(() => document.querySelector<HTMLElement>('[data-dpro-pause]')?.focus(), 0);
  };
  const stop = () => {
    const n = useFocus.getState().stop();
    if (n) toast(tn(n, '{n} minute de concentration comptée', '{n} minutes de concentration comptées'), 'success');
    setTimeout(() => document.querySelector<HTMLElement>('[data-dpro-start]')?.focus(), 0);
  };
  const state = !phase ? t('prêt') : paused ? t('en pause') : phase === 'break' ? t('pause||le temps de pause') : t('en cours');

  return (
    <Panel
      i={i}
      title={t('Minuteur de concentration')}
      sub={
        phase === 'focus'
          ? label
            ? t('Sur « {label} »', { label })
            : t('Bloc de {n} min', { n: planned || focusMinutes })
          : phase === 'break'
            ? t('Temps de pause')
            : t('Bloc de {n} min, puis {pause} min de pause', { n: focusMinutes, pause: breakMinutes })
      }
      className={cx('dpro-timer', phase && 'is-on', phase === 'break' && 'is-break', paused && 'is-paused')}
    >
      <div className="dpro-timer-body">
        <div className="dpro-dial">
          <svg viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r={R} className="dpro-dial-bg" />
            {ratio > 0 && <circle cx="50" cy="50" r={R} className="dpro-dial-fg" strokeDasharray={C} strokeDashoffset={C * (1 - ratio)} transform="rotate(-90 50 50)" />}
          </svg>
          <span className="dpro-dial-text">
            <b role="timer" aria-label={t('Temps restant : {time}', { time: mmss(left) })} className="tabular">
              {mmss(left)}
            </b>
            <span>{state}</span>
          </span>
        </div>
        <div className="dpro-timer-actions">
          {!phase ? (
            <>
              <button type="button" data-dpro-start className="dpro-btn is-timer" onClick={() => start('')}>
                <Play size={15} aria-hidden /> {t('Démarrer')}
              </button>
              {subjects.length > 0 && (
                <div className="dpro-subjects" role="group" aria-label={usage === 'etudes' ? t('Démarrer sur une matière') : t('Démarrer sur un sujet')}>
                  {subjects.map(s => (
                    <button key={s} type="button" className="dpro-mini" onClick={() => start(s)} title={t('Démarrer sur « {subject} »', { subject: s })}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <button type="button" data-dpro-pause className="dpro-btn is-timer" onClick={paused ? useFocus.getState().resume : useFocus.getState().pause}>
                  {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
                  {paused ? t('Reprendre') : phase === 'break' ? t('Suspendre') : t('Pause')}
                </button>
                <button type="button" className="dpro-btn is-round" onClick={stop} title={t('Arrêter')} aria-label={t('Arrêter')}>
                  <Square size={13} aria-hidden />
                </button>
              </div>
              {phase === 'break' && (
                <button type="button" className="dpro-mini" onClick={useFocus.getState().skipBreak}>
                  <FastForward size={12} aria-hidden /> {t('Passer la pause')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ── Tasks ─────────────────────────────────────────────────────── */

function TaskRow({ x, today, subject, bigDay }: { x: Todo; today: string; subject?: Subject; bigDay?: CalendarEvent }) {
  const late = !x.done && !!x.due && x.due < today;
  const tour = isTourTodo(x.title);
  const day = x.due && x.due !== today && (daysUntil(x.due) < -1 || daysUntil(x.due) > 1) ? fmtDay(fromKey(x.due), daysUntil(x.due) < 7 && daysUntil(x.due) > 0 ? 'EEE d' : 'd MMM') : x.due ? countdownLabel(x.due) : '';
  const when = [day, x.time].filter(Boolean).join(' · ');
  return (
    <li className={cx('dpro-task', x.done && 'is-done')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={x.done}
        className="dpro-check"
        onClick={() => useTodos.getState().toggle(x.id)}
        title={x.done ? t('Remettre à faire') : t('Marquer comme faite')}
        aria-label={x.done ? t('Remettre « {title} » à faire', { title: x.title }) : t('Cocher « {title} »', { title: x.title })}
      >
        <Check size={12} strokeWidth={3.2} aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <Link to={`/taches?tache=${x.id}`} className="dpro-task-title" title={t('Ouvrir dans Tâches')}>
          <span>{x.title}</span>
        </Link>
        {(subject || when) && (
          <div className="dpro-meta">
            {subject && (
              <span className="dpro-tag" style={{ '--c': `var(--pro-${subject.space})` } as CSSProperties}>
                {subject.name}
              </span>
            )}
            {when && <span className={cx('dpro-when tabular inline-block first-letter:uppercase', late && 'is-late')}>{when}</span>}
          </div>
        )}
      </div>
      {tour && !x.done ? (
        <button type="button" onClick={startTour} className="dpro-btn is-small">
          {t('Lancer')}
        </button>
      ) : late ? (
        <span className="dpro-chip">
          <Flag size={11} aria-hidden /> {t('En retard')}
        </span>
      ) : (
        bigDay &&
        !x.done && (
          <span className="dpro-chip" title={t('Pour « {title} », {when}', { title: bigDay.title, when: countdownLabel(bigDay.date).toLowerCase() })}>
            <Flag size={11} aria-hidden /> {t('Important')}
          </span>
        )
      )}
    </li>
  );
}

/* ── The page ──────────────────────────────────────────────────── */

export default function DashboardPro() {
  const words = WORDS[useSettings(st => st.usage)] ?? WORDS.etudes;
  const usage = useSettings(st => st.usage);
  const revisionTime = useSettings(st => st.revisionTime) || '18:00';
  const periods = useSettings(st => st.periods);
  const focusMinutes = useSettings(st => st.focusMinutes);
  const navigate = useNavigate();
  const user = useAuth(s => s.user)!;
  const { notes } = useNotes();
  const events = useCalendar(s => s.events);
  const overlay = useAgendaOverlay().events;
  const todos = useTodos(s => s.todos);
  const sessions = useFocusLog(s => s.sessions);
  // A session under way counts in today's rings as it goes (to the minute).
  const running = useFocus(s => (s.phase === 'focus' ? s : null));
  const today = useToday();
  const now = useMinute();
  const nowTime = fmt(now, 'HH:mm');
  const hello = now.getHours() >= 5 && now.getHours() < 18 ? t('Bonjour') : t('Bonsoir');
  const [metric, setMetric] = useState<'focus' | 'tasks' | null>(null);

  // ── The day ──
  const withShared = overlay.length ? [...events, ...overlay] : events;
  const todayEvents = withShared.filter(e => e.date === today).sort(sortEvents);
  const timed = todayEvents.filter(e => e.start);
  const meetDone = timed.filter(e => isOver(e, now)).length;
  const laterToday = timed.filter(e => (e.end ?? e.start)! > nowTime);
  const allDay = todayEvents.filter(e => !e.start);
  const coming = firstOfSpans(withShared.filter(e => e.date > today).sort(sortEvents));
  const queue = [...laterToday, ...allDay, ...coming];
  const next = queue[0];
  const after = queue.slice(1, 4);

  const tasks = dayTasks(todos, today);
  const runningMinutes = running ? Math.max(0, Math.floor(((running.minutes || focusMinutes) * 60_000 - focusLeft(running)) / 60_000)) : 0;
  const focusToday = focusOn(sessions, today) + runningMinutes;
  const goal = GOAL_BLOCKS * focusMinutes;
  const firstLate = tasks.late[0];

  // ── Tasks: late and today, then the ones ticked today; when the day asks nothing, the next ones ──
  const subjects = subjectsOf(events, sessions, usage, today);
  const bigDays = firstOfSeries(events.filter(e => isBigEvent(e) && (e.date > today || (e.date === today && (e.end ?? e.start ?? '24:00') > nowTime))).sort(sortEvents));
  const open = [...tasks.late, ...tasks.due];
  const LIMIT = 6;
  const shownOpen = open.slice(0, LIMIT);
  const shownDone = tasks.done.slice(-3);
  const moreOpen = open.length - shownOpen.length;
  // A light day: what comes next, so the card is never a dead end.
  const shownNext = tasks.next.slice(0, open.length ? Math.min(3, Math.max(0, 5 - open.length)) : 4);
  const row = (x: Todo) => <TaskRow key={x.id} x={x} today={today} subject={taskSubject(x.title, subjects)} bigDay={taskBigDay(x.title, bigDays, today)} />;

  // ── The week ──
  const monday = toKey(weekStart(now));
  const week = weekDays(todos, sessions, monday, today);
  week.find(d => d.when === 'today')!.focus += runningMinutes;
  const kind = metric ?? (week.some(d => d.focus) ? 'focus' : 'tasks');
  const values = week.map(d => d[kind]);
  const marks = axisMarks(Math.max(...values), kind);
  const top = marks[0];
  const weekTotal = values.reduce((a, b) => a + b, 0);
  const delta = weekDelta(todos, sessions, monday, today, kind);
  const { total: weekPlanned, done: weekDone, left: weekLeft } = weekItems(todos, monday, toKey(addDays(fromKey(monday), 6)));
  const value = (v: number) => (kind === 'focus' ? formatMinutes(v) : String(v));

  // ── The big day (as on the usual home page) ──
  const nextExam = bigDays[0];
  const laterBig = bigDays.slice(1, 3);
  const notExam = !!nextExam && nextExam.category !== 'examen' && words === WORDS.etudes;
  const [tooLate, setTooLate] = useState<string>();
  const examSheet = nextExam && notes.length ? revisionNote(nextExam) : undefined;
  const examDays = nextExam ? daysUntil(nextExam.date) : 0;
  const noTimeLeft = !!nextExam && (hasStarted(nextExam) || (examDays === 1 && nowTime > revisionTime && nowTime >= '22:30'));
  const planExam = () => {
    if (!nextExam) return;
    const r = runOffer({ label: t('Planifier'), kind: 'plan_revisions', payload: { eventId: nextExam.id } });
    const planned = r.links?.find(l => l.label === t('Voir le planning'));
    const made = r.links?.find(l => l.to.startsWith('/notes'));
    if (planned)
      return toast(
        r.links!.length > 1
          ? words === WORDS.etudes
            ? t('{planned} : créneaux dans le calendrier et une fiche à remplir', { planned: words.planned })
            : t('{planned} : créneaux dans le calendrier et une note à remplir', { planned: words.planned })
          : t('{planned} : créneaux dans le calendrier', { planned: words.planned }),
        'success',
        { label: made ? t('Ouvrir') : t('Voir'), run: () => navigate((made ?? planned).to) },
      );
    setTooLate(nextExam.id);
    toast(r.text, 'info', made && { label: made.label, run: () => navigate(made.to) });
  };
  const sheetLabel = words === WORDS.etudes ? t('Ouvrir la fiche') : t('Ouvrir la note');
  const showSheet = !!examSheet && (examDays === 0 || tooLate === nextExam?.id || noTimeLeft);

  const recentNotes = [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const nowPeriods = periodsOn(periods, today);

  // ── Header line: « jeudi 5 novembre · 2 rendez-vous et 3 tâches aujourd’hui » ──
  // Timed ones, like the ring (a birthday or an open day is no « rendez-vous »), else the day's events.
  const dayEvents = timed.length || todayEvents.length;
  const dayTodo = open.length;
  const summary =
    dayEvents && dayTodo
      ? t('{events} et {tasks} aujourd’hui', { events: tn(dayEvents, '{n} rendez-vous', '{n} rendez-vous||pluriel'), tasks: tn(dayTodo, '{n} tâche', '{n} tâches') })
      : dayEvents
        ? tn(dayEvents, '{n} rendez-vous aujourd’hui', '{n} rendez-vous aujourd’hui||pluriel')
        : dayTodo
          ? tn(dayTodo, '{n} tâche aujourd’hui', '{n} tâches aujourd’hui')
          : t('Rien de prévu aujourd’hui');
  const minutesTo = next?.date === today && next.start ? toMinutes(next.start) - toMinutes(nowTime) : null;
  const nextWhen = !next
    ? ''
    : next.date === today
      ? !next.start
        ? t('Aujourd’hui')
        : minutesTo! <= 0
          ? t('En ce moment')
          : inMinutes(minutesTo!)
      : daysUntil(next.date) <= 1
        ? countdownLabel(next.date)
        : fmtDay(fromKey(next.date), daysUntil(next.date) < 7 ? 'EEEE' : 'EEEE d MMMM');

  let n = 0;
  return (
    <div className="h-full overflow-y-auto px-4 pb-room md:px-8">
      <div className="dpro mx-auto max-w-[1240px]">
        {/* ── Greeting, the day in one line, two actions ── */}
        <div className="dpro-top">
          <div className="min-w-0">
            <h1>{t('{hello}, {name}', { hello, name: user.name })}</h1>
            <p className="dpro-date">
              <span className="inline-block first-letter:uppercase">{fmt(now, 'EEEE d MMMM')}</span>
              {' · '}
              {summary}
            </p>
          </div>
          <div className="dpro-actions">
            <Link to="/taches?ajout=1" className="dpro-btn">
              <Plus size={15} aria-hidden /> {t('Nouvelle tâche')}
            </Link>
            {next && next.date === today && next.start && minutesTo! > 0 && (
              <Link to={eventLink(next)} className="dpro-btn is-meet" aria-label={t('Prochain : {title} à {time}', { title: next.title, time: next.start })}>
                <AlarmClock size={15} aria-hidden /> {t('Prochain : {time}', { time: next.start })}
              </Link>
            )}
          </div>
        </div>

        {/* ── The day in three numbers ── */}
        <div className="dpro-stats">
          <Link to="/taches" className="dpro-stat" style={{ '--c': 'var(--pro-tasks)' } as CSSProperties}>
            <span>{t('Faites aujourd’hui')}</span>
            <b className="tabular">
              {tasks.done.length}
              <small> / {tasks.total}</small>
            </b>
          </Link>
          <Link to="/taches" className="dpro-stat" style={{ '--c': 'var(--pro-focus)' } as CSSProperties}>
            <span>{t('Concentration')}</span>
            <b className="tabular">{formatMinutes(focusToday)}</b>
          </Link>
          <Link
            to={firstLate ? `/taches?tache=${firstLate.id}` : '/taches'}
            className={cx('dpro-stat is-late', tasks.late.length > 0 && 'is-alert')}
            style={{ '--c': 'var(--pro-urgent)' } as CSSProperties}
            aria-label={tasks.late.length ? tn(tasks.late.length, '{n} tâche en retard', '{n} tâches en retard') : t('Aucune tâche en retard')}
          >
            <span>{t('En retard')}</span>
            <b className="tabular">
              {tasks.late.length}
              {/* Said in full for the page's text too (search, tests), the chip's name being the label above. */}
              {tasks.late.length > 0 && <span className="sr-only"> · {tn(tasks.late.length, '{n} tâche en retard', '{n} tâches en retard')}</span>}
            </b>
          </Link>
          {nowPeriods.map(p => (
            <Link key={p.id} to="/calendrier" className="dpro-period" style={{ background: periodTint(p, 22), color: periodText(p) }}>
              <i style={{ background: periodColor(p) }} aria-hidden />
              {p.title}
              {periodUntil(p, today) && <span>· {periodUntil(p, today)}</span>}
            </Link>
          ))}
        </div>

        <HomeShortcuts />

        <div className="dpro-wrap">
          <div className="dpro-grid">
            {/* ── Today: three rings to close ── */}
            <Panel i={n++} title={t('Aujourd’hui')} sub={t('Ferme tes anneaux')} className="dpro-today">
              <div className="dpro-rings-row">
                <Rings values={[ringRatio(tasks.done.length, tasks.total), ringRatio(focusToday, goal), ringRatio(meetDone, timed.length)]} />
                <ul className="dpro-legend">
                  <li style={{ '--c': 'var(--pro-tasks)' } as CSSProperties}>
                    <span>{t('Tâches')}</span>
                    <b className="tabular">
                      {tasks.done.length}
                      <small> / {tasks.total}</small>
                    </b>
                  </li>
                  <li style={{ '--c': 'var(--pro-focus)' } as CSSProperties} title={t('Objectif : {n} blocs de {m} min', { n: GOAL_BLOCKS, m: focusMinutes })}>
                    <span>{t('Concentration')}</span>
                    <b className="tabular">
                      {formatMinutes(focusToday)}
                      <small> / {formatMinutes(goal)}</small>
                    </b>
                  </li>
                  <li style={{ '--c': 'var(--pro-meet)' } as CSSProperties}>
                    <span>{t('Rendez-vous')}</span>
                    <b className="tabular">
                      {meetDone}
                      <small> / {timed.length}</small>
                    </b>
                  </li>
                </ul>
              </div>
            </Panel>

            {/* ── Up next: the next event lit up, then the following ones ── */}
            <Panel i={n++} title={t('À suivre')} to="/calendrier" link={t('Calendrier')} linkLabel={t('Ouvrir le calendrier')} className="dpro-next">
              {next ? (
                <>
                  <Link to={eventLink(next)} className="dpro-up" style={{ '--c': catOf(next.category).color } as CSSProperties}>
                    <span className="dpro-up-row">
                      <span className="dpro-up-when inline-block first-letter:uppercase">{nextWhen}</span>
                      <span className="dpro-up-tag">{catOf(next.category).label}</span>
                    </span>
                    <span className="dpro-up-title">
                      {next.important && <Flag size={15} className="dpro-flag" aria-label={t('Important')} />}
                      {next.title}
                    </span>
                    <span className="dpro-up-info">
                      {next.start && <span className="tabular">{next.end ? `${next.start} – ${next.end}` : next.start}</span>}
                      {next.place && (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <MapPin size={12} aria-hidden className="shrink-0" />
                          <span className="truncate">{next.place}</span>
                        </span>
                      )}
                      {fromAgenda(next) && <span className="truncate">{next.agenda.name}</span>}
                    </span>
                  </Link>
                  {after.length > 0 && (
                    <ul className="dpro-agenda">
                      {after.map(e => (
                        <li key={`${e.id}-${e.date}`} style={{ '--c': catOf(e.category).color } as CSSProperties}>
                          <Link to={eventLink(e)}>
                            <b>{e.title}</b>
                            <time className="tabular inline-block first-letter:uppercase" dateTime={e.date}>
                              {e.date === today ? e.start ?? t('Aujourd’hui') : `${fmtDay(fromKey(e.date), daysUntil(e.date) < 7 ? 'EEE' : 'EEE d MMM')}${e.start ? ` ${e.start}` : ''}`}
                            </time>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="dpro-empty">
                  <p>{t('Rien de prévu.')}</p>
                  <Link to="/calendrier?ajout=1" className="dpro-btn">
                    <Plus size={15} aria-hidden /> {t('Nouvel événement')}
                  </Link>
                </div>
              )}
            </Panel>

            <TimerCard i={n++} />

            {/* ── Tasks of the day ── */}
            <Panel
              i={n++}
              title={t('À faire')}
              sub={open.length ? (tasks.late.length ? t('Aujourd’hui et en retard') : t('Aujourd’hui')) : todos.length ? t('Rien d’autre pour aujourd’hui') : undefined}
              to="/taches"
              link={t('Toutes les tâches')}
              linkLabel={t('Ouvrir toutes les tâches')}
              className="dpro-tasks"
            >
              {shownOpen.length + shownDone.length + shownNext.length ? (
                <>
                  {shownOpen.length + shownDone.length > 0 && <ul className="dpro-task-list">{[...shownOpen, ...shownDone].map(row)}</ul>}
                  {moreOpen > 0 && (
                    <Link to="/taches" className="dpro-more">
                      {tn(moreOpen, '+{n} autre dans Tâches', '+{n} autres dans Tâches')}
                    </Link>
                  )}
                  {shownNext.length > 0 && (
                    <div className={cx('dpro-later', shownOpen.length + shownDone.length > 0 && 'is-after')}>
                      <h3>{t('Ensuite')}</h3>
                      <ul className="dpro-task-list">{shownNext.map(row)}</ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="dpro-empty">
                  <p>{todos.some(x => x.done) ? t('Tout est coché. Profites-en.') : t('Aucune tâche pour l’instant.')}</p>
                  <Link to="/taches?ajout=1" className="dpro-btn">
                    <Plus size={15} aria-hidden /> {t('Nouvelle tâche')}
                  </Link>
                </div>
              )}
            </Panel>

            {/* ── The week: bars per day, today lit up, the days to come ghosted ── */}
            <Panel
              i={n++}
              title={t('Ma semaine')}
              sub={
                <>
                  <span className="dpro-nowrap">{kind === 'focus' ? t('Concentration · {total}', { total: formatMinutes(weekTotal) }) : t('Tâches faites · {n}', { n: weekTotal })}</span>
                  {delta !== null && (
                    <span className={cx('dpro-delta', delta >= 0 ? 'is-up' : 'is-down')}>
                      {delta >= 0 ? t('+{n} % sur la semaine dernière', { n: delta }) : t('{n} % sur la semaine dernière', { n: delta })}
                    </span>
                  )}
                </>
              }
              className={cx('dpro-week', kind === 'focus' ? 'is-focus' : 'is-tasks')}
              extra={
                <div className="dpro-seg" role="group" aria-label={t('Ce que montrent les barres')}>
                  <button type="button" aria-pressed={kind === 'focus'} onClick={() => setMetric('focus')}>
                    {t('Concentration')}
                  </button>
                  <button type="button" aria-pressed={kind === 'tasks'} onClick={() => setMetric('tasks')}>
                    {t('Tâches')}
                  </button>
                </div>
              }
            >
              <div className="dpro-bars" style={{ '--rows': marks.length - 1 } as CSSProperties}>
                <div className="dpro-axis tabular" aria-hidden>
                  {marks.map(m => (
                    <span key={m}>{!m ? 0 : kind === 'focus' ? (m % 60 ? t('{n} min', { n: m }) : t('{n} h', { n: m / 60 })) : m}</span>
                  ))}
                </div>
                <ol className="dpro-cols">
                  {week.map((d, k) => {
                    const v = values[k];
                    const name = fmt(fromKey(d.day), 'EEEE');
                    return (
                      <li key={d.day} className={cx('dpro-col', `is-${d.when}`)} style={{ '--h': d.when === 'future' ? 0.1 : top ? v / top : 0, '--k': k } as CSSProperties}>
                        <span className="sr-only">
                          {name} : {d.when === 'future' ? t('à venir') : value(v)}
                        </span>
                        <i aria-hidden>{d.when !== 'future' && v > 0 && <em className="tabular">{value(v)}</em>}</i>
                        <span aria-hidden>{fmt(fromKey(d.day), 'EEEEE')}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
              {/* What the usual « Ma semaine » said: the week's tasks, and the next one to tick. */}
              <p className="dpro-cheer">
                <span className="tabular">{tn(weekDone, '{n} tâche sur {total} faite cette semaine.', '{n} tâches sur {total} faites cette semaine.', { total: weekPlanned })}</span> {cheer(weekDone, weekPlanned)}
                {weekLeft[0] && (
                  <>
                    {' '}
                    <Link to={`/taches?tache=${weekLeft[0].id}`}>{t('Ensuite : {title}', { title: weekLeft[0].title })}</Link>
                  </>
                )}
              </p>
            </Panel>

            {/* ── The next big day ── */}
            <Panel i={n++} title={notExam ? t('Prochain grand jour') : words.nextBig} className={cx('dpro-big', nextExam && 'is-set')}>
              {nextExam ? (
                <div className="flex flex-1 flex-col">
                  <Link to={linkToDay(nextExam.date, nextExam.id)} className="dpro-big-main">
                    {examDays <= 1 ? (
                      <span className="dpro-big-word">{examDays === 0 ? t('Aujourd’hui') : t('Demain')}</span>
                    ) : (
                      <span className="dpro-big-count">
                        <b className="tabular">{examDays}</b>
                        <span>{tn(examDays, 'jour', 'jours')}</span>
                      </span>
                    )}
                    <span className="dpro-big-title">
                      {nextExam.important && <Flag size={14} className="dpro-flag" aria-label={t('Important')} />}
                      <span className="truncate">{nextExam.title}</span>
                    </span>
                    <span className="dpro-big-date first-letter:uppercase">
                      {fmtDay(fromKey(nextExam.date), 'EEEE d MMMM')}
                      {nextExam.start && ` · ${nextExam.start}`}
                    </span>
                  </Link>
                  {laterBig.length > 0 && (
                    <ul className="dpro-big-later">
                      {laterBig.map(e => {
                        const d = daysUntil(e.date);
                        return (
                          <li key={e.id}>
                            <Link to={linkToDay(e.date, e.id)}>
                              <b className={cx('tabular', d <= 3 && 'is-soon')}>{d === 0 ? t('Auj.') : t('J-{n}', { n: d })}</b>
                              <span className="truncate">{e.title}</span>
                              <time className="dpro-big-later-date tabular" dateTime={e.date}>
                                {fmtDay(fromKey(e.date), d < 7 ? 'EEE d' : 'EEE d MMM').replace(/^./, c => c.toUpperCase())}
                                {e.start && ` · ${e.start}`}
                              </time>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {hasRevisionPlan(nextExam) ? (
                    <div className="dpro-big-foot">
                      <p>
                        <Check size={13} aria-hidden className="text-[var(--pro-focus)]" /> {words.planned}
                        {revisionSessions(nextExam)[0] && (
                          <Link to={linkToDay(revisionSessions(nextExam)[0].date, revisionSessions(nextExam)[0].id)}>{t('Voir les créneaux')}</Link>
                        )}
                      </p>
                      {examSheet && (
                        <Link to={linkToNote(examSheet.id)} className="dpro-btn is-white">
                          {sheetLabel}
                        </Link>
                      )}
                    </div>
                  ) : showSheet ? (
                    <div className="dpro-big-foot">
                      <Link to={linkToNote(examSheet!.id)} className="dpro-btn is-white">
                        {sheetLabel}
                      </Link>
                    </div>
                  ) : hasStarted(nextExam) || notExam ? null : (
                    <div className="dpro-big-foot">
                      <button type="button" onClick={planExam} className="dpro-btn is-white">
                        {words.plan}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="dpro-empty is-left">
                  <p>{words.noBig}</p>
                  <p className="dpro-hint">
                    <Flag size={12} aria-hidden /> {t('Marque un événement important pour le voir ici.')}
                  </p>
                </div>
              )}
            </Panel>

            {/* ── Notes ── */}
            <Panel i={n++} title={t('Notes récentes')} to="/notes" link={t('Notes')} linkLabel={t('Ouvrir les notes')} className="dpro-notes">
              {recentNotes.length ? (
                <ul className="dpro-note-list">
                  {recentNotes.map(x => (
                    <li key={x.id}>
                      <Link to={linkToNote(x.id)}>
                        <NotebookPen size={14} aria-hidden />
                        <b>{x.title}</b>
                        <span>{relativeTime(x.updatedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="dpro-empty is-left">
                  <p>{t('Aucune note pour l’instant.')}</p>
                  <Link to="/notes?nouvelle=1" className="dpro-btn">
                    <Plus size={15} aria-hidden /> {t('Nouvelle note')}
                  </Link>
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
