// Kompaly's initiative: he watches what happens in the app and, from time to time,
// leans out of the screen edge to react or to suggest something useful.

import { addDays } from 'date-fns';
import { useCalendar, isBigEvent, isDeliverable, sortEvents, type CalendarEvent } from '../store/calendar';
import { useDrive } from '../store/drive';
import { useNotes } from '../store/notes';
import { useCopilot, type Bubble, type CopilotOffer } from '../store/copilot';
import { useAuth } from '../store/auth';
import { useTodos } from '../store/todos';
import { useFocusLog } from '../store/focusLog';
import { useFocus } from '../store/focus';
import { toKey, todayKey, daysUntil, fmt, fromKey, weekStart, countdownLabel, isOver, hasStarted } from '../lib/dates';

export { isOver };
import { hasRevisionPlan, linkToDay, linkToNote } from './actions';
import { aiNudge, type NudgeKind } from './claudeBrain';
import { getSettings } from '../store/settings';
import { notify } from '../lib/notify';
import { usageWords } from '../lib/usage';

/** minimum delay between two spontaneous remarks, depending on the student's preference */
const MIN_GAP = { calme: 5 * 60_000, normal: 75_000, bavard: 30_000 };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

let lastNudge = 0;
let busy = false;

interface Nudge {
  key: string; // memory key: the same remark is not repeated within `every`
  every: number;
  situation: Record<string, unknown>; // given to Claude to phrase it
  fallback: string; // local wording
  offers?: CopilotOffer[];
  links?: Bubble['links'];
  mood?: Bubble['mood'];
  urgent?: boolean; // bypass the global gap
  kind?: NudgeKind; // 'brief' and 'review' are longer, several lines
}

function canSpeak(n: Nudge) {
  const s = useCopilot.getState();
  const settings = getSettings();
  if (s.thinking || !settings.copilotVisible) return false;
  // Never break a focus session (the end-of-session message comes from the timer itself).
  if (useFocus.getState().phase === 'focus') return false;
  const allowed = n.kind === 'brief' ? settings.morningBrief : n.kind === 'review' ? settings.weeklyReview : settings.proactive;
  if (!allowed) return false;
  const last = s.memory[n.key];
  if (last && Date.now() - last < n.every) return false;
  if (!n.urgent && Date.now() - lastNudge < MIN_GAP[settings.chattiness]) return false;
  return true;
}

async function nudge(n: Nudge) {
  if (busy || !canSpeak(n)) return false;
  busy = true;
  lastNudge = Date.now();
  useCopilot.getState().remember(n.key);
  try {
    let text = n.fallback;
    if (useCopilot.getState().aiEnabled) {
      const ai = await aiNudge({ ...n.situation, actions_proposees: n.offers?.map(o => o.label) ?? [] }, useAuth.getState().user?.name ?? '', n.kind);
      if (ai) text = ai;
    }
    useCopilot.getState().say({ text, offers: n.offers, links: n.links, mood: n.mood ?? (n.offers ? 'alert' : 'happy') });
    notify('Kompaly', n.kind ? text.split('\n')[0] : text);
  } finally {
    busy = false;
  }
  return true;
}

const when = (e: CalendarEvent) => `${fmt(fromKey(e.date), 'EEEE d MMMM')}${e.start ? ` à ${e.start.replace(':', 'h')}` : ''}`;

const studying = () => (getSettings().usage ?? 'etudes') === 'etudes';
/** The big days Kompaly helps prepare for: exams in studies; deadlines, « grands jours » and important events elsewhere. */
const big = (e: CalendarEvent) => (studying() ? e.category === 'examen' : isBigEvent(e));

// Work and personal accounts: a deadline or a big day is not revised for, only time blocked to get ready.
const examOffers = (e: CalendarEvent): CopilotOffer[] | undefined =>
  !studying()
    ? hasRevisionPlan(e)
      ? undefined
      : [{ label: usageWords(getSettings().usage).plan, kind: 'plan_revisions', payload: { eventId: e.id } }]
    : hasRevisionPlan(e)
      ? [{ label: 'Créer une fiche', kind: 'revision_note', payload: { eventId: e.id } }]
      : [
          { label: 'Planifier mes révisions', kind: 'plan_revisions', payload: { eventId: e.id } },
          { label: 'Juste une fiche', kind: 'revision_note', payload: { eventId: e.id } },
        ];

