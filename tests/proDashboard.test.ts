import { describe, expect, it } from 'vitest';
import { axisMarks, dayTasks, focusOn, ringRatio, spaceOf, subjectName, subjectsOf, taskBigDay, taskSubject, weekDays, weekDelta } from '../src/lib/proDashboard';
import type { Todo } from '../src/store/todos';
import type { FocusSession } from '../src/store/focusLog';
import type { CalendarEvent } from '../src/store/calendar';

// Local noon of a day, as the app stores it (ISO): the local day stays the same in any time zone of the test machine.
const at = (day: string, h = 12) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).toISOString();
const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, title: id, done: false, createdAt: at('2026-11-01'), ...extra });
const session = (day: string, minutes: number, subject = ''): FocusSession => ({ id: `${day}-${minutes}`, subject, minutes, startedAt: at(day, 10) });
const event = (title: string, date: string, category: CalendarEvent['category'] = 'cours'): CalendarEvent => ({ id: title, title, date, category, done: false, createdAt: at('2026-11-01') });

const TODAY = '2026-11-05'; // a Thursday
const MONDAY = '2026-11-02';

describe('Pro home page: the day', () => {
  it('counts late, due today and ticked today; the others wait', () => {
    const d = dayTasks(
      [
        todo('late', { due: '2026-11-03' }),
        todo('today', { due: TODAY, time: '18:00' }),
        todo('todayEarly', { due: TODAY, time: '08:00' }),
        todo('tickedToday', { done: true, doneAt: at(TODAY), due: '2026-11-09' }),
        todo('tickedBefore', { done: true, doneAt: at('2026-11-04'), due: TODAY }),
        todo('later', { due: '2026-11-08' }),
        todo('someday'),
      ],
      TODAY,
    );
    expect(d.late.map(x => x.id)).toEqual(['late']);
    expect(d.due.map(x => x.id)).toEqual(['todayEarly', 'today']);
    expect(d.done.map(x => x.id)).toEqual(['tickedToday']);
    expect(d.total).toBe(4);
    expect(d.next.map(x => x.id)).toEqual(['later', 'someday']);
  });

  it('adds up the focus minutes of a day', () => {
    expect(focusOn([session(TODAY, 25), session(TODAY, 40), session('2026-11-04', 50)], TODAY)).toBe(65);
  });

  it('rings: nothing asked is an empty ring, never more than full', () => {
    expect(ringRatio(0, 0)).toBe(0);
    expect(ringRatio(1, 4)).toBe(0.25);
    expect(ringRatio(150, 100)).toBe(1);
  });
});

describe('Pro home page: the week', () => {
  const todos = [todo('a', { done: true, doneAt: at('2026-11-02') }), todo('b', { done: true, doneAt: at(TODAY) }), todo('c', { done: true, doneAt: at('2026-10-27') })];
  const sessions = [session('2026-11-03', 50), session(TODAY, 30), session('2026-10-27', 40), session('2026-11-07', 99)];

  it('gives each day its ticks and minutes, today lit, the days to come apart', () => {
    const w = weekDays(todos, sessions, MONDAY, TODAY);
    expect(w.map(d => d.when)).toEqual(['past', 'past', 'past', 'today', 'future', 'future', 'future']);
    expect(w.map(d => d.tasks)).toEqual([1, 0, 0, 1, 0, 0, 0]);
    expect(w[1].focus).toBe(50);
    expect(w[3].focus).toBe(30);
  });

  it('compares with the same days of last week, none when last week was empty', () => {
    // Focus: 80 min Mon–Thu this week against 40 the week before.
    expect(weekDelta(todos, sessions, MONDAY, TODAY, 'focus')).toBe(100);
    // Tasks: 2 against 1.
    expect(weekDelta(todos, sessions, MONDAY, TODAY, 'tasks')).toBe(100);
    expect(weekDelta([], [], MONDAY, TODAY, 'tasks')).toBeNull();
  });

  it('marks the axis in whole tasks or hours, at least two steps', () => {
    expect(axisMarks(0, 'tasks')).toEqual([2, 1, 0]);
    expect(axisMarks(5, 'tasks')).toEqual([6, 4, 2, 0]);
    expect(axisMarks(0, 'focus')).toEqual([60, 30, 0]);
    expect(axisMarks(80, 'focus')).toEqual([90, 60, 30, 0]);
    expect(axisMarks(100, 'focus')).toEqual([120, 60, 0]);
    expect(axisMarks(400, 'focus')).toEqual([540, 360, 180, 0]);
  });
});

describe('Pro home page: what a task is about', () => {
  it('finds the subject in an event title', () => {
    expect(subjectName('Cours de maths')).toBe('Maths');
    expect(subjectName('Partiel d’histoire')).toBe('Histoire');
    expect(subjectName('TD d’anglais')).toBe('Anglais');
    expect(subjectName('Exposé de SVT')).toBe('SVT');
    expect(subjectName('Révision : bac de français pour le groupe B')).toBeNull();
  });

  it('Perso and Sport are personal life, the rest the account’s use', () => {
    expect(spaceOf('sport', 'etudes')).toBe('perso');
    expect(spaceOf('cours', 'travail')).toBe('travail');
    expect(spaceOf('c-stage', 'etudes')).toBe('etudes');
  });

  it('tags a task with its subject, and lights it up before the big day it prepares', () => {
    const events = [event('Cours de maths', '2026-11-04'), event('Partiel d’histoire', '2026-11-08', 'examen'), event('Judo', TODAY, 'sport'), event('Cours de chimie', '2027-02-01')];
    const subjects = subjectsOf(events, [session(TODAY, 25, 'Anglais')], 'etudes', TODAY);
    expect(subjects.map(s => s.name)).toEqual(['Maths', 'Histoire', 'Anglais']);
    expect(taskSubject('Exercices de maths p. 42', subjects)?.name).toBe('Maths');
    expect(taskSubject('Fiche d’histoire : la Révolution', subjects)).toEqual({ name: 'Histoire', space: 'etudes' });
    expect(taskSubject('Appeler mamie', subjects)).toBeUndefined();
    const big = [events[1]];
    expect(taskBigDay('Fiche d’histoire : la Révolution', big, TODAY)?.title).toBe('Partiel d’histoire');
    expect(taskBigDay('Fiche d’histoire', big, '2026-10-20')).toBeUndefined();
    expect(taskBigDay('Rendre le dossier', big, TODAY)).toBeUndefined();
  });
});
