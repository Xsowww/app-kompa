// What the search at the top (Ctrl+K) finds besides the student's things: the pages, the tabs of Profil and quick
// actions (« Nouvelle tâche », « Thème sombre »…); with an empty field, the results chosen lately.

import { HIT_LABEL, startFocus, updateSettings, type SearchHit } from './actions';
import { getSettings } from '../store/settings';
import { WORDS } from '../lib/usage';
import { getStorageUser } from '../lib/userStorage';
import { useNotes } from '../store/notes';
import { useDrive } from '../store/drive';
import { useCalendar } from '../store/calendar';
import { useTodos } from '../store/todos';
import { normalize } from '../lib/utils';
import { t } from '../i18n';

/** `words`: other words that find it (« réglages », « mode nuit »…). */
type Command = SearchHit & { words?: string };

function commands(): Command[] {
  const words = WORDS[getSettings().usage] ?? WORDS.etudes;
  const page = (id: string, title: string, to: string, more = ''): Command => ({ type: 'page', id, title, where: '', to, words: more });
  const tab = (key: string, title: string, more = ''): Command => ({ type: 'réglage', id: key, title, where: t('Profil'), to: `/profil?onglet=${key}`, words: `${t('réglages')} ${more}` });
  const action = (id: string, title: string, to: string, run?: () => void, more = ''): Command => ({ type: 'action', id, title, where: '', to, run, words: more });
  return [
    action('tache', t('Nouvelle tâche'), '/taches?ajout=1', undefined, t('ajouter créer à faire')),
    action('evenement', t('Nouvel événement'), '/calendrier?ajout=1', undefined, t('ajouter créer rendez-vous agenda')),
    action('note', t('Nouvelle note'), '/notes?nouvelle=1', undefined, t('ajouter créer écrire')),
    action('import', t('Importer des fichiers'), '/drive?import=1', undefined, t('ajouter envoyer drive')),
    action('cours', t('Enregistrer un cours'), '/enregistrer', undefined, t('micro transcription')),
    action('focus', t('Session focus'), '', () => void startFocus(), t('minuteur pomodoro concentration')),
    action('sombre', t('Thème sombre'), '', () => void updateSettings({ theme: 'sombre' }), t('mode nuit noir apparence')),
    action('clair', t('Thème clair'), '', () => void updateSettings({ theme: 'clair' }), t('mode jour blanc apparence')),
    page('accueil', t('Accueil'), '/'),
    page('calendrier', t('Calendrier'), '/calendrier', t('agenda')),
    page('taches', t('Tâches'), '/taches'),
    page('notes', t('Notes'), '/notes'),
    page('drive', t('Drive'), '/drive', t('fichiers')),
    page('enregistrer', t('Enregistrer'), '/enregistrer'),
    page('groupes', words.groups, '/groupes'),
    page('agendas', t('Agendas partagés'), '/agendas'),
    page('corbeille', t('Corbeille'), '/corbeille', t('supprimés')),
    page('profil', t('Profil et réglages'), '/profil', t('compte paramètres')),
    tab('apparence', t('Apparence'), t('thème couleur style')),
    tab('copilot', t('Kompaly'), t('assistant mascotte')),
    tab('etudes', words.profileTab),
    tab('notifications', t('Notifications'), t('rappels alertes')),
    tab('donnees', t('Données'), t('sauvegarde export')),
    tab('raccourcis', t('Raccourcis'), t('clavier touches')),
    tab('compte', t('Compte'), t('mot de passe e-mail déconnexion')),
  ];
}

/** The pages, settings and actions whose name (or other words) has every word typed; those it starts with first. */
export function searchCommands(query: string, limit = 5): SearchHit[] {
  const q = normalize(query);
  if (!q) return [];
  const words = q.split(/\s+/);
  return commands()
    .map(c => {
      const name = normalize(c.title);
      const all = `${name} ${normalize(c.words ?? '')} ${normalize(HIT_LABEL[c.type])}`;
      return { c, s: name.startsWith(q) ? 2 : words.every(w => all.includes(w)) ? 1 : 0 };
    })
    .filter(x => x.s)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ c: { words: _w, ...hit } }) => hit);
}

/** What shows with an empty field, besides the recent results: the quick actions most used. */
export const suggestions = () => commands().filter(c => ['tache', 'evenement', 'note'].includes(c.id) && c.type === 'action').map(({ words: _w, ...hit }) => hit);

// ── Recent results (this account, this device) ──
const key = () => `cop:${getStorageUser()}:search-recent`;
type Stored = Pick<SearchHit, 'type' | 'id' | 'title' | 'where' | 'to'>;

/** A result chosen: first of the recent ones (5 kept). Quick actions are not kept (they are always offered). */
export function rememberHit(hit: SearchHit) {
  if (hit.run || hit.type === 'action' || !getStorageUser()) return;
  const { type, id, title, where } = hit;
  // Opened on the words searched: not again next time.
  const to = hit.to.replace(/&q=[^&]*/, '');
  try {
    const list = (JSON.parse(localStorage.getItem(key()) ?? '[]') as Stored[]).filter(h => !(h.type === type && h.id === id));
    localStorage.setItem(key(), JSON.stringify([{ type, id, title, where, to }, ...list].slice(0, 5)));
  } catch {
    /* private browsing: no recent results */
  }
}

/** The recent results still there (a note deleted since is left out), with their current name. */
export function recentHits(): SearchHit[] {
  let list: Stored[] = [];
  try {
    list = getStorageUser() ? JSON.parse(localStorage.getItem(key()) ?? '[]') : [];
  } catch {
    return [];
  }
  const notes = useNotes.getState().notes;
  const items = useDrive.getState().items;
  const events = useCalendar.getState().events;
  const todos = useTodos.getState().todos;
  return list.flatMap(h => {
    const now =
      h.type === 'note' ? notes.find(n => n.id === h.id)?.title
      : h.type === 'fichier' || h.type === 'dossier' ? items.find(i => i.id === h.id)?.name
      : h.type === 'événement' ? events.find(e => e.id === h.id)?.title
      : h.type === 'tâche' ? todos.find(x => x.id === h.id && !x.done)?.title
      : h.title;
    return now ? [{ ...h, title: now }] : [];
  });
}
