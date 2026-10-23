import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Kompaly without the AI, in the other site languages: the examples it shows must work as shown.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
  // « Dark mode » applies the theme to the page.
  document: { documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, classList: { toggle() {} } }, querySelector: () => null },
});
const { setDictForTests } = await import('../src/i18n');
const { localReply, fromOtherLanguage } = await import('../src/copilot/localBrain');
const { useCalendar } = await import('../src/store/calendar');
const { useTodos } = await import('../src/store/todos');
const { useNotes } = await import('../src/store/notes');

type L = 'en' | 'es' | 'de' | 'it';
const LANGS: L[] = ['en', 'es', 'de', 'it'];
const dicts = Object.fromEntries(LANGS.map(l => [l, JSON.parse(readFileSync(`src/i18n/${l}.json`, 'utf8')) as Record<string, string>]));

// The examples of the help (every usage), as written in localBrain.ts, and each one of them in a language.
const src = readFileSync('src/copilot/localBrain.ts', 'utf8');
const block = src.slice(src.indexOf('const EXAMPLES'), src.indexOf('function recordingHelp'));
const keys = [...block.matchAll(/t\('(.+?)'\)/g)].map(m => m[1]);
const examples = (l: L) => keys.flatMap(k => [...(dicts[l][k] ?? '').matchAll(/[“«„]\s*(.+?)\s*[”»“]/g)].map(m => m[1]));

const notUnderstood = (l: L) => dicts[l]['Je n’ai pas tout compris : l’IA n’est pas disponible, je comprends seulement des demandes simples. Essaie par exemple :'];

describe('Kompaly sans IA, dans les autres langues', () => {
  for (const l of LANGS) {
    it(`${l} : chaque exemple de l’aide est compris`, () => {
      setDictForTests(l, dicts[l]);
      const list = examples(l);
      expect(list.length).toBeGreaterThanOrEqual(30);
      for (const ex of list) {
        useNotes.setState({ notes: [] }); // node has no DOMParser for a quiz on a note: « no note of that name » still shows it understood
        const reply = localReply(ex).text;
        expect(reply, `${l} « ${ex} »`).not.toContain(notUnderstood(l));
        // A trash question waits for « yes »: answered « no », nothing is left pending.
        if (/\(.+\/.+\)$/.test(reply)) localReply(l === 'de' ? 'nein' : 'no');
      }
      setDictForTests('fr', {});
    });
  }

  it('aide : « Hilfe », « aiuto », « ayuda », « help »', () => {
    for (const [l, w] of [['de', 'Hilfe'], ['it', 'aiuto'], ['es', 'ayuda'], ['en', 'help'], ['es', '¿Qué puedes hacer?'], ['de', 'Was kannst du?']] as [L, string][]) {
      setDictForTests(l, dicts[l]);
      expect(localReply(w).text, w).toContain(dicts[l]['Voilà ce que je sais faire sans IA :']);
    }
    setDictForTests('fr', {});
  });

  it('les demandes deviennent des actions', () => {
    const cases: [L, string, () => unknown][] = [
      ['de', 'Füge Zahnarzt Freitag 10 Uhr hinzu', () => expect(useCalendar.getState().events.at(-1)).toMatchObject({ title: 'Zahnarzt', start: '10:00' })],
      ['de', 'Trag Kundentermin morgen 14 Uhr ein', () => expect(useCalendar.getState().events.at(-1)).toMatchObject({ title: 'Kundentermin', start: '14:00' })],
      ['es', 'Añade Dentista viernes 10:00', () => expect(useCalendar.getState().events.at(-1)).toMatchObject({ title: 'Dentista', start: '10:00' })],
      ['it', 'Aggiungi Dentista venerdì 10:00', () => expect(useCalendar.getState().events.at(-1)).toMatchObject({ title: 'Dentista', start: '10:00' })],
      ['en', 'Add Dentist Friday 10am', () => expect(useCalendar.getState().events.at(-1)).toMatchObject({ title: 'Dentist', start: '10:00' })],
      ['it', 'Aggiungi l’attività chiamare la banca domani', () => expect(useTodos.getState().todos.at(-1)?.title).toMatch(/^[Cc]hiamare la banca$/)],
      ['de', 'Füge die Aufgabe Bank anrufen morgen hinzu', () => expect(useTodos.getState().todos.at(-1)?.title).toMatch(/^Bank anrufen$/)],
      ['en', 'Add the task call the bank tomorrow', () => expect(useTodos.getState().todos.at(-1)?.title).toMatch(/^[Cc]all the bank$/)],
      ['es', 'Crea una nota Compra: pan, leche', () => expect(useNotes.getState().notes.find(n => n.title === 'Compra')).toBeTruthy()],
      ['de', 'Erstelle eine Notiz Einkauf: Brot, Milch', () => expect(useNotes.getState().notes.find(n => n.title === 'Einkauf')).toBeTruthy()],
    ];
    for (const [l, ask, check] of cases) {
      setDictForTests(l, dicts[l]);
      localReply(ask);
      check();
    }
    setDictForTests('fr', {});
  });

  it('réécrit en français, sans toucher au reste', () => {
    expect(fromOtherLanguage('„Frag mich zu Geschichte ab“')).toBe('interroge-moi sur Geschichte');
    expect(fromOtherLanguage('Starte eine Fokus-Session für den Bericht')).toBe('lance une session focus sur Bericht');
    expect(fromOtherLanguage('Benenne Übung 1 in Übung 1 korrigiert um')).toBe('renomme Übung 1 en Übung 1 korrigiert');
    expect(fromOtherLanguage('Sposta Bozza nel cestino')).toBe('mets Bozza à la corbeille');
    expect(fromOtherLanguage('Find the Maths folder')).toBe('trouve Maths');
    expect(fromOtherLanguage('What have I got this weekend?')).toBe('qu\'est-ce que j\'ai ce week-end');
    expect(fromOtherLanguage('Il compito di matematica è difficile')).toBeNull();
    // French stays French (the rewrite only runs in another language).
    setDictForTests('fr', {});
    expect(localReply('Ajoute Dentiste vendredi 10h').text).toMatch(/^Ajouté au calendrier/);
  });
});
