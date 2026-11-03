import { afterEach, describe, expect, it, vi } from 'vitest';

// The stores read the browser globals.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { parseInvite, inviteText, inviteLink } = await import('../src/lib/groupInvite');
const { changedAfter, defaultHeir, insertMention, matchesQuery, mentionAt, mentionsIn, roleLabel, sortFiles, sortNotes } = await import('../src/pages/groups/logic');
const { groupError } = await import('../src/lib/groups');
const { removeWithUndo, usePendingRemovals } = await import('../src/pages/groups/pending');
const { useUi } = await import('../src/store/ui');

const TOKEN = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';

describe('invitations (Rejoindre : code, lien de groupe, lien d’agenda)', () => {
  it('reconnaît le lien d’un agenda partagé, ou son jeton seul', () => {
    expect(parseInvite(`https://kompaly.com/agendas?invitation=${TOKEN}`)).toEqual({ kind: 'agenda', secret: TOKEN });
    expect(parseInvite(`  ${TOKEN.toUpperCase()} `)).toEqual({ kind: 'agenda', secret: TOKEN });
    expect(parseInvite(`Rejoins l’agenda partagé « Coloc » sur Kompaly : https://kompaly.com/agendas?invitation=${TOKEN}`)).toEqual({ kind: 'agenda', secret: TOKEN });
  });
  it('un lien d’agenda coupé : redemandé en entier (jamais pris pour un code)', () => {
    expect(parseInvite(`https://kompaly.com/agendas?invitation=${TOKEN.slice(0, 40)}`)).toEqual({ kind: 'agenda', secret: '' });
  });
  it('reconnaît le code d’un groupe : seul, dans son lien, ou dans un message', () => {
    expect(parseInvite('abc 234')).toEqual({ kind: 'groupe', secret: 'ABC234' });
    expect(parseInvite('https://kompaly.com/groupes?rejoindre=ZZ9Y8X')).toEqual({ kind: 'groupe', secret: 'ZZ9Y8X' });
    expect(parseInvite('Rejoins-nous avec le code : QW7RT2 sur Kompaly')).toEqual({ kind: 'groupe', secret: 'QW7RT2' });
    expect(parseInvite('abc')).toBeNull();
  });
  it('le message à envoyer porte le lien (et le code d’un groupe), et se relit tel quel', () => {
    const group = inviteText({ kind: 'groupe', name: 'Bio' }, 'ABC234', 'https://kompaly.com');
    expect(group).toContain('https://kompaly.com/groupes?rejoindre=ABC234');
    expect(group).toContain('ABC234');
    expect(parseInvite(group)).toEqual({ kind: 'groupe', secret: 'ABC234' });
    const agenda = inviteText({ kind: 'agenda', name: 'Coloc' }, TOKEN, 'https://kompaly.com');
    expect(agenda).toContain(inviteLink('agenda', TOKEN, 'https://kompaly.com'));
    expect(parseInvite(agenda)).toEqual({ kind: 'agenda', secret: TOKEN });
  });
});

describe('membres', () => {
  const m = (userId: string, joinedAt: string, patch = {}) => ({ userId, name: userId, joinedAt, isOwner: false, role: 'editeur' as const, canInvite: true, ...patch });
  it('le propriétaire qui part : le membre le plus ancien est proposé, jamais lui-même', () => {
    expect(defaultHeir([m('moi', '2026-01-01'), m('lea', '2026-03-01'), m('hugo', '2026-02-01')], 'moi')).toBe('hugo');
    expect(defaultHeir([m('moi', '2026-01-01')], 'moi')).toBeNull();
  });
  it('les droits de chacun, en mots', () => {
    expect(roleLabel(m('a', '', { role: 'lecteur', canInvite: false }))).toBe('Lecteur');
    expect(roleLabel(m('a', ''))).toBe('Éditeur · peut inviter');
    expect(roleLabel(m('a', '', { isOwner: true }))).toBe('Propriétaire');
  });
});

