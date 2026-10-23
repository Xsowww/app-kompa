// Everything Kompaly can *do* on the site. Used by both the built-in French
// command engine and the Claude-powered mode (as tools).

import { addDays } from 'date-fns';
import { useDrive, pathOf, childrenOf, categoryOf, FOLDER_COLORS, type DriveItem } from '../store/drive';
import { collectTrash, restoreTrash } from '../lib/trash';
import { useNotes, type Note, type NoteFolder } from '../store/notes';
import { useCalendar, catOf, guessCategory, customCategoryIn, customNamed, createCategory, isDeliverable, isBigEvent, sortEvents, type CalendarEvent, type EventCategory } from '../store/calendar';
import { useTodos } from '../store/todos';
import { useFocus, focusLeft } from '../store/focus';
import { normalize, noteText, stripHtml, formatBytes } from '../lib/utils';
import { toKey, todayKey, daysUntil, fromKey, fmt, fmtDay, weekStart, countdownLabel } from '../lib/dates';
import type { CopilotLink } from '../store/copilot';
import type { Group, GroupEvent, GroupNoteSummary } from '../lib/groups';
import { getSettings, useSettings, applyAppearance, ACCENTS, type Settings, type AccentKey, type ThemeMode, type Chattiness } from '../store/settings';
import { usageWords } from '../lib/usage';
import { hasTwin, noteFor, noteTitle, notePrefix, pickExam, planTag, sessionPrefix, sessionsFor } from './revisionPlan';
import { lang, t, tn } from '../i18n';

// Studies: revision sessions and a revision sheet; work and personal life: time to prepare and a checklist.
const studying = () => (getSettings().usage ?? 'etudes') === 'etudes';

let navigateFn: ((to: string) => void) | null = null;
export const registerNavigate = (fn: (to: string) => void) => {
  navigateFn = fn;
};
export const goTo = (to: string) => navigateFn?.(to);

export const linkToDriveFolder = (id: string | null) => (id ? `/drive?dossier=${id}` : '/drive');
/** A file in its folder, its preview open (a PDF on `page`, when given). */
export const linkToDriveFile = (it: { id: string; parentId: string | null }, page?: number) =>
  `${linkToDriveFolder(it.parentId)}${it.parentId ? '&' : '?'}fichier=${it.id}${page && page > 1 ? `&page=${page}` : ''}`;
export const linkToNote = (id: string) => `/notes?note=${id}`;
/** A day of the calendar; with an event, that event glows once there (lib/flash). */
export const linkToDay = (date: string, eventId?: string) => `/calendrier?jour=${date}${eventId ? `&evt=${eventId}` : ''}`;

export interface SearchHit {
  type: 'dossier' | 'fichier' | 'note' | 'dossier de notes' | 'événement' | 'tâche' | 'note partagée' | 'événement partagé';
  id: string;
  title: string;
  where: string;
  to: string;
}

/** What a search hit is, as shown in a sentence (« Maths (dossier) »). */
export const HIT_LABEL: Record<SearchHit['type'], string> = {
  dossier: t('dossier'),
  fichier: t('fichier'),
  note: t('note'),
  'dossier de notes': t('dossier de notes'),
  événement: t('événement'),
  tâche: t('tâche'),
  'note partagée': t('note partagée'),
  'événement partagé': t('événement partagé'),
};

/** What the groups and shared calendars already read hold (store/groups), searched without asking the server. */
export interface SharedContent {
  groups: Group[];
  notes: Record<string, GroupNoteSummary[]>;
  events: Record<string, GroupEvent[]>;
}

// Texts prepared for searching, kept per object: an item, note or event is a new object when it changes,
// so only what changed is prepared again (a note's full text was stripped and normalised at each key typed).
const prepared = new WeakMap<object, Map<string, string>>();
function prep(obj: object, field: string, make: () => string) {
  let m = prepared.get(obj);
  if (!m) prepared.set(obj, (m = new Map()));
  let v = m.get(field);
  if (v === undefined) m.set(field, (v = make()));
  return v;
}

const score = (h: string, q: string) => {
  if (h === q) return 3;
  if (h.startsWith(q)) return 2;
  if (h.includes(q)) return 1;
  // every word of the query appears somewhere
  return q.split(/\s+/).every(w => h.includes(w)) ? 0.5 : 0;
};

