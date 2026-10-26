import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { docxToText, inlineRuns, markdownToDocx, markdownToHtml, parseMarkdown } from '../src/lib/docx';

const SAMPLE = [
  '# Les fonctions affines  ',
  '',
  '## Définition :',
  'Une fonction affine',
  's’écrit **f(x) = ax + b**.',
  '',
  '- premier point',
  '  - sous-point',
  '* second point',
  '',
  '1. étape un',
  '2) étape deux',
  '',
  '> À retenir : *a* est le coefficient directeur.',
  '',
  '---',
  '### Exemple',
  '#### Détail',
  '1. encore',
  '2. et encore',
].join('\r\n');

const ATTR = String.raw`\s+[\w:.-]+="(?:[^"<&]|&(?:amp|lt|gt|quot|apos);)*"`;
const TOKEN = new RegExp(String.raw`<(/?)([\w:.-]+)((?:${ATTR})*)\s*(/?)>|((?:[^<&]|&(?:amp|lt|gt|quot|apos);)+)`, 'y');

/** Well-formed XML (one root, balanced tags, quoted attributes, escaped text, no control characters): node has no DOMParser. */
function checkXml(text: string) {
  // eslint-disable-next-line no-control-regex
  expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)).toBe(false);
  const body = text.replace(/^<\?xml [^?]*\?>\n/, '');
  expect(body).not.toBe(text);
  const stack: string[] = [];
  let roots = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while (TOKEN.lastIndex < body.length && (m = TOKEN.exec(body))) {
    if (m[5] !== undefined) {
      expect(stack.length, 'text outside the root').toBeGreaterThan(0);
    } else if (m[1]) {
      expect(m[3] + m[4], 'closing tag with attributes').toBe('');
      expect(stack.pop()).toBe(m[2]);
    } else {
      if (!stack.length) roots++;
      if (!m[4]) stack.push(m[2]);
    }
  }
  expect(TOKEN.lastIndex, `bad XML near: ${body.slice(TOKEN.lastIndex, TOKEN.lastIndex + 40)}`).toBe(body.length);
  expect(stack).toEqual([]);
  expect(roots).toBe(1);
}

describe('parseMarkdown', () => {
  it('reconnaît tous les blocs, avec CRLF', () => {
    expect(parseMarkdown(SAMPLE)).toEqual([
      { kind: 'title', text: 'Les fonctions affines' },
      { kind: 'h1', text: 'Définition :' },
      { kind: 'p', text: 'Une fonction affine s’écrit **f(x) = ax + b**.' },
      { kind: 'bullet', text: 'premier point', level: 0 },
      { kind: 'bullet', text: 'sous-point', level: 1 },
      { kind: 'bullet', text: 'second point', level: 0 },
      { kind: 'number', text: 'étape un', level: 0, list: 0 },
      { kind: 'number', text: 'étape deux', level: 0, list: 0 },
      { kind: 'quote', text: 'À retenir : *a* est le coefficient directeur.' },
      { kind: 'rule' },
      { kind: 'h2', text: 'Exemple' },
      { kind: 'h2', text: 'Détail' },
      { kind: 'number', text: 'encore', level: 0, list: 1 },
      { kind: 'number', text: 'et encore', level: 0, list: 1 },
    ]);
  });

  it('une ligne en gras seule reste un paragraphe à part', () => {
    expect(parseMarkdown('**Titre**\nLe texte.')).toEqual([
      { kind: 'p', text: '**Titre**' },
      { kind: 'p', text: 'Le texte.' },
    ]);
  });

  it('les lignes vides entre les éléments ne coupent pas la liste numérotée', () => {
    const blocks = parseMarkdown('1. a\n\n2. b\n   suite de b\n\nTexte\n\n1. c');
    expect(blocks.filter(b => b.kind === 'number').map(b => [b.text, b.list])).toEqual([['a', 0], ['b suite de b', 0], ['c', 1]]);
  });
});

