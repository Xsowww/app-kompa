import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const memory = new Map<string, string>();
const session = new Map<string, string>();
const store = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) });
Object.assign(globalThis, { location: new URL('http://localhost/'), localStorage: store(memory), sessionStorage: store(session) });
const { afterSignIn, finishWelcome, loadWelcomeDraft, saveWelcomeDraft, useWelcome } = await import('../src/store/session');
const { useSettings } = await import('../src/store/settings');
const { useAuth } = await import('../src/store/auth');
const { readWelcomeDraft, welcomePending, statusGroups, needOptions, isLycee, WELCOME_STEPS } = await import('../src/lib/welcome');
const { navFromAnswers } = await import('../src/lib/navOrder');
const { rememberAfterLogin } = await import('../src/lib/afterLogin');

type Answers = Parameters<typeof finishWelcome>[0];
const answers = (patch: Partial<Answers> = {}): Answers => ({ usage: 'etudes', usages: ['etudes'], year: '', needs: [], persona: 'pote', ...patch });

beforeEach(() => {
  session.clear();
  useSettings.getState().reset();
  useWelcome.setState({ pending: true, unsure: false, checking: false });
});

describe('welcome questionnaire draft (in the account, any device)', () => {
  it('comes back with the question and the answers', () => {
    saveWelcomeDraft({ step: 2, answers: answers({ year: 'L2', needs: ['agenda'] }) });
    expect(useSettings.getState().welcomeDraft).toBeTruthy();
    expect(loadWelcomeDraft()).toEqual({ step: 2, answers: answers({ year: 'L2', needs: ['agenda'] }) });
  });

  it('is not written once the questionnaire is done', () => {
    useWelcome.setState({ pending: false });
    saveWelcomeDraft({ step: 1, answers: answers() });
    expect(useSettings.getState().welcomeDraft).toBeNull();
  });

  it('ignores broken or out-of-range values', () => {
    expect(readWelcomeDraft({ step: 42, answers: { usages: ['pirate', 'travail', 'travail'], year: 3, needs: 'ia', persona: 'robot' } })).toEqual({
      step: WELCOME_STEPS - 1,
      answers: { usage: 'travail', usages: ['travail'], year: '', needs: [], persona: 'neutre' },
    });
    expect(readWelcomeDraft('{oops')).toBeNull();
    expect(readWelcomeDraft(null)).toBeNull();
  });
});

describe('is the questionnaire still to answer?', () => {
  const s = (patch = {}) => ({ welcomeDone: false, welcomeDraft: null, ...patch });
  it('follows the profile once it was read', () => {
    expect(welcomePending(false, s())).toBe(true);
    expect(welcomePending(true, s())).toBe(false);
  });
  it('done on another device (settings synced) wins over a profile flag not sent yet', () => {
    expect(welcomePending(false, s({ welcomeDone: true }))).toBe(false);
  });
  it('left half-way: still to answer, even before the profile is read', () => {
    expect(welcomePending(undefined, s({ welcomeDraft: { step: 1, answers: {} } }))).toBe(true);
  });
  it('unknown on a new device offline: neither the questionnaire nor « done »', () => {
    expect(welcomePending(undefined, s())).toBeNull();
  });
});

describe('after signing in', () => {
  it('goes straight to the questionnaire when it is still to answer (never through a blank « / »)', () => {
    rememberAfterLogin('/calendrier');
    useWelcome.setState({ pending: true });
    expect(afterSignIn()).toBe('/bienvenue');
    useWelcome.setState({ pending: false });
    expect(afterSignIn()).toBe('/calendrier');
    expect(afterSignIn()).toBe('/');
  });

  it('the sign-in and two-factor pages use it (the blank page came from navigating to « / » after the load)', () => {
    for (const page of ['src/pages/AuthPage.tsx', 'src/pages/MfaPage.tsx']) {
      const src = readFileSync(page, 'utf8');
      expect(src).toContain('navigate(afterSignIn()');
      expect(src).not.toMatch(/navigate\(takeAfterLogin\(\)/);
    }
  });
});

describe('the questions', () => {
  it('« Tu es… » shows what fits the usages chosen, each answer once', () => {
    const work = statusGroups(['travail']).flatMap(g => g.options);
    expect(work).toContain('Salarié·e');
    expect(work).not.toContain('L1');
    const both = statusGroups(['etudes', 'travail']).flatMap(g => g.options);
    expect(both.filter(o => o === 'Alternance')).toHaveLength(1);
    expect(statusGroups([]).length).toBe(statusGroups(['etudes', 'travail', 'perso']).length);
  });

  it('no fac words for a high-school pupil', () => {
    expect(isLycee('Terminale')).toBe(true);
    expect(isLycee('L2')).toBe(false);
    const lycee = needOptions({ usage: 'etudes', usages: ['etudes'], year: 'Terminale' }).find(n => n.key === 'reviser')!;
    expect(lycee.label).toMatch(/bac/);
    expect(needOptions({ usage: 'travail', usages: ['travail'], year: '' }).some(n => n.key === 'reviser')).toBe(false);
  });
});

describe('finishWelcome', () => {
  beforeEach(() => useAuth.setState({ user: { id: 'u1', name: 'Lina', email: 'lina@example.com', createdAt: '2026-10-15T10:00:00Z' } } as never));

  it('makes Kompaly speak up for someone who asked for help from the AI', () => {
    finishWelcome(answers({ needs: ['agenda', 'ia'] }));
    expect(useSettings.getState().chattiness).toBe('normal');
  });

  it('keeps him quiet otherwise', () => {
    finishWelcome(answers({ needs: ['agenda'] }));
    expect(useSettings.getState().chattiness).toBe('calme');
  });

  it('is remembered in the account and forgets the draft, without waiting for the network', () => {
    saveWelcomeDraft({ step: 3, answers: answers() });
    finishWelcome(answers());
    expect(useSettings.getState()).toMatchObject({ welcomeDone: true, welcomeDraft: null });
    expect(useWelcome.getState().pending).toBe(false);
    expect(loadWelcomeDraft()).toBeNull();
  });

  it('keeps every usage chosen, the first one is the main one', () => {
    finishWelcome(answers({ usage: 'travail', usages: ['travail', 'perso'] }));
    expect(useSettings.getState()).toMatchObject({ usage: 'travail', usages: ['travail', 'perso'] });
  });

  it('orders the navigation from the answers', () => {
    finishWelcome(answers({ needs: ['agenda-partage', 'enregistrer'] }));
    expect(useSettings.getState().navOrder).toEqual(navFromAnswers(['etudes'], ['agenda-partage', 'enregistrer']));
  });

  it('answered again: the order follows, unless the person reordered it', () => {
    finishWelcome(answers({ needs: ['fichiers'] }));
    finishWelcome(answers({ needs: ['equipe'] }));
    expect(useSettings.getState().navOrder).toEqual(navFromAnswers(['etudes'], ['equipe']));
    const mine = ['agendas', 'notes', 'calendrier', 'taches', 'drive', 'enregistrer', 'groupes'] as const;
    useSettings.getState().set({ navOrder: [...mine] });
    finishWelcome(answers({ needs: ['fichiers'] }));
    expect(useSettings.getState().navOrder).toEqual([...mine]);
  });
});