// `where` never repeats what the hit is (« Notes » for a note, « Tâches » for a task): its type is shown beside it.
export function search(query: string, limit = 8, shared?: SharedContent): SearchHit[] {
  const q = normalize(query);
  if (!q) return [];
  const hits: (SearchHit & { s: number })[] = [];
  const { items } = useDrive.getState();
  for (const it of items) {
    const s = score(prep(it, 'name', () => normalize(it.name)), q);
    if (!s) continue;
    const where = [t('Drive'), ...pathOf(items, it.parentId).map(p => p.name)].join(' › ');
    hits.push({
      s: s + (it.kind === 'folder' ? 0.2 : 0),
      type: it.kind === 'folder' ? 'dossier' : 'fichier',
      id: it.id,
      title: it.name,
      where,
      to: it.kind === 'folder' ? linkToDriveFolder(it.id) : linkToDriveFile(it),
    });
  }
  const { notes, folders } = useNotes.getState();
  for (const f of folders) {
    const s = score(prep(f, 'name', () => normalize(f.name)), q);
    if (s) hits.push({ s, type: 'dossier de notes', id: f.id, title: f.name, where: folders.find(p => p.id === f.parentId)?.name ?? '', to: `/notes?dossier=${f.id}` });
  }
  for (const n of notes) {
    const s = Math.max(score(prep(n, 'title', () => normalize(n.title)), q), score(prep(n, 'text', () => normalize(noteText(n))), q) * 0.6);
    if (s) {
      const folder = folders.find(f => f.id === n.folderId);
      hits.push({ s, type: 'note', id: n.id, title: n.title, where: folder?.name ?? '', to: linkToNote(n.id) });
    }
  }
  for (const e of useCalendar.getState().events) {
    const s = score(prep(e, 'title', () => normalize(e.title)), q);
    if (s) hits.push({ s, type: 'événement', id: e.id, title: e.title, where: fmtDay(fromKey(e.date), 'EEEE d MMMM'), to: linkToDay(e.date, e.id) });
  }
  // Tasks still to do (a ticked one leaves the list: nothing to open there).
  for (const todo of useTodos.getState().todos) {
    const s = todo.done ? 0 : score(prep(todo, 'title', () => normalize(todo.title)), q);
    if (s) hits.push({ s, type: 'tâche', id: todo.id, title: todo.title, where: todo.due ? fmtDay(fromKey(todo.due), 'EEEE d MMMM') : '', to: `/taches?tache=${todo.id}` });
  }
  // Groups and shared calendars: their notes (titles) and events, a little after my own things.
  for (const g of shared?.groups ?? []) {
    for (const n of shared?.notes[g.id] ?? []) {
      const s = score(prep(n, 'title', () => normalize(n.title)), q);
      if (s) hits.push({ s: s * 0.9, type: 'note partagée', id: n.id, title: n.title, where: g.name, to: `/groupes?g=${g.id}&onglet=notes&note=${n.id}` });
    }
    for (const e of shared?.events[g.id] ?? []) {
      const s = score(prep(e, 'title', () => normalize(e.title)), q);
      const to = g.kind === 'agenda' ? `/agendas?g=${g.id}` : `/groupes?g=${g.id}&onglet=revisions`;
      if (s) hits.push({ s: s * 0.9, type: 'événement partagé', id: e.id, title: e.title, where: `${g.name} · ${fmtDay(fromKey(e.date), 'EEEE d MMMM')}`, to });
    }
  }
  return hits.sort((a, b) => b.s - a.s).slice(0, limit).map(({ s: _s, ...h }) => h);
}

export function eventsBetween(from: string, to: string) {
  return useCalendar
    .getState()
    .events.filter(e => e.date >= from && e.date <= to)
    .sort(sortEvents);
}

export function describeEvent(e: { title: string; date: string; start?: string; end?: string; category: EventCategory; done?: boolean; important?: boolean }) {
  const c = catOf(e.category);
  // « 9h », « 14h30 » in French; the other languages keep « 09:00 » (« um 9h » read wrong), and their capitals (German nouns).
  const fr = lang === 'fr';
  const h = (hm: string) => (fr ? hm.replace(':', 'h').replace(/h00$/, 'h').replace(/^0(?=\d)/, '') : hm);
  const time = e.start ? ` ${t('à {time}', { time: `${h(e.start)}${e.end ? `–${h(e.end)}` : ''}` })}` : '';
  return `${e.title} (${fr ? c.label.toLowerCase() : c.label}) — ${fmtDay(fromKey(e.date), 'EEEE d MMM')}${time}${e.important ? ` · ${t('important')}` : ''}${e.done ? ` · ${t('fait')}` : ''}`;
}

