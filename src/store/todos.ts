import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid, nowIso } from '../lib/utils';
import { userStorage } from '../lib/userStorage';
import { t } from '../i18n';
import { taskReminders } from '../lib/reminders';
import { todayKey } from '../lib/dates';
import { nextDue, type TaskRepeat } from '../lib/taskRepeat';
import { TRASH_DAYS } from './drive';
import { getSettings } from './settings';

/** A simple to-do, independent from the calendar (« acheter une calculatrice »). */
export interface Todo {
  id: string;
  title: string;
  done: boolean;
  due?: string; // YYYY-MM-DD, optional
  /** HH:mm, optional: the time of the due day (reminders count from it, else from 9:00). */
  time?: string;
  /** Reminders, in minutes before the due moment: lib/reminders. */
  reminders?: number[];
  /** Repeats (a due day needed): ticked, the next one is made (lib/taskRepeat). */
  repeat?: TaskRepeat;
  createdAt: string;
  doneAt?: string;
  /** Set while the task is in the trash. */
  deletedAt?: string;
}

interface TodosState {
  todos: Todo[];
  /** Deleted tasks, kept TRASH_DAYS days (separate list: nothing else has to filter them). */
  trash: Todo[];
  add: (title: string, due?: string, time?: string) => Todo;
  update: (id: string, patch: Partial<Pick<Todo, 'title' | 'due' | 'time' | 'reminders' | 'repeat'>>) => void;
  toggle: (id: string) => void;
  /** Moves the task to the trash; returns it, for « Annuler ». */
  remove: (id: string) => Todo | undefined;
  removeMany: (ids: string[]) => Todo[];
  /** Puts tasks back from the trash (« Annuler », Corbeille). */
  restore: (ids: string[]) => void;
  purge: (ids: string[]) => void;
  emptyTrash: () => void;
  purgeExpired: () => void;
}

/** The usual reminders of a new dated task (Profil › Notifications › « Rappel par défaut des tâches »). */
const usualReminders = (due: string, time?: string) => taskReminders(due, time, new Date(), getSettings().defaultTaskReminders);

/** The next one of a repeating task just ticked: same title, hour, reminders and repeat, made at the tick (`at`). */
const nextOf = (x: Todo, at: string): Todo | null =>
  x.repeat && x.due
    ? { id: uid(), title: x.title, done: false, due: nextDue(x.due, x.repeat, todayKey()), ...(x.time && { time: x.time }), ...(x.reminders && { reminders: x.reminders }), repeat: x.repeat, createdAt: at }
    : null;

export const useTodos = create<TodosState>()(
  persist(
    (set, get) => ({
      todos: [],
      trash: [],
      add(title, due, time) {
        const todo: Todo = { id: uid(), title: title.trim() || t('Tâche'), done: false, due: due || undefined, ...(due && time && { time }), ...(due && { reminders: usualReminders(due, time) }), createdAt: nowIso() };
        set(s => ({ todos: [...s.todos, todo] }));
        return todo;
      },
      // A task given a date for the first time (« Les répartir », the task dialog) gets the usual reminders too.
      update: (id, patch) =>
        set(s => ({
          todos: s.todos.map(x => {
            if (x.id !== id) return x;
            const next = { ...x, ...patch };
            return next.due && !x.due && next.reminders === undefined ? { ...next, reminders: usualReminders(next.due, next.time) } : next;
          }),
        })),
      // A repeating task ticked: the next one comes at once (made at the tick's moment). Unticked again: that next
      // one goes, if it is still the untouched copy the tick made (same title, made at that very moment, not ticked).
      toggle: id =>
        set(s => {
          const x = s.todos.find(y => y.id === id);
          if (!x) return s;
          const at = nowIso();
          const flipped = s.todos.map(y => (y.id === id ? { ...y, done: !y.done, doneAt: y.done ? undefined : at } : y));
          if (!x.done) {
            const next = nextOf(x, at);
            return { todos: next ? [...flipped, next] : flipped };
          }
          return { todos: flipped.filter(y => !(x.repeat && y.id !== id && y.repeat === x.repeat && !y.done && y.title === x.title && y.createdAt === x.doneAt)) };
        }),
      remove: id => get().removeMany([id])[0],
      removeMany(ids) {
        const gone = new Set(ids);
        const at = nowIso();
        const moved = get().todos.filter(x => gone.has(x.id)).map(x => ({ ...x, deletedAt: at }));
        set(s => ({ todos: s.todos.filter(x => !gone.has(x.id)), trash: [...s.trash, ...moved] }));
        return moved;
      },
      restore(ids) {
        const back = new Set(ids);
        set(s => ({
          todos: [...s.todos, ...s.trash.filter(x => back.has(x.id) && !s.todos.some(y => y.id === x.id)).map(({ deletedAt: _d, ...x }) => x)],
          trash: s.trash.filter(x => !back.has(x.id)),
        }));
      },
      purge(ids) {
        const doomed = new Set(ids);
        set(s => ({ trash: s.trash.filter(x => !doomed.has(x.id)) }));
      },
      emptyTrash: () => set({ trash: [] }),
      purgeExpired() {
        const limit = Date.now() - TRASH_DAYS * 864e5;
        const old = get().trash.filter(x => x.deletedAt && new Date(x.deletedAt).getTime() < limit).map(x => x.id);
        if (old.length) get().purge(old);
      },
    }),
    // Saved before the trash existed: an empty one.
    { name: 'todos', storage: userStorage, skipHydration: true, merge: (saved, cur) => ({ ...cur, ...(saved as Partial<TodosState>), trash: (saved as Partial<TodosState> | undefined)?.trash ?? [] }) },
  ),
);