describe('listes de notes et de fichiers : recherche et ordre', () => {
  const notes = [
    { title: 'Révision anatomie', createdAt: '2026-10-01', updatedAt: '2026-10-20' },
    { title: 'chapitre 10', createdAt: '2026-10-03', updatedAt: '2026-10-05' },
    { title: 'Chapitre 2', createdAt: '2026-10-02', updatedAt: '2026-10-25' },
  ];
  it('cherche sans tenir compte des accents ni des majuscules', () => {
    expect(matchesQuery('Révision anatomie', 'revision ANAT')).toBe(true);
    expect(sortNotes(notes, 'modifiees', 'chap').map(n => n.title)).toEqual(['Chapitre 2', 'chapitre 10']);
  });
  it('trie par modification, création ou titre (2 avant 10)', () => {
    expect(sortNotes(notes, 'modifiees').map(n => n.title)).toEqual(['Chapitre 2', 'Révision anatomie', 'chapitre 10']);
    expect(sortNotes(notes, 'creees').map(n => n.title)).toEqual(['chapitre 10', 'Chapitre 2', 'Révision anatomie']);
    expect(sortNotes(notes, 'titre').map(n => n.title)).toEqual(['Chapitre 2', 'chapitre 10', 'Révision anatomie']);
  });
  it('fichiers : récents, nom ou taille', () => {
    const files = [
      { name: 'b.pdf', size: 10, createdAt: '2026-10-02' },
      { name: 'A.docx', size: 30, createdAt: '2026-10-01' },
    ];
    expect(sortFiles(files, 'recents').map(f => f.name)).toEqual(['b.pdf', 'A.docx']);
    expect(sortFiles(files, 'nom').map(f => f.name)).toEqual(['A.docx', 'b.pdf']);
    expect(sortFiles(files, 'taille').map(f => f.name)).toEqual(['A.docx', 'b.pdf']);
  });
});

describe('@mentions dans les commentaires', () => {
  const members = [
    { userId: 'u1', name: 'Léa' },
    { userId: 'u2', name: 'Léa Martin' },
    { userId: 'u3', name: 'Hugo' },
  ];
  it('repère le nom en cours de saisie après « @ »', () => {
    expect(mentionAt('Merci @Lé', 9)).toEqual({ start: 6, query: 'Lé' });
    expect(mentionAt('Merci @', 7)).toEqual({ start: 6, query: '' });
    expect(mentionAt('mail@test', 9)).toBeNull();
    expect(mentionAt('Merci @Léa ok', 13)).toBeNull();
  });
  it('remplace ce qui était tapé par le nom choisi', () => {
    const at = mentionAt('Merci @Lé', 9)!;
    expect(insertMention('Merci @Lé', at, 'Léa Martin')).toEqual({ text: 'Merci @Léa Martin ', caret: 18 });
    const mid = mentionAt('Vu @H et toi', 5)!;
    expect(insertMention('Vu @H et toi', mid, 'Hugo').text).toBe('Vu @Hugo et toi');
  });
  it('trouve les membres cités, le nom le plus long d’abord', () => {
    expect(mentionsIn('@Léa Martin tu as vu ?', members)).toEqual(['u2']);
    expect(mentionsIn('Merci @Léa, et @hugo.', members).sort()).toEqual(['u1', 'u3']);
    expect(mentionsIn('écris à lea@ecole.fr', members)).toEqual([]);
  });
});

describe('« modifié par »', () => {
  it('seulement quand quelqu’un a changé l’événement après l’avoir proposé', () => {
    const base = { createdAt: '2026-11-01T10:00:00Z', createdBy: 'a' };
    expect(changedAfter({ ...base, updatedAt: null, updatedBy: null })).toBe(false);
    expect(changedAfter({ ...base, updatedAt: '2026-11-01T10:00:00Z', updatedBy: 'a' })).toBe(false);
    expect(changedAfter({ ...base, updatedAt: '2026-11-02T09:00:00Z', updatedBy: 'a' })).toBe(true);
    expect(changedAfter({ ...base, updatedAt: '2026-11-01T10:00:30Z', updatedBy: 'b' })).toBe(true);
  });
});

describe('messages', () => {
  it('la limite de 30 compte groupes et agendas partagés ensemble', () => {
    expect(groupError(new Error('too many groups'))).toBe('Tu fais déjà partie de 30 groupes et agendas partagés en tout, c’est le maximum.');
  });
});

describe('suppression avec « Annuler » (notes et fichiers partagés)', () => {
  afterEach(() => vi.useRealTimers());
  it('cachée tout de suite, envoyée après le délai, pas si annulée', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    removeWithUndo(['n1'], 'Note supprimée', async () => void sent.push('n1'));
    removeWithUndo(['f1'], 'Fichier supprimé', async () => void sent.push('f1'));
    expect(usePendingRemovals.getState().ids.sort()).toEqual(['f1', 'n1']);
    // « Annuler » of the first toast.
    useUi.getState().toasts.find(x => x.text === 'Note supprimée')!.action!.run();
    expect(usePendingRemovals.getState().ids).toEqual(['f1']);
    await vi.advanceTimersByTimeAsync(6000);
    expect(sent).toEqual(['f1']);
    expect(usePendingRemovals.getState().ids).toEqual([]);
  });
});