export function analyzeCalendar() {
  const today = todayKey();
  const ws = weekStart(new Date());
  const weekEnd = toKey(addDays(ws, 6));
  const week = eventsBetween(toKey(ws), weekEnd);
  const upcoming = eventsBetween(today, toKey(addDays(new Date(), 30)));
  const exams = upcoming.filter(e => (studying() ? e.category === 'examen' : isBigEvent(e)));
  const late = useCalendar.getState().events.filter(e => isDeliverable(e) && !e.done && e.date < today);
  const todayEvents = eventsBetween(today, today);

  const perDay = new Map<string, number>();
  for (const e of week) perDay.set(e.date, (perDay.get(e.date) ?? 0) + 1);
  const busiest = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const done = week.filter(e => e.done).length;

  return {
    today: todayEvents,
    weekCount: week.length,
    weekDone: done,
    busiestDay: busiest ? { date: busiest[0], count: busiest[1] } : null,
    exams,
    lateHomework: late,
    nextDeadlines: upcoming.filter(e => isDeliverable(e) && !e.done).slice(0, 5),
  };
}

/** « Demain » → « demain » inside a sentence; « J-3 » stays. */
const inSentence = (label: string) => label.replace(/^\p{Lu}(?=\p{Ll})/u, c => c.toLowerCase());

export function calendarReport(): { text: string; links: CopilotLink[] } {
  const a = analyzeCalendar();
  const w = usageWords(getSettings().usage);
  const lines: string[] = [];
  lines.push(
    a.today.length
      ? t('Aujourd’hui : {list}.', { list: a.today.map(e => e.title).join(', ') })
      : t('Rien de prévu aujourd’hui.'),
  );
  lines.push(t('Cette semaine : {events}, {done}.', { events: tn(a.weekCount, '{n} événement', '{n} événements'), done: tn(a.weekDone, '{n} déjà fait', '{n} déjà faits') }));
  if (a.busiestDay && a.busiestDay.count > 1) {
    lines.push(t('Jour le plus chargé : {day} ({n} événements).', { day: fmt(fromKey(a.busiestDay.date), 'EEEE'), n: a.busiestDay.count }));
  }
  if (a.exams.length) {
    const list = a.exams.map(e => `${e.title} (${inSentence(countdownLabel(e.date))})`).join(', ');
    lines.push(t('{big} à venir : {list}.', { big: `${w.bigMany.charAt(0).toUpperCase()}${w.bigMany.slice(1)}`, list }));
    const soon = a.exams.find(e => daysUntil(e.date) <= 7);
    if (soon) lines.push(studying() ? t('Conseil : révise « {title} » un peu chaque jour, dès maintenant.', { title: soon.title }) : t('Conseil : prépare « {title} » un peu chaque jour, dès maintenant.', { title: soon.title }));
  }
  const late = a.lateHomework;
  if (late.length) {
    const list = late.map(e => e.title).join(', ');
    lines.push(studying() ? tn(late.length, 'Attention, {n} devoir en retard : {list}.', 'Attention, {n} devoirs en retard : {list}.', { list }) : t('Attention, en retard : {list}.', { list }));
  } else if (a.nextDeadlines.length) {
    const next = { title: a.nextDeadlines[0].title, when: inSentence(countdownLabel(a.nextDeadlines[0].date)) };
    lines.push(studying() ? t('Prochain rendu : {title} ({when}).', next) : t('À faire ensuite : {title} ({when}).', next));
  }
  return { text: lines.join('\n'), links: [{ label: t('Ouvrir le calendrier'), to: '/calendrier' }] };
}

export function findDriveFolderByName(name: string) {
  const q = normalize(name);
  const folders = useDrive.getState().items.filter(i => i.kind === 'folder');
  return folders.find(f => f.id === name) ?? folders.find(f => normalize(f.name) === q) ?? folders.find(f => normalize(f.name).includes(q));
}

export function findNoteFolderByName(name: string) {
  const q = normalize(name);
  const { folders } = useNotes.getState();
  return folders.find(f => f.id === name) ?? folders.find(f => normalize(f.name) === q) ?? folders.find(f => normalize(f.name).includes(q));
}

