import { describe, expect, it } from 'vitest';
import { anchorOf, followMoments, minutesBefore, cleanReminders, eventReminders, offsetLabel, reminderBody, reminderLabel, upcomingReminders } from '../src/lib/reminders';

const now = new Date(2026, 9, 16, 10, 0); // jeudi 16 octobre 2026, 10:00

describe('rappels', () => {
  it('ancre : l’heure de l’événement, ou 9 h sans heure', () => {
    expect(anchorOf('2026-10-17', '14:30').getHours()).toBe(14);
    expect(anchorOf('2026-10-17').getHours()).toBe(9);
  });

  it('nettoie : entiers distincts, triés, bornés', () => {
    expect(cleanReminders([15, '60', 15, -5, 1.5, 999999])).toEqual([60, 15]);
    expect(cleanReminders([])).toEqual([]); // « aucun rappel » choisi
    expect(cleanReminders(null)).toBeUndefined(); // jamais choisi
    expect(cleanReminders('x')).toBeUndefined();
  });

  it('plusieurs rappels sur un même événement, dans l’ordre', () => {
    const r = upcomingReminders([{ kind: 'event', id: 'e1', title: 'Réunion client', date: '2026-10-16', time: '14:00', reminders: [60, 15, 0] }], now);
    expect(r.map(x => `${x.fireAt.getHours()}:${x.fireAt.getMinutes()}`)).toEqual(['13:0', '13:45', '14:0']);
    expect(r[0].body).toBe('Aujourd’hui · 14:00\nAgenda');
    expect(r[1].body).toBe('Dans 15 min · 14:00\nAgenda');
    expect(r[2].body).toBe('Maintenant · 14:00\nAgenda');
    expect(r[0].url).toBe('/calendrier?jour=2026-10-16&evt=e1');
  });

  it('les rappels passés, les éléments faits et sans date ne sont pas gardés', () => {
    const r = upcomingReminders(
      [
        { kind: 'event', id: 'a', title: 'Passé', date: '2026-10-16', time: '09:00', reminders: [15] },
        { kind: 'event', id: 'b', title: 'Fait', date: '2026-10-17', time: '09:00', done: true, reminders: [15] },
        { kind: 'task', id: 'c', title: 'Sans date', reminders: [0] },
      ],
      now,
    );
    expect(r).toEqual([]);
  });

  it('tâche sans heure : la veille à 18 h, le jour même à 9 h', () => {
    const r = upcomingReminders([{ kind: 'task', id: 't', title: 'Envoyer le dossier', date: '2026-10-18', reminders: [900, 0] }], now);
    expect(r.map(x => [x.fireAt.getDate(), x.fireAt.getHours()])).toEqual([
      [17, 18],
      [18, 9],
    ]);
    expect(r[0].body).toBe('À faire demain\nTâches');
    expect(r[1].body).toBe('À faire aujourd’hui\nTâches');
    expect(r[0].url).toBe('/taches?tache=t');
  });

  it('clé stable : la même pour le même rappel, différente si l’heure change', () => {
    const a = upcomingReminders([{ kind: 'event', id: 'e', title: 'X', date: '2026-10-20', time: '10:00', reminders: [30] }], now)[0].key;
    const b = upcomingReminders([{ kind: 'event', id: 'e', title: 'Y', date: '2026-10-20', time: '10:00', reminders: [30] }], now)[0].key;
    const c = upcomingReminders([{ kind: 'event', id: 'e', title: 'X', date: '2026-10-20', time: '11:00', reminders: [30] }], now)[0].key;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('textes', () => {
    expect(reminderLabel(15, true)).toBe('15 min avant');
    expect(reminderLabel(900, false)).toBe('La veille à 18:00');
    expect(reminderLabel(180, true)).toBe('3 h avant');
    expect(reminderBody({ kind: 'event', id: 'e', title: 'X', date: '2026-10-23' }, new Date(2026, 9, 16, 9, 0))).toBe('Vendredi 23 oct.\nAgenda');
    expect(reminderBody({ kind: 'event', id: 'e', title: 'X', date: '2026-10-16', time: '14:00', end: '15:30' }, new Date(2026, 9, 16, 13, 45))).toBe('Dans 15 min · 14:00 – 15:30\nAgenda');
    expect(reminderBody({ kind: 'task', id: 't', title: 'X', date: '2026-10-17', time: '09:30' }, new Date(2026, 9, 16, 18, 0))).toBe('À faire demain · 09:30\nTâches');
  });

  it('rappel personnalisé : le moment choisi, ou la durée', () => {
    // Événement le vendredi 17 à 14h ; rappel la veille à 20h30 = 17 h 30 avant.
    expect(reminderLabel(17 * 60 + 30, true, '2026-10-17', '14:00')).toBe('La veille à 20:30');
    expect(reminderLabel(6 * 60 + 15, true, '2026-10-17', '14:00')).toBe('Le jour même à 07:45');
    expect(reminderLabel(3 * 1440 + 120, true, '2026-10-17', '14:00')).toBe('Mer. 14 oct. à 12:00');
    expect(reminderLabel(15, true, '2026-10-17', '14:00')).toBe('15 min avant'); // les choix habituels gardent leur nom
    expect(offsetLabel(45)).toBe('45 min avant');
    expect(offsetLabel(210)).toBe('3 h 30 avant');
    expect(offsetLabel(2 * 1440 + 240)).toBe('2 j 4 h avant');
  });

  it('un rappel à heure fixe garde son heure quand l’événement bouge', () => {
    const eve = minutesBefore('2026-10-21', '14:30', '2026-10-20', '09:00');
    const at = (l: number[], date: string, time?: string) => l.map(m => reminderLabel(m, !!time, date, time));
    // nouvelle heure : « La veille à 9h » reste, « 15 min avant » suit
    expect(at(followMoments([eve, 15], { date: '2026-10-21', time: '14:30' }, { date: '2026-10-21', time: '10:00' }, []), '2026-10-21', '10:00')).toEqual(['La veille à 09:00', '15 min avant']);
    // autre jour : la veille du nouveau jour, toujours à 9h
    expect(at(followMoments([eve], { date: '2026-10-21', time: '14:30' }, { date: '2026-10-24', time: '14:30' }, []), '2026-10-24', '14:30')).toEqual(['La veille à 09:00']);
    // plus d’heure : « 15 min avant » n’a plus de sens, la veille à 9h reste
    expect(at(followMoments([eve, 15], { date: '2026-10-21', time: '14:30' }, { date: '2026-10-21' }, [0]), '2026-10-21')).toEqual(['La veille à 09:00']);
    expect(followMoments([15], { date: '2026-10-21', time: '14:30' }, { date: '2026-10-21' }, [0])).toEqual([0]);
    // une heure ajoutée : « La veille à 18h » reste à 18h
    expect(at(followMoments([900], { date: '2026-10-21' }, { date: '2026-10-21', time: '14:00' }, [15]), '2026-10-21', '14:00')).toEqual(['La veille à 18:00']);
  });
});

describe('rappels des grands jours', () => {
  it('a week before and the day before at 18:00, plus the usual one', () => {
    // Exam at 08:00: the day before at 18:00 is 14 h before.
    expect(eventReminders({ date: '2026-11-20', start: '08:00', category: 'examen' }, [15], now)).toEqual([10080, 840, 15]);
  });
  it('all day: a week before, the day before at 18:00, that day at 9:00', () => {
    expect(eventReminders({ date: '2026-11-20', important: true, category: 'cours' }, [15], now)).toEqual([10080, 900, 0]);
  });
  it('a usual reminder already past is left out (« 1 jour avant » on an event made for today)', () => {
    const today = new Date(2026, 9, 29, 14, 0);
    expect(eventReminders({ date: '2026-10-29', start: '17:00', category: 'perso' }, [1440, 15], today)).toEqual([15]);
  });
  it('its own reminders, an imported one or an ordinary one: unchanged', () => {
    expect(eventReminders({ date: '2026-11-20', start: '08:00', category: 'examen', reminders: [30] }, [15])).toEqual([30]);
    expect(eventReminders({ date: '2026-11-20', category: 'examen', externalId: 'x' }, [15])).toEqual([]);
    expect(eventReminders({ date: '2026-11-20', start: '08:00', category: 'cours' }, [15])).toEqual([15]);
  });
  it('an exam tomorrow at 9:00: not « 1 semaine avant », already past (the usual one stays)', () => {
    // now: Thursday 16 October, 10:00.
    expect(eventReminders({ date: '2026-10-17', start: '09:00', category: 'examen' }, [15], now)).toEqual([900, 15]);
    expect(eventReminders({ date: '2026-10-16', important: true }, [15], now)).toEqual([]);
    // Chosen by hand: kept as chosen.
    expect(eventReminders({ date: '2026-10-17', start: '09:00', category: 'examen', reminders: [10080] }, [15], now)).toEqual([10080]);
  });
});

describe('rappels des tâches datées', () => {
  it('the day before at 18:00 and that day at 9:00, those already past left out', async () => {
    const { taskReminders } = await import('../src/lib/reminders');
    expect(taskReminders('2026-11-10', undefined, new Date(2026, 10, 2, 12))).toEqual([900, 0]);
    expect(taskReminders('2026-11-10', undefined, new Date(2026, 10, 9, 19))).toEqual([0]);
    expect(taskReminders('2026-11-10', '14:00', new Date(2026, 10, 2, 12))).toEqual([60]);
    expect(taskReminders('2026-11-10', undefined, new Date(2026, 10, 10, 10))).toEqual([]);
  });
});

describe('résumé du matin des tâches', () => {
  it('one notification at 8:00 with the tasks due that day or late, nothing on a day without', async () => {
    const { taskDigests } = await import('../src/lib/reminders');
    const todos = [
      { id: 'a', title: 'Envoyer le devis', done: false, due: '2026-11-03' },
      { id: 'b', title: 'Payer la facture', done: false, due: '2026-11-01' },
      { id: 'c', title: 'Fait', done: true, due: '2026-11-03' },
      { id: 'd', title: 'Sans date', done: false },
    ];
    const list = taskDigests(todos, new Date(2026, 10, 2, 20, 0), 2);
    expect(list.map(x => [x.key, x.fireAt.getHours(), x.title])).toEqual([
      ['task:matin:2026-11-03', 8, '2 tâches à faire aujourd’hui'],
      ['task:matin:2026-11-04', 8, '2 tâches à faire aujourd’hui'],
    ]);
    expect(list[0].body).toBe('Envoyer le devis, Payer la facture');
    expect(taskDigests([], new Date(2026, 10, 2, 20, 0))).toEqual([]);
  });
});

describe('rappels : plus tard, résumé du matin, boutons', () => {
  it('« Plus tard » : le rappel revient à l’heure dite, avec sa propre clé ; passé ou élément fait, rien', () => {
    const at = new Date(2026, 9, 16, 10, 10).toISOString();
    const r = upcomingReminders([{ kind: 'task', id: 't1', title: 'Appeler la banque', date: '2026-10-16', reminders: [], snoozes: [at, new Date(2026, 9, 16, 9, 0).toISOString()] }], now);
    expect(r.map(x => [x.key, x.fireAt.getHours(), x.fireAt.getMinutes()])).toEqual([[`task:t1:plus-tard:${Date.parse(at)}`, 10, 10]]);
    expect(r[0].url).toBe('/taches?tache=t1');
    expect(upcomingReminders([{ kind: 'task', id: 't1', title: 'X', date: '2026-10-16', done: true, snoozes: [at] }], now)).toEqual([]);
  });

  it('le résumé de 8 h remplace le rappel de 9 h d’une tâche sans heure, pas celui de la veille ni celui d’une tâche à l’heure dite', () => {
    const items = [
      { kind: 'task' as const, id: 'a', title: 'Envoyer le dossier', date: '2026-10-18', reminders: [900, 0] },
      { kind: 'task' as const, id: 'b', title: 'Réunion', date: '2026-10-18', time: '14:00', reminders: [60] },
    ];
    const keys = (days?: Set<string>) => upcomingReminders(items, now, 35, days).map(x => x.key.split(':').slice(0, 3).join(':'));
    expect(keys()).toEqual(['task:a:900', 'task:a:0', 'task:b:60']);
    expect(keys(new Set(['2026-10-18']))).toEqual(['task:a:900', 'task:b:60']);
    expect(keys(new Set(['2026-10-19']))).toEqual(['task:a:900', 'task:a:0', 'task:b:60']);
  });

  it('rappels par défaut des tâches : ceux choisis, 1 h avant une tâche à l’heure dite, aucun si « Aucun »', async () => {
    const { taskReminders } = await import('../src/lib/reminders');
    const before = new Date(2026, 10, 2, 12);
    expect(taskReminders('2026-11-10', undefined, before, [900])).toEqual([900]);
    expect(taskReminders('2026-11-10', undefined, before, [0])).toEqual([0]);
    expect(taskReminders('2026-11-10', '14:00', before, [0])).toEqual([60]);
    expect(taskReminders('2026-11-10', undefined, before, [])).toEqual([]);
    expect(taskReminders('2026-11-10', '14:00', before, [])).toEqual([]);
  });

  it('les boutons : « Plus tard » et « Fait » sur un rappel à moi, « Voir » pour plusieurs, « Voir » et « OK » sinon', async () => {
    const { notificationButtons, reminderItems } = await import('../src/lib/reminders');
    const { familyOf } = await import('../src/lib/notifyGroups.mjs');
    expect(notificationButtons(['task:t1:0:2026-10-16T09:00']).map(b => b.action)).toEqual(['plus-tard', 'fait']);
    expect(notificationButtons(['task:t1:0:2026-10-16T09:00', 'event:e1:15:2026-10-16T10:00']).map(b => b.action)).toEqual(['plus-tard', 'voir']);
    expect(notificationButtons(['task:t1:900:x', 'task:t1:plus-tard:1']).map(b => b.action)).toEqual(['plus-tard', 'fait']);
    for (const other of [['task:matin:2026-11-03'], ['agenda:x:y'], ['test'], []]) expect(notificationButtons(other).map(b => b.action)).toEqual(['voir', 'ok']);
    expect(reminderItems(['event:e1:15:x', 'task:t2:plus-tard:5'])).toEqual([
      { kind: 'event', id: 'e1' },
      { kind: 'task', id: 't2' },
    ]);
    expect(familyOf('task:matin:2026-11-03')).toBe('matin');
    expect(familyOf('task:t1:0:x')).toBe('rappel');
  });
});
