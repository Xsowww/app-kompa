// Test visiteurs : l'assistant en mode simple oubliait les tâches (Yanis : « qu'est-ce que j'ai la semaine
// prochaine ? »), ignorait « cette semaine » (Antoine), répondait à côté pour une facture ou un planning d'employés
// (Karim), et proposait « Me prévenir 1 h avant » comme s'il n'y avait aucun rappel.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
// Jeudi 12 novembre 2026, 10 h.
vi.useFakeTimers({ now: new Date(2026, 10, 12, 10, 0), toFake: ['Date'] });
const { localReply } = await import('../src/copilot/localBrain');
const { outOfScope } = await import('../src/copilot/outOfScope');
const { isSimpleRequest } = await import('../src/copilot/simpleIntent');
const { useCalendar } = await import('../src/store/calendar');
const { useTodos } = await import('../src/store/todos');
const { useSettings } = await import('../src/store/settings');

beforeEach(() => {
  useCalendar.setState({ events: [], trash: [] });
  useTodos.setState({ todos: [], trash: [] });
  useSettings.getState().set({ usage: 'etudes' });
  localReply('non');
});

const seed = () => {
  useCalendar.getState().add({ title: 'TD algo', date: '2026-11-17', start: '10:00', category: 'cours' });
  useCalendar.getState().add({ title: 'Cinéma', date: '2026-11-14', start: '20:00', category: 'perso' });
  const t = useTodos.getState();
  t.add('Rendre le TP réseaux', '2026-11-16', '18:00');
  t.add('Acheter un cahier', '2026-11-13');
  t.add('Courses du week-end', '2026-11-14');
  t.add('Dossier de bourse', '2026-12-15');
  t.add('Inscription au stage', '2027-01-20');
  t.add('Ranger le bureau');
};

describe('une période : les événements ET les tâches à rendre', () => {
  it('« qu’est-ce que j’ai la semaine prochaine ? » : le cours du mardi et la tâche du lundi 18 h', () => {
    seed();
    const r = localReply('qu’est-ce que j’ai la semaine prochaine ?');
    expect(r.text).toContain('TD algo');
    expect(r.text).toContain('Rendre le TP réseaux (lundi 16 nov. à 18h)');
    expect(r.text).not.toContain('Dossier de bourse');
    expect(r.text).not.toContain('Acheter un cahier');
    expect(r.links?.map(l => l.to)).toContain('/taches');
  });

  it('une semaine sans événement mais avec une tâche : pas « rien de prévu »', () => {
    useTodos.getState().add('Rendre le TP réseaux', '2026-11-16', '18:00');
    const r = localReply('qu’est-ce que j’ai la semaine prochaine ?');
    expect(r.text).toContain('La semaine prochaine');
    expect(r.text).toContain('Rendre le TP réseaux');
    expect(r.text).not.toContain('Rien de prévu');
  });

  it('« ce week-end » : la tâche de samedi avec le cinéma', () => {
    seed();
    const r = localReply('qu’est-ce qui est prévu ce week-end ?');
    expect(r.text).toContain('Cinéma');
    expect(r.text).toContain('Courses du week-end');
    expect(r.text).not.toContain('Rendre le TP');
  });

  it('« mon planning de la semaine » : les tâches de la semaine s’ajoutent au point de la semaine', () => {
    seed();
    const r = localReply('c’est quoi mon planning de la semaine ?');
    expect(r.text).toContain('Cette semaine');
    expect(r.text).toContain('Acheter un cahier (demain)');
    expect(r.text).not.toContain('Dossier de bourse');
  });
});

