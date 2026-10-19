// Executes the buttons Kompaly offers in its remarks ("Planifier mes révisions", …).

import { useCopilot, type CopilotOffer, type CopilotLink } from '../store/copilot';
import { useCalendar } from '../store/calendar';
import { useTodos } from '../store/todos';
import type { Note } from '../store/notes';
import { alreadyPlanned, createRevisionNote, hasRevisionPlan, planRevisions, goTo, linkToNote, linkToDay, deleteEvent, trashItems, openNoteLabel } from './actions';
import { fmt, fromKey } from '../lib/dates';
import { getSettings } from '../store/settings';
import { t, tn } from '../i18n';

type OfferResult = { text: string; links?: CopilotLink[] };
const studying = () => (getSettings().usage ?? 'etudes') === 'etudes';

const gone = () => (studying() ? t('Je ne retrouve plus cet examen.') : t('Je ne retrouve plus cet événement.'));

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
export function acceptOffer(offer: CopilotOffer) {
  const cop = useCopilot.getState();
  cop.push('user', offer.label);
  const reply = runOffer(offer);
  if (useCopilot.getState().pose === 'open') cop.push('bot', reply.text, { links: reply.links });
  else cop.say({ text: reply.text, links: reply.links, mood: 'happy' });
  return reply;
}
