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
import { useAgendaNews } from '../store/agendaNews';
import { normalize } from '../lib/utils';
import { eventKind, birthdayOf, hasAddress, overlapping, looksRecurring, hasActionItems, isGroupProject } from './initiatives';

/** minimum delay between two spontaneous remarks, depending on the student's preference */
const MIN_GAP = { calme: 20 * 60_000, normal: 5 * 60_000, bavard: 2 * 60_000 };
/** At most this many remarks a day (the greeting, the morning brief and answers to what was just done still come). */
export const DAILY_CAP = { calme: 3, normal: 6, bavard: 10 };
/** Nothing unasked for at night (22:00 – 7:00). */
const quiet = (now: Date) => now.getHours() >= 22 || now.getHours() < 7;
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

/** Remarks made today (the memory keeps the last time of each). */
export const saidToday = (memory: Record<string, number>, now = new Date()) => {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Object.values(memory).filter(at => at >= start && at <= now.getTime()).length;
};

function canSpeak(n: Nudge, now = new Date()) {
  const s = useCopilot.getState();
  const settings = getSettings();
  if (s.thinking || !settings.copilotVisible) return false;
  // Never break a focus session (the end-of-session message comes from the timer itself).
  if (useFocus.getState().phase === 'focus') return false;
  const allowed = n.kind === 'brief' ? settings.morningBrief : n.kind === 'review' ? settings.weeklyReview : settings.proactive;
  if (!allowed) return false;
  const last = s.memory[n.key];
  if (last && Date.now() - last < n.every) return false;
  if (n.urgent) return true;
  if (quiet(now) || saidToday(s.memory, now) >= DAILY_CAP[settings.chattiness]) return false;
  return now.getTime() - lastNudge >= MIN_GAP[settings.chattiness];
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
    useCopilot.getState().say({ text, offers: n.offers, links: n.links, mood: n.mood ?? (n.offers ? 'alert' : 'happy'), brief: n.kind === 'brief' || undefined });
    // Out of the app (another tab): only a suggestion to act on, never a greeting, a bravo or a summary.
    if (getSettings().copilotNotify && n.offers?.length && !n.kind) notify('Kompaly', text.length > 160 ? `${text.slice(0, 159)}…` : text);
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

/** A button that asks the AI (only when there is one: the simple mode couldn't answer it). */
const ask = (label: string, prompt: string): CopilotOffer[] => (useCopilot.getState().aiEnabled ? [{ label, kind: 'ask', payload: { prompt } }] : []);
const atTime = (e: CalendarEvent) => (e.start ? t(' à {time}', { time: e.start.replace(':', 'h') }) : '');

// ── Reactions to what the student does ──────────────────────────────────────

/** An ordinary event just added (not a big day): a clash, a rehearsal to plan, when to leave, a habit to repeat. */
function onOrdinaryEventAdded(e: CalendarEvent) {
  if (hasStarted(e) || /^r[ée]p[ée]tition\b/i.test(e.title)) return;
  const events = useCalendar.getState().events;
  const d = daysUntil(e.date);
  const clash = overlapping(e, events);
  if (clash.length) {
    void nudge({
      key: `overlap:${e.id}`,
      every: 365 * DAY,
      urgent: true,
      situation: { evenement: "l'utilisateur vient d'ajouter un événement qui tombe en même temps qu'un autre", ajoute: e.title, deja_prevu: clash.map(o => `${o.title} à ${o.start}`), quand: when(e) },
      fallback: t('« {title} » tombe en même temps que « {other} », {when}.', { title: e.title, other: clash[0].title, when: when(e) }),
      links: [{ label: t('Voir le jour'), to: linkToDay(e.date, e.id) }],
      mood: 'alert',
    });
    return;
  }
  if (eventKind(e) === 'presentation' && d >= 2) {
    void nudge({
      key: `rehearse:${e.id}`,
      every: 365 * DAY,
      urgent: true,
      situation: { evenement: "l'utilisateur vient d'ajouter une présentation ou un oral", titre: e.title, quand: when(e), jours_restants: d },
      fallback: t('« {title} » {when}. Je te cale deux répétitions avant ?', { title: e.title, when: inDays(d) }),
      offers: [{ label: t('Caler deux répétitions'), kind: 'rehearse', payload: { eventId: e.id } }],
    });
    return;
  }
  if (hasAddress(e) && e.start && !(e.reminders ?? []).some(m => m >= 45)) {
    void nudge({
      key: `leave:${e.id}`,
      every: 365 * DAY,
      urgent: true,
      situation: { evenement: "l'utilisateur vient d'ajouter un rendez-vous à une adresse : demande-lui s'il veut être prévenu à l'heure de partir", titre: e.title, quand: when(e) },
      fallback: t('« {title} » {when} : je te préviens à l’heure de partir ?', { title: e.title, when: when(e) }),
      offers: [
        { label: t('Me prévenir 1 h avant'), kind: 'add_reminder', payload: { eventId: e.id, minutes: '60' } },
        { label: t('Me prévenir 30 min avant'), kind: 'add_reminder', payload: { eventId: e.id, minutes: '30' } },
      ],
    });
    return;
  }
  if (looksRecurring(e, events)) {
    void nudge({
      key: `recurring:${normalize(e.title)}`,
      every: 90 * DAY,
      urgent: true,
      situation: { evenement: "l'utilisateur ajoute à la main, chaque semaine, le même événement au même horaire : propose d'en faire un événement qui se répète", titre: e.title },
      fallback: t('« {title} » revient chaque semaine à la même heure : tu veux qu’il se répète tout seul ?', { title: e.title }),
      links: [{ label: t('Ouvrir pour le répéter'), to: linkToDay(e.date, e.id) }],
    });
  }
}


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
    return;
  }
  if (isDeliverable(e) && daysUntil(e.date) <= 1 && !isOver(e)) {
    void nudge({
      key: `hw-added:${e.id}`,
      every: 365 * DAY,
      situation: { evenement: "l'étudiant ajoute un devoir à rendre très bientôt", devoir: e.title, quand: when(e) },
      fallback: daysUntil(e.date) === 0 ? t('« {title} » pour aujourd’hui. Courage !', { title: e.title }) : t('« {title} » pour demain. Courage !', { title: e.title }),
    });
    return;
  }
  onOrdinaryEventAdded(e);
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