describe('« … à faire cette semaine » ne liste plus tout', () => {
  it('seulement les tâches de la semaine (et celles en retard), puis le calendrier de ces jours', () => {
    seed();
    useTodos.getState().add('Appeler la banque', '2026-11-10');
    const r = localReply('qu’est-ce que j’ai à faire cette semaine ?');
    expect(r.text).toContain('À faire cette semaine (3) :');
    expect(r.text).toContain('Appeler la banque');
    expect(r.text).toContain('(en retard)');
    expect(r.text).toContain('Acheter un cahier · demain');
    expect(r.text).toContain('Courses du week-end');
    for (const later of ['Rendre le TP', 'Dossier de bourse', 'Inscription au stage', 'Ranger le bureau']) expect(r.text).not.toContain(later);
    expect(r.text).toContain('Au calendrier :');
    expect(r.text).toContain('Cinéma');
  });

  it.each([
    ['mes tâches de la semaine prochaine', ['Rendre le TP réseaux · lundi 16 nov. à 18h'], ['Acheter un cahier', 'Dossier de bourse']],
    ['mes tâches de demain', ['Acheter un cahier'], ['Rendre le TP', 'Courses']],
    ['qu’est-ce que j’ai à faire ce week-end ?', ['Courses du week-end'], ['Acheter un cahier', 'Rendre le TP']],
  ])('%s', (ask, there, absent) => {
    seed();
    const r = localReply(ask);
    for (const x of there) expect(r.text).toContain(x);
    for (const x of absent) expect(r.text).not.toContain(x);
  });

  it('rien à rendre dans la période : c’est dit, sans lister le reste', () => {
    useTodos.getState().add('Dossier de bourse', '2026-12-15');
    const r = localReply('mes tâches cette semaine');
    expect(r.text).toBe('Rien à faire cette semaine pour le moment.');
  });

  it('sans période : toute la liste, comme avant', () => {
    seed();
    const r = localReply('mes tâches');
    expect(r.text).toContain('À faire (6) :');
    expect(r.text).toContain('Inscription au stage');
  });
});

describe('factures, devis, planning d’équipe, comptabilité : Kompaly dit qu’il ne le fait pas', () => {
  it.each([
    ['Fais une facture pour M. Dupuis', 'facture'],
    ['fais-moi un devis pour le chantier Martin', 'facture'],
    ['Peux-tu créer une facture de 300 euros ?', 'facture'],
    ['Est-ce que Kompaly fait les devis ?', 'facture'],
    ['Comment faire une facture ?', 'facture'],
    ['Fais le planning de mes 8 employés pour la semaine prochaine', 'equipe'],
    ['Tu peux gérer les horaires de mon équipe ?', 'equipe'],
    ['Est-ce que tu fais la gestion du personnel ?', 'equipe'],
    ['Fais ma comptabilité', 'compta'],
    ['Calcule ma TVA du trimestre', 'compta'],
    ['Tu peux faire mes fiches de paie ?', 'compta'],
  ])('%s', (ask, kind) => {
    expect(outOfScope(ask)).toBe(kind);
    const r = localReply(ask);
    expect(r.text).toMatch(/^Kompaly ne fait pas/);
    expect(r.text).toContain('rappel');
    expect(r.text).toContain('tâche');
    expect(r.text).toContain('note');
    expect(r.text).not.toContain('pas tout compris');
    expect(r.unknown).toBeUndefined();
    expect(useCalendar.getState().events).toHaveLength(0);
    expect(useTodos.getState().todos).toHaveLength(0);
  });

  it.each([
    'Rappelle-moi d’envoyer la facture demain 9h',
    'Ajoute la tâche faire le devis Dupuis',
    'Faire le devis Dupuis demain 9h',
    'Envoyer facture Martin lundi 14h',
    'Trouve le dossier Factures',
    'Réunion d’équipe lundi 10h',
    'Ajoute Planning de l’équipe lundi 10h',
    'qu’est-ce que j’ai la semaine prochaine ?',
    'Planifie mes révisions',
  ])('%s : une demande pour Kompaly', ask => {
    expect(outOfScope(ask)).toBeNull();
  });

  it('le planning d’employés n’est plus pris pour « qu’est-ce que j’ai la semaine prochaine »', () => {
    const ask = 'Fais le planning de mes 8 employés pour la semaine prochaine';
    // Answered on the device even with the AI on: the answer must be the right one.
    if (isSimpleRequest(ask)) expect(localReply(ask).text).toMatch(/^Kompaly ne fait pas le planning/);
  });
});

describe('la pastille de rappel après un ajout', () => {
  it('un rappel existe déjà (15 min) : « Me prévenir aussi 1 h avant »', () => {
    const r = localReply('Dentiste mardi 17h30');
    const ev = useCalendar.getState().events[0];
    expect(ev.reminders).toEqual([15]);
    expect(r.offers?.[0]).toMatchObject({ kind: 'add_reminder', label: 'Me prévenir aussi 1 h avant' });
  });
  it('aucun rappel par défaut : « Me prévenir 1 h avant »', () => {
    useSettings.getState().set({ defaultReminders: [] });
    const r = localReply('Dentiste mardi 17h30');
    expect(useCalendar.getState().events[0].reminders ?? []).toEqual([]);
    expect(r.offers?.[0]).toMatchObject({ label: 'Me prévenir 1 h avant' });
    useSettings.getState().set({ defaultReminders: [15] });
  });
});
