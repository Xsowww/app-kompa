// Test complet V9 : l'assistant en mode simple ne dit que ce qu'il a vraiment fait.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
// Mercredi 11 novembre 2026, 10 h.
vi.useFakeTimers({ now: new Date(2026, 10, 11, 10, 0), toFake: ['Date'] });
const { localReply } = await import('../src/copilot/localBrain');
const { useCalendar } = await import('../src/store/calendar');
const { useTodos } = await import('../src/store/todos');
const { useFocus } = await import('../src/store/focus');
const { useSettings } = await import('../src/store/settings');
const { reminderMoment } = await import('../src/lib/reminders');

const events = () => useCalendar.getState().events;
const todos = () => useTodos.getState().todos;

beforeEach(() => {
  useCalendar.setState({ events: [], trash: [] });
  useTodos.setState({ todos: [], trash: [] });
  useFocus.getState().stop();
  useSettings.getState().set({ pro: false });
  localReply('non'); // nothing left waiting for « oui »
});

describe('mode simple : les rappels promis sonnent vraiment', () => {
  it('« rappelle-moi d’acheter des fleurs demain » : un rappel est mis (il n’y en avait aucun sans heure)', () => {
    const r = localReply('rappelle-moi d’acheter des fleurs demain');
    expect(r.text).toContain('Je te le rappellerai');
    expect(r.text).not.toContain('..');
    const ev = events()[0];
    expect(ev).toMatchObject({ title: 'Acheter des fleurs', date: '2026-11-12' });
    expect((ev.reminders ?? []).some(m => reminderMoment(ev.date, ev.start, m) > new Date())).toBe(true);
  });

  it('avec une heure : le rappel habituel suffit, rien n’est ajouté en double', () => {
    localReply('Rappelle-moi demain 8h d’appeler mamie');
    expect(events()[0]).toMatchObject({ title: 'Appeler mamie', date: '2026-11-12', start: '08:00', reminders: [15] });
  });

  it('un moment déjà passé : noté au calendrier, sans promesse de rappel', () => {
    const r = localReply('rappelle-moi d’acheter du pain ce soir'); // sans heure : 9 h ce matin, déjà passé
    expect(events()).toHaveLength(1);
    expect(r.text).not.toContain('rappellerai');
  });

  it('« mets un rappel 1h avant le dentiste » : le rappel va sur le rendez-vous, pas un nouvel événement à 1 h du matin', () => {
    useCalendar.getState().add({ title: 'Dentiste', date: '2026-11-12', start: '14:00', category: 'perso' });
    const r = localReply('Mets un rappel 1h avant le dentiste');
    expect(events()).toHaveLength(1);
    expect(events()[0].reminders).toEqual([60, 15]);
    expect(r.text).toContain('Dentiste');
    expect(localReply('Mets un rappel 2 jours avant le dentiste').text).toBe('Ce moment est déjà passé\u00a0: plus de rappel possible.');
    expect(events()[0].reminders).toEqual([60, 15]);
    expect(localReply('ajoute un rappel 30 min avant le coiffeur').text).toContain('Je ne trouve rien');
    expect(events()).toHaveLength(1);
  });
});

describe('mode simple : rien d’ajouté ni de perdu sans le dire', () => {
  it('« Ajoute rdv 31/11 » : la date n’existe pas, rien n’est mis aujourd’hui', () => {
    const r = localReply('Ajoute rdv 31/11');
    expect(events()).toHaveLength(0);
    expect(r.text).toBe('Cette date n’existe pas\u00a0: vérifie le jour.');
  });

  it('une tâche garde son heure et sa répétition, et la réponse le dit', () => {
    expect(localReply('Ajoute la tâche payer le loyer tous les mois').text).toBe('Ajouté à ta liste : « Payer le loyer » (pour aujourd’hui, chaque mois).');
    expect(todos()[0]).toMatchObject({ title: 'Payer le loyer', due: '2026-11-11', repeat: 'month' });
    expect(localReply('ajoute la tâche appeler la banque demain 14h').text).toBe('Ajouté à ta liste : « Appeler la banque » (pour demain à 14h).');
    expect(todos()[1]).toMatchObject({ title: 'Appeler la banque', due: '2026-11-12', time: '14:00' });
    expect(localReply('ajoute la tâche acheter du lait').text).toBe('Ajouté à ta liste : « Acheter du lait ».');
  });

  it('« Supprime l’examen de maths » : trouvé avec son article, et seulement après « oui »', () => {
    useCalendar.getState().add({ title: 'Examen de maths', date: '2026-11-20', start: '09:00', category: 'examen' });
    expect(localReply("Supprime l'examen de maths").text).toContain('(oui / non)');
    expect(events()).toHaveLength(1);
    localReply('oui');
    expect(events()).toHaveLength(0);
    expect(useCalendar.getState().trash).toHaveLength(1);
  });
});

describe('mode simple : « concentration », le mot de l’appli', () => {
  it('« lance une session de concentration sur les maths » : sur « maths »', () => {
    expect(localReply('Lance une session de concentration sur les maths').text).toBe('C’est parti pour 25 minutes sur « maths ».');
    expect(useFocus.getState()).toMatchObject({ phase: 'focus', label: 'maths' });
    expect(localReply('arrête la concentration').text).toBe('Session arrêtée.');
    expect(useFocus.getState().phase).toBeNull();
  });
  it.each(['Lance une session de concentration', 'lance le minuteur', 'démarre un pomodoro de 50 min', 'Lance une session focus'])('%s : sans sujet inventé, la durée dite est la vraie', text => {
    expect(localReply(text).text).toBe('C’est parti pour 25 minutes.');
    expect(useFocus.getState().label).toBe('');
  });
  it('les exemples donnés parlent de concentration', () => {
    const help = localReply('aide').text;
    expect(help).toContain('session de concentration');
    expect(help).not.toMatch(/focus/i);
  });
});
