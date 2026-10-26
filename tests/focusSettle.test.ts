import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { useFocus, settleFocus } = await import('../src/store/focus');
const { useFocusLog } = await import('../src/store/focusLog');
const { useSettings } = await import('../src/store/settings');

const MIN = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T10:00:00'));
  useFocusLog.setState({ sessions: [] });
  useFocus.setState({ phase: null, pausedLeft: null, label: '', endsAt: 0, minutes: 0 });
  useSettings.getState().set({ focusMinutes: 25, breakMinutes: 5, focusSound: false });
});

describe('focus session', () => {
  it('counts the minutes done when stopped before the end, none under one', () => {
    useFocus.getState().start('Maths');
    vi.setSystemTime(Date.now() + 20 * MIN + 30_000);
    expect(useFocus.getState().stop()).toBe(20);
    expect(useFocus.getState().phase).toBeNull();
    expect(useFocusLog.getState().sessions[0]).toMatchObject({ subject: 'Maths', minutes: 20 });
    useFocus.getState().start('Physique');
    vi.setSystemTime(Date.now() + 40_000);
    expect(useFocus.getState().stop()).toBe(0);
    expect(useFocusLog.getState().sessions).toHaveLength(1);
  });

  it('counts a session that ended while the tab was closed, even after the break', () => {
    useFocus.getState().start('Histoire');
    vi.setSystemTime(Date.now() + 35 * MIN);
    settleFocus();
    expect(useFocus.getState().phase).toBeNull();
    const [s] = useFocusLog.getState().sessions;
    expect(s).toMatchObject({ subject: 'Histoire', minutes: 25, startedAt: new Date('2026-10-15T10:00:00').toISOString() });
  });

  it('starts the break from the real end of the session', () => {
    useFocus.getState().start('Chimie');
    vi.setSystemTime(Date.now() + 27 * MIN);
    settleFocus();
    const f = useFocus.getState();
    expect(f.phase).toBe('break');
    expect(f.endsAt - Date.now()).toBe(3 * MIN);
    expect(useFocusLog.getState().sessions).toHaveLength(1);
  });

  it('keeps the planned length when the setting changes during the session', () => {
    useFocus.getState().start('Chimie');
    useSettings.getState().set({ focusMinutes: 15 });
    vi.setSystemTime(Date.now() + 25 * MIN);
    useFocus.getState().tick();
    expect(useFocusLog.getState().sessions[0].minutes).toBe(25);
  });

  it('forgets a break that is long over', () => {
    useFocus.setState({ phase: 'break', endsAt: Date.now() - 10 * MIN, pausedLeft: null, label: '', minutes: 5 });
    settleFocus();
    expect(useFocus.getState().phase).toBeNull();
    expect(useFocusLog.getState().sessions).toHaveLength(0);
  });
});
