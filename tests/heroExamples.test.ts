import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseQuickAdd } from '../src/lib/dates';
import { demoMonday, demoPlace, exampleBase, keyOf, mondayOf } from '../src/pages/landingDemo';

// Test visiteurs (12 novembre 2026) : en haut de la page d'accueil, trois exemples à toucher par public
// (« Études · Travail · Famille »). Chacun doit vraiment se ranger dans la semaine montrée, dans les 5 langues.
const page = readFileSync('src/pages/LandingPage.tsx', 'utf8');
const block = page.slice(page.indexOf('const TRY = {'), page.indexOf('} satisfies Record<string, Try>'));
const examples = [...block.matchAll(/audience: '(\w+)'.*?text: t\('([^']+)'\)/g)].map(m => ({ audience: m[1], text: m[2] }));
const dict = (lang: string): Record<string, string> => (lang === 'fr' ? {} : JSON.parse(readFileSync(`src/i18n/${lang}.json`, 'utf8')));

describe('exemples du haut de la page d’accueil', () => {
  it('trois par public : études, travail, famille', () => {
    expect(examples).toHaveLength(9);
    for (const a of ['etudes', 'travail', 'perso']) expect(examples.filter(e => e.audience === a)).toHaveLength(3);
  });

  for (const lang of ['fr', 'en', 'es', 'de', 'it'] as const) {
    it(`chacun devient un événement de la semaine montrée, jamais dans le passé (${lang})`, () => {
      const words = dict(lang);
      // Du lundi 2 au dimanche 8 novembre 2026, le soir.
      for (let d = 2; d <= 8; d++) {
        const now = new Date(2026, 10, d, 19);
        for (const { text } of examples) {
          const said = words[text] ?? text;
          const placed = demoPlace(parseQuickAdd(said, exampleBase(now), lang), keyOf(now), said);
          const where = `« ${said} », le ${d}`;
          expect('error' in placed, where).toBe(false);
          if ('error' in placed) continue;
          expect(placed.kind, where).toBe('event');
          expect(placed.title.trim().length, where).toBeGreaterThan(2);
          expect(mondayOf(placed.date!), where).toBe(demoMonday(now));
          expect(placed.date! >= keyOf(now), where).toBe(true);
        }
      }
    });
  }
});
