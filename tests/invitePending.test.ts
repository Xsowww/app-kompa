import { describe, expect, it } from 'vitest';

// The stores read the browser globals.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
  sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
});
const { INVITE_KEY, freshInvite, keepInvite, keptInvite, pendingInvite, readInvite, takeInvite } = await import('../src/pages/groups/invitePending');
const { inviteLink, inviteText, parseInvite, shareLinks } = await import('../src/lib/groupInvite');
const { agendaTargets, toAgendaRows } = await import('../src/pages/groups/agendaTarget');
const { workWeek } = await import('../src/pages/landingDemo');

const TOKEN = 'ab'.repeat(32);
const now = new Date('2026-11-06T10:00:00Z');

describe('le lien d’invitation', () => {
  it('porte le prénom de qui invite et le nom de l’agenda, et se relit tel quel', () => {
    const link = inviteLink('agenda', TOKEN, 'https://kompaly.com', { from: 'Sandrine', name: 'Famille Martin' });
    expect(link).toBe(`https://kompaly.com/agendas?invitation=${TOKEN}&de=Sandrine&nom=Famille%20Martin`);
    expect(readInvite(link)).toEqual({ kind: 'agenda', secret: TOKEN, from: 'Sandrine', name: 'Famille Martin' });
    expect(parseInvite(link)).toEqual({ kind: 'agenda', secret: TOKEN });
    const group = inviteText({ kind: 'groupe', name: 'Bio' }, 'ABC234', 'https://kompaly.com', 'Léa');
    expect(group).toContain('rejoindre=ABC234&de=L%C3%A9a&nom=Bio');
    expect(parseInvite(group)).toEqual({ kind: 'groupe', secret: 'ABC234' });
  });
  it('un ancien lien (sans nom) marche toujours ; un faux lien ne donne rien', () => {
    expect(readInvite(`/agendas?invitation=${TOKEN}`)).toEqual({ kind: 'agenda', secret: TOKEN, from: '', name: '' });
    expect(readInvite('/groupes?rejoindre=abc234')).toEqual({ kind: 'groupe', secret: 'ABC234', from: '', name: '' });
    expect(readInvite('/agendas?invitation=1234')).toBeNull();
    expect(readInvite('/agendas')).toBeNull();
  });
  it('ce que dit le lien est nettoyé et coupé (affiché, jamais cru)', () => {
    const info = readInvite(`/agendas?invitation=${TOKEN}&de=${encodeURIComponent('<b>Sandrine</b>\u0007')}&nom=${'x'.repeat(100)}`)!;
    expect(info.from).toBe('bSandrine/b');
    expect(info.name).toHaveLength(60);
  });
  it('SMS, WhatsApp et e-mail avec le message écrit', () => {
    const ways = shareLinks('Rejoins « Famille » : https://k.com/x', 'Invitation');
    expect(ways.map(w => w.key)).toEqual(['sms', 'whatsapp', 'email']);
    expect(ways[0].href.startsWith('sms:?&body=Rejoins')).toBe(true);
    expect(ways[1].href).toContain('https://wa.me/?text=');
    expect(ways[2].href).toContain('mailto:?subject=Invitation&body=');
  });
});

describe('l’invitation gardée sur l’appareil', () => {
  const path = `/agendas?invitation=${TOKEN}&de=Sandrine`;
  it('gardée deux semaines, pas plus', () => {
    expect(freshInvite(keptInvite(path, now), now)).toBe(path);
    expect(freshInvite(keptInvite(path, now), new Date(now.getTime() + 13 * 864e5))).toBe(path);
    expect(freshInvite(keptInvite(path, now), new Date(now.getTime() + 15 * 864e5))).toBeNull();
    expect(freshInvite('pas du json', now)).toBeNull();
    expect(freshInvite(keptInvite('/ailleurs', now), now)).toBeNull();
  });
  it('dans le localStorage (survit à l’inscription et à la confirmation), rejointe une seule fois', () => {
    keepInvite(path, now);
    expect(JSON.parse(memory.get(INVITE_KEY)!)).toEqual({ path, at: now.toISOString() });
    expect(pendingInvite(now)).toBe(path);
    expect(takeInvite(now)).toBe(path);
    expect(takeInvite(now)).toBeNull();
  });
});

describe('« + » : ajouter dans un agenda partagé', () => {
  const g = (id: string, ownerId: string, kind: 'agenda' | 'groupe' = 'agenda') => ({ id, name: id, color: null, photo: null, ownerId, createdAt: '', kind, categories: [], defaultRole: 'editeur' as const, defaultCanInvite: true });
  it('les agendas où je peux ajouter : les miens et ceux où je suis éditeur', () => {
    const list = [g('famille', 'moi'), g('coloc', 'lea'), g('club', 'hugo'), g('groupe', 'moi', 'groupe')];
    expect(agendaTargets(list, { coloc: 'editeur', club: 'lecteur' }, 'moi').map(x => x.id)).toEqual(['famille', 'coloc']);
  });
  it('mes catégories à moi deviennent la catégorie de l’agenda ; pas de rappel imposé', () => {
    const rows = toAgendaRows(
      [
        { title: 'Dentiste', date: '2026-11-10', start: '17:30', category: 'cours', important: true },
        { title: 'Stage', date: '2026-11-11', category: 'c-perso1', reminders: [60], series: 's1' },
      ],
      { categories: [] },
    );
    expect(rows[0]).toEqual({ title: 'Dentiste', date: '2026-11-10', start: '17:30', end: null, place: null, category: 'cours', details: null, people: [], reminders: [], series: null });
    expect(rows[1]).toMatchObject({ category: 'perso', reminders: [60], series: 's1', start: null });
  });
});

describe('la petite semaine de la connexion', () => {
  it('du lundi au vendredi de cette semaine, aujourd’hui marqué ; le week-end, la semaine suivante', () => {
    expect(workWeek(new Date(2026, 10, 6, 10))).toEqual({ days: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'], today: 4 });
    expect(workWeek(new Date(2026, 10, 7, 10))).toEqual({ days: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'], today: -1 });
    expect(workWeek(new Date(2026, 10, 9, 8)).today).toBe(0);
  });
});
