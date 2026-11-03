import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../src/store/calendar';

// The stores read the address and the browser's storage when loaded.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { shortcutOf } = await import('../src/layout/shortcuts');
const { sharedNote } = await import('../src/lib/shareTarget');
const { badgeCount } = await import('../src/lib/appBadge');
const { ownFiles } = await import('../src/lib/offline');
const { backOnlineText } = await import('../src/lib/backOnline');
const { toastDuration, useUi } = await import('../src/store/ui');
const { allActions } = await import('../src/store/create');
const { default: ErrorBoundary } = await import('../src/components/ErrorBoundary');
const { toKey } = await import('../src/lib/dates');

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('raccourcis globaux', () => {
  it('?, /, N, G and Ctrl+J (⌘J)', () => {
    expect(shortcutOf(key('?', { shiftKey: true }))).toEqual({ kind: 'help' });
    expect(shortcutOf(key('/'))).toEqual({ kind: 'search' });
    expect(shortcutOf(key('/', { shiftKey: true }))).toEqual({ kind: 'search' }); // French keyboard: Maj + :
    expect(shortcutOf(key('n'))).toEqual({ kind: 'create' });
    expect(shortcutOf(key('N'))).toEqual({ kind: 'create' }); // Caps Lock
    expect(shortcutOf(key('g'))).toEqual({ kind: 'g' });
    expect(shortcutOf(key('j', { ctrlKey: true }))).toEqual({ kind: 'kompaly' });
    expect(shortcutOf(key('j', { metaKey: true }))).toEqual({ kind: 'kompaly' });
  });
  it('G then a letter goes to a space; anything else after G does nothing', () => {
    expect(shortcutOf(key('c'), true)).toEqual({ kind: 'go', to: '/calendrier' });
    expect(shortcutOf(key('t'), true)).toEqual({ kind: 'go', to: '/taches' });
    expect(shortcutOf(key('a'), true)).toEqual({ kind: 'go', to: '/' });
    expect(shortcutOf(key('n'), true)).toEqual({ kind: 'go', to: '/notes' });
    expect(shortcutOf(key('x'), true)).toBeNull();
    expect(shortcutOf(key('c', { shiftKey: true }), true)).toBeNull();
  });
  it('other modifiers leave the keys to the browser and the page', () => {
    expect(shortcutOf(key('n', { ctrlKey: true }))).toBeNull();
    expect(shortcutOf(key('n', { shiftKey: true }))).toBeNull();
    expect(shortcutOf(key('n', { altKey: true }))).toBeNull();
    expect(shortcutOf(key('j', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutOf(key('k', { ctrlKey: true }))).toBeNull(); // the search's own Ctrl+K
    expect(shortcutOf(key('m'))).toBeNull(); // « Moment important » while recording
  });
  it('the « + » menu shows N on its first line only', () => {
    const a = { label: 'A', icon: null, onClick: () => {} };
    const lines = allActions([
      { id: '2', order: 1, actions: [{ ...a, label: 'Page' }] },
      { id: '1', order: 0, actions: [{ ...a, label: 'Onglet' }, a] },
    ]);
    expect(lines.map(l => [l.label, l.shortcut])).toEqual([
      ['Onglet', 'N'],
      ['A', undefined],
      ['Page', undefined],
    ]);
  });
});

describe('toasts', () => {
  afterEach(() => {
    useUi.setState({ toasts: [] });
    vi.useRealTimers();
  });
  it('errors stay longer, a button leaves time to reach it', () => {
    expect(toastDuration('error')).toBe(8000);
    expect(toastDuration('info', { label: 'Annuler', run: () => {} })).toBe(6000);
    expect(toastDuration('success')).toBe(3500);
  });
  it('the same message twice: one toast', () => {
    const { toast } = useUi.getState();
    toast('Copié', 'success');
    toast('Copié', 'success');
    toast('Autre chose', 'success');
    expect(useUi.getState().toasts.map(x => x.text)).toEqual(['Copié', 'Autre chose']);
  });
  it('waits while paused, then counts the rest of its time; 0: stays', () => {
    vi.useFakeTimers();
    const { toast, pauseToast, resumeToast } = useUi.getState();
    toast('Erreur réseau', 'error');
    const id = useUi.getState().toasts[0].id;
    vi.advanceTimersByTime(5000);
    pauseToast(id);
    vi.advanceTimersByTime(60_000);
    expect(useUi.getState().toasts).toHaveLength(1);
    resumeToast(id);
    vi.advanceTimersByTime(2900);
    expect(useUi.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(useUi.getState().toasts).toHaveLength(0);
    toast('Nouvelle version disponible', 'info', undefined, { duration: 0 });
    vi.advanceTimersByTime(600_000);
    expect(useUi.getState().toasts).toHaveLength(1);
  });
});

describe('partage vers Kompaly', () => {
  it('a link with its page title: a note titled so, the link at the end', () => {
    expect(sharedNote({ title: 'Article', text: '', url: 'https://www.example.org/a?b=1&c=2' })).toEqual({
      title: 'Article',
      content: '<p><a href="https://www.example.org/a?b=1&amp;c=2">https://www.example.org/a?b=1&amp;c=2</a></p>',
    });
  });
  it('a text alone: its first line as title, paragraphs, no HTML from the text', () => {
    const n = sharedNote({ title: '', text: 'Courses\nlait <b>frais</b>\n\npain', url: '' })!;
    expect(n.title).toBe('Courses');
    expect(n.content).toBe('<p>Courses<br>lait &lt;b&gt;frais&lt;/b&gt;</p><p>pain</p>');
  });
  it('the link already in the text is not added twice; a bare link is named after its site', () => {
    expect(sharedNote({ title: '', text: 'Vu sur https://ex.fr/x', url: 'https://ex.fr/x' })!.content).toBe('<p>Vu sur https://ex.fr/x</p>');
    expect(sharedNote({ title: '', text: '', url: 'https://www.ex.fr/x' })!.title).toBe('ex.fr');
    expect(sharedNote({ title: ' ', text: ' ', url: '' })).toBeNull();
  });
});

describe('pastille de l’icône', () => {
  const day = (n: number) => toKey(new Date(Date.now() + n * 86400000));
  const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({ id: Math.random().toString(36), title: 'x', date: day(-3), category: 'perso', done: false, createdAt: '', ...over });
  it('a trip over several days counts once, done or deleted things not at all, plus the news', () => {
    const trip = ['span-1', 'span-1', 'span-1'].map((series, i) => ev({ series, date: day(-5 + i) }));
    const events = [...trip, ev({}), ev({ done: true }), ev({ deletedAt: 'x' }), ev({ date: day(2) })];
    const todos = [{ done: false, due: day(-1) }, { done: true, due: day(-1) }, { done: false, due: day(1) }, { done: false }, { done: false, due: day(-2), deletedAt: 'x' }];
    expect(badgeCount(events, todos, day(0), 0)).toBe(3);
    expect(badgeCount(events, todos, day(0), 4)).toBe(7);
    expect(badgeCount([], [], day(0), 0)).toBe(0);
  });
});

describe('hors ligne', () => {
  it('only the site’s own files are kept, never its API', () => {
    const o = 'https://kompaly.com';
    expect(ownFiles([`${o}/assets/index-a1.js`, `${o}/api/sante`, `${o}/theme.js`, 'https://x.supabase.co/rest/v1/notes', `${o}/__kompaly/page`, 'https://kompaly.com.evil.io/a.js'], o)).toEqual([`${o}/assets/index-a1.js`, `${o}/theme.js`]);
  });
  it('back online: says what was sent, when it all went', () => {
    expect(backOnlineText(3, true)).toBe('De retour en ligne · 3 changements envoyés');
    expect(backOnlineText(1, true)).toBe('De retour en ligne · 1 changement envoyé');
    expect(backOnlineText(3, false)).toBe('De retour en ligne');
    expect(backOnlineText(0, false)).toBe('De retour en ligne');
  });
});

describe('erreur dans une page', () => {
  it('another address tries the page again', () => {
    expect(ErrorBoundary.getDerivedStateFromProps({ resetKey: '/taches' }, { key: '/notes' })).toEqual({ failed: false, key: '/taches' });
    expect(ErrorBoundary.getDerivedStateFromProps({ resetKey: '/notes' }, { key: '/notes' })).toBeNull();
  });
});