/** Kompaly's words when a big event is added, in the vocabulary of the account's usage. */
function bigEventFallback(e: CalendarEvent, d: number) {
  const words = usageWords(getSettings().usage);
  const day = d === 0 ? 'aujourd’hui' : d === 1 ? 'demain' : 'après-demain';
  if (!studying()) {
    return d <= 2
      ? `« ${e.title} » ${day} : tu veux que je te bloque un moment pour t’y préparer ?`
      : `${words.bigNoted}\u00a0: «\u00a0${e.title}\u00a0», dans ${d}\u00a0jours. On bloque ${words.prepare} maintenant, comme ça c’est fait\u00a0?`;
  }
  return d <= 2
    ? `« ${e.title} » ${day} ? On ne panique pas : je te prépare un mini-plan express ?`
    : pick([
        `${words.bigNoted}\u00a0: «\u00a0${e.title}\u00a0», dans ${d}\u00a0jours. On cale ${words.prepare} maintenant, comme ça c’est fait\u00a0?`,
        `« ${e.title} » dans ${d} jours. Je te propose de répartir des séances de révision d’ici là, ça te va ?`,
      ]);
}

// ── Reactions to what the student does ──────────────────────────────────────

function onEventAdded(e: CalendarEvent) {
  if (e.title.startsWith('Révision · ') || e.title.startsWith('Préparation · ')) return; // created by Kompaly himself
  if (big(e)) {
    const d = daysUntil(e.date);
    if (hasStarted(e)) return; // added after the fact (or already under way) (« Exam hier », « Partiel aujourd'hui 8h » at 20h): nothing left to prepare
    void nudge({
      key: `exam-added:${e.id}`,
      every: 365 * DAY,
      urgent: true,
      situation: studying()
        ? { evenement: "l'étudiant vient d'ajouter un examen", examen: e.title, quand: when(e), jours_restants: d }
        : { evenement: `l'utilisateur vient d'ajouter un événement important (${getSettings().usage === 'travail' ? 'échéance de travail' : 'événement personnel'}), pas un examen`, titre: e.title, quand: when(e), jours_restants: d },
      fallback: bigEventFallback(e, d),
      offers: examOffers(e),
    });
  } else if (isDeliverable(e) && daysUntil(e.date) <= 1 && !isOver(e)) {
    void nudge({
      key: `hw-added:${e.id}`,
      every: 365 * DAY,
      situation: { evenement: "l'étudiant ajoute un devoir à rendre très bientôt", devoir: e.title, quand: when(e) },
      fallback: `« ${e.title} » pour ${daysUntil(e.date) === 0 ? 'aujourd’hui' : 'demain'}… Courage, je te le rappelle si besoin.`,
    });
  }
}

function onEventDone(e: CalendarEvent) {
  const today = useCalendar.getState().events.filter(x => x.date === todayKey());
  if (big(e) && daysUntil(e.date) <= 0) {
    void nudge({
      key: `exam-done:${e.id}`,
      every: 365 * DAY,
      situation: { evenement: "l'étudiant vient de cocher son examen comme passé", examen: e.title },
      fallback: `« ${e.title} », c’est derrière toi. Alors, ça s’est passé comment ?`,
      mood: 'happy',
    });
  } else if (today.length >= 2 && today.every(x => x.done)) {
    void nudge({
      key: `day-clear:${todayKey()}`,
      every: DAY,
      situation: { evenement: "l'étudiant a terminé tout ce qui était prévu aujourd'hui", nombre: today.length },
      fallback: pick(['Tout est coché pour aujourd’hui. Respect. Tu as gagné une vraie pause.', "Journée bouclée à 100 %. Franchement, chapeau."]),
      mood: 'happy',
    });
  }
}

