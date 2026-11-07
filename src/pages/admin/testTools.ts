// The « Tests » tab of the administration (AdminTests): what it makes is marked « [Test] » at the start of its title or
// name, so « Tout supprimer (éléments de test) » finds it again, and only it. Pure functions, tested in
// tests/adminTestTools.test.ts; the stores are used by AdminTests.

/** The mark at the start of everything the tools make (never translated: the cleaning looks for it). */
export const TEST_MARK = '[Test]';

export const testName = (name: string) => `${TEST_MARK} ${name}`;
export const isTestName = (name: string | null | undefined) => !!name && name.trimStart().startsWith(TEST_MARK);

interface Titled {
  id: string;
  title: string;
}
interface DriveLike {
  id: string;
  name: string;
  parentId: string | null;
}

export interface TestSnapshot {
  todos: Titled[];
  events: Titled[];
  notes: Titled[];
  drive: DriveLike[];
  periods: Titled[];
}

export interface TestSelection {
  todos: string[];
  events: string[];
  notes: string[];
  /** Only the top ones: a folder takes what is inside it (store/drive › remove). */
  drive: string[];
  periods: string[];
}

/**
 * What the cleaning removes: the marked items. A marked folder of the files goes only when everything inside it is
 * marked too (a real file put in it is never taken along); then its content isn't listed apart.
 */
export function testItems(s: TestSnapshot): TestSelection {
  const marked = (list: Titled[]) => list.filter(x => isTestName(x.title)).map(x => x.id);
  const children = new Map<string, DriveLike[]>();
  for (const it of s.drive) if (it.parentId) children.set(it.parentId, [...(children.get(it.parentId) ?? []), it]);
  const allMarked = (id: string): boolean => (children.get(id) ?? []).every(c => isTestName(c.name) && allMarked(c.id));
  const removable = new Set(s.drive.filter(it => isTestName(it.name) && allMarked(it.id)).map(it => it.id));
  const byId = new Map(s.drive.map(it => [it.id, it]));
  // Inside a folder that goes anyway: not named again.
  const coveredBy = (it: DriveLike): boolean => {
    for (let p = it.parentId ? byId.get(it.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) if (removable.has(p.id)) return true;
    return false;
  };
  return {
    todos: marked(s.todos),
    events: marked(s.events),
    notes: marked(s.notes),
    drive: s.drive.filter(it => removable.has(it.id) && !coveredBy(it)).map(it => it.id),
    periods: marked(s.periods),
  };
}

export const testCount = (sel: TestSelection) => sel.todos.length + sel.events.length + sel.notes.length + sel.drive.length + sel.periods.length;

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The day `days` after `key` (before when negative), as YYYY-MM-DD. */
export function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return keyOf(new Date(y, m - 1, d + days));
}

/**
 * A moment `minutes` after the next whole minute (reminders count in whole minutes): its day and time. From 14:32:50,
 * 1 minute gives 14:34 — between one and two minutes away, never already past.
 */
export function soon(now: Date, minutes: number): { date: string; time: string } {
  const at = new Date(now);
  at.setSeconds(0, 0);
  at.setMinutes(at.getMinutes() + 1 + minutes);
  return { date: keyOf(at), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
}

/** Next week, Monday to Sunday (a period « la semaine prochaine »). */
export function nextWeek(today: string): { start: string; end: string } {
  const [y, m, d] = today.split('-').map(Number);
  const fromMonday = (new Date(y, m - 1, d).getDay() + 6) % 7;
  const start = shiftDay(today, 7 - fromMonday);
  return { start, end: shiftDay(start, 6) };
}

/** The next one in a list, round (back to the first after the last). */
export const nextInCycle = <T>(list: readonly T[], current: T): T => list[(list.indexOf(current) + 1) % list.length];

export interface TaskPlan {
  title: string;
  due?: string;
  time?: string;
  done?: boolean;
}

/** Ten tasks of every kind (`titles`: the ten words, translated by the caller): late, today, later, timed, none, done. */
export function mixedTasks(today: string, titles: string[]): TaskPlan[] {
  const plans: Omit<TaskPlan, 'title'>[] = [
    { due: shiftDay(today, -2) },
    { due: shiftDay(today, -1), time: '18:00' },
    { due: today },
    { due: today, time: '17:30' },
    { due: shiftDay(today, 1) },
    { due: shiftDay(today, 3), time: '09:00' },
    { due: shiftDay(today, 10) },
    {},
    {},
    { due: today, done: true },
  ];
  return plans.map((p, i) => ({ ...p, title: testName(titles[i % titles.length]) }));
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A note of `count` numbered lines (`line(n)`: its words), as the editor saves it. */
export const linesHtml = (count: number, line: (n: number) => string) => Array.from({ length: count }, (_, i) => `<p>${escape(line(i + 1))}</p>`).join('');

/** A checklist (the editor's « Liste à cocher »), every third one ticked. */
export const checklistHtml = (items: string[]) =>
  `<ul data-type="taskList">${items.map((x, i) => `<li data-type="taskItem" data-checked="${i % 3 === 2}"><p>${escape(x)}</p></li>`).join('')}</ul>`;

/** What this browser keeps in its storage (keys and values, in bytes: two per character). */
export const storageBytes = (entries: [string, string][]) => entries.reduce((n, [k, v]) => n + (k.length + v.length) * 2, 0);

/** The version of the app's files kept by the service worker (its cache is named « kompaly-app-<version> »). */
export const swVersions = (cacheNames: string[]) => cacheNames.filter(n => n.startsWith('kompaly-app-')).map(n => n.slice('kompaly-app-'.length));
