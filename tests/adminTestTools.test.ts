import { describe, expect, it } from 'vitest';
import { checklistHtml, isTestName, linesHtml, mixedTasks, nextInCycle, nextWeek, shiftDay, soon, storageBytes, swVersions, testCount, testItems, testName } from '../src/pages/admin/testTools';

describe('Administration › Tests : la marque « [Test] » et le nettoyage', () => {
  it('marks a title and recognises it, only at the start', () => {
    expect(testName('Tâche')).toBe('[Test] Tâche');
    expect(isTestName('[Test] Tâche')).toBe(true);
    expect(isTestName('  [Test] Tâche')).toBe(true);
    expect(isTestName('Tâche [Test]')).toBe(false);
    expect(isTestName('[test] minuscule')).toBe(false);
    expect(isTestName('')).toBe(false);
    expect(isTestName(undefined)).toBe(false);
  });

  it('selects only the marked items, of every kind', () => {
    const sel = testItems({
      todos: [{ id: 't1', title: '[Test] A' }, { id: 't2', title: 'Vraie tâche' }],
      events: [{ id: 'e1', title: 'Dentiste' }, { id: 'e2', title: '[Test] Garde' }, { id: 'e3', title: '[Test] Garde' }],
      notes: [{ id: 'n1', title: '[Test] Note' }],
      periods: [{ id: 'p1', title: 'Vacances' }, { id: 'p2', title: '[Test] Vacances' }],
      drive: [],
    });
    expect(sel).toEqual({ todos: ['t1'], events: ['e2', 'e3'], notes: ['n1'], drive: [], periods: ['p2'] });
    expect(testCount(sel)).toBe(5);
  });

  it('takes a marked folder with its marked content once, never a real file put inside it', () => {
    const drive = [
      { id: 'f1', name: '[Test] Dossier', parentId: null },
      { id: 'a', name: '[Test] a.txt', parentId: 'f1' },
      { id: 'b', name: '[Test] b.txt', parentId: 'f1' },
      { id: 'f2', name: '[Test] Dossier 2', parentId: null },
      { id: 'real', name: 'Facture.pdf', parentId: 'f2' },
      { id: 'c', name: '[Test] c.txt', parentId: 'f2' },
      { id: 'top', name: '[Test] notes.txt', parentId: null },
      { id: 'mine', name: 'Mes photos', parentId: null },
    ];
    const sel = testItems({ todos: [], events: [], notes: [], periods: [], drive });
    // f1 alone stands for a and b; f2 stays (a real file is in it), its marked file goes by itself.
    expect(sel.drive.sort()).toEqual(['c', 'f1', 'top']);
  });

  it('counts nothing when there is nothing marked', () => {
    expect(testCount(testItems({ todos: [{ id: '1', title: 'x' }], events: [], notes: [], periods: [], drive: [] }))).toBe(0);
  });
});

describe('Administration › Tests : les dates et les contenus', () => {
  it('shifts days across months and years', () => {
    expect(shiftDay('2026-11-07', -3)).toBe('2026-11-04');
    expect(shiftDay('2026-11-07', -14)).toBe('2026-10-24');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('« soon » is always a whole minute still to come', () => {
    expect(soon(new Date(2026, 10, 7, 14, 32, 50), 1)).toEqual({ date: '2026-11-07', time: '14:34' });
    expect(soon(new Date(2026, 10, 7, 14, 32, 0), 5)).toEqual({ date: '2026-11-07', time: '14:38' });
    expect(soon(new Date(2026, 10, 7, 23, 58, 30), 1)).toEqual({ date: '2026-11-08', time: '00:00' });
  });

  it('next week runs Monday to Sunday', () => {
    expect(nextWeek('2026-11-07')).toEqual({ start: '2026-11-09', end: '2026-11-15' }); // a Saturday
    expect(nextWeek('2026-11-09')).toEqual({ start: '2026-11-16', end: '2026-11-22' }); // a Monday
    expect(nextWeek('2026-11-15')).toEqual({ start: '2026-11-16', end: '2026-11-22' }); // a Sunday
  });

  it('makes ten marked tasks of every kind', () => {
    const list = mixedTasks('2026-11-07', ['a', 'b']);
    expect(list).toHaveLength(10);
    expect(list.every(x => isTestName(x.title))).toBe(true);
    expect(list.some(x => x.due && x.due < '2026-11-07')).toBe(true);
    expect(list.some(x => !x.due)).toBe(true);
    expect(list.some(x => x.time)).toBe(true);
    expect(list.filter(x => x.done)).toHaveLength(1);
  });

  it('writes notes as the editor saves them (text escaped)', () => {
    expect(linesHtml(2, n => `L${n} <b>`)).toBe('<p>L1 &lt;b&gt;</p><p>L2 &lt;b&gt;</p>');
    expect(linesHtml(60, n => `${n}`).match(/<p>/g)).toHaveLength(60);
    expect(checklistHtml(['a', 'b', 'c'])).toBe(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>a</p></li><li data-type="taskItem" data-checked="false"><p>b</p></li><li data-type="taskItem" data-checked="true"><p>c</p></li></ul>',
    );
  });

  it('cycles, measures the storage and reads the service worker version', () => {
    expect(nextInCycle(['a', 'b', 'c'], 'c')).toBe('a');
    expect(nextInCycle(['a', 'b', 'c'], 'a')).toBe('b');
    expect(storageBytes([['ab', 'cde']])).toBe(10);
    expect(swVersions(['kompaly-app-1a2b3c4', 'kompaly-share', 'other'])).toEqual(['1a2b3c4']);
  });
});
