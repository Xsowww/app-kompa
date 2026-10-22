import { describe, expect, it } from 'vitest';
// @ts-expect-error -- server module in plain JavaScript
import { cleanSegments, overAudioQuota, parseSection, wavSeconds } from '../server/cours.mjs';
import { RATE, Resampler, encodeWav, findCut, isSilent } from '../src/lib/recorder/audio';
import { cleanKeywords, keywordRanges, matchKeywords, normalize, parseKeywords } from '../src/lib/keywords';
import { PART_CHARS, baseName, chunkText, clock, courseMarkdown, duration, essentialsOf, makeSegment, momentLines, nextPart, rawPart, type Segment } from '../src/lib/recorder/course';
import { docxToText, markdownToDocx } from '../src/lib/docx';

const kw = (...words: string[]) => words.map(word => ({ word, notify: true }));

describe('mots-clés', () => {
  it('ignore majuscules, accents et ponctuation, et attrape le début des mots', () => {
    expect(normalize('C’est À RETENIR ! Œuvre')).toBe('c est a retenir oeuvre');
    expect(matchKeywords('Les EXAMENS auront lieu…', kw('examen'))).toEqual(['examen']);
    expect(matchKeywords('réexamen du dossier', kw('examen'))).toEqual([]);
    expect(matchKeywords('Ceci est à retenir, par cœur.', kw('à retenir', 'par coeur', 'DM'))).toEqual(['à retenir', 'par coeur']);
  });
  it('donne où surligner dans le texte d’origine', () => {
    const text = 'Le partiel, c’est à retenir : les Partiels sont lundi.';
    expect(keywordRanges(text, kw('partiel', 'à retenir')).map(([a, b]) => text.slice(a, b))).toEqual(['partiel', 'à retenir', 'Partiels']);
  });
  it('lit une liste tapée et nettoie celle des réglages', () => {
    expect(parseKeywords('examen, DM;\n  Examen \nà rendre')).toEqual(['examen', 'DM', 'à rendre']);
    expect(cleanKeywords([{ word: 'Examen' }, { word: 'examen', notify: false }, { nope: 1 }, { word: '  ' }])).toEqual([{ word: 'Examen', notify: true }]);
    expect(cleanKeywords('n’importe quoi').length).toBeGreaterThan(5);
  });
});

describe('son', () => {
  it('ramène 48 kHz à 16 kHz', () => {
    const r = new Resampler(48_000);
    let n = 0;
    for (let i = 0; i < 10; i++) n += r.push(new Float32Array(4800).fill(0.5)).length;
    expect(Math.abs(n - 16_000)).toBeLessThanOrEqual(1);
  });
  it('coupe dans un silence, pas au milieu d’un mot', () => {
    const s = new Float32Array(RATE * 21);
    for (let i = 0; i < s.length; i++) s[i] = 0.3 * Math.sin(i / 3);
    // A pause at 18.5 s.
    s.fill(0, RATE * 18.4, RATE * 18.7);
    const cut = findCut(s, 20)!;
    expect(cut / RATE).toBeGreaterThan(18.35);
    expect(cut / RATE).toBeLessThan(18.75);
    // No pause at all: wait, unless forced.
    const loud = new Float32Array(RATE * 21).map((_, i) => 0.3 * Math.sin(i / 3));
    expect(findCut(loud, 20)).toBeNull();
    expect(findCut(loud, 20, true)).not.toBeNull();
  });
  it('repère un morceau sans personne qui parle', () => {
    expect(isSilent(new Float32Array(RATE).fill(0.0005))).toBe(true);
    expect(isSilent(new Float32Array(RATE).map((_, i) => 0.2 * Math.sin(i / 4)))).toBe(false);
  });
  it('fait un WAV que le serveur accepte', async () => {
    const wav = Buffer.from(await encodeWav(new Float32Array(RATE * 2)).arrayBuffer());
    expect(wavSeconds(wav)).toBe(2);
    expect(wavSeconds(Buffer.from('pas un wav du tout, vraiment pas, non non non non'))).toBeNull();
  });
});