function onFilesUploaded(count: number, added: { id: string; name: string }[]) {
  const files = useDrive.getState().items.filter(i => i.kind === 'file');
  const pdf = added.length <= 3 ? added.find(f => /\.pdf$/i.test(f.name)) : undefined;
  if (files.length !== count && pdf && useCopilot.getState().aiEnabled) {
    void nudge({
      key: `pdf:${pdf.id}`,
      every: 365 * DAY,
      urgent: true,
      situation: { evenement: "l'utilisateur vient d'ajouter un PDF dans son Drive : propose d'en faire une fiche ou un quiz (ou un résumé hors études)", fichier: pdf.name },
      fallback: studying() ? t('« {name} » est dans ton Drive. Je t’en fais une fiche ou un quiz ?', { name: pdf.name }) : t('« {name} » est dans ton Drive. Je t’en fais un résumé ?', { name: pdf.name }),
      offers: studying()
        ? [
            ...ask(t('Faire une fiche'), t('Lis le fichier « {name} » de mon Drive et fais-en une fiche de révision claire dans mes notes.', { name: pdf.name })),
            ...ask(t('Faire un quiz'), t('Lis le fichier « {name} » de mon Drive et crée une note avec un quiz de 10 questions pour le réviser.', { name: pdf.name })),
          ]
        : ask(t('Faire un résumé'), t('Lis le fichier « {name} » de mon Drive et fais-en un résumé en points clés dans mes notes.', { name: pdf.name })),
    });
    return;
  }
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
  out.push(...otherNudges(now, events));
  return out;
}

