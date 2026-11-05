import { describe, expect, it } from 'vitest';
import { cleanNavOrder, moveSpace, navFromAnswers, PHONE_TABS, resolveNavOrder, SPACE_KEYS } from '../src/lib/navOrder';

const whole = (o: string[]) => expect([...o].sort()).toEqual([...SPACE_KEYS].sort());

describe('navFromAnswers', () => {
  it('no answer: today’s order', () => {
    expect(navFromAnswers(undefined, [])).toEqual(SPACE_KEYS);
    expect(navFromAnswers('etudes', null)).toEqual(SPACE_KEYS);
  });

  it('the usage alone keeps the everyday spaces in the bar, its own after them', () => {
    for (const u of ['etudes', 'travail', 'perso'] as const) expect(navFromAnswers(u, []).slice(0, PHONE_TABS)).toEqual(['calendrier', 'taches', 'notes', 'drive']);
    expect(navFromAnswers('perso', []).indexOf('agendas')).toBe(PHONE_TABS);
    expect(navFromAnswers('travail', []).indexOf('groupes')).toBe(PHONE_TABS);
  });

  it('the spaces of the needs come first, always the 7 keys once', () => {
    const o = navFromAnswers('etudes', ['enregistrer', 'equipe']);
    whole(o);
    expect(o.slice(0, PHONE_TABS)).toEqual(['enregistrer', 'groupes', 'calendrier', 'taches']);
    const p = navFromAnswers('perso', ['agenda-partage', 'agenda']);
    expect(p.slice(0, 3)).toEqual(['calendrier', 'taches', 'agendas']);
    whole(p);
  });

  it('the calendar stays in the phone’s bar', () => {
    const o = navFromAnswers('travail', ['fichiers', 'equipe', 'enregistrer', 'notes']);
    whole(o);
    expect(o.indexOf('calendrier')).toBeLessThan(PHONE_TABS);
    expect(o.slice(0, PHONE_TABS)).toContain('drive');
  });

  it('several usages: the first is the primary one; unknown needs change nothing', () => {
    expect(navFromAnswers(['perso', 'etudes'], [])).toEqual(navFromAnswers('perso', []));
    expect(navFromAnswers('etudes', ['ia', '???'])).toEqual(SPACE_KEYS);
  });
});

describe('the questionnaire’s keys (pages/WelcomePage › needs)', () => {
  const KEYS = ['agenda', 'reviser', 'enregistrer', 'agenda-partage', 'equipe', 'notes', 'fichiers', 'taches', 'focus', 'ia'];
  it('each one known (« ia » brings no space)', () => {
    const expected: Record<string, string> = { agenda: 'calendrier', reviser: 'notes', enregistrer: 'enregistrer', 'agenda-partage': 'agendas', equipe: 'groupes', notes: 'notes', fichiers: 'drive', taches: 'taches', focus: 'taches' };
    for (const k of KEYS) {
      const o = navFromAnswers('perso', [k]);
      whole(o);
      if (k === 'ia') expect(o).toEqual(navFromAnswers('perso', []));
      else expect(o.slice(0, PHONE_TABS)).toContain(expected[k]);
    }
  });
  it('a shared calendar and a group asked for: both in the bar, with the calendar', () => {
    const o = navFromAnswers('etudes', ['agenda-partage', 'equipe']);
    expect(o.slice(0, PHONE_TABS)).toEqual(expect.arrayContaining(['agendas', 'groupes', 'calendrier']));
  });
});

describe('saved order', () => {
  it('cleaned: unknown keys and repeats out, missing spaces at the end', () => {
    expect(cleanNavOrder(['notes', 'accueil', 'notes', 'drive', 3])).toEqual(['notes', 'drive', 'calendrier', 'taches', 'enregistrer', 'groupes', 'agendas']);
  });

  it('the chosen order wins; empty or absent: derived from the answers', () => {
    expect(resolveNavOrder(['agendas'], 'etudes', [])[0]).toBe('agendas');
    expect(resolveNavOrder(null, 'etudes', ['enregistrer'])[0]).toBe('enregistrer');
    expect(resolveNavOrder([], 'etudes', [])).toEqual(SPACE_KEYS);
  });

  it('moves one place, not past the ends', () => {
    expect(moveSpace(SPACE_KEYS, 'taches', -1).slice(0, 2)).toEqual(['taches', 'calendrier']);
    expect(moveSpace(SPACE_KEYS, 'calendrier', -1)).toEqual(SPACE_KEYS);
    expect(moveSpace(SPACE_KEYS, 'agendas', 1)).toEqual(SPACE_KEYS);
  });
});
