// Built-in French command engine: works offline, no API key needed (the simple requests of the other site languages are rewritten in French first).

import { recWords } from '../pages/record/words';
import { normalize } from '../lib/utils';
import { parseQuickAdd, todayKey, daysUntil, fmt, fromKey } from '../lib/dates';
import { useCalendar, isBigEvent } from '../store/calendar';
import { buildQuiz, checkAnswer, type Quiz } from './quiz';
import {
  addTodo, listTodos, completeTodo, deleteTodo, listTrash, findInTrash, restoreFromTrash, trashItems, deleteEvent, renameItem, moveItem,
  itemName, linkToItem, HIT_LABEL, setStar, setFolderColor, searchNotes, findNote, startFocus, stopFocus, updateSettings,
} from './actions';
import type { CopilotLink, CopilotOffer } from '../store/copilot';
import {
  search,
  calendarReport,
  createNote,
  createDriveFolder,
  addEvent,
  eventsBetween,
  describeEvent,
  linkToNote,
  linkToDriveFolder,
  linkToDay,
  listDriveFolder,
  overview,
} from './actions';
import { useNotes } from '../store/notes';
import { useCopilot } from '../store/copilot';
import { runOffer } from './offers';
import { alreadyPlanned, eventNamed, examLabel, findExam, hasRevisionPlan, planRevisions, openNoteLabel } from './actions';
import { subjectStart } from './revisionPlan';
import { askedDay, askedPeriod } from './dayQuestion';
import { getSettings } from '../store/settings';
import { WORDS, groupWords, type Usage } from '../lib/usage';
import { lang, t, tn } from '../i18n';

export interface BotReply {
  text: string;
  links?: CopilotLink[];
  offers?: CopilotOffer[];
  /** Not understood: the simple mode only knows a few requests. */
  unknown?: boolean;
}

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

const words = () => WORDS[getSettings().usage] ?? WORDS.etudes;