describe('serveur', () => {
  it('écarte ce que Whisper invente sur un silence', () => {
    const out = cleanSegments({
      segments: [
        { start: 0, end: 4, text: ' Bonjour à tous.', no_speech_prob: 0.01, avg_logprob: -0.2 },
        { start: 4, end: 6, text: 'Sous-titres réalisés par la communauté d’Amara.org', no_speech_prob: 0.1, avg_logprob: -0.3 },
        { start: 6, end: 8, text: 'Merci.', no_speech_prob: 0.9, avg_logprob: -1.2 },
        { start: 8, end: 9, text: 'bruit', no_speech_prob: 0.8, avg_logprob: -1.5 },
        { start: 9, end: 12, text: 'Le contrat est un accord.', no_speech_prob: 0.2, avg_logprob: -0.3 },
      ],
    });
    expect(out.map((s: { text: string }) => s.text)).toEqual(['Bonjour à tous.', 'Le contrat est un accord.']);
  });
  it('lit la partie rédigée par l’IA', () => {
    const p = parseSection('TITRE: ## La formation du contrat\n---\n### Définition\nUn **contrat** est…\n---\nPOINTS:\n- Point un\n2. Point deux\n');
    expect(p).toEqual({ title: 'La formation du contrat', text: '### Définition\nUn **contrat** est…', points: ['Point un', 'Point deux'] });
    expect(parseSection('Juste du texte').text).toBe('Juste du texte');
  });
  it('limite le son écrit par jour (par élève et pour le site)', () => {
    const t = { groq: true };
    const env = { TRANSCRIBE_DAILY_MINUTES: '1', TRANSCRIBE_SITE_MINUTES: '2' };
    expect(overAudioQuota('a', 50, t, env)).toBeNull();
    expect(overAudioQuota('a', 20, t, env)).toBe('daily_limit');
    expect(overAudioQuota('b', 60, t, env)).toBeNull();
    expect(overAudioQuota('c', 20, t, env)).toBe('site_limit');
  });
});

