// A small Markdown subset (what the AI writes for a course) turned into a real Word file, and into safe HTML for the preview.
// jszip and mammoth are only downloaded when a document is written or read.

import { locale } from '../i18n';

export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'bullet'; text: string; level: 0 | 1 }
  /** `list`: index of the numbered list the item belongs to, so numbering restarts per list. */
  | { kind: 'number'; text: string; level: 0 | 1; list: number }
  | { kind: 'rule' };

type ListBlock = Extract<Block, { kind: 'bullet' | 'number' }>;
export type Run = { text: string; bold?: boolean; italic?: boolean };

const isList = (b: Block | undefined): b is ListBlock => b?.kind === 'bullet' || b?.kind === 'number';

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?$/;
const RULE = /^([-*_])(?:\s*\1){2,}$/;
const QUOTE = /^>\s?(.*)$/;
const BULLET = /^([-*+•])\s+(.*)$/;
const NUMBER = /^\d{1,3}[.)]\s+(.*)$/;
/** A line that is only bold text (« **Définition** »): its own paragraph, not glued to the next line. */
const BOLD_LINE = /^\*\*[^*].*\*\*:?$/;

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let lists = 0;
  let list: number | null = null; // numbered list being continued
  let lastLineWasItem = false;

  const push = (b: Block) => {
    if (!isList(b)) list = null;
    blocks.push(b);
  };
  const flush = () => {
    if (para.length) push({ kind: 'p', text: para.join(' ') });
    if (quote.length) push({ kind: 'quote', text: quote.join(' ') });
    para = [];
    quote = [];
  };

  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const indent = (/^[ \t]*/.exec(raw)?.[0] ?? '').replace(/\t/g, '    ').length;
    const line = raw.trim();
    const wasItem = lastLineWasItem;
    lastLineWasItem = false;
    if (!line) {
      flush();
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = HEADING.exec(line))) {
      flush();
      const text = m[2].trim();
      const kind = m[1].length === 1 ? 'title' : m[1].length === 2 ? 'h1' : 'h2';
      if (text) push({ kind, text });
    } else if (RULE.test(line)) {
      flush();
      push({ kind: 'rule' });
    } else if ((m = QUOTE.exec(line))) {
      if (para.length) flush();
      if (m[1].trim()) quote.push(m[1].trim());
      else flush();
    } else if ((m = BULLET.exec(line))) {
      flush();
      push({ kind: 'bullet', text: m[2].trim(), level: indent >= 2 ? 1 : 0 });
      lastLineWasItem = true;
    } else if ((m = NUMBER.exec(line))) {
      flush();
      if (list === null) list = lists++;
      push({ kind: 'number', text: m[1].trim(), level: indent >= 2 ? 1 : 0, list });
      lastLineWasItem = true;
    } else if (wasItem && indent >= 2 && !para.length && !quote.length) {
      // Indented line right under an item: the rest of that item.
      const item = blocks[blocks.length - 1] as ListBlock;
      item.text += ' ' + line;
      lastLineWasItem = true;
    } else if (BOLD_LINE.test(line)) {
      flush();
      push({ kind: 'p', text: line });
    } else {
      if (quote.length) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}

const WORD = /[\p{L}\p{N}]/u;

/** Index of the marker closing one opened at `from` (content starts there), or -1. */
function closing(text: string, from: number, marker: string): number {
  for (let j = from + 1; j < text.length; j++) {
    if (text[j] === '\\') {
      j++;
      continue;
    }
    if (text[j] === '`') {
      const end = text.indexOf('`', j + 1);
      if (end > 0) j = end;
      continue;
    }
    if (marker === '*' && text.startsWith('**', j)) {
      j++; // skip a nested « ** »
      continue;
    }
    if (!text.startsWith(marker, j) || /\s/.test(text[j - 1])) continue;
    if (marker === '**') while (text[j + 2] === '*') j++; // « ***x*** »: the bold closes on the last stars
    if (marker !== '_') return j;
    if (!WORD.test(text[j + 1] ?? '')) return j; // « _ » closes only at a word's end
  }
  return -1;
}

