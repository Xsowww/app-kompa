import { beforeEach, describe, expect, it, vi } from 'vitest';

// The stores reach for the browser when they load: give them the globals they read.
const memory = new Map<string, string>();
const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) };
Object.assign(globalThis, { location: new URL('http://localhost/'), localStorage: storage, sessionStorage: storage });
const { dayLabel, leastCovering } = await import('../src/copilot/panel');
const { isTourRequest } = await import('../src/copilot/localBrain');
const { hourLabel } = await import('../src/copilot/actions');
const { CopilotApiError, PartlyDone, canRetry, wasStopped } = await import('../src/copilot/claudeBrain');
const { useCopilot, toggleKompaly } = await import('../src/store/copilot');
const { useFocus, focusTitle } = await import('../src/store/focus');
const { useSettings } = await import('../src/store/settings');
const { keyChips } = await import('../src/pages/profile/shortcuts');

describe('day separators of the conversation', () => {
  const now = new Date('2026-11-03T15:00:00');
  it('says « Aujourd’hui », « Hier », else the date', () => {
    expect(dayLabel('2026-11-03T08:12:00', now)).toBe('Aujourd’hui');
    expect(dayLabel('2026-11-02T23:59:00', now)).toBe('Hier');
    expect(dayLabel('2026-10-30T10:00:00', now)).toBe('vendredi 30 octobre');
  });
});

describe('where a remark goes on a computer', () => {
  const box = (top: number) => ({ left: 0, top, width: 100, height: 100 });
  it('keeps the usual place when it hides nothing', () => {
    expect(leastCovering([box(0), box(200)], () => false)).toBe(0);
  });
  it('takes the first place over no card, else the one over the fewest points', () => {
    const card = (x: number, y: number) => y < 150 && x >= 0; // a card over the top 150 px
    expect(leastCovering([box(0), box(100), box(300)], card)).toBe(2);
    expect(leastCovering([box(0), box(100)], card)).toBe(1); // partly over it is better than all over it
  });
});

describe('Kompaly understands « fais-moi visiter »', () => {
  it('in the site’s languages, not in other sentences', () => {
    for (const q of ['Fais-moi visiter', 'fais moi visiter stp', 'Je veux revoir la visite guidée', 'refais le tour de Kompaly', 'show me around', 'Guided tour please'])
      expect(isTourRequest(q), q).toBe(true);
    for (const q of ['visite chez le dentiste mardi', 'fais une fiche sur le tour de France']) expect(isTourRequest(q), q).toBe(false);
  });
});

describe('hours in Kompaly’s sentences', () => {
  it('« 14h », « 9h30 » in French (no « à 14:00 » mixed in)', () => {
    expect(hourLabel('14:00')).toBe('14h');
    expect(hourLabel('09:30')).toBe('9h30');
  });
});

describe('« Arrêter » and « Réessayer »', () => {
  it('a stop is not an error to retry; a network hiccup is, a limit or a half-done answer is not', () => {
    expect(wasStopped(new CopilotApiError('aborted'))).toBe(true);
    expect(wasStopped(new PartlyDone(new CopilotApiError('aborted'), []))).toBe(true);
    expect(canRetry(new CopilotApiError('aborted'))).toBe(false);
    expect(canRetry(new CopilotApiError('network'))).toBe(true);
    expect(canRetry(new CopilotApiError('timeout'))).toBe(true);
    expect(canRetry(new CopilotApiError('daily_limit'))).toBe(false);
    expect(canRetry(new PartlyDone(new CopilotApiError('network'), []))).toBe(false);
  });
});

describe('a remark missed while the panel was closed', () => {
  beforeEach(() => useCopilot.setState({ messages: [], pose: 'hidden', bubble: null, unread: false }));
  it('leaves a dot until the panel is opened, from anywhere', () => {
    useCopilot.getState().say({ text: 'Pense à ton partiel.' });
    expect(useCopilot.getState().unread).toBe(true);
    toggleKompaly();
    expect(useCopilot.getState().pose).toBe('open');
    expect(useCopilot.getState().unread).toBe(false);
    toggleKompaly();
    expect(useCopilot.getState().pose).toBe('hidden');
  });
});

describe('focus session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T10:00:00'));
    useCopilot.setState({ messages: [], pose: 'hidden', pendingOffer: null });
    useFocus.setState({ phase: null, pausedLeft: null, label: '', endsAt: 0, minutes: 0 });
    useSettings.getState().set({ focusMinutes: 25, breakMinutes: 5, focusSound: false });
  });

  it('« Passer la pause » starts the next session on the same subject', () => {
    useFocus.getState().start('Chimie');
    vi.setSystemTime(Date.now() + 25 * 60_000 + 500);
    useFocus.getState().tick();
    expect(useFocus.getState().phase).toBe('break');
    useFocus.getState().skipBreak();
    expect(useFocus.getState()).toMatchObject({ phase: 'focus', label: 'Chimie', pausedLeft: null });
  });

  it('the end of the break offers « Relancer une session »', () => {
    useFocus.getState().start('Chimie');
    vi.setSystemTime(Date.now() + 25 * 60_000 + 500);
    useFocus.getState().tick();
    vi.setSystemTime(Date.now() + 5 * 60_000 + 500);
    useFocus.getState().tick();
    expect(useFocus.getState().phase).toBeNull();
    const last = useCopilot.getState().messages.at(-1);
    expect(last?.offers?.[0]).toMatchObject({ kind: 'start_focus', label: 'Relancer une session', payload: { subject: 'Chimie' } });
  });

  it('shows the time left in the window’s title, after a recording’s own mark', () => {
    expect(focusTitle('Notes · Kompaly', '24:59')).toBe('⏱ 24:59 · Notes · Kompaly');
    expect(focusTitle('⏱ 24:59 · Notes · Kompaly', '24:58')).toBe('⏱ 24:58 · Notes · Kompaly');
    expect(focusTitle('● 03:12 · Notes · Kompaly', '24:58')).toBe('● 03:12 · ⏱ 24:58 · Notes · Kompaly');
    expect(focusTitle('● 03:13 · ⏱ 24:58 · Notes · Kompaly', null)).toBe('● 03:13 · Notes · Kompaly');
  });
});

describe('Réglages › Raccourcis', () => {
  it('writes the keys for Windows and Linux, and with the Mac’s symbols', () => {
    expect(keyChips('Ctrl+K · /', false)).toEqual([['Ctrl + K'], ['/']]);
    expect(keyChips('G, A', false)).toEqual([['G', 'A']]);
    expect(keyChips('Ctrl+Maj+Z', true)).toEqual([['⌘⇧Z']]);
    expect(keyChips('Ctrl+Entrée', true)).toEqual([['⌘↩']]);
    expect(keyChips('Suppr', true)).toEqual([['⌘⌫']]);
    expect(keyChips('Retour arrière', true)).toEqual([['⌫']]);
    expect(keyChips('Ctrl+clic', true)).toEqual([['⌘ clic']]);
  });
});
