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
import { isSessionTitle } from './revisionPlan';
import { t, tn } from '../i18n';

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
  // Never over the recording page: its buttons are where the bubble opens (and the documents it saves aren't « first files »).
  if (busy || !canSpeak(n) || (typeof location !== 'undefined' && location.pathname === '/enregistrer')) return false;
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
      ? [{ label: t('Créer une fiche'), kind: 'revision_note', payload: { eventId: e.id } }]
      : [
          { label: t('Planifier mes révisions'), kind: 'plan_revisions', payload: { eventId: e.id } },
          { label: t('Juste une fiche'), kind: 'revision_note', payload: { eventId: e.id } },
        ];

/** Kompaly's words when a big event is added, in the vocabulary of the account's usage. */
function bigEventFallback(e: CalendarEvent, d: number) {
  const words = usageWords(getSettings().usage);
  const day = d === 0 ? t('aujourd’hui') : d === 1 ? t('demain') : t('après-demain');
  const vars = { title: e.title, day, noted: words.bigNoted, prepare: words.prepare };
  if (!studying()) {
    return d <= 2
      ? t('« {title} » {day} : je te bloque un moment pour t’y préparer ?', vars)
      : tn(d, '{noted}\u00a0: «\u00a0{title}\u00a0», dans {n}\u00a0jour. On bloque {prepare} maintenant\u00a0?', '{noted}\u00a0: «\u00a0{title}\u00a0», dans {n}\u00a0jours. On bloque {prepare} maintenant\u00a0?', vars);
  }
  return d <= 2
    ? t('« {title} » {day} ? Je te prépare un mini-plan express ?', vars)
    : pick([
        tn(d, '{noted}\u00a0: «\u00a0{title}\u00a0», dans {n}\u00a0jour. On cale {prepare} maintenant\u00a0?', '{noted}\u00a0: «\u00a0{title}\u00a0», dans {n}\u00a0jours. On cale {prepare} maintenant\u00a0?', vars),
        tn(d, '« {title} » dans {n} jour. Je répartis des séances de révision d’ici là ?', '« {title} » dans {n} jours. Je répartis des séances de révision d’ici là ?', vars),
      ]);
}

// ── Reactions to what the student does ──────────────────────────────────────