/** Inline runs of a block's text: **bold**, *italic* or _italic_, `code` shown as plain text; unmatched markers stay literal. */
export function inlineRuns(text: string): Run[] {
  const runs: Run[] = [];
  const add = (t: string, bold: boolean, italic: boolean) => {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && !!last.bold === bold && !!last.italic === italic) last.text += t;
    else runs.push({ text: t, ...(bold && { bold }), ...(italic && { italic }) });
  };
  const walk = (s: string, bold: boolean, italic: boolean) => {
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && /[\\`*_#>[\]-]/.test(s[i + 1] ?? '')) {
        add(s[i + 1], bold, italic);
        i += 2;
        continue;
      }
      if (c === '`') {
        const end = s.indexOf('`', i + 1);
        if (end > i + 1) {
          add(s.slice(i + 1, end), bold, italic);
          i = end + 1;
          continue;
        }
      }
      const marker = s.startsWith('**', i) ? '**' : c === '*' || c === '_' ? c : '';
      const start = i + marker.length;
      const opens = marker && start < s.length && !/\s/.test(s[start]) && !(marker === '_' && WORD.test(s[i - 1] ?? ''));
      const end = opens ? closing(s, start, marker) : -1;
      if (end > start) {
        walk(s.slice(start, end), bold || marker === '**', italic || marker !== '**');
        i = end + marker.length;
        continue;
      }
      add(marker || c, bold, italic);
      i += marker.length || 1;
    }
  };
  walk(text, false, false);
  return runs;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inlineHtml(text: string): string {
  return inlineRuns(text)
    .map(r => {
      let h = escapeHtml(r.text);
      if (r.italic) h = `<em>${h}</em>`;
      if (r.bold) h = `<strong>${h}</strong>`;
      return h;
    })
    .join('');
}

/** A run of consecutive list items as nested <ul>/<ol>. */
function listHtml(items: ListBlock[]): string {
  let out = '';
  const stack: string[] = []; // open lists, each with an open <li>
  const done = new Map<number, number>(); // level 0 items written per numbered list (to continue after a bullet)
  for (const it of items) {
    const tag = it.kind === 'number' ? 'ol' : 'ul';
    const level = Math.min(it.level, stack.length);
    while (stack.length > level + 1) out += `</li></${stack.pop()}>`;
    if (stack.length === level + 1 && stack[level] === tag) out += '</li><li>';
    else {
      if (stack.length === level + 1) out += `</li></${stack.pop()}>`;
      const n = it.kind === 'number' && level === 0 ? (done.get(it.list) ?? 0) : 0;
      out += `<${tag}${tag === 'ol' && level ? ' type="a"' : ''}${n ? ` start="${n + 1}"` : ''}><li>`;
      stack.push(tag);
    }
    if (it.kind === 'number' && level === 0) done.set(it.list, (done.get(it.list) ?? 0) + 1);
    out += inlineHtml(it.text);
  }
  while (stack.length) out += `</li></${stack.pop()}>`;
  return out;
}

/** Safe HTML for an in-app preview (everything escaped; only the tags we produce). */
export function markdownToHtml(md: string): string {
  const blocks = parseMarkdown(md);
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (isList(b)) {
      const items: ListBlock[] = [];
      while (isList(blocks[i])) items.push(blocks[i++] as ListBlock);
      i--;
      out.push(listHtml(items));
    } else if (b.kind === 'rule') out.push('<hr>');
    else {
      const tag = { title: 'h1', h1: 'h2', h2: 'h3', p: 'p', quote: 'blockquote' }[b.kind];
      out.push(`<${tag}>${inlineHtml(b.text)}</${tag}>`);
    }
  }
  return out.join('\n');
}

// ——— Word ———

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Escaped for XML 1.0, without the characters it forbids (control characters, lone surrogates). */
const xml = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FONT = 'Calibri';
const BLUE = '1F3864';

const runXml = (r: Run) => {
  const props = (r.bold ? '<w:b/><w:bCs/>' : '') + (r.italic ? '<w:i/><w:iCs/>' : '');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(r.text.replace(/[\t\n]/g, ' '))}</w:t></w:r>`;
};

const para = (pPr: string, text: string) => `<w:p><w:pPr>${pPr}</w:pPr>${inlineRuns(text).map(runXml).join('')}</w:p>`;

/** numId of the bullets; numbered list `n` uses NUM_FIRST + n. */
const BULLET_NUM = 1;
const NUM_FIRST = 2;

function documentXml(blocks: Block[]): string {
  const body = blocks.map(b => {
    switch (b.kind) {
      case 'title': return para('<w:pStyle w:val="Title"/>', b.text);
      case 'h1': return para('<w:pStyle w:val="Heading1"/>', b.text);
      case 'h2': return para('<w:pStyle w:val="Heading2"/>', b.text);
      case 'quote': return para('<w:pStyle w:val="Quote"/>', b.text);
      case 'p': return para('', b.text);
      case 'rule':
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr><w:spacing w:after="240"/></w:pPr></w:p>';
      default: {
        const numId = b.kind === 'bullet' ? BULLET_NUM : NUM_FIRST + b.list;
        return para(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${b.level}"/><w:numId w:val="${numId}"/></w:numPr>`, b.text);
      }
    }
  });
  // A4, 2.5 cm margins (French default).
  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  return `${HEAD}<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}${sect}</w:body></w:document>`;
}

