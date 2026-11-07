// Executes the buttons Kompaly offers in its remarks ("Planifier mes révisions", …).

import { useCopilot, type CopilotOffer, type CopilotLink } from '../store/copilot';
import { useCalendar } from '../store/calendar';
import { useTodos } from '../store/todos';
import type { Note } from '../store/notes';
import { alreadyPlanned, createRevisionNote, hasRevisionPlan, planRevisions, goTo, linkToNote, linkToDay, deleteEvent, trashItems, openNoteLabel, createNote, addTodo, startFocus, restoreFromTrash } from './actions';
import { fmt, fromKey, toKey, todayKey } from '../lib/dates';
import { cleanReminders, offsetLabel } from '../lib/reminders';
import { addDays } from 'date-fns';
import { getSettings } from '../store/settings';
import { t, tn } from '../i18n';

type OfferResult = { text: string; links?: CopilotLink[]; offers?: CopilotOffer[] };

/** « Annuler » after a deletion: puts these back from the trash. */
const undo = (ids: string[]): CopilotOffer[] => [{ label: t('Annuler'), kind: 'undo_trash', payload: { ids: ids.join(',') } }];
const studying = () => (getSettings().usage ?? 'etudes') === 'etudes';

const gone = () => (studying() ? t('Je ne retrouve plus cet examen.') : t('Je ne retrouve plus cet événement.'));

/** Set by claudeBrain: makes a change the AI asked for once the student clicked (see confirm_change there). */
export const pendingChanges: { apply?: (name: string, input: Record<string, unknown>) => OfferResult } = {};

/**
 * Buttons whose work waits for a server (saving checked, a shared calendar, a photo's slots): set by the modules that
 * know how (claudeBrain, photoSlots). From a click or a « oui », acceptOffer runs them and says the outcome after.
 */
export const asyncOffers: Partial<Record<CopilotOffer['kind'], (payload: Record<string, string>) => Promise<OfferResult>>> = {};
export const isAsyncOffer = (o: CopilotOffer) => !!asyncOffers[o.kind];

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
    case 'mark_done':
      // Events are no longer ticked (only tasks): an offer left in an older conversation only says OK.
      return { text: t('Parfait.') };
    case 'open':
      goTo(p.to ?? '/');
      return { text: t('C’est ouvert.') };
    case 'confirm_change': {
      if (!pendingChanges.apply) return { text: t('Je ne peux plus le faire, redemande-le-moi.') };
      try {
        // Several changes asked together (offerMerge): one click applies them all.
        if (p.name === 'batch') {
          const list = JSON.parse(p.input ?? '[]') as { name: string; input: Record<string, unknown> }[];
          const res = list.map(c => pendingChanges.apply!(c.name, c.input));
          const failed = res.filter(r => r.text !== t('C’est fait.'));
          return {
            text: failed.length ? `${tn(list.length - failed.length, '{n} changement fait.', '{n} changements faits.')} ${failed.map(r => r.text).join(' ')}` : tn(list.length, 'C’est fait.', 'C’est fait : {n} changements.'),
            links: res.flatMap(r => r.links ?? []).filter((l, i, a) => a.findIndex(x => x.to === l.to) === i).slice(0, 3),
          };
        }
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
      return { text: t('Séance de concentration de {n} min lancée. Je ne te dérange plus.', { n: res.minutes }) };
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
        const gone = ids.map(deleteEvent).filter(e => e !== null);
        if (!gone.length) return { text: t('Introuvable, il a déjà dû être supprimé.') };
        return {
          text: gone.length === 1 ? t('« {title} » est dans la corbeille, récupérable 30 jours.', { title: gone[0].title }) : tn(gone.length, '{n} événement mis à la corbeille, récupérable 30 jours.', '{n} événements mis à la corbeille, récupérables 30 jours.'),
          offers: undo(gone.map(e => e.id)),
        };
      }
      if (p.what === 'todo') {
        const todos = useTodos.getState().todos.filter(x => ids.includes(x.id) && !x.deletedAt);
        if (!todos.length) return { text: t('Introuvable, elle a déjà dû être supprimée.') };
        todos.forEach(x => useTodos.getState().remove(x.id));
        return {
          text: todos.length === 1 ? t('« {title} » est dans la corbeille, récupérable 30 jours.', { title: todos[0].title }) : tn(todos.length, '{n} tâche mise à la corbeille, récupérable 30 jours.', '{n} tâches mises à la corbeille, récupérables 30 jours.'),
          offers: undo(todos.map(x => x.id)),
        };
      }
      const res = trashItems(ids);
      return res.done.length ? { text: t('Mis à la corbeille : {names}. Récupérable 30 jours.', { names: res.done.join(', ') }), offers: undo(ids) } : { text: t('Introuvable, déjà supprimé.') };
    }
    case 'undo_trash': {
      const res = restoreFromTrash((p.ids ?? '').split(',').filter(Boolean));
      return res.restored.length ? { text: tn(res.restored.length, 'Annulé : {n} élément remis à sa place.', 'Annulé : {n} éléments remis à leur place.') } : { text: t('Déjà remis à sa place.') };
    }
    default:
      // A button that needs a server (asyncOffers), reached without it: never a silent « done ».
      return { text: t('Je ne peux plus le faire, redemande-le-moi.') };
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
  const answer = (reply: OfferResult) => {
    const offers = [...(reply.offers ?? []), ...rest];
    if (useCopilot.getState().pose === 'open') useCopilot.getState().push('bot', reply.text, { links: reply.links, ...(offers.length && { offers }) });
    else useCopilot.getState().say({ text: reply.text, links: reply.links, mood: 'happy', ...(offers.length && { offers }) });
  };
  const slow = asyncOffers[offer.kind];
  if (slow) {
    // The outcome once the server answered (« dots » meanwhile): what is said is what was saved.
    cop.setThinking(true);
    void slow(offer.payload ?? {})
      .catch((e: unknown): OfferResult => ({ text: t('Ça n’a pas marché : {reason}', { reason: (e as Error)?.message ?? String(e) }) }))
      .then(reply => {
        useCopilot.getState().setThinking(false);
        offerLog.push(`« ${offer.label} » → ${reply.text}`);
        if (offerLog.length > 5) offerLog.shift();
        answer(reply);
      });
    return { text: '' };
  }
  const reply = runOffer(offer);
  answer(reply);
  return reply;
}
