// Le bouton Retour du téléphone ferme ce qui est ouvert par-dessus la page (lib/backClose), sans laisser d’entrée en
// trop dans l’historique. Un faux historique de navigateur : des entrées, une position, « popstate » après back().
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Entry = { state: Record<string, unknown> | null; url: string };
let entries: Entry[] = [];
let at = 0;
let listeners: ((e: { stopImmediatePropagation: () => void }) => void)[] = [];
/** What the pages (the router) heard: the address of each « popstate » that reached them. */
let heard: string[] = [];
let backClose: (close: () => void) => () => void;

const fake = {
  get state() {
    return entries[at].state;
  },
  pushState(state: Entry['state'], _: string, url?: string) {
    entries = [...entries.slice(0, at + 1), { state, url: url ?? entries[at].url }];
    at++;
  },
  replaceState(state: Entry['state'], _: string, url?: string) {
    entries[at] = { state, url: url ?? entries[at].url };
  },
  back: () => fake.go(-1),
  forward: () => fake.go(1),
  go(by: number) {
    setTimeout(() => {
      if (!entries[at + by]) return;
      at += by;
      let stopped = false;
      for (const l of [...listeners]) if (!stopped) l({ stopImmediatePropagation: () => (stopped = true) });
    }, 0);
  },
};

/** A fresh page of the app, on the history as it is. */
async function load() {
  listeners = [];
  heard = [];
  vi.resetModules();
  Object.assign(globalThis, {
    window: { addEventListener: (_: string, l: (typeof listeners)[number]) => listeners.push(l) },
    history: { ...fake },
    location: {},
  });
  Object.defineProperty(history, 'state', { get: () => entries[at].state });
  Object.defineProperty(location, 'href', { get: () => entries[at].url, configurable: true });
  ({ backClose } = await import('../src/lib/backClose'));
  listeners.push(() => heard.push(entries[at].url)); // the router, after us
}

const idx = () => (entries[at].state?.idx as number) ?? 0;
/** The router: another page, or the same one with another address. */
const go = (url: string) => history.pushState({ idx: idx() + 1 }, '', url);
const rewrite = (url: string) => history.replaceState({ idx: idx() }, '', url);
/** The user's Back button (and what follows at once). */
const back = () => (history.back(), vi.advanceTimersByTime(5));
/** A moment later. */
const wait = () => vi.advanceTimersByTime(400);
const here = () => `${entries[at].url}${entries[at].state?.overlay ? ` +${entries[at].state!.overlay}` : ''}`;

beforeEach(async () => {
  vi.useFakeTimers();
  entries = [{ state: { idx: 0 }, url: '/accueil' }, { state: { idx: 1 }, url: '/taches' }];
  at = 1;
  await load();
});