const unquote = (s: string) => s.trim().replace(/^["'«“]\s*|\s*["'»”]$/g, '').trim();

// ── Things waiting for the student's next message ───────────────────────────

/** A destructive action announced and waiting for « oui ». */
let pendingConfirm: { run: () => BotReply } | null = null;
let quiz: Quiz | null = null;

// « Nouvelle conversation » (or any cleared history): a quiz or a question no longer on screen is dropped.
useCopilot.subscribe((s, prev) => {
  if (!s.messages.length && prev.messages.length) {
    pendingConfirm = null;
    quiz = null;
  }
});

const ask = (text: string, run: () => BotReply): BotReply => {
  pendingConfirm = { run };
  return { text: t('{question} (oui / non)', { question: text }) };
};

// French first; the other site languages too (en, es, de, it), the confirmations being shown translated.
const YES = /^(oui|ouais|ouep|ok|okay|vas[- ]y|go|carrement|d'accord|dac|yes|yeah|yep|sure|si|vale|claro|dale|ja|klar|gerne|jawohl|certo|va bene|confirme|je confirme|c'est bon)\b/;
/** A clear « yes »: a short answer, not a question that happens to start with « si » or « ok ». */
const isYes = (q: string) => YES.test(q) && !q.includes('?') && q.split(/\s+/).length <= 4 && !/^si\s+\S/.test(q);
const NO = /^(non|nan|annule|laisse|nope|non merci|pas maintenant|surtout pas|no|cancel|nein|lieber nicht|cancela|annulla)\b/;

function quizQuestion(z: Quiz) {
  return t('**Question {index}/{total}.** {question}', { index: z.index + 1, total: z.questions.length, question: z.questions[z.index].q });
}

function quizStep(input: string, q: string): BotReply {
  const z = quiz!;
  const cur = z.questions[z.index];
  if (/^(stop|arrete|fin|termine|j'arrete|on arrete)\b/.test(q)) {
    quiz = null;
    return { text: t('Quiz arrêté. Score : {score}/{total}.', { score: z.score, total: z.index }), links: [{ label: t('Revoir « {title} »', { title: z.title }), to: linkToNote(z.noteId) }] };
  }
  let feedback: string;
  if (/^(passe|je sais pas|je ne sais pas|aucune idee|joker|\?+)$/.test(q)) feedback = t('La réponse : {answer}', { answer: cur.answer });
  else {
    const verdict = checkAnswer(cur, input);
    if (verdict === 'good') {
      z.score++;
      feedback = pick([t('Bien vu !'), t('Exact.'), t('Parfait, c’est ça.'), t('Yes, bonne réponse.')]) + (cur.mode === 'keywords' ? ` ${t('Pour compléter : {answer}', { answer: cur.answer })}` : '');
    } else if (verdict === 'partial') {
      z.score += 0.5;
      feedback = t('En partie. Ce qu’il fallait dire : {answer}', { answer: cur.answer });
    } else feedback = t('Pas tout à fait. La réponse : {answer}', { answer: cur.answer });
  }
  z.index++;
  if (z.index < z.questions.length) return { text: `${feedback}\n\n${quizQuestion(z)}` };
  quiz = null;
  const total = z.questions.length;
  const verdict = z.score >= total * 0.8 ? t('Tu maîtrises.') : z.score >= total * 0.5 ? t('Pas mal, relis la note une fois.') : t('Relis la note, puis on recommence.');
  return { text: `${feedback}\n\n${t('**Score : {score}/{total}.** {verdict}', { score: z.score, total, verdict })}`, links: [{ label: t('Ouvrir « {title} »', { title: z.title }), to: linkToNote(z.noteId) }] };
}

const COLOR_WORDS: Record<string, string> = { bleu: 'bleu', rouge: 'rouge', orange: 'orange', jaune: 'jaune', vert: 'vert', violet: 'violet', rose: 'rose', gris: 'gris' };
/** The colour named back in the answer (« Le dossier Maths est maintenant bleu »). */
const COLOR_NAMES: Record<string, string> = { bleu: t('bleu'), rouge: t('rouge'), orange: t('orange'), jaune: t('jaune'), vert: t('vert'), violet: t('violet'), rose: t('rose'), gris: t('gris') };
const ACCENT_WORDS: Record<string, string> = { orange: 'orange', bleu: 'bleu', bleue: 'bleu', vert: 'vert', verte: 'vert', violet: 'violet', violette: 'violet', rose: 'rose', framboise: 'rose', encre: 'encre', noir: 'encre', noire: 'encre' };

/** Commands added for the to-dos, the trash, the Drive organisation, focus, settings and quizzes. */
function moreCommands(input: string, q: string): BotReply | null {
  // `q` is normalize(input) kept to the same length (see localReply), so indices found in `q` cut the original text.
  const grab = (re: RegExp) => {
    const m = re.exec(q);
    if (!m) return null;
    const ix = (m as RegExpExecArray & { indices?: [number, number][] }).indices;
    return (i: number) => (ix?.[i] ? unquote(input.slice(ix[i][0], ix[i][1])) : '');
  };

  // ── Quiz ──
  let g = grab(/^(?:interroge|questionne|teste|quizz?)[- ]?(?:moi)?\s+(?:sur|en)\s+(?:la note\s+|ma note\s+|le cours\s+(?:de\s+)?)?(.+?)\s*\??$/d);
  if (g) {
    const term = g(1);
    const note = findNote(term) ?? (() => {
      const hit = search(term).find(h => h.type === 'note');
      return hit ? findNote(hit.id) : undefined;
    })();
    if (!note) return { text: t('Je ne trouve pas de note « {term} ». Donne-moi le titre exact ?', { term }) };
    const z = buildQuiz(note);
    if (!z) return { text: t('« {title} » manque de structure pour un quiz : ajoute des titres, des listes « terme : définition » ou des mots en gras.', { title: note.title }), links: [{ label: t('Ouvrir la note'), to: linkToNote(note.id) }] };
    quiz = z;
    return { text: `${tn(z.questions.length, 'C’est parti : {n} question sur « {title} ». « passe » pour voir la réponse, « stop » pour arrêter.', 'C’est parti : {n} questions sur « {title} ». « passe » pour voir la réponse, « stop » pour arrêter.', { title: note.title })}\n\n${quizQuestion(z)}` };
  }

  // ── Summing up a note: only the AI can (not the general « bilan » further down) ──
  // « résume ma note Biologie », « fais-moi un résumé de la note Biologie », or « résume Biologie » when a note has that exact title.
  g = grab(/^(?:(?:resume|resumer|synthetise)(?:[- ]moi)?|fais(?:[- ]moi)?\s+(?:un|le)\s+resume\s+(?:de|d'))\s*(?:la\s+|ma\s+|cette\s+)?note\s+(.+?)\s*[.!?]*$/d);
  const named = g ? null : grab(/^(?:resume|resumer)(?:[- ]moi)?\s+(?:la\s+|le\s+|ma\s+|mon\s+)?(.+?)\s*[.!?]*$/d);
  const exact = named && useNotes.getState().notes.find(n => normalize(n.title) === normalize(named(1)));
  if (g || exact) {
    const term = g ? g(1) : '';
    const note = exact || findNote(term) || (() => {
      const hit = search(term).find(h => h.type === 'note');
      return hit ? findNote(hit.id) : undefined;
    })();
    if (!note) return { text: t('Je ne trouve pas de note « {term} ». Donne-moi le titre exact ?', { term }) };
    return { text: t('Résumer «\u00a0{title}\u00a0» demande l’IA, qui n’est pas disponible pour le moment.', { title: note.title }), links: [{ label: t('Ouvrir la note'), to: linkToNote(note.id) }] };
  }

  // ── To-dos ──
  // « Ajoute une tâche » with nothing after it (or dictation sent too soon): ask, rather than make an event « Tâche ».
  if (/^(?:ajoute|rajoute|cree|mets|note)\s+(?:moi\s+)?(?:une?\s+|la\s+)?(?:tache|todo|to-do|chose a faire)\s*[.!?]*$/.test(q)) {
    return { text: t('Quelle tâche ? Par exemple « Ajoute la tâche appeler la banque demain ».') };
  }
  g = grab(/^(?:ajoute|rajoute|note|cree|mets)\s+(?:moi\s+)?(?:une?\s+|la\s+)?(?:tache|todo|to-do|chose a faire)\s*:?\s+(.+)$/d) ?? grab(/^(?:a faire|todo)\s*:\s*(.+)$/d);
  if (g) {
    const parsed = parseQuickAdd(g(1));
    const todo = addTodo(parsed.title || g(1), parsed.date ?? undefined);
    return { text: todo.due ? t('Ajouté à ta liste : « {title} » (pour {day}).', { title: todo.title, day: describeDue(todo.due) }) : t('Ajouté à ta liste : « {title} ».', { title: todo.title }) };
  }
  if (/(mes taches|ma liste|ma to-?do|liste (de|des) taches|qu'est-ce que j'ai a faire|qu'est-ce qu'il me reste a faire|il me reste quoi)/.test(q)) {
    const list = listTodos();
    if (!list.length) return { text: t('Ta liste est vide.') };
    return { text: `${t('À faire ({n}) :', { n: list.length })}\n${list.slice(0, 12).map(x => `- ${x.title}${x.due ? ` · ${describeDue(x.due)}${x.late ? ` ${t('(en retard)')}` : ''}` : ''}`).join('\n')}` };
  }
  g = grab(/^(?:coche|termine|valide)\s+(?:la tache\s+)?(.+)$/d) ?? grab(/^j'ai (?:fini|termine|fait)\s+(?:la tache\s+)?(.+)$/d);
  if (g) {
    const todo = completeTodo(g(1));
    if (todo) return { text: t('« {title} » coché. Un de moins !', { title: todo.title }) };
    if (/^coche/.test(q)) return { text: t('Je ne trouve pas « {name} » dans ta liste de tâches.', { name: g(1) }) };
  }
  g = grab(/^(?:supprime|enleve|retire|efface)\s+(?:la tache\s+)(.+)$/d) ?? grab(/^(?:enleve|retire)\s+(.+?)\s+de (?:ma|la) liste$/d);
  if (g) {
    const todo = deleteTodo(g(1));
    return { text: todo ? t('« {title} » retiré de ta liste.', { title: todo.title }) : t('Je ne trouve pas « {name} » dans ta liste.', { name: g(1) }) };
  }

  // ── Trash ──
  if (/corbeille/.test(q) && /(qu'y a|qu'est-ce qu|montre|liste|contenu|dans la|ouvre|voir)/.test(q) && !/(mets|deplace|envoie|jette)/.test(q)) {
    const list = listTrash();
    const links = [{ label: t('Ouvrir la corbeille'), to: '/corbeille' }];
    if (!list.length) return { text: t('La corbeille est vide.'), links };
    return { text: `${t('Dans la corbeille ({n}) :', { n: list.length })}\n${list.slice(0, 12).map(x => `- ${t('{name} ({type}, supprimé le {date})', { name: x.name, type: x.type, date: x.deleted })}`).join('\n')}\n${t('Dis « restaure … » pour récupérer.')}`, links };
  }
  g = grab(/^(?:restaure|recupere|remets|ramene)\s+(.+?)(?:\s+(?:de|depuis) la corbeille)?$/d);
  if (g && findInTrash(g(1))) {
    const res = restoreFromTrash([g(1)]);
    return { text: t('« {names} » est de retour à sa place.', { names: res.restored.join(', ') }), links: res.links.map(l => ({ ...l, label: t('Ouvrir') })) };
  }
  g = grab(/^(?:supprime|efface|jette|mets|envoie|deplace)\s+(?:le fichier\s+|le dossier\s+|la note\s+|le document\s+)?(.+?)(?:\s+(?:a|dans) la corbeille)?$/d);
  if (g && /^(supprime|efface|jette)|corbeille/.test(q)) {
    const term = g(1);
    const wantsEvent = /(evenement|rdv|rendez-vous)/.test(q);
    const hit = search(term.replace(/^(l'|le |la )?(evenement|événement|rdv|rendez-vous)\s+/i, '')).find(h => (wantsEvent ? h.type === 'événement' : true));
    if (!hit) return { text: t('Je ne trouve rien qui s’appelle « {term} ».', { term }) };
    if (hit.type === 'événement') {
      const ev = useCalendar.getState().events.find(e => e.id === hit.id)!;
      return ask(t('Je mets « {name} » à la corbeille (récupérable 30 jours) ?', { name: describeEvent(ev) }), () => {
        deleteEvent(ev.id);
        return { text: t('« {title} » est dans la corbeille (dis « restaure {title} » pour annuler).', { title: ev.title }) };
      });
    }
    // A note is « la », a file or a folder « le ».
    const feminine = hit.type === 'note';
    const question = hit.where
      ? t('Je mets « {title} » ({type}, {where}) à la corbeille (récupérable 30 jours) ?', { title: hit.title, type: HIT_LABEL[hit.type], where: hit.where })
      : t('Je mets «\u00a0{title}\u00a0» ({type}) à la corbeille (récupérable 30 jours) ?', { title: hit.title, type: HIT_LABEL[hit.type] });
    return ask(question, () => {
      const res = trashItems([hit.id]);
      return { text: res.done.length ? t('« {title} » est dans la corbeille (dis « restaure {title} » pour annuler).', { title: hit.title }) : feminine ? t('Elle a déjà disparu.') : t('Il a déjà disparu.') };
    });
  }

  // ── Drive & notes organisation ──
  g = grab(/^renomme\s+(?:le fichier\s+|le dossier\s+|la note\s+)?(.+?)\s+en\s+(.+)$/d);
  if (g) {
    const hit = search(g(1)).find(h => h.type !== 'événement');
    if (!hit) return { text: t('Je ne trouve pas « {name} ».', { name: g(1) }) };
    const s = renameItem(hit.id, g(2));
    return s ? { text: t('Renommé en « {name} ».', { name: itemName(s) }), links: [{ label: t('Voir'), to: linkToItem(s) }] } : { text: t('Le nouveau nom est vide.') };
  }
  g = grab(/^(?:deplace|range)\s+(?:le fichier\s+|le dossier\s+|la note\s+)?(.+?)\s+dans\s+(?:le dossier\s+)?(.+)$/d);
  if (g) {
    const hit = search(g(1)).find(h => h.type !== 'événement');
    if (!hit) return { text: t('Je ne trouve pas « {name} ».', { name: g(1) }) };
    const res = moveItem(hit.id, /^(la )?racine$/i.test(g(2)) ? undefined : g(2));
    if ('error' in res) return { text: t('Impossible : {error}.', { error: res.error }) };
    return { text: t('« {name} » rangé dans « {folder} ».', { name: itemName(res.moved), folder: res.to }), links: [{ label: t('Voir'), to: linkToItem(res.moved) }] };
  }
  g = grab(/^(?:ajoute|mets)\s+(.+?)\s+(?:en|aux|dans les)\s+favoris$/d);
  if (g) {
    const hit = search(g(1)).find(h => h.type === 'fichier' || h.type === 'dossier');
    const it = hit && setStar(hit.id, true);
    return it ? { text: t('« {name} » ajouté aux favoris.', { name: it.name }) } : { text: t('Je ne trouve pas « {name} » dans le Drive.', { name: g(1) }) };
  }
  g = grab(/dossier\s+(.+?)\s+en\s+(bleu|rouge|orange|jaune|vert|violet|rose|gris)$/d);
  if (g) {
    const f = setFolderColor(g(1), COLOR_WORDS[g(2).toLowerCase()]);
    return f ? { text: t('Le dossier « {name} » est maintenant {color}.', { name: f.name, color: COLOR_NAMES[g(2).toLowerCase()] ?? g(2).toLowerCase() }), links: [{ label: t('Voir'), to: linkToDriveFolder(f.id) }] } : { text: t('Je ne trouve pas le dossier « {name} ».', { name: g(1) }) };
  }

  // ── Search inside notes ──
  g = grab(/^(?:cherche|trouve|recherche)\s+(.+?)\s+dans\s+(?:mes|les)\s+notes$/d);
  if (g) {
    const hits = searchNotes(g(1));
    if (!hits.length) return { text: t('Aucune note ne parle de « {term} ».', { term: g(1) }) };
    return {
      text: `${tn(hits.length, '« {term} » apparaît dans {n} note :', '« {term} » apparaît dans {n} notes :', { term: g(1) })}\n${hits.slice(0, 5).map(h => `- **${h.title}**${h.excerpts[0] ? ` : ${h.excerpts[0]}` : ''}`).join('\n')}`,
      links: hits.slice(0, 3).map(h => ({ label: h.title, to: linkToNote(h.id) })),
    };
  }

  // ── Focus ──
  // « stop » alone too (outside a quiz, which handles its own « stop » first).
  if (/(arrete|stoppe|stop|termine|coupe)\s+(la |ma )?(session|pomodoro|focus|minuteur)|^(stop|stoppe|arrete)\s*!?$/.test(q)) {
    const res = stopFocus();
    return { text: res ? t('Session arrêtée.') : t('Il n’y a pas de session en cours.') };
  }
  g = grab(/(?:lance|demarre|commence|on fait)\s+(?:une\s+|la\s+)?(?:session(?:\s+(?:de\s+)?(?:focus|travail|revision))?|pomodoro|focus)(?:\s+(?:sur|en|de|pour)\s+(.+))?$/d);
  if (g) {
    const res = startFocus(g(1).replace(/^(?:la |le |les |l'|l’|mes |ma |mon )/i, ''));
    return { text: res.subject ? t('C’est parti pour {minutes} minutes sur « {subject} ».', { minutes: res.minutes, subject: res.subject }) : t('C’est parti pour {minutes} minutes.', { minutes: res.minutes }) };
  }

  // ── Settings ──
  let m = q.match(/(?:mode|theme)\s+(sombre|nuit|noir|clair|jour|auto|automatique)/);
  if (m) {
    const theme = /sombre|nuit|noir/.test(m[1]) ? 'sombre' : /clair|jour/.test(m[1]) ? 'clair' : 'auto';
    updateSettings({ theme });
    const done = theme === 'auto' ? t('Thème automatique (comme ton système) enregistré.') : theme === 'sombre' ? t('Thème sombre enregistré.') : t('Thème clair enregistré.');
    return { text: done, links: [{ label: t('Réglages'), to: '/profil' }] };
  }
  m = q.match(/(?:couleur|accent).*?\b(orange|bleue?|verte?|violette?|rose|framboise|encre|noire?)\b/);
  if (m) {
    updateSettings({ accent: ACCENT_WORDS[m[1]] });
    return { text: t('Nouvelle couleur appliquée.') };
  }
  if (/(reduis|desactive|coupe|enleve|moins d')\s*(les )?animations/.test(q)) {
    updateSettings({ reduceMotion: true });
    return { text: t('Animations réduites.') };
  }
  if (/(active|remets|reactive)\s+(les )?animations/.test(q)) {
    updateSettings({ reduceMotion: false });
    return { text: t('Animations réactivées.') };
  }
  if (/(sois|parle|fais)\s.*(plus )?(discret|calme|moins bavard|tais-toi)|^tais[- ]toi/.test(q)) {
    updateSettings({ chattiness: 'calme' });
    return { text: t('Compris, je me fais discret.') };
  }
  if (/(sois|parle).*(plus )?bavard|parle[- ]moi plus/.test(q)) {
    updateSettings({ chattiness: 'bavard' });
    return { text: t('Compris, je passerai plus souvent.') };
  }
  return null;
}

const JOKES: Record<Usage, string[]> = {
  etudes: [
    t('Pourquoi les étudiants aiment les ascenseurs ? Parce que c’est le seul endroit où ils prennent de l’avance.'),
    t('J’ai voulu réviser avec toi, mais j’ai paniqué en voyant le programme. Je suis qu’un petit casque, moi.'),
    t('Un partiel, c’est comme une série : tu ne regardes pas le dernier épisode sans avoir vu les précédents. Enfin… en théorie.'),
    t('Mon prof de maths m’a dit que j’étais moyen. C’était méchant, mais statistiquement juste.'),
  ],
  travail: [
    t('Une réunion qui aurait pu être un e-mail, c’est comme un casque sans écran : ça fait du bruit, mais on ne voit rien.'),
    t('J’ai demandé une augmentation à mon écran. Il m’a répondu : « Luminosité, oui. Salaire, non. »'),
    t('Mon agenda et moi, c’est compliqué : il dit « 30 minutes », je comprends « une heure et demie ».'),
    t("Le vendredi à 17h, je suis le seul ici à encore croire aux « petites modifs rapides »."),
  ],
  perso: [
    t('J’ai voulu ranger ma vie comme un dossier. Résultat : un dossier « Divers » de 4 Go.'),
    t('Mon frigo et moi, on a un point commun : on attend tous les deux que quelqu’un fasse les courses.'),
    t("La liste « à faire demain » est mon genre littéraire préféré : du suspense, chaque jour."),
    t('J’ai essayé le réveil à 6h. Lui s’est levé, moi non.'),
  ],
};

/** Examples of commands for « je n'ai pas compris », in the account's world. */
const EXAMPLES: Record<Usage, string[]> = {
  etudes: [
    t('« Trouve le dossier Maths »'), t('« Analyse mon calendrier »'), t('« Crée une note Révisions histoire : chapitre 3 »'), t('« Ajoute Exam de physique vendredi 10h »'),
    t('« Ajoute la tâche acheter une calculatrice demain »'), t('« Interroge-moi sur Histoire »'), t('« Lance une session focus sur les maths »'),
    t('« Renomme TD1 en TD1 corrigé », « Mets Brouillon à la corbeille »'), t('« Mode sombre », « Qu’est-ce que j’ai demain ? »'), t('« Comment enregistrer un cours ? »'),
  ],
  travail: [
    t('« Trouve le dossier Clients »'), t('« Analyse mon calendrier »'), t('« Crée une note Compte rendu : points clés »'), t('« Ajoute Réunion client vendredi 10h »'),
    t('« Ajoute la tâche envoyer le devis demain »'), t('« Interroge-moi sur Procédure »'), t('« Lance une session focus sur le rapport »'),
    t('« Renomme Devis v1 en Devis final », « Mets Brouillon à la corbeille »'), t('« Mode sombre », « Qu’est-ce que j’ai demain ? »'), t('« Comment enregistrer une réunion ? »'),
  ],
  perso: [
    t('« Trouve le dossier Papiers »'), t('« Analyse mon calendrier »'), t('« Crée une note Courses : pain, lait »'), t('« Ajoute Dentiste vendredi 10h »'),
    t('« Ajoute la tâche appeler la banque demain »'), t('« Interroge-moi sur Espagnol »'), t('« Lance une session focus sur le rangement »'),
    t('« Renomme Vacances en Vacances 2026 », « Mets Brouillon à la corbeille »'), t('« Mode sombre », « Qu’est-ce que j’ai demain ? »'), t('« Comment enregistrer une conférence ? »'),
  ],
};

/** « Comment enregistrer mon cours ? »: the page « Enregistrer » does it, Kompaly explains how. */
function recordingHelp(): BotReply {
  const w = words().recording;
  return {
    text: [
      t('Ouvre **Enregistrer**, choisis « Micro » ou « Son de l’ordinateur » (visio, vidéo : Chrome ou Edge sur ordinateur), puis « Démarrer ».'),
      t('- Le texte s’écrit en direct. La cloche : je te préviens quand un mot-clé est prononcé.'),
      t('- « Terminer » range {doc} dans le Drive, avec {sheet} et {exam} si tu les as cochés.', { doc: w.doc, sheet: w.sheet, exam: w.exam }),
      t('Demande l’accord des personnes que tu enregistres.'),
    ].join('\n'),
    links: [{ label: t('Enregistrer'), to: '/enregistrer' }],
  };
}

/** « Fais-moi une fiche de révision de ce document »: the Drive's right-click menu makes it, next to the file. */
function sheetFromDocument(input: string, q: string): BotReply {
  const exam = /(examen|quiz|questions)/.test(q) && !/fiche/.test(q);
  // The menu's own words for this usage (« Faire un résumé » for a pro account).
  const label = recWords(getSettings().usage).menu[exam ? 'examen' : 'fiche'];
  // « … du fichier Chapitre 3 », « … de Chapitre 3.pdf »: the file named, when the Drive has it (and the menu offers it).
  const named = /(?:document|fichier|pdf|word)\s+(?!(?:du|de|dans)\b)(.+?)\s*[?.!]*$/i.exec(input)?.[1] ?? input.split(/\s(?:de|du|sur|d['’])\s*/i).at(-1)?.replace(/[\s?.!]+$/, '');
  const file = named ? search(unquote(named)).find(h => h.type === 'fichier' && /\.(docx|pdf|txt|md)$/i.test(h.title)) : undefined;
  return {
    text:
      t('Dans le Drive, fais un clic droit sur {file}, puis « {action} » (sur téléphone : sélectionne-le, puis « Plus d’actions »). Le nouveau document se range à côté.', {
        file: file ? t('« {title} »', { title: file.title }) : t('le document (Word, PDF ou texte)'),
        action: label,
      }),
    links: [file ? { label: file.title, to: file.to } : { label: t('Drive'), to: '/drive' }],
  };
}

const describeDue = (key: string) => {
  const d = daysUntil(key);
  return d === 0 ? t('aujourd’hui') : d === 1 ? t('demain') : d === -1 ? t('hier') : fmt(fromKey(key), 'EEEE d MMM');
};

/** The suggestions under the chat, sent as they are shown: in another language, back to the French this brain reads. */
const SUGGESTED: [string, string][] = [
  ['Analyse ma semaine', t('Analyse ma semaine')],
  ['Planifie mes révisions', t('Planifie mes révisions')],
  ['Bloque du temps pour préparer', t('Bloque du temps pour préparer')],
  ['Comment enregistrer un cours ?', t('Comment enregistrer un cours ?')],
  ['Comment enregistrer une réunion ?', t('Comment enregistrer une réunion ?')],
  ['Comment enregistrer une conférence ?', t('Comment enregistrer une conférence ?')],
];

// ── The other site languages: the simple requests (the examples shown) rewritten in the French read below ──
// Leading articles of a name or a subject (« the report », « den Bericht », « il report »).
const ARTICLE = /^(?:the|my|el|la|los|las|mi|mis|der|die|das|den|dem|meinen?|meine|il|lo|i|gli|le|l['’]|il mio|la mia)\s+|^l['’]/i;
const bare = (s: string) => s.trim().replace(ARTICLE, '').trim();
// « this week », « nächstes Wochenende »… in the French askedPeriod reads.
const PERIODS: [RegExp, string][] = [
  [/\b(?:next weekend|el pr[oó]ximo fin de semana|n[äa]chstes wochenende|il prossimo (?:fine settimana|weekend)|il (?:fine settimana|weekend) prossimo)\b/i, 'le week-end prochain'],
  [/\b(?:this weekend|the weekend|este fin de semana|el fin de semana|dieses wochenende|am wochenende|questo (?:fine settimana|weekend)|nel (?:fine settimana|weekend))\b/i, 'ce week-end'],
  [/\b(?:next week|la (?:semana que viene|pr[oó]xima semana)|n[äa]chste woche|la (?:settimana prossima|prossima settimana))\b/i, 'la semaine prochaine'],
  [/\b(?:this week|esta semana|diese woche|questa settimana)\b/i, 'cette semaine'],
];
const OTHER: [RegExp, (m: RegExpMatchArray) => string][] = [
  // Help
  [/^(?:help|hilfe|hilf mir|ayuda|ay[uú]dame|aiuto|aiutami)\b|what can you do|was kannst du|qu[eé] (?:sabes|puedes) hacer|(?:che )?cosa (?:sai|puoi) fare/i, () => 'aide'],
  // Tasks (before the events: « Füge die Aufgabe … hinzu »)
  [/^(?:add|create|new)\s+(?:a\s+|the\s+)?(?:new\s+)?(?:task|to-?do)(?=[\s:]|$)\s*:?\s*(.*)$/i, m => `ajoute la tâche ${m[1]}`],
  [/^(?:añade|agrega|crea|nueva)\s+(?:una\s+|la\s+)?(?:nueva\s+)?tarea(?=[\s:]|$)\s*:?\s*(.*)$/i, m => `ajoute la tâche ${m[1]}`],
  [/^(?:füg(?:e)?|trag(?:e)?)\s+(?:eine\s+|die\s+)?(?:neue\s+)?aufgabe(?=[\s:]|$)\s*:?\s*(.*?)\s*(?:hinzu|ein)?$/i, m => `ajoute la tâche ${m[1]}`],
  [/^(?:neue|erstell(?:e)?\s+(?:eine\s+)?(?:neue\s+)?)aufgabe(?=[\s:]|$)\s*:?\s*(.*)$/i, m => `ajoute la tâche ${m[1]}`],
  [/^(?:aggiungi|crea|nuova)\s+(?:l['’]\s*|un['’]\s*|una\s+|la\s+|il\s+|un\s+)?(?:nuova\s+)?(?:attivit[aà]|compito|cosa da fare)(?=[\s:]|$)\s*:?\s*(.*)$/i, m => `ajoute la tâche ${m[1]}`],
  // Notes
  [/^(?:create|make|write|add|new)\s+(?:me\s+)?(?:a\s+)?(?:new\s+)?note(?=[\s:]|$)\s*(?:called|named|titled|about|on)?\s*(.*)$/i, m => `crée une note ${m[1]}`],
  [/^(?:crea|haz|escribe|añade|agrega|nueva|fai|scrivi|aggiungi|nuova)\s+(?:me\s+|mi\s+)?(?:una\s+)?(?:nueva\s+|nuova\s+)?nota(?=[\s:]|$)\s*(?:llamada|titulada|sobre|chiamata|intitolata|su)?\s*(.*)$/i, m => `crée une note ${m[1]}`],
  [/^(?:erstell(?:e)?|schreib(?:e)?|mach(?:e)?|neue)\s+(?:mir\s+)?(?:eine\s+)?(?:neue\s+)?notiz(?=[\s:]|$)\s*(?:namens|über|zu)?\s*(.*)$/i, m => `crée une note ${m[1]}`],
  // Quiz, focus
  [/^(?:quiz|test)\s+me\s+(?:on|about)\s+(.+)$|^preg[uú]ntame\s+(?:sobre|de)\s+(.+)$|^frag(?:e)?\s+mich\s+(?:zu|über|in|nach)\s+(.+?)(?:\s+ab)?$|^interrogami\s+(?:su|sul|sulla|sullo|di)\s+(.+)$/i, m => `interroge-moi sur ${m[1] ?? m[2] ?? m[3] ?? m[4]}`],
  [/^(?:start|begin|launch)\s+(?:a\s+)?(?:focus(?:\s+session)?|pomodoro|study\s+session|work\s+session)(?:\s+(?:on|for)\s+(.+))?$|^(?:inicia|empieza|comienza|lanza|arranca)\s+(?:una\s+)?(?:sesi[oó]n(?:\s+de\s+(?:concentraci[oó]n|focus|estudio|trabajo))?|pomodoro)(?:\s+(?:de|sobre|en|para)\s+(.+))?$|^(?:starte|start|beginne)\s+(?:eine\s+|einen\s+)?(?:fokus-?session|fokus|pomodoro|lernsession)(?:\s+(?:für|fürs|zum|zur|zu|über|in)\s+(.+))?$|^(?:avvia|inizia|comincia|lancia)\s+(?:una\s+)?(?:sessione(?:\s+(?:di\s+)?(?:focus|studio|lavoro|concentrazione))?|pomodoro|focus)(?:\s+(?:su|sul|sulla|sullo|sui|di|per)\s+(.+))?$/i, m => {
    const subject = m[1] ?? m[2] ?? m[3] ?? m[4];
    return subject ? `lance une session focus sur ${bare(subject)}` : 'lance une session focus';
  }],
  [/^(?:stop|end)\s+(?:the\s+|my\s+)?(?:session|focus|pomodoro|timer)|^(?:para|det[eé]n|termina)\s+(?:la\s+)?(?:sesi[oó]n|pomodoro)|^(?:stopp(?:e)?|beende)\s+(?:die\s+)?(?:session|fokus|pomodoro)|^(?:ferma|termina)\s+(?:la\s+)?(?:sessione|pomodoro)|^(?:stopp|para|basta|ferma)\s*!?$/i, () => 'arrête la session'],
  // Rename, trash
  [/^rename\s+(?:the\s+(?:file|folder|note)\s+)?(.+?)\s+(?:to|as)\s+(.+)$|^renombra\s+(?:el\s+archivo\s+|la\s+carpeta\s+|la\s+nota\s+)?(.+?)\s+(?:a|como)\s+(.+)$|^benenne\s+(?:die\s+datei\s+|den\s+ordner\s+|die\s+notiz\s+)?(.+?)\s+(?:in|zu)\s+(.+?)\s+um$|^rinomina\s+(?:il\s+file\s+|la\s+cartella\s+|la\s+nota\s+)?(.+?)\s+(?:in|come)\s+(.+)$/i, m => `renomme ${m[1] ?? m[3] ?? m[5] ?? m[7]} en ${m[2] ?? m[4] ?? m[6] ?? m[8]}`],
  [/^(?:move|put|send|throw)\s+(.+?)\s+(?:to|in|into)\s+(?:the\s+)?(?:trash|bin)$|^(?:mueve|manda|env[ií]a|pon|tira|echa)\s+(.+?)\s+(?:a|en)\s+la\s+papelera$|^(?:leg(?:e)?|verschieb(?:e)?|schieb(?:e)?|wirf)\s+(.+?)\s+in\s+den\s+papierkorb$|^(?:sposta|metti|butta|manda)\s+(.+?)\s+nel\s+cestino$/i, m => `mets ${bare(m[1] ?? m[2] ?? m[3] ?? m[4])} à la corbeille`],
  [/^(?:delete|trash|borra|elimina|l[öo]sch(?:e)?|cancella)\s+(.+)$/i, m => `supprime ${bare(m[1])}`],
  // Theme
  [/\b(?:dark|night)\s+(?:mode|theme)\b|\b(?:modo|tema)\s+oscuro\b|\bdunkel(?:modus|er\s+modus)\b|\bdunkles\s+design\b|\bmodalit[aà]\s+scura\b|\btema\s+scuro\b/i, () => 'mode sombre'],
  [/\blight\s+(?:mode|theme)\b|\b(?:modo|tema)\s+claro\b|\bhell(?:modus|er\s+modus)\b|\bhelles\s+design\b|\bmodalit[aà]\s+chiara\b|\btema\s+chiaro\b/i, () => 'mode clair'],
  // Calendar: analysis, what is planned
  [/^(?:analy[sz]e|review|check)\s+(?:my\s+|the\s+)?(?:calendar|week|schedule|agenda)|^analiza\s+(?:mi\s+|el\s+|la\s+)?(?:calendario|semana|agenda)|^analysiere\s+(?:meinen\s+|den\s+|meine\s+|die\s+)?(?:kalender|woche|terminplan)|^analizza\s+(?:il\s+mio\s+|la\s+mia\s+|il\s+|la\s+)?(?:calendario|settimana|agenda)/i, () => 'analyse mon calendrier'],
  [/^(?:what(?:['’]s|\s+is)\s+(?:on|planned|happening)|what\s+(?:have\s+i\s+got|do\s+i\s+have)(?:\s+on|\s+planned)?)\s+(.+)$|^qu[eé]\s+(?:tengo|hay)\s+(?:para\s+)?(.+)$|^was\s+(?:habe|hab|steht)\s+(?:ich\s+)?(.+?)(?:\s+an)?$|^(?:che\s+)?cosa\s+(?:ho|c['’]\s*[eè])\s+(.+)$|^che\s+ho\s+(.+)$/i, m => {
    const when = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
    return `qu'est-ce que j'ai ${PERIODS.find(([re]) => re.test(when))?.[1] ?? when}`;
  }],
  // Find (« … in my notes »: inside the notes)
  [/^(?:find|search(?:\s+for)?|look\s+for|where(?:['’]s|\s+is|\s+are))\s+(?:me\s+)?(.+?)(?:\s+(?:folder|file|document))?$|^(?:b[uú]sca(?:me)?|encuentra(?:me)?|d[oó]nde\s+est[aá]n?)\s+(?:la\s+carpeta\s+|el\s+archivo\s+|el\s+documento\s+)?(.+)$|^(?:finde|such(?:e)?(?:\s+nach)?|wo\s+(?:ist|sind))\s+(?:den\s+ordner\s+|die\s+datei\s+|das\s+dokument\s+)?(.+)$|^(?:trova(?:mi)?|cerca(?:mi)?|dov['’]\s*[eè]|dove\s+sono)\s+(?:la\s+cartella\s+|il\s+file\s+|il\s+documento\s+)?(.+)$/i, m => {
    const term = bare(m[1] ?? m[2] ?? m[3] ?? m[4]);
    const notes = /\s+(?:in\s+(?:my|the)\s+notes|en\s+(?:mis|las)\s+notas|in\s+(?:meinen|den)\s+notizen|nelle\s+(?:mie\s+)?note)$/i;
    return notes.test(term) ? `trouve ${term.replace(notes, '')} dans mes notes` : `trouve ${term}`;
  }],
  // Events: « Add Dentist Friday 10am », « Füge Zahnarzt Freitag 10 Uhr hinzu », « Trag Zahnarzt Freitag ein »
  [/^(?:add|schedule)\s+(?:an?\s+)?(?:event\s+|appointment\s+)?(.+?)(?:\s+(?:to|in)\s+(?:my|the)\s+calendar)?$/i, m => `ajoute ${m[1]}`],
  [/^(?:añade|agrega|programa|apunta)\s+(?:un\s+|una\s+)?(?:evento\s+|cita\s+)?(.+?)(?:\s+(?:a|en)\s+(?:mi|el)\s+calendario)?$/i, m => `ajoute ${m[1]}`],
  [/^(?:füg(?:e)?\s+(?:einen\s+)?(?:termin\s+)?(.+?)(?:\s+(?:zu|in)\s+(?:meinem|meinen|dem|den)\s+kalender)?\s+hinzu|trag(?:e)?\s+(?:einen\s+)?(?:termin\s+)?(.+?)(?:\s+in\s+(?:meinen|den)\s+kalender)?\s+ein)$/i, m => `ajoute ${m[1] ?? m[2]}`],
  [/^(?:aggiungi|programma|segna)\s+(?:un\s+|una\s+)?(?:evento\s+|appuntamento\s+)?(.+?)(?:\s+(?:al|nel)\s+(?:mio\s+)?calendario)?$/i, m => `ajoute ${m[1]}`],
  // Recording, greetings, thanks
  [/^(?:how\s+(?:do|can)\s+i|c[oó]mo|wie|come)\b.*(?:\brecord|\bgrab(?:o|ar|a)\b|aufnehm|\bnehme\b.*\bauf\b|aufzeichn|\bregistr(?:o|are|a)\b)/i, () => 'comment enregistrer ?'],
  [/^(?:hi|hello|hey|hola|buenas|hallo|servus|moin|ciao|buongiorno|buonasera|salve|guten\s+(?:morgen|tag|abend))\b/i, () => 'salut'],
  [/^(?:thanks|thank you|thx|cheers|gracias|muchas gracias|danke(?: sch[öo]n| sehr)?|vielen dank|grazie(?: mille)?)\s*[!.]*$/i, () => 'merci'],
];

/** A simple request in English, Spanish, German or Italian, said the French way (null: not one of them). */
export function fromOtherLanguage(typed: string): string | null {
  const s = typed.trim().replace(/^[¿¡«“„"‚‹']\s*/, '').replace(/\s*[»”“"‘’›']?\s*[?!.]*\s*[»”“"‘’›']?$/, '');
  for (const [re, fr] of OTHER) {
    const m = s.match(re);
    if (m) return fr(m).trim();
  }
  return null;
}

export function localReply(raw: string): BotReply {
  const typed = raw.trim();
  let input = SUGGESTED.find(([, shown]) => shown.toLowerCase() === typed.toLowerCase())?.[0] ?? typed;
  // Only read by patterns (the words searched are cut from `input`): « œ », « æ » stay one letter, as normalize would spell them out.
  const fold = (s: string) => normalize(s.replace(/[œŒ]/g, 'o').replace(/[æÆ]/g, 'a'));
  let q = fold(input);

  // ── Waiting for a confirmation ────────────────────────────────────────────
  if (pendingConfirm) {
    const p = pendingConfirm;
    pendingConfirm = null;
    if (isYes(q)) return p.run();
    if (NO.test(q)) return { text: t('Ok, je n’y touche pas.') };
  }

  // ── Quiz in progress: every message is an answer ─────────────────────────
  if (quiz) return quizStep(input, q);

  // Typed in another site language: read as the same request in French.
  const french = lang === 'fr' ? null : fromOtherLanguage(input);
  if (french) {
    input = french;
    q = fold(input);
  }

  const more = moreCommands(input, q);
  if (more) return more;

  // ── Answer to Kompaly's last proposal ─────────────────────────────────────
  const offer = useCopilot.getState().pendingOffer;
  if (offer && (isYes(q) || /^(let'?s go|avec plaisir|je veux bien|volontiers|bonne idee|va bene|perfetto|vamos|gerne)\b/.test(q))) {
    return runOffer(offer);
  }
  if (offer && (NO.test(q) || /^(plus tard|not now|later|luego|m[aá]s tarde|sp[aä]ter|pi[uù] tardi|dopo)\b/.test(q))) {
    return { text: pick([t('Ok, je n’insiste pas. Je reste dans le coin.'), t('Pas de souci, on verra plus tard.')]) };
  }

  // ── Recording (page « Enregistrer ») and sheets made from a Drive document ──
  // Not « rappelle-moi d'enregistrer… » nor « ajoute Enregistrement du podcast mardi » (a reminder, an event).
  if (/(enregistr|transcri)/.test(q) && !/\b(note|tache|evenement|rdv|rendez-vous|fichier|dossier|document|reglages?|mot de passe)\b|rappel|penser|^(ajoute|planifie|programme|mets?)\b/.test(q)) {
    return recordingHelp();
  }
  if (/(fiche|examen|quiz)/.test(q) && /(fai[st]|faire|cree|creer|prepar|genere|ecri|tire|transforme|comment)/.test(q) && /\b(document|fichier|pdf|word|docx|drive)\b|\.(pdf|docx|txt|md)\b/.test(q)) {
    return sheetFromDocument(input, q);
  }

  // ── Plan revisions ────────────────────────────────────────────────────────
  if (/(planifi|organis|prepar|cale|programm).*(revision|revis)|(revision|reviser).*(planifi|organis)|(bloqu|planifi|cale|organis).*(temps|creneau|preparation).*prepar|planifie (ma|la) preparation|^(?:aide[- ]moi a )?prepar(?:e|er)\s+(?!(?:moi\s+)?(?:une?|la|le|ma|mon)\s+(?:note|fiche|tache|liste)\b)\S/.test(q)) {
    const w = words();
    // « … pour le contrôle de maths du 10 novembre », « … pour préparer lancement »: the words after the request.
    const subject = unquote(input.slice(subjectStart(q)).replace(/[\s?!.]+$/, ''));
    const exam = findExam(subject);
    // Named, in the calendar, but not something Kompaly prepares for (not an exam, not marked important).
    const named = !exam && subject ? eventNamed(subject) : undefined;
    if (named) {
      return {
        text: getSettings().usage === 'etudes'
          ? t('« {title} » n’est pas un examen : passe-le en catégorie « Examen » ou marque-le ★, et je planifie tes révisions.', { title: named.title })
          : t('« {title} » n’est pas marqué important : marque-le ★ dans le calendrier et je bloque du temps pour le préparer.', { title: named.title }),
        links: [{ label: t('Voir le jour'), to: linkToDay(named.date, named.id) }],
      };
    }
    if (!exam && subject && findExam('')) {
      return { text: t('Je ne trouve pas « {subject} » parmi {upcoming}. Quel est son nom dans le calendrier ?', { subject, upcoming: w.upcoming.charAt(0).toLowerCase() + w.upcoming.slice(1) }), links: [{ label: t('Calendrier'), to: '/calendrier' }] };
    }
    if (!exam) return { text: t('Je ne vois {none} {big} à venir dans ton calendrier. Ajoute-{it} et je m’occupe du reste.', { none: w.none, big: w.bigOne, it: w.it }) };
    if (hasRevisionPlan(exam)) return alreadyPlanned(exam);
    const res = planRevisions(exam.id)!;
    if (!res.created.length) {
      return {
        text: getSettings().usage === 'etudes'
          ? t('Plus le temps de caler une séance avant {exam} : voici une fiche pour une dernière relecture.', { exam: examLabel(exam) })
          : t('Plus le temps de bloquer un créneau avant {exam} : voici une note pour ne rien oublier.', { exam: examLabel(exam) }),
        links: res.note ? [{ label: openNoteLabel(), to: linkToNote(res.note.id) }] : [],
      };
    }
    return {
      text:
        getSettings().usage === 'etudes'
          ? tn(res.created.length, 'Pour {exam}, je t’ai calé {n} séance de révision et une fiche pour t’organiser.', 'Pour {exam}, je t’ai calé {n} séances de révision et une fiche pour t’organiser.', { exam: examLabel(exam) })
          : tn(res.created.length, 'Pour {exam}, je t’ai bloqué {n} créneau pour préparer et une note pour ne rien oublier.', 'Pour {exam}, je t’ai bloqué {n} créneaux pour préparer et une note pour ne rien oublier.', { exam: examLabel(exam) }),
      links: [
        { label: t('Voir le planning'), to: linkToDay(res.created[0].date) },
        ...(res.note ? [{ label: openNoteLabel(), to: linkToNote(res.note.id) }] : []),
      ],
    };
  }

  // ── Jokes ─────────────────────────────────────────────────────────────────
  if (/(blague|fais[- ]moi rire|raconte.*(truc|histoire) drole|une vanne)/.test(q)) {
    return { text: pick(JOKES[getSettings().usage] ?? JOKES.etudes) };
  }

  // ── Reminder: « rappelle-moi ce soir 17h d'étendre le linge » ───────────────
  if (/(rappel|rappelle[- ]moi|fais[- ]moi penser|pense a me dire)/.test(q)) {
    const parsed = parseQuickAdd(input);
    // Date/heure retirées par parseQuickAdd, puis tout ce qui précède le sujet du rappel.
    // ’ (iPhone, Mac keyboards) read as ' for the patterns below: « rappelle-moi d’appeler Paul ».
    let what = (parsed.title || input).replace(/[’‘]/g, "'").replace(/\b(?:stp|s'il te pla[iî]t|svp|merci)\b/gi, '').replace(/\s+[àa]\s*(?=\s|$)/g, ' ');
    const after = what.match(/\b(?:que je (?:dois|doit|devrais)|qu'il faut que je|de ne pas oublier d(?:e\s|'))\s*(.+)$/i) ?? what.match(/\b(?:rappel(?:le[- ]moi)?|fais[- ]moi penser|pense [àa] me dire)\b.*?\b(?:d'|de\s|pour\s)\s*(.+)$/i);
    what = (after ? after[1] : '').replace(/[\s,.!]+$/, '').trim();
    if (/[’‘]/.test(input)) what = what.replace(/'/g, '’'); // keep the apostrophe the person typed
    if (what) {
      const title = what.charAt(0).toUpperCase() + what.slice(1);
      const ev = addEvent({ title, date: parsed.date ?? todayKey(), start: parsed.start ?? undefined, category: 'perso' });
      return { text: t('C’est noté : {event}. Je te le rappellerai.', { event: describeEvent(ev) }), links: [{ label: t('Voir le jour'), to: linkToDay(ev.date, ev.id) }] };
    }
  }

  // ── Revision sheet: « crée une fiche de révision de maths dans le dossier Cours » ──
  let m = input.match(/(?:cr[ée]e|cr[ée]er|fais|faire|pr[ée]pare|[ée]cris)(?:[\s-]+moi)?\s+(?:une\s+)?(?:petite\s+)?fiche(?:\s+de\s+r[ée]vision)?(?:\s+(?:(?:de|d['’]|en|sur|pour)\s*)?(.+?))?(?:\s+dans\s+(?:le\s+dossier\s+)?(.+?))?(?:\s+dans\s+(?:les\s+|mes\s+)?notes)?\s*[.!?]*$/i);
  if (m) {
    const subject = m[1] ? unquote(m[1]) : '';
    const folder = m[2] && !/^(?:les |mes )?notes$/i.test(m[2]) ? unquote(m[2]) : undefined;
    const studies = (getSettings().usage ?? 'etudes') === 'etudes';
    const Subject = subject.charAt(0).toUpperCase() + subject.slice(1);
    // Outside studies, a « fiche » is a note to sum something up, not a revision sheet.
    const note = studies
      ? createNote(Subject ? t('Fiche de révision — {subject}', { subject: Subject }) : t('Fiche de révision'), t('# Notions clés\n- \n# Définitions\n- \n# Formules / dates à retenir\n- \n# Exemples\n- \n# Je me teste\n- '), folder)
      : createNote(Subject ? t('Fiche — {subject}', { subject: Subject }) : t('Fiche'), t('# L’essentiel\n- \n# Points clés\n- \n# À retenir\n- \n# À faire\n[ ] '), folder);
    return {
      text: folder
        ? t('C’est fait : « {title} » dans le dossier « {folder} », avec un plan prêt à remplir.', { title: note.title, folder })
        : t('C’est fait : « {title} », avec un plan prêt à remplir.', { title: note.title }),
      links: [{ label: studies ? t('Ouvrir la fiche') : t('Ouvrir la note'), to: linkToNote(note.id) }],
    };
  }

  // ── Create a note ─────────────────────────────────────────────────────────
  m = input.match(/(?:cr[ée]e|cr[ée]er|fais|faire|[ée]cris|ajoute|nouvelle)\s+(?:moi\s+)?(?:une\s+)?note\s*(?:qui s'appelle|appel[ée]e|intitul[ée]e|nomm[ée]e|sur|:)?\s*(.*)$/i);
  if (m) {
    let rest = m[1];
    let content = '';
    let folder: string | undefined;
    const colon = rest.indexOf(':');
    if (colon >= 0) {
      content = rest.slice(colon + 1).trim();
      rest = rest.slice(0, colon);
    }
    const inFolder = rest.match(/\s+dans\s+(?:le\s+dossier\s+)?(.+)$/i);
    if (inFolder) {
      folder = unquote(inFolder[1]);
      rest = rest.slice(0, inFolder.index);
    }
    const title = unquote(rest) || t('Note de Kompaly');
    const note = createNote(title, content, folder);
    return {
      text: folder ? t('Note « {title} » créée dans le dossier « {folder} ».', { title: note.title, folder }) : t('Note « {title} » créée.', { title: note.title }),
      links: [{ label: t('Ouvrir la note'), to: linkToNote(note.id) }],
    };
  }

  // ── Create a folder ───────────────────────────────────────────────────────
  m = input.match(/(?:cr[ée]e|cr[ée]er|fais|ajoute|nouveau)\s+(?:moi\s+)?(?:un\s+)?dossier\s*(?:qui s'appelle|appel[ée]|nomm[ée]|:)?\s*(.*)$/i);
  if (m) {
    let rest = m[1];
    const forNotes = /\b(notes?)\b/i.test(rest) && /dans (les |mes )?notes/i.test(rest);
    rest = rest.replace(/\s+dans\s+(les\s+|mes\s+)?notes\s*$/i, '').replace(/\s+dans\s+(le\s+)?drive\s*$/i, '');
    let parent: string | undefined;
    const inFolder = rest.match(/\s+dans\s+(?:le\s+dossier\s+)?(.+)$/i);
    if (inFolder) {
      parent = unquote(inFolder[1]);
      rest = rest.slice(0, inFolder.index);
    }
    const name = unquote(rest) || t('Nouveau dossier');
    if (forNotes) {
      const f = useNotes.getState().createFolder(name, null);
      return { text: t('Dossier de notes « {name} » créé.', { name: f.name }), links: [{ label: t('Voir mes notes'), to: `/notes?dossier=${f.id}` }] };
    }
    const f = createDriveFolder(name, parent);
    return { text: t('Dossier « {name} » créé dans le Drive.', { name: f.name }), links: [{ label: t('Ouvrir le dossier'), to: linkToDriveFolder(f.id) }] };
  }

  // ── Add an event ──────────────────────────────────────────────────────────
  m = input.match(/^(?:ajoute|ajouter|planifie|programme|rappelle[- ]moi|note dans (?:le|mon) calendrier|mets?)\s+(?:un\s+|une\s+)?(?:[ée]v[ée]nement\s+|rdv\s+|rendez-vous\s+)?(.*)$/i);
  // « Planifie ma semaine », « mets de l'ordre dans mes fichiers »: a request, not an event to add.
  const vague = !!m && /^(?:(?:ma|mon|mes|la|cette|ce)\s+(?:semaine|journ[ée]e|soir[ée]e|week-?end|mois|matin[ée]e|planning|agenda)|de\s+l['’]ordre)\b/i.test(m[1]);
  if (m && !vague && !/\bnote\b/i.test(m[1].split(' ')[0])) {
    const parsed = parseQuickAdd(m[1]);
    if (parsed.title) {
      const date = parsed.date ?? todayKey();
      const ev = addEvent({ title: parsed.title, date, start: parsed.start ?? undefined, end: parsed.end ?? undefined, important: parsed.important });
      return {
        text: `${t('Ajouté au calendrier : {event}', { event: describeEvent(ev) })}${parsed.date ? '' : `\n${t('(Pas de date trouvée : je l’ai mis aujourd’hui.)')}`}`,
        links: [{ label: t('Voir le jour'), to: linkToDay(ev.date, ev.id) }],
      };
    }
  }

  // ── Analyse calendar ──────────────────────────────────────────────────────
  if (/(analys|resum|bilan|point sur|charge|organis|planifi).*(calendrier|semaine|planning|agenda|emploi du temps)|(calendrier|semaine|planning).*(analys|resum|bilan)/.test(q)) {
    return calendarReport();
  }

  // ── What's on a weekend or a week: « qu'est-ce qui est prévu ce week-end ? », « mon planning de la semaine » ──
  const period = askedPeriod(input);
  if (period?.kind === 'week') return calendarReport();
  if (period) {
    const list = eventsBetween(period.from, period.to);
    const span = { from: fmt(fromKey(period.from), 'EEEE d'), to: fmt(fromKey(period.to), 'EEEE d MMMM') };
    const kind = period.kind === 'weekend' ? (/prochain/.test(q) ? 'next-weekend' : 'weekend') : 'next-week';
    const more = list.length > 12 ? `\n${tn(list.length - 12, '… et {n} autre.', '… et {n} autres.')}` : '';
    const heading = { 'next-weekend': t('Le week-end prochain (du {from} au {to}) :', span), weekend: t('Ce week-end (du {from} au {to}) :', span), 'next-week': t('La semaine prochaine (du {from} au {to}) :', span) }[kind];
    const empty = { 'next-weekend': t('Rien de prévu le week-end prochain (du {from} au {to}) pour le moment.', span), weekend: t('Rien de prévu ce week-end (du {from} au {to}) pour le moment.', span), 'next-week': t('Rien de prévu la semaine prochaine (du {from} au {to}) pour le moment.', span) }[kind];
    return {
      text: list.length ? `${heading}\n${list.slice(0, 12).map(e => `- ${describeEvent(e)}`).join('\n')}${more}` : empty,
      links: [{ label: t('Voir le calendrier'), to: linkToDay(period.from) }],
    };
  }

  // ── What's on a day: « qu'est-ce que j'ai jeudi prochain ? », « je fais quoi demain », « demain ? » ──
  const day = askedDay(input);
  if (day) {
    const d = daysUntil(day);
    // The tasks of that day too (today: the late ones with them), after its events.
    const todos = listTodos().filter(x => x.due && (d === 0 ? x.due <= day : x.due === day));
    const list = [...eventsBetween(day, day).map(describeEvent), ...(todos.length ? [t('À faire : {list}.', { list: todos.map(x => x.title).join(', ') })] : [])];
    const date = fmt(fromKey(day), 'EEEE d MMMM');
    const near = d === 0 ? t('aujourd’hui') : d === 1 ? t('demain') : d === 2 ? t('après-demain') : '';
    // « jeudi », « le 15 » asked: the answer names that day too (« Demain, jeudi 15 octobre »).
    const named = /\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b|\d/.test(q);
    const name = near ? (named ? t('{near}, {date}', { near, date }) : near) : date;
    const empty = !named && d === 0
      ? t('Rien de prévu aujourd’hui.')
      : !named && d === 1
        ? t('Demain est libre pour le moment.')
        : near
          ? named ? t('Rien de prévu {near}, {date}, pour le moment.', { near, date }) : t('Rien de prévu {near} pour le moment.', { near })
          : t('Rien de prévu le {date} pour le moment.', { date });
    return {
      text: list.length ? `${t('{title} :', { title: name.charAt(0).toUpperCase() + name.slice(1) })}\n${list.join('\n')}` : empty,
      links: [{ label: d === 0 ? t('Voir aujourd’hui') : d === 1 ? t('Voir demain') : t('Voir le jour'), to: linkToDay(day) }, ...(todos.length ? [{ label: t('Tâches'), to: '/taches' }] : [])],
    };
  }
  if (/(examen|exam|partiel|controle|echeance|deadline|grand jour)s?/.test(q) && /(quand|prochain|liste|quels|quelles|mes|a venir)/.test(q)) {
    const exams = eventsBetween(todayKey(), '9999-12-31').filter(e => (getSettings().usage === 'etudes' ? e.category === 'examen' : isBigEvent(e)));
    return {
      text: exams.length ? `${t('{title} :', { title: words().upcoming })}\n${exams.slice(0, 6).map(describeEvent).join('\n')}` : words().noBig,
      links: [{ label: t('Calendrier'), to: '/calendrier' }],
    };
  }

  // ── List a Drive folder ───────────────────────────────────────────────────
  m = input.match(/(?:qu'?y a[- ]t[- ]il|qu'est-ce qu'il y a|contenu|montre(?:-moi)?|liste)\s+(?:dans\s+|du\s+|le\s+)?(?:le\s+|mon\s+)?(?:dossier\s+)?(.+)$/i);
  if (m && !/(calendrier|semaine|notes?$)/i.test(m[1])) {
    const target = unquote(m[1].replace(/\?$/, ''));
    const res = /^(drive|mon drive|mes fichiers)$/i.test(target) ? listDriveFolder() : listDriveFolder(target);
    if (res) {
      return {
        text: res.content.length
          ? `${tn(res.content.length, 'Dans « {folder} » ({n} élément) :', 'Dans « {folder} » ({n} éléments) :', { folder: res.folder })}\n${res.content.slice(0, 12).map(c => `${c.type === 'dossier' ? '📁' : '📄'} ${c.name}${c.size ? ` · ${c.size}` : ''}`).join('\n')}`
          : t('Le dossier « {folder} » est vide.', { folder: res.folder }),
        links: [{ label: t('Ouvrir'), to: res.link }],
      };
    }
  }

  // ── Find something ────────────────────────────────────────────────────────
  m = input.match(/(?:trouve|cherche|recherche|o[uù] est|o[uù] sont|retrouve|j'ai perdu|localise)\s*(?:-moi)?\s+(?:le |la |les |l'|mon |ma |mes |un |une )?(?:dossier |fichier |note |document |cours )?(.+)$/i);
  if (m) {
    const term = unquote(m[1].replace(/\?$/, ''));
    const hits = search(term);
    if (!hits.length) return { text: t('Rien trouvé pour « {term} ». Essaie un autre mot ?', { term }) };
    return {
      text: `${tn(hits.length, 'J’ai trouvé {n} résultat pour « {term} » :', 'J’ai trouvé {n} résultats pour « {term} » :', { term })}\n${hits.map(h => `• ${h.title} (${HIT_LABEL[h.type]})${h.where ? ` — ${h.where}` : ''}`).join('\n')}`,
      // Two hits with the same name (the sessions of a plan, a note in two folders): their day or place tells them apart.
      links: hits.slice(0, 4).map((h, _i, shown) => {
        const label = (h.type === 'événement' || hits.filter(x => x.title === h.title).length > 1) && h.where ? `${h.title} · ${h.where}` : h.title;
        // Still the same (two notes of the same name in one folder): numbered.
        const same = shown.filter(x => x.title === h.title && x.where === h.where);
        return { label: same.length > 1 ? `${label} (${same.indexOf(h) + 1})` : label, to: h.to };
      }),
    };
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  if (/(ouvre|va|aller|emmene|montre).*(drive|fichiers)/.test(q)) return { text: t('On y va.'), links: [{ label: t('Drive'), to: '/drive' }] };
  if (/(ouvre|va|aller|emmene|montre).*agendas? partages?/.test(q)) return { text: t('Tes agendas partagés, c’est par ici.'), links: [{ label: t('Agendas partagés'), to: '/agendas' }] };
  if (/(ouvre|va|aller|emmene|montre).*(calendrier|agenda|planning)/.test(q)) return { text: t('Direction le calendrier.'), links: [{ label: t('Calendrier'), to: '/calendrier' }] };
  if (/(ouvre|va|aller|emmene|montre).*notes/.test(q)) return { text: t('Tes notes t’attendent.'), links: [{ label: t('Notes'), to: '/notes' }] };
  if (/(ouvre|va|aller|emmene|montre).*(taches|todo|to-do|a faire|progression|temps de travail)/.test(q)) return { text: t('Voilà ta liste.'), links: [{ label: t('Tâches'), to: '/taches' }] };
  if (/(ouvre|va|aller|emmene|montre).*badges?/.test(q)) return { text: t('Tes badges sont dans ton profil.'), links: [{ label: t('Mes badges'), to: '/profil#badges' }] };
  if (/(ouvre|va|aller|emmene|montre).*(groupes?|equipes?)/.test(q)) {
    const w = groupWords(getSettings().usage);
    return { text: t('Tes {groups}, c’est par ici.', { groups: w.groups }), links: [{ label: w.Groups, to: '/groupes' }] };
  }
  if (/(ouvre|va|aller|emmene|montre).*(dashboard|accueil|tableau)/.test(q)) return { text: t('Retour au QG.'), links: [{ label: t('Accueil'), to: '/' }] };

  // ── Overview ──────────────────────────────────────────────────────────────
  if (/(resume|bilan|vue d'ensemble|etat|statistiques|stats)/.test(q)) {
    const o = overview();
    return {
      text: [
        t('Petit bilan 📊'),
        t('📁 Drive : {folders}, {files} ({size})', { folders: tn(o.drive.folders, '{n} dossier', '{n} dossiers'), files: tn(o.drive.files, '{n} fichier', '{n} fichiers'), size: o.drive.totalSize }),
        t('📝 Notes : {notes}', { notes: tn(o.notes.count, '{n} note', '{n} notes') }),
        o.calendar.exams.length
          ? t('📅 Cette semaine : {events}, {n} {big} à venir', { events: tn(o.calendar.weekCount, '{n} événement', '{n} événements'), n: o.calendar.exams.length, big: o.calendar.exams.length > 1 ? words().bigMany : words().bigOne })
          : t('📅 Cette semaine : {events}', { events: tn(o.calendar.weekCount, '{n} événement', '{n} événements') }),
      ].join('\n'),
    };
  }

  // ── Small talk ────────────────────────────────────────────────────────────
  if (/^(salut|bonjour|hello|hey|yo|coucou|bonsoir|wesh|cc)\b/.test(q)) {
    return { text: pick([t('Salut ! 👋 Je surveillais ton écran, tout roule ?'), t('Hey ! Besoin d’un coup de main ?'), t('Coucou 😄 Qu’est-ce que je peux faire pour toi ?')]) };
  }
  if (/\b(merci|super|genial|top|parfait|nickel)\b/.test(q)) return { text: pick([t('Avec plaisir 😎'), t('Toujours là pour toi !'), t('De rien, je retourne me cacher derrière l’écran 👀')]) };
  if (/(qui es[- ]tu|t'es qui|c'est quoi ton nom|presente)/.test(q)) {
    return { text: t('Moi c’est Kompaly 🤖 Je retrouve tes fichiers, j’analyse ton calendrier, je crée notes, dossiers et événements. Demande-moi !') };
  }
  if (/(fatigue|stress|motivation|demotive|j'en peux plus|flemme)/.test(q)) {
    return { text: pick([t('Respire 🌬️ Fais d’abord la plus petite tâche, le reste suivra.'), t('25 min de focus, 5 min de pause : dis « lance une session focus » pour commencer.')]) };
  }

  const ex = EXAMPLES[getSettings().usage] ?? EXAMPLES.etudes;
  // A request for help, anywhere in a short sentence (« Aide ! », « aide-moi », « j'ai besoin d'aide », « qu'est-ce que tu sais faire ? »).
  if (/^\?+$|\b(aide|help|au secours)\b|(sais|peux)[- ]tu faire|tu (sais|peux) faire( quoi)?|tu (sers|peux servir) a quoi|a quoi (tu sers|sers[- ]tu|tu peux servir)/.test(q.replace(/[’‘]/g, "'"))) {
    return { text: `${t('Voilà ce que je sais faire sans IA :')}\n${ex.map(e => `- ${e}`).join('\n')}` };
  }
  // Said plainly: without the AI (none set up, paused or failing), only simple requests are understood.
  return { text: `${t('Je n’ai pas tout compris : l’IA n’est pas disponible, je comprends seulement des demandes simples. Essaie par exemple :')}\n${ex.slice(0, 4).map(e => `- ${e}`).join('\n')}\n${t('(« aide » pour tout voir)')}`, unknown: true };
}
