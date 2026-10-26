import { cleanPeriods, type Period } from './periods';
import { folderColorKey, useDrive, type DriveItem } from '../store/drive';
import { useNotes, type Note, type NoteFolder } from '../store/notes';
import { applyUsage, useCalendar, catOf, type CalendarEvent, type CustomCategory } from '../store/calendar';
import { useSettings, DEFAULT_SETTINGS, applyAppearance, type Settings } from '../store/settings';
import { addDays } from 'date-fns';
import { fromKey, fromMinutes, toKey, toMinutes, validKey } from './dates';
import { foldLine, utcStamp } from './ics';
import { useAuth } from '../store/auth';
import { blobStore } from './blobStore';
import { blobKey, getStorageUser, userStorage, SYNC_CURSOR } from './userStorage';
import { cloudEnabled, supabase } from './supabase';
import { flushNow } from './cloudSync';
import { purgeSoleGroups } from './groups';
import { useTodos } from '../store/todos';
import { isTourTodo } from '../store/tour';
import { useFocusLog } from '../store/focusLog';
import { useCopilot } from '../store/copilot';
import { useRecorder } from '../store/recorder';
import { t } from '../i18n';

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const stamp = () => toKey(new Date()); // the local day (in UTC it was the day before until 1 or 2 am)

/** Everything except file contents (those stay in the Drive) and the sound of the recordings. */
export function exportBackup() {
  const { avatarImage: _img, ...settings } = useSettings.getState();
  const { user } = useAuth.getState();
  const { messages, memory } = useCopilot.getState();
  const data = {
    app: 'cop-pilot',
    version: 1,
    exportedAt: new Date().toISOString(),
    user: { name: user?.name, email: user?.email },
    settings: Object.fromEntries(Object.entries(settings).filter(([, v]) => typeof v !== 'function')),
    calendar: useCalendar.getState().events,
    todos: useTodos.getState().todos,
    notes: { folders: useNotes.getState().folders, notes: useNotes.getState().notes },
    driveFolders: useDrive.getState().items.filter(i => i.kind === 'folder'),
    // Also what the privacy policy lists (Profil › Données › Exporter): not restored by importBackup.
    focusSessions: useFocusLog.getState().sessions,
    kompaly: { conversation: messages, memory },
    recordings: useRecorder.getState().history, // titles, key points and parts; the documents made are in the Drive
  };
  download(t('kompaly-sauvegarde-{day}.json', { day: stamp() }), JSON.stringify(data, null, 2), 'application/json');
}

/** What the backup has and this account doesn't (anywhere, trash included). Nothing current is replaced. */
function missing<T extends { id: string }>(incoming: unknown, ...current: T[][]): T[] {
  const have = new Set(current.flat().map(x => x.id));
  return (Array.isArray(incoming) ? incoming : []).filter((x): x is T => typeof x?.id === 'string' && !have.has(x.id));
}

// A damaged or edited file: only items with what the app needs to show them (a title, a real day…).
type Item = Record<string, unknown>;
const text = (v: unknown) => typeof v === 'string';
const day = (v: unknown) => text(v) && !!validKey(v as string);
const okEvent = (x: Item) => text(x.title) && day(x.date);
const okTodo = (x: Item) => text(x.title) && (x.due == null || day(x.due));
const okNote = (x: Item) => text(x.title) && text(x.content);
const okFolder = (x: Item) => text(x.name);
const valid = <T,>(list: T[], ok: (x: Item) => boolean) => list.filter(x => ok(x as Item));
/** A setting of the file, only when it has the type of the app's own (« defaultReminders »: "abc" is dropped). */
function sameType(value: unknown, model: unknown) {
  if (Array.isArray(model)) return Array.isArray(value) && (!model.length || value.every(v => typeof v === typeof model[0]));
  if (model === null) return value === null || typeof value === 'string';
  return typeof value === typeof model && (typeof model !== 'object' || (value !== null && !Array.isArray(value)));
}

const KEEP_CURRENT = new Set<keyof Settings>(['focusSessions', 'focusTotalMinutes', 'badgesSeen', 'groupsSeen', 'renamedToKompa', 'customCategories', 'periods']);

