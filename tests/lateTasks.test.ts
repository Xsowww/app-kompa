import { describe, expect, it } from 'vitest';
import { lateDays, lateLabel } from '../src/pages/tasks/lateDays';
import { remindersShort, remindersText } from '../src/lib/reminders';

describe('tâche en retard : le badge « En retard · depuis … »', () => {
  const today = '2026-11-07';
  it('counts the days since its due day, only for a task not done', () => {
    expect(lateDays({ due: '2026-11-04' }, today)).toBe(3);
    expect(lateDays({ due: '2026-11-06' }, today)).toBe(1);
    expect(lateDays({ due: '2026-11-07' }, today)).toBe(0);
    expect(lateDays({ due: '2026-11-09' }, today)).toBe(0);
    expect(lateDays({ due: '2026-11-04', done: true }, today)).toBe(0);
    expect(lateDays({}, today)).toBe(0);
    // Across a month and the clocks changing (late October).
    expect(lateDays({ due: '2026-10-24' }, today)).toBe(14);
  });
  it('says it the same way everywhere', () => {
    expect(lateLabel(1)).toBe('En retard · depuis hier');
    expect(lateLabel(3)).toBe('En retard · depuis 3 jours');
  });
});

describe('les rappels d’un événement dans une liste : une petite pastille', () => {
  it('one reminder: its short label; several: how many (the whole list stays in remindersText)', () => {
    expect(remindersShort([60], '2026-11-10', '14:00')).toBe('1 h avant');
    expect(remindersShort([900, 0], '2026-11-10')).toBe('2 rappels');
    // The sentence that was cut in the list (« le jour même à 9h00, la veille à 18h00 ») is the tooltip's.
    expect(remindersText([900, 0], '2026-11-10')).toMatch(/,/);
  });
});