function onFilesUploaded(count: number) {
  const files = useDrive.getState().items.filter(i => i.kind === 'file');
  if (files.length === count) {
    void nudge({
      key: 'first-upload',
      every: 365 * DAY,
      situation: { evenement: "premier import de fichiers dans le Drive de l'étudiant", nombre: count },
      fallback: 'Premiers fichiers dans ton Drive. Demande-moi si tu as besoin de les retrouver plus tard.',
    });
  }
}

// ── Periodic look at the calendar ────────────────────────────────────────────

/**
 * The remarks the calendar and the notes call for right now, most important first. Only the first one Kompaly
 * may make is made: one already made today (or switched off) must not hold back the ones after it.
 */
export function periodicNudges(now = new Date()): Nudge[] {
  const out: Nudge[] = [];
  const events = [...useCalendar.getState().events].sort(sortEvents);
  const today = toKey(now);

  // (« ça commence dans 15 min » : the reminders of the event, lib/reminderScheduler.ts)

  // Exams within 6 days and no revision plan yet
  for (const exam of events.filter(e => big(e) && !e.done && daysUntil(e.date) >= 0 && daysUntil(e.date) <= 6 && !hasRevisionPlan(e))) {
    const d = daysUntil(exam.date);
    out.push({
      key: `exam-soon:${exam.id}`,
      every: DAY,
      situation: studying()
        ? { evenement: 'examen proche sans révisions planifiées', examen: exam.title, quand: when(exam), jours_restants: d }
        : { evenement: 'événement important proche (pas un examen), rien de prévu pour le préparer', titre: exam.title, quand: when(exam), jours_restants: d },
      fallback: !studying()
        ? `« ${exam.title} » ${d === 0 ? 'c’est aujourd’hui' : d === 1 ? 'c’est demain' : `arrive dans ${d} jours`} et rien n’est prévu pour t’y préparer. Je te bloque un moment ?`
        : d <= 1
          ? `« ${exam.title} » ${d === 0 ? 'c’est aujourd’hui' : 'c’est demain'}. On fait une dernière révision ciblée ensemble ?`
          : `« ${exam.title} » arrive dans ${d} jours et rien n’est prévu pour réviser. Je te cale des créneaux ?`,
      offers: examOffers(exam),
    });
  }

  // Late homework
  const late = events.filter(e => isDeliverable(e) && !e.done && e.date < today);
  if (late.length) {
    out.push({
      key: `late:${today}`,
      every: DAY,
      situation: { evenement: 'devoirs non cochés dont la date est passée', devoirs: late.map(e => e.title) },
      fallback:
        late.length === 1
          ? `« ${late[0].title} » n’est pas coché alors que la date est passée. ${studying() ? 'Tu l’as rendu ?' : 'C’est fait ?'}`
          : `${late.length} ${studying() ? 'devoirs sont' : 'choses à faire sont'} en retard dans ton calendrier. Tu veux faire le tri ?`,
      offers: late.length === 1 ? [{ label: studying() ? 'Oui, c’est rendu' : 'Oui, c’est fait', kind: 'mark_done', payload: { eventId: late[0].id } }] : undefined,
      links: late.length > 1 ? [{ label: 'Voir le calendrier', to: '/calendrier' }] : undefined,
    });
  }

  // Homework due tomorrow
  const tomorrow = toKey(addDays(now, 1));
  const due = events.find(e => isDeliverable(e) && !e.done && e.date === tomorrow);
  if (due && now.getHours() >= 14) {
    out.push({
      key: `due-tomorrow:${due.id}`,
      every: DAY,
      situation: { evenement: 'devoir à rendre demain, pas encore coché', devoir: due.title, quand: when(due) },
      fallback: `N’oublie pas : « ${due.title} » est ${studying() ? 'à rendre' : 'prévu'} demain. Il te reste beaucoup ?`,
      offers: [{ label: 'C’est déjà fait', kind: 'mark_done', payload: { eventId: due.id } }],
    });
  }

  // Evening before an exam
  const examTomorrow = events.find(e => big(e) && e.date === tomorrow);
  if (examTomorrow && now.getHours() >= 21) {
    out.push({
      key: `eve:${examTomorrow.id}`,
      every: DAY,
      situation: { evenement: "veille d'examen, il est tard", examen: examTomorrow.title, heure: examTomorrow.start },
      fallback: studying()
        ? `Demain c’est « ${examTomorrow.title} ». Le meilleur conseil maintenant : dormir. Tu en sais plus que tu crois.`
        : `Demain c’est « ${examTomorrow.title} ». Le meilleur conseil maintenant : une bonne nuit de sommeil.`,
      mood: 'sleep',
    });
  }

  // A note created a while ago that is still empty
  const empty = useNotes.getState().notes.find(n => !n.content.replace(/<[^>]+>/g, '').trim() && Date.now() - new Date(n.createdAt).getTime() > 2 * DAY);
  if (empty) {
    out.push({
      key: `empty-note:${empty.id}`,
      every: 30 * DAY,
      situation: { evenement: 'une note créée il y a plusieurs jours est toujours vide', note: empty.title },
      fallback: `Ta note « ${empty.title} » est vide depuis un moment. On la remplit ou je la laisse tranquille ?`,
      links: [{ label: 'Ouvrir la note', to: linkToNote(empty.id) }],
    });
  }
  return out;
}