/**
 * Brings back from an exported file the notes, events, tasks and Drive folders that are no longer
 * here (deleted for good, or another device). Current items are kept as they are, so restoring an
 * old file never erases recent work. Settings are replaced.
 */
export async function importBackup(file: File): Promise<{ notes: number; events: number; todos: number; folders: number; inTrash: number }> {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error(t('Ce fichier n’est pas une sauvegarde Kompaly.'));
  }
  if (data?.app !== 'cop-pilot' || !Array.isArray(data.calendar) || !data.notes) throw new Error(t('Ce fichier n’est pas une sauvegarde Kompaly.'));
  const cal = useCalendar.getState();
  const nb0 = useNotes.getState();
  const drive0 = useDrive.getState();
  // Items of the file that are in the trash: not duplicated, but the person is told where they are.
  const trashed = new Set([...cal.trash, ...nb0.trashNotes, ...nb0.trashFolders, ...drive0.trash].map(x => x.id));
  const inFile = [data.calendar, data.notes.notes, data.notes.folders, data.driveFolders].flatMap(a => (Array.isArray(a) ? a : []));
  const inTrash = inFile.filter(x => typeof x?.id === 'string' && trashed.has(x.id)).length;
  const events = valid(missing(data.calendar, cal.events, cal.trash), okEvent);
  useCalendar.setState(s => ({ events: [...s.events, ...events] }));
  const nb = useNotes.getState();
  const folders = valid(missing<NoteFolder>(data.notes.folders, nb.folders, nb.trashFolders), okFolder).map(f => ({ ...f, color: folderColorKey(f.color) }));
  const notes = valid(missing<Note>(data.notes.notes, nb.notes, nb.trashNotes), okNote);
  // Into a folder that is in the trash, they would be invisible: root instead.
  const live = new Set([...nb.folders, ...folders].map(f => f.id));
  useNotes.setState(s => ({
    folders: [...s.folders, ...folders.map(f => (f.parentId && !live.has(f.parentId) ? { ...f, parentId: null } : f))],
    notes: [...s.notes, ...notes.map(n => (n.folderId && !live.has(n.folderId) ? { ...n, folderId: null } : n))],
  }));
  if (data.settings) {
    // Preferences come back; counters and « already seen » marks never go backwards, and
    // categories created since the export stay (the file's are added).
    const known = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).filter(k => !KEEP_CURRENT.has(k));
    const restored = Object.fromEntries(known.filter(k => k in data.settings && sameType(data.settings[k], DEFAULT_SETTINGS[k])).map(k => [k, data.settings[k]])) as Partial<Settings>;
    const current = useSettings.getState();
    if (Array.isArray(data.settings.customCategories)) restored.customCategories = [...current.customCategories, ...missing<CustomCategory>(data.settings.customCategories, current.customCategories)];
    if (Array.isArray(data.settings.periods)) restored.periods = [...current.periods, ...missing<Period>(cleanPeriods(data.settings.periods), current.periods)];
    useSettings.getState().set(restored);
    applyAppearance(useSettings.getState());
    applyUsage(useSettings.getState().usage);
  }
  const drive = useDrive.getState();
  const driveFolders = valid(missing<DriveItem>(data.driveFolders, drive.items, drive.trash), x => okFolder(x) && x.kind === 'folder');
  const liveDrive = new Set([...drive.items, ...driveFolders].map(i => i.id));
  if (driveFolders.length) useDrive.setState(s => ({ items: [...s.items, ...driveFolders.map(f => (f.parentId && !liveDrive.has(f.parentId) ? { ...f, parentId: null } : f))] }));
  // The tour's task of another account: not a second one here.
  const cur = useTodos.getState().todos;
  const todos = valid(missing(data.todos, cur), okTodo).filter(t => !(isTourTodo(String(t.title)) && cur.some(x => isTourTodo(x.title))));
  if (todos.length) useTodos.setState(s => ({ todos: [...s.todos, ...todos] }));
  return { notes: notes.length, events: events.length, todos: todos.length, folders: folders.length + driveFolders.length, inTrash };
}