export function createNote(title: string, content = '', folderName?: string) {
  let folderId: string | null = null;
  if (folderName) {
    folderId = (findNoteFolderByName(folderName) ?? useNotes.getState().createFolder(folderName, null)).id;
  }
  return useNotes.getState().createNote({ title, content: textToHtml(content), folderId });
}

export function createDriveFolder(name: string, parentName?: string) {
  const parent = parentName ? findDriveFolderByName(parentName) : undefined;
  return useDrive.getState().createFolder(name, parent?.id ?? null);
}

export function addEvent(input: { title: string; date: string; start?: string; end?: string; category?: EventCategory; important?: boolean }) {
  return useCalendar.getState().add({
    title: input.title,
    date: input.date,
    start: input.start || undefined,
    end: input.end || undefined,
    // The student's own category named in the title wins over the AI's pick among the built-in ones.
    category: customCategoryIn(input.title) ?? input.category ?? guessCategory(input.title, !!input.start),
    important: input.important || undefined,
  });
}

export function overview() {
  const { items } = useDrive.getState();
  const files = items.filter(i => i.kind === 'file');
  const { notes, folders } = useNotes.getState();
  return {
    drive: {
      folders: items.filter(i => i.kind === 'folder').length,
      files: files.length,
      totalSize: formatBytes(files.reduce((s, f) => s + (f.size ?? 0), 0)),
      rootContent: childrenOf(items, null).map(i => `${i.kind === 'folder' ? '📁' : '📄'} ${i.name}`),
    },
    notes: { count: notes.length, folders: folders.map(f => f.name) },
    todos: listTodos().slice(0, 15),
    focus: focusStatus(),
    calendar: analyzeCalendar(),
  };
}

export function listDriveFolder(folderName?: string) {
  const { items } = useDrive.getState();
  const folder = folderName ? findDriveFolderByName(folderName) : undefined;
  if (folderName && !folder) return null;
  return {
    folder: folder?.name ?? t('Drive (racine)'),
    path: folder ? [t('Drive'), ...pathOf(items, folder.id).map(p => p.name)].join(' › ') : t('Drive'),
    link: linkToDriveFolder(folder?.id ?? null),
    content: childrenOf(items, folder?.id ?? null).map(i => ({
      id: i.id,
      name: i.name,
      type: i.kind === 'folder' ? 'dossier' : categoryOf(i),
      size: i.kind === 'file' ? formatBytes(i.size) : undefined,
    })),
  };
}