/** The remark the periodic look makes now: the first of the list Kompaly may make (tested in tests/proactive.test.ts). */
export const nextNudge = (now = new Date()) => periodicNudges(now).find(canSpeak);

function periodicCheck() {
  if (weeklyReview()) return;
  const next = nextNudge();
  if (next) void nudge(next);
}

// ── Morning brief & Sunday review ───────────────────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** « Ta journée en 3 lignes », on the first opening of the day before noon. Returns true if shown. */
function morningBrief(): boolean {
  const settings = getSettings();
  const today = todayKey();
  const key = `brief:${today}`;
  if (!settings.morningBrief || !settings.copilotVisible || new Date().getHours() >= 12 || useCopilot.getState().memory[key]) return false;
  const events = useCalendar.getState().events;
  const todays = events.filter(e => e.date === today).sort(sortEvents);
  const todos = useTodos.getState().todos.filter(t => !t.done);
  const dueTodos = todos.filter(t => t.due && t.due <= today);
  const nextExam = events.filter(e => big(e) && !e.done && e.date >= today && !isOver(e)).sort(sortEvents)[0];
  // Discreet mode: only when there is something worth saying.
  if (settings.chattiness === 'calme' && !todays.length && !dueTodos.length && !(nextExam && daysUntil(nextExam.date) <= 7)) return false;

  const name = useAuth.getState().user?.name ?? '';
  const words = usageWords(settings.usage);
  const lines = [
    todays.length
      ? `Aujourd’hui : ${todays.slice(0, 4).map(e => `${e.title}${e.start ? ` (${e.start.replace(':', 'h')})` : ''}`).join(', ')}${todays.length > 4 ? '…' : '.'}`
      : 'Aujourd’hui : rien au calendrier, journée libre.',
    dueTodos.length
      ? `À faire : ${dueTodos.slice(0, 3).map(t => t.title).join(', ')}${dueTodos.length > 3 ? ` et ${dueTodos.length - 3} autre${dueTodos.length > 4 ? 's' : ''}` : ''}.`
      : todos.length
        ? `À faire : ${plural(todos.length, 'tâche')} dans ta liste, rien d’urgent.`
        : 'À faire : liste vide, rien qui presse.',
    nextExam
      ? `${words.nextBig} : ${nextExam.title}, ${daysUntil(nextExam.date) <= 1 ? countdownLabel(nextExam.date).toLowerCase() : `dans ${daysUntil(nextExam.date)} jours`}.`
      : `${words.nextBig} : ${words.none} à l’horizon.`,
  ];
  const offers: CopilotOffer[] = [{ label: 'Ouvrir le calendrier', kind: 'open', payload: { to: todays.length ? linkToDay(today) : '/calendrier' } }];
  if (nextExam && daysUntil(nextExam.date) <= 10 && !hasRevisionPlan(nextExam)) {
    offers.unshift({ label: studying() ? 'Planifier mes révisions' : words.plan, kind: 'plan_revisions', payload: { eventId: nextExam.id } });
  }
  void nudge({
    key,
    every: 365 * DAY,
    urgent: true,
    kind: 'brief',
    situation: {
      evenement: `point du matin de ${name || "l'étudiant"}`,
      aujourdhui: todays.map(e => `${e.title}${e.start ? ` à ${e.start}` : ''} (${e.category})${e.done ? ' fait' : ''}`),
      taches_du_jour_ou_en_retard: dueTodos.map(t => t.title),
      taches_restantes: todos.length,
      prochain_examen: nextExam ? `${nextExam.title} dans ${daysUntil(nextExam.date)} jours` : null,
    },
    fallback: `${name ? `Salut ${name} !` : 'Salut !'} Ta journée en 3 lignes :\n${lines.join('\n')}`,
    offers,
    mood: 'happy',
  });
  return true;
}