const icsDate = (date: string) => date.replace(/-/g, '');
const icsText = (t: string) => t.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => `\\${m}`);

// Local calendar arithmetic (toISOString gave the same day back east of UTC+12).
const nextDay = (date: string) => toKey(addDays(fromKey(date), 1));

/** .ics file that Google Agenda, Apple Calendrier or Outlook can import. */
export function exportIcs(events: CalendarEvent[] = useCalendar.getState().events) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kompaly//FR', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@cop-pilot`, `DTSTAMP:${now}`);
    if (e.start) {
      // In UTC (« Z »): a floating time would be placed at the wrong hour by a calendar set to another time zone.
      lines.push(`DTSTART:${utcStamp(e.date, e.start)}`);
      // No end: one hour, not a zero-length event that some calendars hide.
      lines.push(`DTEND:${utcStamp(e.date, e.end ?? fromMinutes(toMinutes(e.start) + 60))}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(e.date)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(e.date))}`);
    }
    lines.push(`SUMMARY:${icsText(e.title)}`, `CATEGORIES:${icsText(catOf(e.category).label)}`);
    if (e.details) lines.push(`DESCRIPTION:${icsText(e.details)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  download(t('kompaly-calendrier-{day}.ics', { day: stamp() }), lines.map(foldLine).join('\r\n'), 'text/calendar');
}

/** The account's own tables (group content lives in separate tables and is left alone). */
const OWN_TABLES = ['focus_sessions', 'todos', 'events', 'notes', 'note_folders', 'drive_items'] as const;

async function deleteLocalFiles() {
  const files = [...useDrive.getState().items, ...useDrive.getState().trash].filter(i => i.kind === 'file');
  await Promise.all(files.map(f => blobStore.delete(blobKey(f.id)).catch(() => undefined)));
}

/** Empties this device's copy: lists, conversation with Kompaly, search index of the PDFs. */
export function resetLocalData() {
  userStorage.removeItem(SYNC_CURSOR); // an empty copy: the next download is the whole account
  useDrive.setState({ items: [], trash: [], clipboard: null });
  useNotes.setState({ notes: [], folders: [], trashNotes: [], trashFolders: [] });
  useCalendar.setState({ events: [], trash: [] });
  useTodos.setState({ todos: [] });
  useFocusLog.setState({ sessions: [] });
  useCopilot.getState().clearHistory();
  useCopilot.setState({ memory: {} });
  void import('../copilot/claudeBrain').then(m => m.resetClaudeHistory()).catch(() => undefined);
  void import('./textIndex').then(m => m.forgetTextIndex()).catch(() => undefined);
}

/** Removes everything the current account holds (files, notes, events, tasks, conversation); the account itself stays. */
export async function wipeUserData() {
  const user = getStorageUser();
  if (cloudEnabled && user) {
    // Send what is waiting first, so nothing is written back after the deletion below.
    await flushNow();
    // By owner, not by the ids this device knows: rows added on another device since the last pull go too.
    for (const table of OWN_TABLES) {
      const { error } = await supabase!.from(table).delete().eq('user_id', user);
      if (error) throw new Error(t('L’effacement n’a pas pu se faire : réessaie dans un instant.'));
    }
    // Every file under the account's folder, even those this device doesn't know about.
    await blobStore.removeFolder(user);
  } else {
    await deleteLocalFiles();
  }
  resetLocalData();
}

/**
 * Before deleting the account: what the server doesn't remove with it (files, groups left without members).
 * The rows go with the account, so a deletion that fails leaves notes, events and tasks in place.
 */
export async function clearBeforeAccountDeletion() {
  const user = getStorageUser();
  if (cloudEnabled && user) {
    await purgeSoleGroups().catch(() => undefined);
    await blobStore.removeFolder(user);
  } else {
    await deleteLocalFiles();
  }
}

/** Resizes a picked image to a small square data URL for the avatar. */
export function imageToAvatar(file: File, size = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const side = Math.min(img.width, img.height);
      ctx.fillStyle = '#fff'; // a JPEG has no transparency: a see-through PNG gets white, not black
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error(t('Image illisible')));
    img.src = url;
  });
}
