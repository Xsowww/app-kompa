// Le résumé de 8 h et les rappels de tâches, relus au moment de l'envoi : une tâche cochée entre-temps n'y est plus.
import { describe, expect, it } from 'vitest';
import { freshTaskRows } from '../server/push.mjs';

const U = '11111111-1111-1111-1111-111111111111';
const id = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
const row = (key: string, title = '3 tâches à faire aujourd’hui', body = 'Lire, Écrire, Ranger') => ({ key, user_id: U, title, body, url: '/taches', fire_at: '2026-11-13T07:00:00Z' });
const todo = (n: number, title: string, extra: object = {}) => ({ id: id(n), user_id: U, title, done: false, due: '2026-11-13', deleted_at: null, created_at: `2026-11-0${n}T10:00:00Z`, ...extra });

describe('rappels de tâches relus avant l’envoi', () => {
  it('le résumé du matin ne garde que les tâches encore à faire', () => {
    const out = freshTaskRows([row('task:matin:2026-11-13')], [todo(1, 'Lire'), todo(3, 'Ranger')]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('2 tâches à faire aujourd’hui');
    expect(out[0].body).toBe('Lire, Ranger');
  });
  it('une seule tâche : au singulier, dans la langue du compte', () => {
    const out = freshTaskRows([row('task:matin:2026-11-13')], [todo(1, 'Read')], new Map([[U, 'en']]));
    expect(out[0].title).toBe('1 task to do today');
  });
  it('les tâches en retard comptent, celles de demain non', () => {
    const out = freshTaskRows([row('task:matin:2026-11-13')], [todo(1, 'En retard', { due: '2026-11-10' }), todo(2, 'Demain', { due: '2026-11-14' })]);
    expect(out[0].body).toBe('En retard');
  });
  it('plus rien à faire : pas de résumé', () => {
    expect(freshTaskRows([row('task:matin:2026-11-13')], [])).toEqual([]);
  });
  it('le rappel d’une tâche cochée ou supprimée n’est pas envoyé ; une tâche inconnue garde le sien', () => {
    const rows = [row(`task:${id(1)}:30`), row(`task:${id(2)}:30`), row(`task:${id(3)}:30`), row('evt:abc:15')];
    const out = freshTaskRows(rows, [todo(1, 'Faite', { done: true }), todo(2, 'Supprimée', { deleted_at: '2026-11-12T10:00:00Z' })]);
    expect(out.map(r => r.key)).toEqual([`task:${id(3)}:30`, 'evt:abc:15']);
  });
  it('plus de 3 tâches : les 3 premières et « … »', () => {
    const out = freshTaskRows([row('task:matin:2026-11-13')], [1, 2, 3, 4].map(n => todo(n, `T${n}`)));
    expect(out[0].body).toBe('T1, T2, T3…');
    expect(out[0].title).toBe('4 tâches à faire aujourd’hui');
  });
});