function stylesXml(): string {
  const style = (id: string, name: string, pPr: string, rPr: string) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
  return (
    `${HEAD}<w:styles xmlns:w="${W}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>` +
    `<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${locale()}" w:eastAsia="fr-FR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    style('Title', 'Title', '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="6" w:color="8EAADB"/></w:pBdr><w:spacing w:after="300" w:line="240" w:lineRule="auto"/><w:contextualSpacing/>',
      `<w:b/><w:bCs/><w:color w:val="${BLUE}"/><w:kern w:val="28"/><w:sz w:val="52"/><w:szCs w:val="52"/>`) +
    style('Heading1', 'heading 1', '<w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>',
      `<w:b/><w:bCs/><w:color w:val="${BLUE}"/><w:sz w:val="32"/><w:szCs w:val="32"/>`) +
    style('Heading2', 'heading 2', '<w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/>',
      '<w:b/><w:bCs/><w:color w:val="2F5496"/><w:sz w:val="26"/><w:szCs w:val="26"/>') +
    style('Quote', 'Quote', '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr><w:spacing w:before="120" w:after="160"/><w:ind w:left="284" w:right="284"/>',
      '<w:i/><w:iCs/><w:color w:val="595959"/>') +
    style('ListParagraph', 'List Paragraph', '<w:spacing w:after="80"/><w:contextualSpacing/>', '') +
    '</w:styles>'
  );
}

function numberingXml(lists: number): string {
  const lvl = (ilvl: number, fmt: string, text: string, left: number) =>
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>${fmt === 'bullet' ? `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:hint="default"/></w:rPr>` : ''}</w:lvl>`;
  const abstract = (id: number, levels: string) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`;
  const restart = '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride><w:lvlOverride w:ilvl="1"><w:startOverride w:val="1"/></w:lvlOverride>';
  let nums = `<w:num w:numId="${BULLET_NUM}"><w:abstractNumId w:val="0"/></w:num>`;
  for (let n = 0; n < lists; n++) nums += `<w:num w:numId="${NUM_FIRST + n}"><w:abstractNumId w:val="1"/>${restart}</w:num>`;
  return (
    `${HEAD}<w:numbering xmlns:w="${W}">` +
    abstract(0, lvl(0, 'bullet', '•', 720) + lvl(1, 'bullet', '◦', 1440)) +
    abstract(1, lvl(0, 'decimal', '%1.', 720) + lvl(1, 'lowerLetter', '%2.', 1440)) +
    nums +
    '</w:numbering>'
  );
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (items: [string, string][]) =>
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  items.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${type}" Target="${target}"/>`).join('') +
  '</Relationships>';

/** A real .docx (Word, LibreOffice, Google Docs, and the `mammoth` previewer used by the app's Drive must all open it). */
export async function markdownToDocx(md: string, meta: { title?: string; author?: string } = {}): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const blocks = parseMarkdown(md);
  const lists = blocks.reduce((n, b) => (b.kind === 'number' ? Math.max(n, b.list + 1) : n), 0);
  const title = meta.title ?? blocks.find(b => b.kind === 'title')?.text ?? '';
  const author = meta.author ?? '';
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const main = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${main}.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="${main}.styles+xml"/>` +
      `<Override PartName="/word/numbering.xml" ContentType="${main}.numbering+xml"/>` +
      `<Override PartName="/word/settings.xml" ContentType="${main}.settings+xml"/>` +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>',
  );
  zip.file('_rels/.rels', rels([
    [`${REL}/officeDocument`, 'word/document.xml'],
    ['http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    [`${REL}/extended-properties`, 'docProps/app.xml'],
  ]));
  zip.file('word/_rels/document.xml.rels', rels([
    [`${REL}/styles`, 'styles.xml'],
    [`${REL}/numbering`, 'numbering.xml'],
    [`${REL}/settings`, 'settings.xml'],
  ]));
  zip.file('word/document.xml', documentXml(blocks));
  zip.file('word/styles.xml', stylesXml());
  zip.file('word/numbering.xml', numberingXml(lists));
  // compatibilityMode 15: Word doesn't open it in « Mode de compatibilité ».
  zip.file(
    'word/settings.xml',
    `${HEAD}<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/>` +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
      '<w:themeFontLang w:val="fr-FR"/></w:settings>',
  );
  zip.file(
    'docProps/core.xml',
    `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
      'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator><cp:lastModifiedBy>${xml(author)}</cp:lastModifiedBy><dc:language>${locale()}</dc:language>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      '</cp:coreProperties>',
  );
  zip.file(
    'docProps/app.xml',
    `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
      '<Application>Kompaly</Application></Properties>',
  );
  return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
}

/** The plain text of a .docx (for re-reading a document later), via mammoth.extractRawText, imported on demand. */
export async function docxToText(blob: Blob): Promise<string> {
  const mammoth = await import('mammoth');
  const data = await blob.arrayBuffer();
  // arrayBuffer: mammoth's browser build; buffer: its Node build (tests), which takes an ArrayBuffer as well.
  const input = { arrayBuffer: data, buffer: data };
  return (await mammoth.extractRawText(input)).value;
}