/** Sunday from 17:00: what was done this week, focus time per subject, what's next. Once per week. */
function weeklyReview(): boolean {
  const now = new Date();
  const settings = getSettings();
  if (!settings.weeklyReview || !settings.copilotVisible || now.getDay() !== 0 || now.getHours() < 17) return false;
  const ws = weekStart(now);
  const key = `review:${toKey(ws)}`;
  if (useCopilot.getState().memory[key]) return false;
  const from = toKey(ws);
  const to = toKey(addDays(ws, 6));
  const events = useCalendar.getState().events;
  const week = events.filter(e => e.date >= from && e.date <= to && e.category !== 'cours');
  const done = week.filter(e => e.done).length;
  const todosDone = useTodos.getState().todos.filter(t => t.doneAt && toKey(new Date(t.doneAt)) >= from).length;
  const sessions = useFocusLog.getState().sessions.filter(s => toKey(new Date(s.startedAt)) >= from);
  const bySubject = new Map<string, number>();
  const none = `sans ${usageWords(settings.usage).subject}`;
  for (const s of sessions) bySubject.set(s.subject || none, (bySubject.get(s.subject || none) ?? 0) + s.minutes);
  const focusMin = sessions.reduce((n, s) => n + s.minutes, 0);
  const top = [...bySubject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const nFrom = toKey(addDays(ws, 7));
  const nTo = toKey(addDays(ws, 13));
  const next = events.filter(e => e.date >= nFrom && e.date <= nTo);
  const nextExams = next.filter(e => big(e));
  // Discreet mode: only when there is something to act on (an exam next week, something late).
  const late = events.some(e => isDeliverable(e) && !e.done && e.date < toKey(now)) || useTodos.getState().todos.some(t => !t.done && t.due && t.due < toKey(now));
  if (settings.chattiness === 'calme' && !nextExams.length && !late) return false;
  const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`);
  const ticked = todosDone ? `${plural(todosDone, 'tâche')} cochée${todosDone > 1 ? 's' : ''}` : '';

  const lines = [
    week.length
      ? `Cette semaine : ${done} fait${done > 1 ? 's' : ''} sur ${week.length} prévu${week.length > 1 ? 's' : ''}${ticked ? `, plus ${ticked}` : ''}.`
      : `Cette semaine : rien de prévu au calendrier${ticked ? `, mais ${ticked}` : ''}.`,
    focusMin
      ? `Concentration : ${hours(focusMin)}${top.length ? ` (${top.map(([s, m]) => `${s} ${hours(m)}`).join(', ')})` : ''}.`
      : 'Concentration : aucune session focus, on en lance une cette semaine ?',
    next.length
      ? `Semaine prochaine : ${plural(next.length, 'événement')}${nextExams.length ? `, dont ${nextExams.map(e => e.title).join(', ')}` : ''}.`
      : 'Semaine prochaine : calendrier vide pour l’instant.',
  ];
  void nudge({
    key,
    every: 365 * DAY,
    urgent: true,
    kind: 'review',
    situation: {
      evenement: 'bilan du dimanche soir',
      prevu_cette_semaine: week.length,
      fait_cette_semaine: done,
      taches_cochees: todosDone,
      minutes_focus_par_matiere: Object.fromEntries(bySubject),
      semaine_prochaine: next.map(e => `${e.title} (${e.category}, ${fmt(fromKey(e.date), 'EEEE')})`).slice(0, 12),
    },
    fallback: `Bilan de ta semaine :\n${lines.join('\n')}`,
    offers: [{ label: 'Voir la semaine prochaine', kind: 'open', payload: { to: linkToDay(nFrom) } }],
    mood: 'happy',
  });
  return true;
}

/** « arrive demain », « arrive dans 3 jours » (« c'est aujourd'hui » for a big event not in today's list). */
const inDays = (d: number) => (d <= 0 ? 'c’est aujourd’hui' : d === 1 ? 'arrive demain' : `arrive dans ${d} jours`);

/** Greeting when the app opens (once per browser session). */
function greet() {
  if (sessionStorage.getItem('cop:greeted')) return;
  sessionStorage.setItem('cop:greeted', '1');
  if (morningBrief() || weeklyReview()) return;
  // Discreet mode: no plain hello, the dashboard already says it.
  if (getSettings().chattiness === 'calme') return;
  const name = useAuth.getState().user?.name ?? '';
  const events = useCalendar.getState().events;
  const today = events.filter(e => e.date === todayKey()).sort(sortEvents);
  const nextExam = events.filter(e => big(e) && !e.done && e.date >= todayKey()).sort(sortEvents)[0];
  const h = new Date().getHours();
  const hello = h < 5 ? `Encore debout, ${name} ?` : h < 12 ? `Salut ${name} !` : h < 18 ? `Hey ${name}.` : `Bonsoir ${name}.`;
  const fallback = today.length
    ? `${hello} Aujourd’hui : ${today.map(e => e.title).slice(0, 3).join(', ')}${today.length > 3 ? '…' : '.'}`
    : `${hello} Rien de prévu aujourd’hui${nextExam ? `, mais « ${nextExam.title} » ${inDays(daysUntil(nextExam.date))}` : ''}.`;
  void nudge({
    key: 'greet',
    every: 0,
    urgent: true,
    situation: {
      evenement: "l'étudiant ouvre l'application, salue-le et résume sa journée en une phrase",
      aujourdhui: today.map(e => `${e.title}${e.start ? ` ${e.start}` : ''}${e.done ? ' (fait)' : ''}`),
      prochain_examen: nextExam ? `${nextExam.title} dans ${daysUntil(nextExam.date)} jours` : null,
      heure: fmt(new Date(), 'HH:mm'),
    },
    fallback,
    mood: 'happy',
  });
}

/** Starts watching the app. Returns a cleanup function. */
export function startProactive() {
  const unsubs = [
    useCalendar.subscribe((s, prev) => {
      if (s.events === prev.events) return;
      if (s.events.length > prev.events.length) onEventAdded(s.events[s.events.length - 1]);
      // One lookup table, not a search per event: a year of imported timetable is ~1 500 events.
      const before = new Map(prev.events.map(p => [p.id, p]));
      for (const e of s.events) if (e.done && before.get(e.id)?.done === false) onEventDone(e);
    }),
    useDrive.subscribe((s, prev) => {
      const added = s.items.filter(i => i.kind === 'file').length - prev.items.filter(i => i.kind === 'file').length;
      if (added > 0) onFilesUploaded(added);
    }),
  ];
  const greetTimer = setTimeout(greet, 1500);
  const first = setTimeout(periodicCheck, 25_000);
  const interval = setInterval(periodicCheck, 2 * 60_000);
  return () => {
    unsubs.forEach(u => u());
    clearTimeout(greetTimer);
    clearTimeout(first);
    clearInterval(interval);
  };
}