/** Birthdays, meetings, appointments, trips, a full day, tasks left waiting, the Drive and notes, group work. */
function otherNudges(now: Date, events: CalendarEvent[]): Nudge[] {
  const out: Nudge[] = [];
  const today = toKey(now);
  const tomorrow = toKey(addDays(now, 1));
  const h = now.getHours();
  const ahead = events.filter(e => !e.done && !e.deletedAt && e.date >= today);
  const todos = useTodos.getState().todos;
  const taskTitles = [...todos.map(x => normalize(x.title)), ...events.map(e => normalize(e.title))];

  // 1. A birthday in the next days, and no gift in the tasks or the calendar
  for (const b of ahead.filter(e => eventKind(e) === 'anniversaire' && daysUntil(e.date) >= 1 && daysUntil(e.date) <= 5)) {
    const who = birthdayOf(b.title);
    if (taskTitles.some(x => /cadeau/.test(x) && (!who || x.includes(normalize(who))))) continue;
    const eve = toKey(addDays(fromKey(b.date), -1));
    out.push({
      key: `gift:${b.id}`,
      every: 365 * DAY,
      situation: { evenement: 'un anniversaire approche : demande gentiment si le cadeau est trouvé', anniversaire: b.title, quand: when(b) },
      fallback: who ? t('L’anniversaire de {who} {when}. Tu as trouvé un cadeau ?', { who, when: inDays(daysUntil(b.date)) }) : t('« {title} » {when}. Tu as pensé au cadeau ?', { title: b.title, when: inDays(daysUntil(b.date)) }),
      offers: [
        { label: t('Ajouter « acheter un cadeau »'), kind: 'add_todo', payload: { title: who ? t('Acheter un cadeau pour {who}', { who }) : t('Acheter un cadeau ({title})', { title: b.title }), due: eve > today ? eve : today } },
        { label: t('C’est déjà fait'), kind: 'ack', payload: { text: t('Parfait, une chose de moins !') } },
      ],
    });
  }

  // 2. A meeting tomorrow: an agenda to prepare
  const meeting = ahead.find(e => e.date === tomorrow && eventKind(e) === 'reunion');
  if (meeting && h >= 14) {
    out.push({
      key: `agenda-note:${meeting.id}`,
      every: 365 * DAY,
      situation: { evenement: 'réunion demain : propose de préparer un ordre du jour', reunion: meeting.title, quand: when(meeting) },
      fallback: t('Demain{time}, « {title} ». Je te prépare une note pour l’ordre du jour ?', { title: meeting.title, time: atTime(meeting) }),
      offers: [{ label: t('Préparer l’ordre du jour'), kind: 'create_note', payload: { title: t('Ordre du jour — {title}', { title: meeting.title }), content: t('Objectif :\n\nPoints à aborder :\n- \n- \n\nQuestions à poser :\n- \n\nDécisions et suites :\n- ') } }],
    });
  }

  // 4. A medical appointment tomorrow: the papers to bring
  const medical = ahead.find(e => e.date === tomorrow && eventKind(e) === 'medical');
  if (medical && h >= 17) {
    out.push({
      key: `medical:${medical.id}`,
      every: 365 * DAY,
      situation: { evenement: 'rendez-vous médical demain : rappelle la carte Vitale et les papiers', rendez_vous: medical.title, quand: when(medical) },
      fallback: t('Demain{time}, « {title} ». Pense à ta carte Vitale et à ta mutuelle.', { title: medical.title, time: atTime(medical) }),
      mood: 'happy',
    });
  }

  // 5. A trip in the next days: what to pack, the tickets
  const trip = ahead.find(e => eventKind(e) === 'voyage' && daysUntil(e.date) >= 1 && daysUntil(e.date) <= 4);
  if (trip) {
    out.push({
      key: `trip:${trip.id}`,
      every: 365 * DAY,
      situation: { evenement: 'un voyage ou un déplacement approche : propose une liste de choses à emporter et de vérifier les billets', voyage: trip.title, quand: when(trip) },
      fallback: t('« {title} » {when}. Je te fais une liste de choses à emporter ?', { title: trip.title, when: inDays(daysUntil(trip.date)) }),
      offers: [
        { label: t('Faire la liste à emporter'), kind: 'create_note', payload: { title: t('À emporter — {title}', { title: trip.title }), content: t('Papiers :\n- Pièce d’identité\n- Billets et réservations\n- Carte bancaire\n\nAffaires :\n- Chargeur de téléphone\n- Vêtements\n- Trousse de toilette\n- Médicaments\n\nAvant de partir :\n- Vérifier l’horaire de départ\n- ') } },
        ...ask(t('Vérifier mes billets'), t('Est-ce que j’ai mes billets ou mes réservations pour « {title} » dans mon Drive ?', { title: trip.title })),
      ],
    });
  }

  // 9. Tomorrow is full
  const full = ahead.filter(e => e.date === tomorrow);
  if (full.length >= 5 && h >= 17) {
    out.push({
      key: `busy:${tomorrow}`,
      every: DAY,
      situation: { evenement: 'la journée de demain est très chargée', nombre: full.length, demain: full.map(e => `${e.title}${e.start ? ` ${e.start}` : ''}`) },
      fallback: tn(full.length, 'Demain, {n} chose prévue.', 'Demain, {n} choses prévues : grosse journée. On regarde ce qu’on peut alléger ?'),
      offers: ask(t('Alléger ma journée'), t('Ma journée de demain est chargée : propose-moi ce que je peux décaler ou faire avant.')),
      links: [{ label: t('Voir demain'), to: linkToDay(tomorrow) }],
    });
  }

  // 10. A task waiting for more than a week
  const stale = todos.filter(x => !x.done && (!x.due || x.due < today) && now.getTime() - new Date(x.createdAt).getTime() > 7 * DAY).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (stale) {
    out.push({
      key: `stale:${stale.id}`,
      every: 7 * DAY,
      situation: { evenement: 'une tâche attend depuis plus d’une semaine : propose de la découper en petites étapes', tache: stale.title },
      fallback: t('« {title} » attend depuis plus d’une semaine. On la découpe en petites étapes ?', { title: stale.title }),
      offers: ask(t('Découper en étapes'), t('Découpe la tâche « {title} » en 3 petites étapes et ajoute-les à mes tâches.', { title: stale.title })),
      links: [{ label: t('Voir mes tâches'), to: '/taches' }],
    });
  }

  // 11. Many tasks without a date
  const undated = todos.filter(x => !x.done && !x.due);
  if (undated.length >= 5) {
    out.push({
      key: `spread:${toKey(weekStart(now))}`,
      every: 7 * DAY,
      situation: { evenement: 'beaucoup de tâches sans date : propose de les répartir sur les prochains jours', nombre: undated.length },
      fallback: t('{n} tâches n’ont pas de date. Je les répartis sur les prochains jours ?', { n: undated.length }),
      offers: [{ label: t('Les répartir'), kind: 'spread_todos' }],
    });
  }

  // 13. A big day this week and no focus session for three days
  const soon = ahead.filter(e => big(e) && daysUntil(e.date) >= 1 && daysUntil(e.date) <= 7).sort(sortEvents)[0];
  const lastFocus = Math.max(0, ...useFocusLog.getState().sessions.map(x => new Date(x.startedAt).getTime()));
  if (soon && h >= 9 && h < 20 && now.getTime() - lastFocus > 3 * DAY) {
    out.push({
      key: `focus-nudge:${today}`,
      every: 2 * DAY,
      situation: { evenement: 'un grand jour approche et aucune session focus depuis plusieurs jours : propose d’en lancer une', titre: soon.title, jours_restants: daysUntil(soon.date) },
      fallback: t('« {title} » {when}. Une session focus de {n} min maintenant ?', { title: soon.title, when: inDays(daysUntil(soon.date)), n: getSettings().focusMinutes }),
      offers: [{ label: t('Lancer une session focus'), kind: 'start_focus', payload: { subject: soon.title } }],
    });
  }

  // 16. Loose files at the root of the Drive
  const loose = useDrive.getState().items.filter(i => i.kind === 'file' && !i.parentId);
  if (loose.length >= 10 && useCopilot.getState().aiEnabled) {
    out.push({
      key: 'tidy-drive',
      every: 30 * DAY,
      situation: { evenement: 'beaucoup de fichiers en vrac à la racine du Drive : propose de les ranger', nombre: loose.length },
      fallback: t('{n} fichiers sont en vrac à la racine de ton Drive. Je les range dans des dossiers ?', { n: loose.length }),
      offers: ask(t('Ranger mon Drive'), t('Range les fichiers à la racine de mon Drive dans des dossiers par thème (crée les dossiers qu’il faut).')),
    });
  }

  // 17. A recent note with things to do in it
  const actions = useNotes.getState().notes.find(n => now.getTime() - new Date(n.updatedAt ?? n.createdAt).getTime() < 2 * DAY && hasActionItems(n.content));
  if (actions && useCopilot.getState().aiEnabled) {
    out.push({
      key: `note-actions:${actions.id}`,
      every: 30 * DAY,
      situation: { evenement: 'une note récente contient des choses à faire : propose d’en faire des tâches', note: actions.title },
      fallback: t('Ta note « {title} » contient des choses à faire. J’en fais des tâches ?', { title: actions.title }),
      offers: ask(t('En faire des tâches'), t('Lis la note « {title} » et ajoute à mes tâches les choses à faire qu’elle contient.', { title: actions.title })),
    });
  }

  // 19. A group project coming: share out the work
  const project = ahead.find(e => isGroupProject(e.title) && daysUntil(e.date) >= 2 && daysUntil(e.date) <= 10);
  if (project && useCopilot.getState().aiEnabled) {
    out.push({
      key: `group-split:${project.id}`,
      every: 365 * DAY,
      situation: { evenement: 'un projet de groupe approche : propose de répartir le travail', projet: project.title, quand: when(project) },
      fallback: t('« {title} » {when}. On répartit le travail du groupe ?', { title: project.title, when: inDays(daysUntil(project.date)) }),
      offers: ask(t('Répartir le travail'), t('Pour « {title} », crée une note qui répartit le travail entre les membres du groupe, avec une étape et une date pour chacun.', { title: project.title })),
    });
  }
  return out;
}

