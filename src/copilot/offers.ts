// Executes the buttons Kompaly offers in its remarks ("Planifier mes révisions", …).

import { useCopilot, type CopilotOffer, type CopilotLink } from '../store/copilot';
import { useCalendar } from '../store/calendar';
import { useTodos } from '../store/todos';
import type { Note } from '../store/notes';
import { alreadyPlanned, createRevisionNote, hasRevisionPlan, planRevisions, goTo, linkToNote, linkToDay, deleteEvent, trashItems, openNoteLabel, createNote, addTodo, startFocus } from './actions';
import { fmt, fromKey, toKey, todayKey } from '../lib/dates';
import { cleanReminders, offsetLabel } from '../lib/reminders';
import { addDays } from 'date-fns';
import { getSettings } from '../store/settings';
import { t, tn } from '../i18n';

type OfferResult = { text: string; links?: CopilotLink[] };
const studying = () => (getSettings().usage ?? 'etudes') === 'etudes';

const gone = () => (studying() ? t('Je ne retrouve plus cet examen.') : t('Je ne retrouve plus cet événement.'));

/** Set by claudeBrain: makes a change the AI asked for once the student clicked (see confirm_change there). */
export const pendingChanges: { apply?: (name: string, input: Record<string, unknown>) => OfferResult } = {};

/** What the student did with buttons since the AI last spoke (it doesn't see the clicks otherwise). */
export const offerLog: string[] = [];

export function runOffer(offer: CopilotOffer): OfferResult {
  const r = run(offer);
  offerLog.push(`« ${offer.label} » → ${r.text}`);
  if (offerLog.length > 5) offerLog.shift();
  return r;
}

/** No slot left before the exam: only the revision sheet. */
function tooLate(note: Note | null): OfferResult {
  return {
    text: studying()
      ? t('Plus le temps de caler une séance avant l’examen : voici une fiche pour une dernière relecture.')
      : t('Plus le temps de bloquer un créneau avant : voici une note pour ne rien oublier.'),
    links: note ? [{ label: openNoteLabel(), to: linkToNote(note.id) }] : [],
  };
}