function onEventAdded(e: CalendarEvent) {
  if (isSessionTitle(e.title)) return; // created by Kompaly himself
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
      fallback: daysUntil(e.date) === 0 ? t('« {title} » pour aujourd’hui. Courage !', { title: e.title }) : t('« {title} » pour demain. Courage !', { title: e.title }),
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
      fallback: t('« {title} », c’est derrière toi. Alors, ça s’est passé comment ?', { title: e.title }),
      mood: 'happy',
    });
  } else if (today.length >= 2 && today.every(x => x.done)) {
    void nudge({
      key: `day-clear:${todayKey()}`,
      every: DAY,
      situation: { evenement: "l'étudiant a terminé tout ce qui était prévu aujourd'hui", nombre: today.length },
      fallback: pick([t('Tout est coché pour aujourd’hui. Bravo, pause méritée.'), t('Journée bouclée à 100 %. Franchement, chapeau.')]),
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
      fallback: t('Premiers fichiers dans ton Drive. Demande-moi pour les retrouver.'),
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
        ? t('« {title} » {when} et rien n’est prévu pour t’y préparer. Je te bloque un moment ?', { title: exam.title, when: d === 0 ? t('c’est aujourd’hui') : d === 1 ? t('c’est demain') : tn(d, 'arrive dans {n} jour', 'arrive dans {n} jours') })
        : d <= 1
          ? d === 0
            ? t('« {title} » c’est aujourd’hui. On fait une dernière révision ciblée ensemble ?', { title: exam.title })
            : t('« {title} » c’est demain. On fait une dernière révision ciblée ensemble ?', { title: exam.title })
          : tn(d, '« {title} » arrive dans {n} jour et rien n’est prévu pour réviser. Je te cale des créneaux ?', '« {title} » arrive dans {n} jours et rien n’est prévu pour réviser. Je te cale des créneaux ?', { title: exam.title }),
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
          ? studying()
            ? t('« {title} » : la date est passée. Tu l’as rendu ?', { title: late[0].title })
            : t('« {title} » : la date est passée. C’est fait ?', { title: late[0].title })
          : studying()
            ? t('{n} devoirs sont en retard dans ton calendrier. Tu veux faire le tri ?', { n: late.length })
            : t('{n} choses à faire sont en retard dans ton calendrier. Tu veux faire le tri ?', { n: late.length }),
      offers: late.length === 1 ? [{ label: studying() ? t('Oui, c’est rendu') : t('Oui, c’est fait'), kind: 'mark_done', payload: { eventId: late[0].id } }] : undefined,
      links: late.length > 1 ? [{ label: t('Voir le calendrier'), to: '/calendrier' }] : undefined,
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
      fallback: studying() ? t('« {title} » est à rendre demain. Il te reste beaucoup ?', { title: due.title }) : t('« {title} » est prévu demain. Il te reste beaucoup ?', { title: due.title }),
      offers: [{ label: t('C’est déjà fait'), kind: 'mark_done', payload: { eventId: due.id } }],
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
        ? t('Demain c’est « {title} ». Meilleur conseil : dormir.', { title: examTomorrow.title })
        : t('Demain c’est « {title} ». Meilleur conseil : une bonne nuit de sommeil.', { title: examTomorrow.title }),
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
      fallback: t('Ta note « {title} » est vide depuis un moment.', { title: empty.title }),
      links: [{ label: t('Ouvrir la note'), to: linkToNote(empty.id) }],
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

/** « Ta journée en 3 lignes », on the first opening of the day before noon. Returns true if shown. */
function morningBrief(): boolean {
  const settings = getSettings();
  const today = todayKey();
  const key = `brief:${today}`;
  if (!settings.morningBrief || !settings.copilotVisible || new Date().getHours() >= 12 || useCopilot.getState().memory[key]) return false;
  const events = useCalendar.getState().events;
  const todays = events.filter(e => e.date === today).sort(sortEvents);
  const todos = useTodos.getState().todos.filter(x => !x.done);
  const dueTodos = todos.filter(x => x.due && x.due <= today);
  const nextExam = events.filter(e => big(e) && !e.done && e.date >= today && !isOver(e)).sort(sortEvents)[0];
  // Discreet mode: only when there is something worth saying.
  if (settings.chattiness === 'calme' && !todays.length && !dueTodos.length && !(nextExam && daysUntil(nextExam.date) <= 7)) return false;

  const name = useAuth.getState().user?.name ?? '';
  const words = usageWords(settings.usage);
  const lines = [
    // Times as in the lists (« 10:16 »), not « 06h00 ».
    todays.length
      ? `${t('Aujourd’hui : {list}', { list: todays.slice(0, 4).map(e => `${e.title}${e.start ? ` (${e.start})` : ''}`).join(', ') })}${todays.length > 4 ? '…' : '.'}`
      : t('Aujourd’hui : rien au calendrier.'),
    dueTodos.length
      ? dueTodos.length > 3
        ? tn(dueTodos.length - 3, 'À faire : {list} et {n} autre.', 'À faire : {list} et {n} autres.', { list: dueTodos.slice(0, 3).map(x => x.title).join(', ') })
        : t('À faire : {list}.', { list: dueTodos.map(x => x.title).join(', ') })
      : todos.length
        ? tn(todos.length, 'À faire : {n} tâche dans ta liste, rien d’urgent.', 'À faire : {n} tâches dans ta liste, rien d’urgent.')
        : t('À faire : rien.'),
    nextExam
      ? daysUntil(nextExam.date) <= 1
        ? t('{next} : {title}, {when}.', { next: words.nextBig, title: nextExam.title, when: countdownLabel(nextExam.date).replace(/^\p{Lu}(?=\p{Ll})/u, c => c.toLowerCase()) })
        : tn(daysUntil(nextExam.date), '{next} : {title}, dans {n} jour.', '{next} : {title}, dans {n} jours.', { next: words.nextBig, title: nextExam.title })
      : t('{next} : {none} à l’horizon.', { next: words.nextBig, none: words.none }),
  ];
  const offers: CopilotOffer[] = [{ label: t('Ouvrir le calendrier'), kind: 'open', payload: { to: todays.length ? linkToDay(today) : '/calendrier' } }];
  if (nextExam && daysUntil(nextExam.date) <= 10 && !hasRevisionPlan(nextExam)) {
    offers.unshift({ label: studying() ? t('Planifier mes révisions') : words.plan, kind: 'plan_revisions', payload: { eventId: nextExam.id } });
  }
  void nudge({
    key,
    every: 365 * DAY,
    urgent: true,
    kind: 'brief',
    situation: {
      evenement: `point du matin de ${name || "l'étudiant"}`,
      aujourdhui: todays.map(e => `${e.title}${e.start ? ` à ${e.start}` : ''} (${e.category})${e.done ? ' fait' : ''}`),
      taches_du_jour_ou_en_retard: dueTodos.map(x => x.title),
      taches_restantes: todos.length,
      prochain_examen: nextExam ? `${nextExam.title} dans ${daysUntil(nextExam.date)} jours` : null,
    },
    fallback: `${name ? t('Salut {name} ! Ta journée en 3 lignes :', { name }) : t('Salut ! Ta journée en 3 lignes :')}\n${lines.join('\n')}`,
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
  const todosDone = useTodos.getState().todos.filter(x => x.doneAt && toKey(new Date(x.doneAt)) >= from).length;
  const sessions = useFocusLog.getState().sessions.filter(s => toKey(new Date(s.startedAt)) >= from);
  const bySubject = new Map<string, number>();
  const none = t('sans {subject}', { subject: usageWords(settings.usage).subject });
  for (const s of sessions) bySubject.set(s.subject || none, (bySubject.get(s.subject || none) ?? 0) + s.minutes);
  const focusMin = sessions.reduce((n, s) => n + s.minutes, 0);
  const top = [...bySubject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const nFrom = toKey(addDays(ws, 7));
  const nTo = toKey(addDays(ws, 13));
  const next = events.filter(e => e.date >= nFrom && e.date <= nTo);
  const nextExams = next.filter(e => big(e));
  // Discreet mode: only when there is something to act on (an exam next week, something late).
  const late = events.some(e => isDeliverable(e) && !e.done && e.date < toKey(now)) || useTodos.getState().todos.some(x => !x.done && x.due && x.due < toKey(now));
  if (settings.chattiness === 'calme' && !nextExams.length && !late) return false;
  const hours = (m: number) => (m >= 60 ? t('{h} h {min}', { h: Math.floor(m / 60), min: String(m % 60).padStart(2, '0') }) : t('{n} min', { n: m }));
  const ticked = todosDone ? tn(todosDone, '{n} tâche cochée', '{n} tâches cochées') : '';
  const doneOf = { done: tn(done, '{n} fait', '{n} faits'), planned: tn(week.length, 'sur {n} prévu', 'sur {n} prévus') };
  const nextCount = tn(next.length, '{n} événement', '{n} événements');

  const lines = [
    week.length
      ? ticked ? t('Cette semaine : {done} {planned}, plus {ticked}.', { ...doneOf, ticked }) : t('Cette semaine : {done} {planned}.', doneOf)
      : ticked ? t('Cette semaine : rien de prévu au calendrier, mais {ticked}.', { ticked }) : t('Cette semaine : rien de prévu au calendrier.'),
    focusMin
      ? top.length
        ? t('Concentration : {time} ({details}).', { time: hours(focusMin), details: top.map(([s, m]) => `${s} ${hours(m)}`).join(', ') })
        : t('Concentration : {time}.', { time: hours(focusMin) })
      : t('Concentration : aucune session focus.'),
    next.length
      ? nextExams.length
        ? t('Semaine prochaine : {events}, dont {list}.', { events: nextCount, list: nextExams.map(e => e.title).join(', ') })
        : t('Semaine prochaine : {events}.', { events: nextCount })
      : t('Semaine prochaine : rien de prévu.'),
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
    fallback: `${t('Bilan de ta semaine :')}\n${lines.join('\n')}`,
    offers: [{ label: t('Voir la semaine prochaine'), kind: 'open', payload: { to: linkToDay(nFrom) } }],
    mood: 'happy',
  });
  return true;
}

/** « arrive demain », « arrive dans 3 jours » (« c'est aujourd'hui » for a big event not in today's list). */
const inDays = (d: number) => (d <= 0 ? t('c’est aujourd’hui') : d === 1 ? t('arrive demain') : tn(d, 'arrive dans {n} jour', 'arrive dans {n} jours'));

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
  const hello = h < 5 ? t('Encore debout, {name} ?', { name }) : h < 12 ? t('Salut {name} !', { name }) : h < 18 ? t('Hey {name}.', { name }) : t('Bonsoir {name}.', { name });
  const fallback = today.length
    ? `${hello} ${t('Aujourd’hui : {list}', { list: today.map(e => e.title).slice(0, 3).join(', ') })}${today.length > 3 ? '…' : '.'}`
    : `${hello} ${nextExam ? t('Rien de prévu aujourd’hui, mais « {title} » {when}.', { title: nextExam.title, when: inDays(daysUntil(nextExam.date)) }) : t('Rien de prévu aujourd’hui.')}`;
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