/** The remark the periodic look makes now: the first of the list Kompaly may make (tested in tests/proactive.test.ts). */
export const nextNudge = (now = new Date()) => periodicNudges(now).find(n => canSpeak(n, now));

function periodicCheck() {
  if (weeklyReview()) return;
  const next = nextNudge();
  if (next) void nudge(next);
}

// ── Morning brief & Sunday review ───────────────────────────────────────────

/** Phones and tablets: the brief would cover the page being used (a note being written); it waits for the home page
 *  (in the browser session, like the greeting: a reload of the page does not lose it). */
const BRIEF_WAITING = 'cop:brief-waiting';

/** The home page is on screen: the morning brief kept for it comes now (called by Copilot). */
export function homeVisited() {
  if (!sessionStorage.getItem(BRIEF_WAITING)) return;
  sessionStorage.removeItem(BRIEF_WAITING);
  morningBrief();
}

/** « Ta journée en 3 lignes », on the first opening of the day before noon. Returns true if shown (or kept for the home page). */
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
  // Not used up: it stays due until the home page shows it.
  if (typeof location !== 'undefined' && location.pathname !== '/' && matchMedia('(max-width: 1023px)').matches) {
    sessionStorage.setItem(BRIEF_WAITING, '1');
    return true;
  }

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
      if (added > 0) {
        const before = new Set(prev.items.map(i => i.id));
        onFilesUploaded(added, s.items.filter(i => i.kind === 'file' && !before.has(i.id)).map(i => ({ id: i.id, name: i.name })));
      }
    }),
    // 18. Something new in a shared calendar (added by the others)
    useAgendaNews.subscribe((s, prev) => {
      const sum = (n: Record<string, number>) => Object.values(n).reduce((a, b) => a + b, 0);
      if (sum(s.news) <= sum(prev.news)) return;
      void nudge({
        key: `agenda-news:${todayKey()}`,
        every: 6 * HOUR,
        situation: { evenement: 'quelqu’un a ajouté ou changé quelque chose dans un agenda partagé de l’utilisateur', nouveautes: sum(s.news) },
        fallback: t('Du nouveau dans un de tes agendas partagés.'),
        links: [{ label: t('Voir les agendas partagés'), to: '/agendas' }],
      });
    }),
  ];
  // 15. A recording just finished: the dates and tasks said in it
  void import('../store/recorder').then(({ useRecorder }) =>
    unsubs.push(
      useRecorder.subscribe((s, prev) => {
        const done = s.history[0];
        if (!done || prev.history[0]?.id === done.id || !useCopilot.getState().aiEnabled) return;
        void nudge({
          key: `rec:${done.id}`,
          every: 365 * DAY,
          urgent: true,
          situation: { evenement: 'un enregistrement vient d’être rangé dans le Drive : propose d’ajouter les dates et tâches qui y sont mentionnées', titre: done.title },
          fallback: t('« {title} » est rangé. J’ajoute à ton agenda les dates et les tâches qui y sont mentionnées ?', { title: done.title }),
          offers: ask(t('Ajouter dates et tâches'), t('Lis le document de l’enregistrement « {title} » dans mon Drive et ajoute à mon agenda et à mes tâches ce qui y est prévu (dates, choses à faire).', { title: done.title })),
        });
      }),
    ),
  );
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