function run(offer: CopilotOffer): OfferResult {
  const p = offer.payload ?? {};
  switch (offer.kind) {
    case 'plan_revisions': {
      const exam = useCalendar.getState().events.find(e => e.id === p.eventId);
      if (!exam) return { text: gone() };
      if (hasRevisionPlan(exam)) return alreadyPlanned(exam);
      const res = planRevisions(exam.id, Number(p.sessions) || getSettings().revisionSessions);
      if (!res) return { text: gone() };
      if (!res.created.length) return tooLate(res.note);
      const days = res.created.map(e => fmt(fromKey(e.date), 'EEEE d')).join(', ');
      return {
        text: studying()
          ? tn(res.created.length, 'C’est calé : {n} séance de révision ({days}) et une fiche « {title} » pour t’organiser.', 'C’est calé : {n} séances de révision ({days}) et une fiche « {title} » pour t’organiser.', { days, title: res.note?.title ?? '' })
          : tn(res.created.length, 'C’est calé : {n} créneau pour préparer ({days}) et une note « {title} » pour ne rien oublier.', 'C’est calé : {n} créneaux pour préparer ({days}) et une note « {title} » pour ne rien oublier.', { days, title: res.note?.title ?? '' }),
        links: [
          { label: t('Voir le planning'), to: linkToDay(res.created[0].date) },
          ...(res.note ? [{ label: openNoteLabel(), to: linkToNote(res.note.id) }] : []),
        ],
      };
    }
    case 'revision_note': {
      const note = createRevisionNote(p.eventId);
      if (!note) return { text: studying() ? t('Je ne retrouve plus cet examen.') : t('Je ne retrouve plus cet événement.') };
      return {
        text: studying() ? t('Fiche « {title} » prête.', { title: note.title }) : t('Note « {title} » prête.', { title: note.title }),
        links: [{ label: openNoteLabel(), to: linkToNote(note.id) }],
      };
    }
    case 'mark_done': {
      const ev = useCalendar.getState().events.find(e => e.id === p.eventId);
      if (!ev) return { text: t('Introuvable, il a dû être supprimé.') };
      if (!ev.done) useCalendar.getState().toggleDone(ev.id);
      return { text: t('« {title} » coché. Un de moins !', { title: ev.title }) };
    }
    case 'open':
      goTo(p.to ?? '/');
      return { text: t('C’est ouvert.') };
    case 'confirm_change': {
      if (!pendingChanges.apply) return { text: t('Je ne peux plus le faire, redemande-le-moi.') };
      try {
        return pendingChanges.apply(p.name ?? '', JSON.parse(p.input ?? '{}') as Record<string, unknown>);
      } catch (e) {
        return { text: t('Ça n’a pas marché : {reason}', { reason: (e as Error).message }) };
      }
    }
    case 'add_todo': {
      const todo = addTodo(p.title ?? '', p.due);
      return { text: t('Tâche « {title} » ajoutée.', { title: todo.title }), links: [{ label: t('Voir mes tâches'), to: '/taches' }] };
    }
    case 'create_note': {
      const note = createNote(p.title || t('Note'), p.content ?? '');
      return { text: t('Note « {title} » prête.', { title: note.title }), links: [{ label: t('Ouvrir la note « {name} »', { name: note.title }), to: linkToNote(note.id) }] };
    }
    case 'add_reminder': {
      const ev = useCalendar.getState().events.find(e => e.id === p.eventId);
      if (!ev) return { text: t('Introuvable, il a dû être supprimé.') };
      const minutes = Number(p.minutes) || 60;
      useCalendar.getState().update(ev.id, { reminders: cleanReminders([...(ev.reminders ?? []), minutes]) });
      return { text: t('C’est noté : je te préviens {when} « {title} ».', { when: offsetLabel(minutes), title: ev.title }), links: [{ label: t('Voir le jour'), to: linkToDay(ev.date, ev.id) }] };
    }
    case 'rehearse': {
      // Two rehearsals at 18:00, the two days before (only those still to come).
      const ev = useCalendar.getState().events.find(e => e.id === p.eventId);
      if (!ev) return { text: gone() };
      const days = [2, 1].map(n => toKey(addDays(fromKey(ev.date), -n))).filter(d => d > todayKey() || (d === todayKey() && new Date().getHours() < 17));
      if (!days.length) return { text: t('Plus le temps de caler une répétition avant : bon courage pour « {title} » !', { title: ev.title }) };
      for (const date of days) useCalendar.getState().add({ title: t('Répétition — {title}', { title: ev.title }), date, start: '18:00', end: '18:45', category: 'perso' });
      return { text: tn(days.length, '{n} répétition calée avant « {title} ».', '{n} répétitions calées avant « {title} ».', { title: ev.title }), links: [{ label: t('Voir le planning'), to: linkToDay(days[0]) }] };
    }
    case 'spread_todos': {
      // The tasks without a date, two a day from tomorrow, oldest first.
      const todos = useTodos.getState().todos.filter(x => !x.done && !x.due).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      todos.forEach((x, i) => useTodos.getState().update(x.id, { due: toKey(addDays(new Date(), 1 + Math.floor(i / 2))) }));
      return { text: tn(todos.length, '{n} tâche a maintenant une date.', '{n} tâches ont maintenant une date, deux par jour à partir de demain.'), links: [{ label: t('Voir mes tâches'), to: '/taches' }] };
    }
    case 'start_focus': {
      const res = startFocus(p.subject ?? '');
      return { text: t('Session focus de {n} min lancée. Je ne te dérange plus.', { n: res.minutes }) };
    }
    case 'ack':
      return { text: p.text || t('Parfait.') };
    case 'ask':
      // Sent by the chat itself (acceptOffer): here only when there is no AI to ask.
      return { text: t('Pour ça, il me faut l’IA : elle n’est pas disponible pour le moment.') };
    case 'confirm_delete': {
      // Deletions asked to the AI only happen here, on the student's click (or « oui »).
      const ids = (p.ids ?? '').split(',').filter(Boolean);
      if (p.what === 'event') {
        const ev = deleteEvent(ids[0]);
        return ev ? { text: t('« {title} » est dans la corbeille, récupérable 30 jours.', { title: ev.title }), links: [{ label: t('Corbeille'), to: '/corbeille?type=calendrier' }] } : { text: t('Introuvable, il a déjà dû être supprimé.') };
      }
      if (p.what === 'todo') {
        const todo = useTodos.getState().todos.find(x => x.id === ids[0]);
        if (!todo) return { text: t('Introuvable, elle a déjà dû être supprimée.') };
        useTodos.getState().remove(todo.id);
        return { text: t('Tâche « {title} » supprimée.', { title: todo.title }) };
      }
      const res = trashItems(ids);
      return res.done.length ? { text: t('Mis à la corbeille : {names}. Récupérable 30 jours.', { names: res.done.join(', ') }), links: [{ label: t('Corbeille'), to: '/corbeille' }] } : { text: t('Introuvable, déjà supprimé.') };
    }
  }
}

/** Runs an offer from a button (or a "oui") and reports back in the conversation. */
export function acceptOffer(offer: CopilotOffer, rest: CopilotOffer[] = []) {
  const cop = useCopilot.getState();
  // A question for the AI: the chat opens and sends it as the student's own message.
  if (offer.kind === 'ask' && offer.payload?.prompt && cop.aiEnabled) {
    cop.askKompaly(offer.payload.prompt);
    return { text: '' };
  }
  cop.push('user', offer.label);
  const reply = runOffer(offer);
  if (useCopilot.getState().pose === 'open') cop.push('bot', reply.text, { links: reply.links, ...(rest.length && { offers: rest }) });
  else cop.say({ text: reply.text, links: reply.links, mood: 'happy', ...(rest.length && { offers: rest }) });
  return reply;
}