describe('le cours', () => {
  const seg = (start: number, text: string, extra: Partial<Segment> = {}): Segment => ({ ...makeSegment(`s${start}`, start, start + 10, text, kw('examen'), [25]), ...extra });

  it('marque les mots-clés et les moments étoilés', () => {
    const s = makeSegment('x', 20, 30, ' Attention   à l’examen ', kw('examen'), [25]);
    expect(s).toMatchObject({ text: 'Attention à l’examen', hits: ['examen'], starred: true });
  });
  it('envoie une partie à l’IA quand il y a assez de texte, entière', () => {
    const long = 'mot '.repeat(PART_CHARS / 8);
    const segs = [seg(0, long), seg(10, 'L’examen aura lieu lundi.'), seg(20, long), seg(30, 'suite')];
    expect(nextPart(segs.slice(0, 2), 0)).toBeNull();
    const p = nextPart(segs, 0)!;
    expect(p.until).toBe(30);
    expect(p.text).toContain('⚑ L’examen aura lieu lundi.');
    expect(nextPart(segs, p.until)).toBeNull();
    expect(nextPart(segs, p.until, true)!.text).toBe('suite');
  });
  it('recopie tel quel ce que l’IA n’a pas pu rédiger', () => {
    const raw = rawPart([seg(0, 'Bonjour'), seg(10, '', { origin: 'manquant' })], 0, 20, 'Partie 1');
    expect(raw.text).toBe('**00:00:00** Bonjour\n\n**00:00:10** *(passage non transcrit)*');
  });
  it('écrit le document, et la fiche peut se refaire depuis le fichier Word seul', async () => {
    const md = courseMarkdown({
      title: 'Droit des contrats',
      date: 'lundi 19 octobre 2026',
      seconds: 5520,
      parts: [{ title: 'La formation', text: '## Sous-titre\nTexte.', points: ['Le contrat est un accord de volontés.', 'Il faut un consentement libre.'], until: 300 }],
      alerts: [{ id: 'a', time: 754, keyword: 'examen', excerpt: 'l’examen sera le 12 novembre' }],
    });
    expect(md).toContain('# Droit des contrats');
    expect(md).toContain('1 h 32');
    expect(md).toContain('### Sous-titre');
    expect(md).toContain('- 00:12:34 · « examen » : l’examen sera le 12 novembre');
    const text = await docxToText(await markdownToDocx(md));
    expect(essentialsOf(text)).toEqual({
      points: ['Le contrat est un accord de volontés.', 'Il faut un consentement libre.'],
      moments: ['00:12:34 · « examen » : l’examen sera le 12 novembre'],
    });
    expect(essentialsOf('Un cours sans résumé')).toBeNull();
  });
  it('une phrase avec deux mots-clés : une seule ligne', () => {
    const e = 'ceci tombera à l’examen';
    expect(momentLines([{ id: '2', time: 12, keyword: 'examen', excerpt: e }, { id: '1', time: 11, keyword: 'tombera', excerpt: e }, { id: '3', time: 60, keyword: null, excerpt: 'autre' }])).toEqual([
      '00:00:11 · « tombera », « examen » : ceci tombera à l’examen',
      '00:01:00 · moment marqué : autre',
    ]);
  });
  it('un moment marqué avant toute parole : l’heure seule, une fois', () => {
    expect(momentLines([{ id: '1', time: 3, keyword: null, excerpt: '' }, { id: '2', time: 5, keyword: null, excerpt: '' }])).toEqual(['00:00:03 · moment marqué']);
  });
  it('petits outils', () => {
    expect(clock(3754)).toBe('01:02:34');
    expect(duration(300)).toBe('5 min');
    expect(duration(26)).toBe('26 s');
    expect(duration(59.6)).toBe('1 min');
    expect(duration(5520)).toBe('1 h 32');
    expect(baseName('Droit / civil', new Date(2026, 9, 9))).toBe('2026-10-09 – Droit - civil');
    const chunks = chunkText(`${'a'.repeat(6000)}\n${'b'.repeat(6000)}\n${'c'.repeat(100)}`, 10_000);
    expect(chunks.map(c => c.length)).toEqual([6000, 6101]);
  });
});

describe('partage sans son', () => {
  it('dit quoi faire', async () => {
    const { noSoundHelp } = await import('../src/lib/recorder/capture');
    expect(noSoundHelp('window', true)).toMatch(/Écran entier/);
    expect(noSoundHelp('monitor', true)).toMatch(/Réglages Système/);
    expect(noSoundHelp('monitor', false)).toMatch(/audio du système/);
  });
});

describe('rédaction selon l’usage', () => {
  it('un cours pour un étudiant, un compte rendu pour une réunion', async () => {
    // @ts-expect-error -- server module in plain JavaScript
    const { SYSTEMS } = await import('../server/cours.mjs');
    expect(SYSTEMS.etudes.partie).toMatch(/étudiant/);
    expect(SYSTEMS.travail.partie).toMatch(/réunion/);
    expect(SYSTEMS.travail.fiche).toMatch(/Décisions/);
    expect(SYSTEMS.perso.examen).toMatch(/Quiz/);
    for (const u of Object.values(SYSTEMS) as Record<string, string>[]) expect(u.partie).toMatch(/TITRE:[^]*POINTS:/);
  });
});

describe('mots-clés par défaut selon l’usage', () => {
  it('une liste jamais modifiée suit l’usage, une liste à soi reste', async () => {
    const { KEYWORDS_BY_USAGE, keywordsFor } = await import('../src/lib/keywords');
    const etudes = KEYWORDS_BY_USAGE.etudes.map(k => (k.word === 'important' ? { ...k, notify: false } : k));
    const pro = keywordsFor(etudes, 'travail');
    expect(pro.map(k => k.word)).toContain('décision');
    expect(pro.find(k => k.word === 'important')?.notify).toBe(false);
    const mine = [{ word: 'Hugo', notify: true }];
    expect(keywordsFor(mine, 'travail')).toEqual(mine);
  });
});