export function readNote(id: string) {
  const n = useNotes.getState().notes.find(x => x.id === id);
  return n ? { title: n.title, text: stripHtml(n.content) } : null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
/** Escaped text with **bold** turned into <strong>. */
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/** Plain text → note HTML: "# " = heading, "- " = bullet, "[ ] " = checkbox, other lines = paragraphs. */
export function textToHtml(text: string): string {
  const out: string[] = [];
  let list: 'ul' | 'task' | null = null;
  const close = () => {
    if (list) out.push('</ul>');
    list = null;
  };
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line) {
      close();
      continue;
    }
    // The line is trimmed: an empty « [ ] » or « - » (a plan to fill in) has no space left after it.
    const task = line.match(/^[-*]?\s*\[( |x)\](?:\s+(.*))?$/i);
    if (task) {
      if (list !== 'task') {
        close();
        out.push('<ul data-type="taskList">');
        list = 'task';
      }
      out.push(`<li data-type="taskItem" data-checked="${task[1].toLowerCase() === 'x'}"><p>${inline(task[2] ?? '')}</p></li>`);
    } else if (/^[-*•](?:\s+|$)/.test(line)) {
      if (list !== 'ul') {
        close();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li><p>${inline(line.replace(/^[-*•]\s*/, ''))}</p></li>`);
    } else if (/^#{1,3}\s+/.test(line)) {
      close();
      out.push(`<h2>${inline(line.replace(/^#{1,3}\s+/, ''))}</h2>`);
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join('');
}

export function appendToNote(id: string, text: string) {
  const n = useNotes.getState().notes.find(x => x.id === id);
  if (!n) return null;
  useNotes.getState().updateNote(id, { content: n.content + textToHtml(text) });
  return n;
}

/** The upcoming exam named in `query` (id, title words, day), or the next one when `query` names none. */
export function findExam(query: string) {
  return pickExam(query, useCalendar.getState().events, todayKey(), !studying());
}

/** An upcoming event of any kind whose title has every word of `query` (« la réunion client »). */
export function eventNamed(query: string) {
  return pickExam(query, useCalendar.getState().events.map(e => ({ ...e, important: true })), todayKey(), true);
}

const revisionTitle = (examTitle: string) => sessionPrefix(studying()) + examTitle;
/** « Ouvrir la fiche » (studies) or « Ouvrir la note ». */
export const openNoteLabel = () => (studying() ? t('Ouvrir la fiche') : t('Ouvrir la note'));

/** Revision (or preparation) sessions already planned for an exam, earliest first. */
export function revisionSessions(exam: CalendarEvent) {
  return sessionsFor(exam, useCalendar.getState().events);
}

export function hasRevisionPlan(exam: CalendarEvent) {
  return revisionSessions(exam).length > 0;
}

/** The revision sheet (« À préparer » note outside studies) of an exam, if there is one. */
export function revisionNote(exam: CalendarEvent) {
  return noteFor(exam, useNotes.getState().notes, useCalendar.getState().events);
}

/** « « Contrôle de maths » », with its day when another exam has the same title (« … » du 10 novembre). */
export function examLabel(exam: CalendarEvent) {
  return hasTwin(exam, useCalendar.getState().events)
    ? t('« {title} » du {date}', { title: exam.title, date: fmt(fromKey(exam.date), 'd MMMM') })
    : t('« {title} »', { title: exam.title });
}

/** Kompaly's answer when asked to plan an exam that already has its sessions (no duplicates). */
export function alreadyPlanned(exam: CalendarEvent) {
  const first = revisionSessions(exam)[0];
  const note = revisionNote(exam);
  return {
    text: studying()
      ? t('C’est déjà planifié pour {exam} : tes séances de révision sont dans le calendrier.', { exam: examLabel(exam) })
      : t('C’est déjà planifié pour {exam} : tes créneaux de préparation sont dans le calendrier.', { exam: examLabel(exam) }),
    links: [
      ...(first ? [{ label: t('Voir le planning'), to: linkToDay(first.date) }] : []),
      ...(note ? [{ label: openNoteLabel(), to: linkToNote(note.id) }] : []),
    ],
  };
}

/**
 * What a preparation note holds, by what is being prepared: a meeting (client, interview…) gets what to
 * bring, the questions and the minutes to fill in after; anything else a plain to-do.
 */
export function prepTemplate(title: string): string {
  if (/\b(client|rendez|rdv|r[ée]union|meeting|entretien|visio|appel|call|pr[ée]sentation|soutenance|oral)\b/i.test(title))
    return t('# Objectif du rendez-vous\n- \n# À préparer ou envoyer avant\n[ ] Documents utiles (devis, présentation…)\n[ ] Relire les derniers échanges\n[ ] \n# Questions à poser\n- \n# Points à aborder\n- \n# Compte rendu (après)\n- Décisions :\n- Prochaines étapes :\n- À relancer le :');
  return t('# Objectif\n- \n# À préparer\n[ ] \n[ ] \n# Points à ne pas oublier\n- \n# Après\n- ');
}

/** Creates (or reuses) the revision sheet of an exam, in the "Révisions" notes folder (« Préparation » outside studies). */
export function createRevisionNote(examId: string) {
  const exam = useCalendar.getState().events.find(e => e.id === examId);
  if (!exam) return null;
  const existing = revisionNote(exam);
  if (existing) return existing;
  const title = noteTitle(notePrefix(studying()), exam, useCalendar.getState().events);
  const note = studying()
    ? createNote(title, t('# Ce qui tombe\n- Chapitres à revoir :\n- Type d’épreuve :\n# À retenir\n- \n# Mes points faibles\n[ ] \n# Questions à poser au prof\n- '), t('Révisions'))
    : createNote(title, prepTemplate(exam.title), t('Préparation'));
  // Linked to its exam: two exams with the same title each get their own.
  useNotes.getState().updateNote(note.id, { links: [{ kind: 'event', id: exam.id }] });
  return useNotes.getState().notes.find(n => n.id === note.id) ?? note;
}

/**
 * Category of the preparation sessions: « Devoir » for studies, « À faire » for personal life; at work the
 * built-in ones (Réunion, Échéance, Devis…) don't fit, so a « Préparation » category of the account's own.
 */
function sessionCategory(): EventCategory {
  if (getSettings().usage !== 'travail') return 'devoir';
  return (customNamed(t('Préparation')) ?? createCategory(t('Préparation'), '#1f8a8a')).id;
}

const toHm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Hours of a 1h30 revision session on `date`: the usual time, or, on the exam day, a slot that
 * ends 30 min before the exam (null when there is no time left). Today after the usual time:
 * no hours, the session stays in the day's list, unless less than 1h30 is left before midnight
 * (null: a « session » at 23:50 is no session).
 */
function revisionSlot(date: string, at: string, examStart: string | undefined, now: Date): { start?: string; end?: string } | null {
  const isToday = date === toKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (examStart) {
    const end = toMin(examStart) - 30;
    const start = Math.max(end - 90, isToday ? Math.ceil(nowMin / 15) * 15 : 0);
    return end - start >= 30 ? { start: toHm(start), end: toHm(end) } : null;
  }
  if (isToday && nowMin > toMin(at)) return 24 * 60 - nowMin >= 90 ? {} : null;
  return { start: at, end: toHm(Math.min(23 * 60 + 59, toMin(at) + 90)) };
}

/** Spreads revision sessions over the days before an exam, at the usual revision time. None for a past exam. */
export function planRevisions(examId: string, sessions = getSettings().revisionSessions) {
  const exam = useCalendar.getState().events.find(e => e.id === examId);
  if (!exam) return null;
  const n = Math.min(6, Math.max(1, Math.round(sessions)));
  const until = daysUntil(exam.date);
  const today = new Date();
  const candidates: string[] = [];
  // Prefer J-1, J-3, J-5… then fill remaining days, never in the past.
  const order = [1, 3, 5, 2, 4, 6, 7, 9, 11, 13];
  for (const d of order) {
    if (d < until || (d === until && until === 0)) {
      const key = toKey(addDays(fromKey(exam.date), -d));
      if (key >= toKey(today)) candidates.push(key);
    }
  }
  if (candidates.length === 0) candidates.push(todayKey());
  const chosen = until < 0 ? [] : [...new Set(candidates)].slice(0, n).sort();
  const at = getSettings().revisionTime || '18:00';
  const created = chosen.flatMap(date => {
    const slot = revisionSlot(date, at, exam.date === date ? exam.start : undefined, today);
    if (!slot) return [];
    return [
      useCalendar.getState().add({
        title: revisionTitle(exam.title),
        date,
        ...slot,
        category: sessionCategory(),
        details: studying()
          ? t('Préparation de l’examen du {date}.', { date: fmt(fromKey(exam.date), 'EEEE d MMMM') })
          : t('Pour préparer « {title} », le {date}.', { title: exam.title, date: fmt(fromKey(exam.date), 'EEEE d MMMM') }),
        externalId: planTag(exam.id),
      }),
    ];
  });
  const note = createRevisionNote(exam.id);
  return { exam, created, note };
}

export function updateEvent(id: string, patch: { title?: string; date?: string; start?: string; end?: string; done?: boolean; important?: boolean }) {
  const ev = useCalendar.getState().events.find(e => e.id === id);
  if (!ev) return null;
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== ''));
  useCalendar.getState().update(id, clean);
  return useCalendar.getState().events.find(e => e.id === id)!;
}

export function deleteEvent(id: string) {
  const ev = useCalendar.getState().events.find(e => e.id === id);
  if (!ev) return null;
  useCalendar.getState().remove(id);
  return ev;
}

// ── Organising the Drive and the notes ───────────────────────────────────────

/** A Drive item, a note or a notes folder. */
export type SiteItem = { space: 'drive'; item: DriveItem } | { space: 'note'; item: Note } | { space: 'notes-folder'; item: NoteFolder };

/** Finds a Drive item, a note or a notes folder by id (or by exact name as a fallback). */
export function findItem(ref: string): SiteItem | null {
  const { items } = useDrive.getState();
  const { notes, folders } = useNotes.getState();
  const d = items.find(i => i.id === ref);
  if (d) return { space: 'drive', item: d };
  const n = notes.find(i => i.id === ref);
  if (n) return { space: 'note', item: n };
  const f = folders.find(i => i.id === ref);
  if (f) return { space: 'notes-folder', item: f };
  const q = normalize(ref);
  if (!q) return null;
  const dn = items.find(i => normalize(i.name) === q);
  if (dn) return { space: 'drive', item: dn };
  const nn = notes.find(i => normalize(i.title) === q);
  if (nn) return { space: 'note', item: nn };
  const fn = folders.find(i => normalize(i.name) === q);
  return fn ? { space: 'notes-folder', item: fn } : null;
}

export const itemName = (s: SiteItem) => (s.space === 'note' ? s.item.title : s.item.name);

export function linkToItem(s: SiteItem): string {
  if (s.space === 'note') return linkToNote(s.item.id);
  if (s.space === 'notes-folder') return `/notes?dossier=${s.item.id}`;
  const it = s.item;
  return it.kind === 'folder' ? linkToDriveFolder(it.id) : `${linkToDriveFolder(it.parentId)}${it.parentId ? '&' : '?'}fichier=${it.id}`;
}

export function renameItem(ref: string, name: string) {
  const s = findItem(ref);
  if (!s || !name.trim()) return null;
  if (s.space === 'drive') useDrive.getState().rename(s.item.id, name);
  else if (s.space === 'note') useNotes.getState().updateNote(s.item.id, { title: name.trim() });
  else useNotes.getState().renameFolder(s.item.id, name);
  return findItem(s.item.id);
}

/** Moves a Drive item into a Drive folder, or a note / notes folder into a notes folder. `folder` empty = root. */
export function moveItem(ref: string, folder?: string): { moved: SiteItem; to: string } | { error: string } {
  const s = findItem(ref);
  if (!s) return { error: t('élément introuvable') };
  if (s.space === 'drive') {
    const target = folder ? findDriveFolderByName(folder) : undefined;
    if (folder && !target) return { error: t('dossier de destination introuvable dans le Drive') };
    const n = useDrive.getState().move([s.item.id], target?.id ?? null);
    if (!n && s.item.parentId !== (target?.id ?? null)) return { error: t('impossible de déplacer un dossier dans lui-même') };
    return { moved: findItem(s.item.id)!, to: target?.name ?? t('Drive (racine)') };
  }
  const target = folder ? findNoteFolderByName(folder) : undefined;
  if (folder && !target) return { error: t('dossier de notes introuvable') };
  if (s.space === 'note') useNotes.getState().updateNote(s.item.id, { folderId: target?.id ?? null });
  else {
    useNotes.getState().moveFolder(s.item.id, target?.id ?? null);
    if (useNotes.getState().folders.find(f => f.id === s.item.id)?.parentId !== (target?.id ?? null)) return { error: t('impossible de déplacer un dossier dans lui-même') };
  }
  return { moved: findItem(s.item.id)!, to: target?.name ?? t('Notes (racine)') };
}

export function setStar(ref: string, starred = true) {
  const s = findItem(ref);
  if (!s || s.space !== 'drive') return null;
  if (Boolean(s.item.starred) !== starred) useDrive.getState().toggleStar(s.item.id);
  return s.item;
}

export function setFolderColor(ref: string, color: string) {
  const folder = findDriveFolderByName(ref);
  const key = normalize(color);
  if (!folder || (key !== 'aucune' && !FOLDER_COLORS[key])) return null;
  useDrive.getState().update(folder.id, { color: key === 'aucune' ? undefined : key });
  return folder;
}

/** Puts Drive items, notes and notes folders in the trash. */
export function trashItems(refs: string[]) {
  const done: string[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    const s = findItem(ref);
    if (!s) {
      missing.push(ref);
      continue;
    }
    if (s.space === 'drive') useDrive.getState().remove([s.item.id]);
    else if (s.space === 'note') useNotes.getState().removeNote(s.item.id);
    else useNotes.getState().removeFolder(s.item.id);
    done.push(itemName(s));
  }
  return { done, missing };
}

const deletedLabel = (iso?: string) => (iso ? fmt(new Date(iso), t("d MMM 'à' HH:mm")) : '');

const TRASH_LABEL = { note: t('note'), noteFolder: t('dossier de notes'), event: t('événement') };

/** Everything in the trash (Notes, Drive and Calendar), newest first. */
export function listTrash() {
  return collectTrash().map(e => ({
    id: e.id,
    name: e.name,
    type: e.kind === 'drive' ? (e.item.kind === 'folder' ? t('dossier du Drive') : t('fichier du Drive')) : TRASH_LABEL[e.kind],
    from: e.place,
    deleted: deletedLabel(e.deletedAt),
  }));
}

/** Finds something in the trash by id or by name. */
export function findInTrash(ref: string) {
  const all = listTrash();
  const q = normalize(ref);
  return all.find(x => x.id === ref) ?? all.find(x => normalize(x.name) === q) ?? all.find(x => q.length > 2 && normalize(x.name).includes(q));
}

export function restoreFromTrash(refs: string[]) {
  const restored: string[] = [];
  const missing: string[] = [];
  const links: CopilotLink[] = [];
  for (const ref of refs) {
    const found = findInTrash(ref);
    if (!found) {
      missing.push(ref);
      continue;
    }
    const r = restoreTrash([found.id]);
    restored.push(found.name);
    if (r.href) links.push({ label: found.name, to: r.href });
  }
  return { restored, missing, links };
}

/** Notes whose text contains `query`, with a short excerpt around each match. */
export function searchNotes(query: string, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const out: { id: string; title: string; excerpts: string[] }[] = [];
  for (const n of useNotes.getState().notes) {
    const text = stripHtml(n.content);
    // normalize() keeps one character per letter (accents are separate marks it removes),
    // so positions in the normalized text are close enough to cut an excerpt.
    const hay = normalize(text);
    const excerpts: string[] = [];
    let from = 0;
    while (excerpts.length < 3) {
      const at = hay.indexOf(q, from);
      if (at < 0) break;
      excerpts.push(`${at > 60 ? '…' : ''}${text.slice(Math.max(0, at - 60), at + q.length + 80).trim()}…`);
      from = at + q.length;
    }
    if (excerpts.length || normalize(n.title).includes(q)) out.push({ id: n.id, title: n.title, excerpts });
    if (out.length >= limit) break;
  }
  return out;
}

export function findNote(ref: string) {
  const { notes } = useNotes.getState();
  const q = normalize(ref);
  return notes.find(n => n.id === ref) ?? notes.find(n => normalize(n.title) === q) ?? (q ? notes.find(n => normalize(n.title).includes(q)) : undefined);
}

// ── To-dos ───────────────────────────────────────────────────────────────────

export function listTodos(includeDone = false) {
  const today = todayKey();
  return useTodos
    .getState()
    .todos.filter(t => includeDone || !t.done)
    .map(t => ({ id: t.id, title: t.title, done: t.done, due: t.due, late: !t.done && !!t.due && t.due < today }));
}

export function findTodo(ref: string) {
  const { todos } = useTodos.getState();
  const q = normalize(ref);
  return todos.find(t => t.id === ref) ?? todos.find(t => normalize(t.title) === q) ?? (q ? todos.find(t => normalize(t.title).includes(q)) : undefined);
}

export function addTodo(title: string, due?: string) {
  return useTodos.getState().add(title, due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : undefined);
}

export function completeTodo(ref: string, done = true) {
  const t = findTodo(ref);
  if (!t) return null;
  if (t.done !== done) useTodos.getState().toggle(t.id);
  return t;
}

export function deleteTodo(ref: string) {
  const t = findTodo(ref);
  if (t) useTodos.getState().remove(t.id);
  return t ?? null;
}

// ── Focus & settings ─────────────────────────────────────────────────────────

export function startFocus(subject = '') {
  useFocus.getState().start(subject.trim());
  return { subject: subject.trim(), minutes: getSettings().focusMinutes };
}

export function stopFocus() {
  const s = useFocus.getState();
  if (!s.phase) return null;
  const subject = s.label;
  s.stop();
  return { stopped: true, subject };
}

export function focusStatus() {
  const s = useFocus.getState();
  if (!s.phase) return null;
  return { phase: s.phase === 'focus' ? 'travail' : 'pause', subject: s.label, minutesLeft: Math.ceil(focusLeft(s) / 60_000), paused: s.pausedLeft !== null };
}

export interface SettingsPatch {
  accent?: string;
  theme?: string;
  reduceMotion?: boolean;
  chattiness?: string;
}

/** Applies the settings Kompaly is allowed to change; returns what actually changed. */
export function updateSettings(p: SettingsPatch) {
  const patch: Partial<Settings> = {};
  if (p.accent && p.accent in ACCENTS) patch.accent = p.accent as AccentKey;
  if (p.theme && ['clair', 'sombre', 'auto'].includes(p.theme)) patch.theme = p.theme as ThemeMode;
  if (typeof p.reduceMotion === 'boolean') patch.reduceMotion = p.reduceMotion;
  if (p.chattiness && ['calme', 'normal', 'bavard'].includes(p.chattiness)) patch.chattiness = p.chattiness as Chattiness;
  if (!Object.keys(patch).length) return null;
  useSettings.getState().set(patch);
  applyAppearance(useSettings.getState());
  return patch;
}
