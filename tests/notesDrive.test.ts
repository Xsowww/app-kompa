import { describe, expect, it } from 'vitest';

// The stores read the browser globals.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL('http://localhost/'),
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
});
const { countWords, sortNotes } = await import('../src/pages/notes/noteUtils');
const { markdownForWord } = await import('../src/pages/notes/exportNote');
const { textSnippet } = await import('../src/lib/textFind');
const { pastedFiles } = await import('../src/pages/drive/upload');
const { localSaveError } = await import('../src/lib/blobStore');
const { plainTextToHtml } = await import('../src/pages/notes/driveBridge');

describe('notes: word count', () => {
  it('counts words as a word processor does', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('Bonjour  le monde')).toBe(3);
    expect(countWords('l’arbre et le porte-clés coûtent 3,5 € — ok ?')).toBe(7);
    expect(countWords('Prophase, métaphase. Anaphase')).toBe(3);
  });
});

describe('notes: order of the list', () => {
  const notes = [
    { title: 'b', pinned: false, createdAt: '2026-01-03', updatedAt: '2026-01-04' },
    { title: 'A 10', pinned: false, createdAt: '2026-01-01', updatedAt: '2026-01-09' },
    { title: 'A 9', pinned: true, createdAt: '2026-01-02', updatedAt: '2026-01-02' },
  ];
  it('keeps the pinned ones first, then sorts as asked', () => {
    expect(sortNotes(notes, 'modified').map(n => n.title)).toEqual(['A 9', 'A 10', 'b']);
    expect(sortNotes(notes, 'created').map(n => n.title)).toEqual(['A 9', 'b', 'A 10']);
    expect(sortNotes(notes, 'title', 'fr').map(n => n.title)).toEqual(['A 9', 'A 10', 'b']);
  });
});

describe('search: extract around the words', () => {
  const text = 'Le chloroplaste est le lieu de la photosynthèse, où la chlorophylle capte la lumière du soleil pour la plante.';
  it('cuts around the match, between words, accents aside', () => {
    const s = textSnippet(text, 'chlorophylle', 10, 20)!;
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('chlorophylle');
    expect(s.endsWith('…')).toBe(true);
    expect(textSnippet(text, 'PHOTOSYNTHESE')).toContain('photosynthèse');
  });
  it('falls back on one of the words, else null', () => {
    expect(textSnippet(text, 'soleil absent')).toContain('soleil');
    expect(textSnippet(text, 'introuvable')).toBeNull();
  });
});

describe('notes → Word', () => {
  it('turns what the Word writer cannot read into plain text', () => {
    const md = [
      '# Titre',
      '',
      '![schéma](data:image/png;base64,AAAA)',
      'Voir [le site](https://kompaly.com) et [https://a.fr](https://a.fr).',
      '',
      '- [x] fait',
      '- [ ] à faire',
      '',
      '==important== et ~~barré~~ \\<balise>',
      '',
      '```',
      'code',
      '```',
    ].join('\n');
    expect(markdownForWord(md)).toBe(['# Titre', '', 'Voir le site (https://kompaly.com) et https://a.fr.', '', '- ☑ fait', '- ☐ à faire', '', 'important et barré <balise>', '', 'code', ''].join('\n'));
  });
  it('a text file becomes one paragraph per line, escaped', () => {
    expect(plainTextToHtml('Une <ligne>\r\n\r\nDeux & trois')).toBe('<p>Une &lt;ligne&gt;</p><p>Deux &amp; trois</p>');
  });
});

describe('Drive: pasted files', () => {
  it('names a pasted screenshot after the moment, keeps a real file name', () => {
    const at = new Date(2026, 10, 3, 9, 5, 7);
    const [shot, doc] = pastedFiles([new File(['x'], 'image.png', { type: 'image/png' }), new File(['y'], 'Cours.pdf', { type: 'application/pdf' })], at);
    expect(shot.file!.name).toBe('Image collée 2026-11-03 09.05.07.png');
    expect(doc.file!.name).toBe('Cours.pdf');
    expect(pastedFiles([new File(['z'], '', { type: 'image/jpeg' })], at)[0].file!.name).toBe('Image collée 2026-11-03 09.05.07.jpg');
  });
});

describe('Drive: browser storage errors', () => {
  it('says « plein » only when the storage is full', () => {
    expect(localSaveError(new DOMException('x', 'QuotaExceededError')).message).toMatch(/plein/);
    expect(localSaveError(new DOMException('x', 'SecurityError')).message).toMatch(/refuse/);
    const other = localSaveError(new DOMException('x', 'UnknownError'));
    expect(other.message).not.toMatch(/plein/);
    expect((other as unknown as { reason: string }).reason).toBeTruthy();
    expect(localSaveError(new Error('x')).message).not.toMatch(/plein/);
  });
});

describe('notes: words found by a search, in the editor', async () => {
  const { Schema } = await import('@tiptap/pm/model');
  const { findHits } = await import('../src/pages/notes/searchHits');
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*' },
      text: { group: 'inline' },
      hard_break: { group: 'inline', inline: true },
    },
  });
  const p = (...parts: (string | null)[]) => schema.node('paragraph', null, parts.map(x => (x === null ? schema.node('hard_break') : schema.text(x))));
  const doc = schema.node('doc', null, [p('La Photosynthèse'), p('avant', null, 'la photosynthese, encore')]);
  const text = (r: { from: number; to: number }) => doc.textBetween(r.from, r.to);
  it('finds every place, accents and case aside, after a line break too', () => {
    expect(findHits(doc, 'photosynthèse').map(text)).toEqual(['Photosynthèse', 'photosynthese']);
  });
  it('words apart: each of them', () => {
    expect(findHits(doc, 'encore la').map(text)).toEqual(['La', 'la', 'encore']);
    expect(findHits(doc, '  ')).toEqual([]);
  });
});
