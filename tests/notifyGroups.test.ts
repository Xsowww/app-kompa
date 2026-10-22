import { describe, expect, it } from 'vitest';
import { familyOf, groupByMoment, isGroupNews, mergeNotifications } from '../src/lib/notifyGroups.mjs';

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 22, h, m, s);
const r = (key: string, title: string, body: string, fireAt = at(9, 0)) => ({ key, title, body, url: '/taches', fireAt });

describe('reminders due together', () => {
  it('one notification for the reminders of the same moment, the others apart', () => {
    const list = [
      r('task:a:0:2026-10-22T09:00', 'Acheter du pain', 'À faire aujourd’hui\nTâches'),
      r('task:b:0:2026-10-22T09:00', 'Rendre le DM', 'À faire aujourd’hui\nTâches', at(9, 0, 20)),
      r('event:c:15:2026-10-22T09:15', 'Réunion', 'Dans 15 min · 09:15\nAgenda', at(9, 0, 40)),
      r('event:d:0:2026-10-22T10:00', 'Sport', 'Maintenant · 10:00\nAgenda', at(10, 0)),
    ];
    const groups = groupByMoment(list);
    expect(groups.map(g => g.length)).toEqual([3, 1]);
    const one = mergeNotifications(groups[0]);
    expect(one.title).toBe('Acheter du pain +2');
    expect(one.body).toBe('Rendre le DM, Réunion');
    expect(one.keys).toHaveLength(3);
    expect(one.key).toBe(list[0].key);
    // Alone: unchanged.
    expect(mergeNotifications(groups[1])).toMatchObject({ title: 'Sport', body: 'Maintenant · 10:00\nAgenda', keys: [list[3].key] });
  });

  it('says once what they share', () => {
    const tasks = [r('task:a:0:x', 'Acheter du pain', 'À faire aujourd’hui\nTâches'), r('task:b:0:x', 'Rendre le DM', 'À faire aujourd’hui\nTâches')];
    expect(mergeNotifications(tasks)).toMatchObject({ title: 'Acheter du pain +1', body: 'À faire aujourd’hui · Rendre le DM\nTâches' });
  });

  it('a burst of news by one member: the count in the title, each one underneath', () => {
    const news = [1, 2, 3].map(i => r(`agenda:e${i}:INSERT:${i}`, 'Léo a ajouté un événement', `« Cours ${i} » · lundi\nAgenda partagé « Famille »`));
    const one = mergeNotifications(news);
    expect(one.title).toBe('Léo a ajouté un événement ×3');
    expect(one.body).toBe('« Cours 1 » · lundi, « Cours 2 » · lundi, « Cours 3 » · lundi\nAgenda partagé « Famille »');
  });

  it('never mixes kinds', () => {
    const list = [r('task:a:0:x', 'Pain', 'Aujourd’hui\nTâches'), r('admin:bug:1', 'Nouveau bug signalé', 'Ça plante\nAdministration')];
    expect(groupByMoment(list).map(g => g.length)).toEqual([1, 1]);
    expect(familyOf('rappel-agenda:x')).toBe(familyOf('event:y'));
    expect(isGroupNews('fichiers:g:1')).toBe(true);
    expect(isGroupNews('rappel-agenda:x')).toBe(false);
  });

  it('keeps a long list short', () => {
    const many = Array.from({ length: 30 }, (_, i) => r(`task:${i}:0:x`, `Tâche numéro ${i}`, `Le ${i}\nTâches`));
    expect(mergeNotifications(many).body.split('\n')[0].length).toBeLessThanOrEqual(160);
  });
});