describe('Retour ferme la fenêtre ouverte', () => {
  it('une fenêtre : Retour la ferme, on reste sur la page, les pages n’en entendent rien', () => {
    const close = vi.fn();
    const gone = backClose(close);
    expect(here()).toBe('/taches +1');
    back();
    expect(close).toHaveBeenCalledTimes(1);
    gone();
    wait();
    expect([here(), heard]).toEqual(['/taches', []]);
    // Rien d’ouvert : Retour quitte la page.
    back();
    expect([here(), heard]).toEqual(['/accueil', ['/accueil']]);
  });

  it('fermée par son bouton : son entrée s’en va, Retour quitte la page en une fois', () => {
    backClose(vi.fn())();
    wait();
    expect([here(), entries.length, heard]).toEqual(['/taches', 3, []]);
    back();
    expect(here()).toBe('/accueil');
  });

  it('Retour juste après le bouton (l’entrée est encore là) : une seule pression suffit', () => {
    backClose(vi.fn())();
    back();
    expect([here(), heard]).toEqual(['/accueil', ['/accueil']]);
  });

  it('deux l’une sur l’autre : Retour ferme celle du dessus seulement', () => {
    const under = vi.fn();
    const over = vi.fn();
    const goneUnder = backClose(under);
    const goneOver = backClose(over);
    expect(here()).toBe('/taches +2');
    back();
    expect([under.mock.calls.length, over.mock.calls.length, here()]).toEqual([0, 1, '/taches +1']);
    goneOver();
    back();
    expect(under).toHaveBeenCalledTimes(1);
    goneUnder();
    wait();
    expect([here(), heard]).toEqual(['/taches', []]);
  });

  it('celle du dessus fermée par son bouton, puis Retour : celle du dessous se ferme', () => {
    const under = vi.fn();
    const goneUnder = backClose(under);
    backClose(vi.fn())();
    back(); // before its entry is taken away
    expect([under.mock.calls.length, here()]).toEqual([1, '/taches']);
    goneUnder();
  });

  it('un menu puis sa fenêtre, et le double montage de React : une seule entrée, réutilisée', () => {
    backClose(vi.fn())(); // the menu, closed by the choice
    const first = backClose(vi.fn()); // the dialog (mounted, unmounted, mounted again)
    first();
    const close = vi.fn();
    const gone = backClose(close);
    wait();
    expect([here(), entries.length]).toEqual(['/taches +1', 3]);
    back();
    expect(close).toHaveBeenCalledTimes(1);
    gone();
    expect(here()).toBe('/taches');
  });

  it('aller à une autre page depuis la fenêtre : rien ne reste entre les deux pages (Retour, Avancer, Retour)', () => {
    const gone = backClose(vi.fn());
    go('/notes');
    gone();
    wait();
    expect([here(), entries.map(e => e.url)]).toEqual(['/notes', ['/accueil', '/taches', '/notes']]);
    back();
    wait();
    expect([here(), heard]).toEqual(['/taches', ['/taches']]);
    history.forward();
    wait();
    expect([here(), heard]).toEqual(['/notes', ['/taches', '/notes']]);
    back();
    back();
    expect(here()).toBe('/accueil');
  });

  it('depuis une liste ouverte dans une fenêtre (deux entrées) : Retour revient à la page d’avant, puis la quitte', () => {
    const under = backClose(vi.fn());
    const over = backClose(vi.fn());
    go('/notes');
    over();
    under();
    wait();
    expect(here()).toBe('/notes');
    back();
    wait();
    expect([entries[at].url, heard]).toEqual(['/taches', ['/taches']]);
    back();
    wait();
    expect([here(), heard]).toEqual(['/accueil', ['/taches', '/accueil']]);
  });

  it('un changement de page pile quand l’entrée d’une fenêtre fermée s’en va : on reste sur la nouvelle page', () => {
    backClose(vi.fn())();
    vi.advanceTimersByTime(250); // our step back is on its way…
    go('/notes'); // …and the user taps a link
    wait();
    expect([here(), heard.filter(u => u !== '/notes')]).toEqual(['/notes', []]);
    back();
    expect(here()).toBe('/taches');
  });

  it('une fenêtre qui reste ouverte quand la page change retrouve son entrée', () => {
    const close = vi.fn();
    backClose(close);
    go('/notes');
    wait();
    expect(here()).toBe('/notes +1');
    back();
    expect([close.mock.calls.length, here()]).toEqual([1, '/notes']);
  });

  it('la page réécrit son adresse fenêtre ouverte (« ?ajout=1 » retiré) : Retour ferme et garde la nouvelle adresse', () => {
    go('/calendrier?ajout=1');
    const close = vi.fn();
    const gone = backClose(close);
    rewrite('/calendrier');
    expect(here()).toBe('/calendrier +1');
    back();
    gone();
    wait();
    expect([close.mock.calls.length, here(), entries[at].state, heard]).toEqual([1, '/calendrier', { idx: 2 }, []]);
    // Pas de « ?ajout=1 » resté dessous, qui rouvrirait le formulaire.
    back();
    expect(here()).toBe('/taches');
  });

  it('la même chose fermée par son bouton', () => {
    go('/calendrier?ajout=1');
    const gone = backClose(vi.fn());
    rewrite('/calendrier');
    gone();
    wait();
    expect([here(), entries[at].state, heard]).toEqual(['/calendrier', { idx: 2 }, []]);
  });

  it('page rechargée fenêtre ouverte : l’entrée restée seule s’en va', async () => {
    backClose(vi.fn());
    expect(here()).toBe('/taches +1');
    await load(); // the overlay is gone with the old page
    wait();
    expect([here(), heard]).toEqual(['/taches', []]);
    back();
    expect(here()).toBe('/accueil');
  });

  it('sans rien d’ouvert, Retour et les changements de page ne sont pas touchés', () => {
    go('/notes');
    go('/drive');
    back();
    back();
    wait();
    expect([here(), heard, entries.length]).toEqual(['/taches', ['/notes', '/taches'], 4]);
  });
});