describe('inlineRuns', () => {
  it('gras, italique et code', () => {
    expect(inlineRuns('a **gras** et *ital* ou _ital_ `x*y`')).toEqual([
      { text: 'a ' },
      { text: 'gras', bold: true },
      { text: ' et ' },
      { text: 'ital', italic: true },
      { text: ' ou ' },
      { text: 'ital', italic: true },
      { text: ' x*y' },
    ]);
    expect(inlineRuns('***les deux***')).toEqual([{ text: 'les deux', bold: true, italic: true }]);
    expect(inlineRuns('*a **b** c*')).toEqual([{ text: 'a ', italic: true }, { text: 'b', bold: true, italic: true }, { text: ' c', italic: true }]);
  });

  it('les marqueurs sans fin restent tels quels', () => {
    expect(inlineRuns('2 * 3 = 6 et **pas fini')).toEqual([{ text: '2 * 3 = 6 et **pas fini' }]);
    expect(inlineRuns('nom_de_variable')).toEqual([{ text: 'nom_de_variable' }]);
  });
});

describe('markdownToHtml', () => {
  it('échappe tout ce que l’on tape', () => {
    const html = markdownToHtml('<script>alert("x")</script> & **<b>**');
    expect(html).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; <strong>&lt;b&gt;</strong></p>');
  });

  it('listes imbriquées et titres', () => {
    expect(markdownToHtml('# T\n## A\n- a\n  - b\n- c\n\n1. un\n   1. sous\n2. deux\n\n---')).toBe(
      ['<h1>T</h1>', '<h2>A</h2>', '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><ol><li>un<ol type="a"><li>sous</li></ol></li><li>deux</li></ol>', '<hr>'].join('\n'),
    );
  });
});

describe('markdownToDocx', () => {
  it('le vérificateur XML refuse ce qui est mal formé', () => {
    for (const bad of ['<a><b></a>', '<a>&</a>', '<a b=c/>', '<a></a><b/>', '<a>\u0001</a>', '<a>']) expect(() => checkXml(`<?xml version="1.0"?>\n${bad}`), bad).toThrow();
    checkXml('<?xml version="1.0"?>\n<a x="1&amp;"><b/>t &lt; u</a>');
  });

  it('un vrai .docx bien formé', async () => {
    const blob = await markdownToDocx(SAMPLE + '\n\nR&D <b> "ok" \u0001fin', { title: 'Cours & co', author: 'Léa' });
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const parts = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml', 'docProps/app.xml'];
    const text: Record<string, string> = {};
    for (const p of parts) {
      expect(zip.file(p), p).not.toBeNull();
      text[p] = await zip.file(p)!.async('string');
      checkXml(text[p]);
    }
    const doc = text['word/document.xml'];
    for (const s of ['Title', 'Heading1', 'Heading2', 'Quote', 'ListParagraph']) expect(doc).toContain(`<w:pStyle w:val="${s}"/>`);
    const numIds = new Set([...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map(m => m[1]));
    expect(numIds.size).toBe(3); // bullets + two numbered lists
    expect(doc).toContain('R&amp;D &lt;b&gt; &quot;ok&quot; fin');
    expect(doc).toContain('<w:b/>');

    const numbering = text['word/numbering.xml'];
    expect(numbering.match(/<w:startOverride w:val="1"\/>/g)?.length).toBe(4);
    const styles = text['word/styles.xml'];
    for (const n of ['Title', 'heading 1', 'heading 2', 'Quote', 'List Paragraph']) expect(styles).toContain(`<w:name w:val="${n}"/>`);
    expect(styles).toContain('<w:outlineLvl w:val="0"/>');
    expect(text['docProps/core.xml']).toContain('<dc:title>Cours &amp; co</dc:title>');
    expect(text['docProps/core.xml']).toContain('<dc:language>fr-FR</dc:language>');
  });

  it('se relit avec mammoth', async () => {
    const out = await docxToText(await markdownToDocx(SAMPLE));
    for (const t of ['Les fonctions affines', 'Définition :', 'Une fonction affine s’écrit f(x) = ax + b.', 'sous-point', 'étape deux', 'À retenir : a est le coefficient directeur.', 'et encore']) {
      expect(out).toContain(t);
    }
  });
  it('turns a table into one line per row', () => {
    expect(parseMarkdown('Avant\n| Grandeur | Unité |\n|---|:--:|\n| Force | N |\n|  | J |\n\n---')).toEqual([
      { kind: 'p', text: 'Avant' },
      { kind: 'bullet', text: '**Grandeur · Unité**', level: 0 },
      { kind: 'bullet', text: 'Force · N', level: 0 },
      { kind: 'bullet', text: '— · J', level: 0 },
      { kind: 'rule' },
    ]);
  });
});
