// A sheet written in Markdown (the small subset of lib/docx) turned into a real PDF file, laid out in the browser.
// jsPDF is only downloaded when a PDF is made.

import { parseMarkdown, inlineRuns, type Block, type Run } from './docx';
import { t } from '../i18n';

// The PDF's built-in fonts only know the Western European letters (WinAnsi): the other signs a sheet often has are
// written in words or plain signs. shortcut: no Greek or Asian script; embed a Unicode font if users need them.
const WRITE_AS: Record<string, string> = {
  '→': '->', '⇒': '=>', '←': '<-', '⇐': '<=', '↔': '<->', '⇔': '<=>', '↑': '^', '↓': 'v', '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '−': '-',
  '√': 'racine de ', '∞': 'infini', '∑': 'somme', '∫': 'intégrale', '∈': ' appartient à ', '∉': " n'appartient pas à ", '∀': 'pour tout ', '∃': 'il existe ',
  'α': 'alpha', 'β': 'bêta', 'γ': 'gamma', 'δ': 'delta', 'Δ': 'Delta', 'ε': 'epsilon', 'θ': 'thêta', 'λ': 'lambda', 'μ': 'µ', 'π': 'pi', 'ρ': 'rhô',
  'σ': 'sigma', 'Σ': 'Sigma', 'τ': 'tau', 'φ': 'phi', 'ω': 'oméga', 'Ω': 'Oméga', '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '★': '*', '☆': '*',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};
// What WinAnsi has beyond Latin-1.
const WIN_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Text the PDF fonts can draw: the signs above in words, emoji and other scripts left out. */
export function pdfSafe(text: string): string {
  let out = '';
  for (const c of text.normalize('NFC')) {
    const code = c.codePointAt(0)!;
    if (c in WRITE_AS) out += WRITE_AS[c];
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_EXTRA.has(c)) out += c;
    else if (c === '\t') out += ' ';
  }
  return out;
}

const PAGE = { w: 595.28, h: 841.89, margin: 56 };
const STYLE: Record<Block['kind'], { size: number; bold?: boolean; italic?: boolean; before: number; color?: number }> = {
  title: { size: 20, bold: true, before: 0 },
  h1: { size: 15, bold: true, before: 16 },
  h2: { size: 12.5, bold: true, before: 12 },
  p: { size: 11, before: 6 },
  quote: { size: 11, italic: true, before: 6, color: 90 },
  bullet: { size: 11, before: 3 },
  number: { size: 11, before: 3 },
  rule: { size: 11, before: 10 },
};

/** Markdown → PDF (A4, Helvetica). The first « # » line is the sheet's title. */
export async function markdownToPdf(md: string, meta: { title?: string } = {}): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setProperties({ title: pdfSafe(meta.title ?? ''), creator: 'Kompaly' });
  const right = PAGE.w - PAGE.margin;
  const bottom = PAGE.h - PAGE.margin;
  let y = PAGE.margin;
  const numbers = new Map<number, number>();

  const font = (r: Pick<Run, 'bold' | 'italic'>) => doc.setFont('helvetica', r.bold && r.italic ? 'bolditalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'normal');
  const newPage = () => {
    doc.addPage();
    y = PAGE.margin;
  };

  /** Writes runs from `x`, wrapping words at the right margin (next lines start at `x` too). */
  const write = (runs: Run[], x: number, size: number, base: Pick<Run, 'bold' | 'italic'>) => {
    const lh = size * 1.4;
    doc.setFontSize(size);
    // Words with their style; spaces kept on the word before them.
    const words = runs.flatMap(r => pdfSafe(r.text).split(/(?<=\s)/).filter(Boolean).map(w => ({ w, bold: base.bold || r.bold, italic: base.italic || r.italic })));
    let line: typeof words = [];
    let width = 0;
    const flush = () => {
      if (y + lh > bottom) newPage();
      let cx = x;
      for (const p of line) {
        font(p);
        doc.text(p.w, cx, y + size);
        cx += doc.getTextWidth(p.w);
      }
      y += lh;
      line = [];
      width = 0;
    };
    for (const p of words) {
      font(p);
      const wWidth = doc.getTextWidth(p.w.trimEnd());
      if (line.length && x + width + wWidth > right) flush();
      // A word longer than the whole line (a link): cut where it overflows.
      if (!line.length && x + wWidth > right) {
        for (const piece of doc.splitTextToSize(p.w, right - x) as string[]) {
          line = [{ ...p, w: piece }];
          flush();
        }
        continue;
      }
      line.push(p);
      width += doc.getTextWidth(p.w);
    }
    if (line.length) flush();
  };

  for (const b of parseMarkdown(md)) {
    const s = STYLE[b.kind];
    y += s.before;
    if (y > bottom - 40 && (b.kind === 'h1' || b.kind === 'h2')) newPage(); // a heading never alone at the bottom
    doc.setTextColor(s.color ?? (b.kind === 'h1' || b.kind === 'h2' ? 30 : 20));
    if (b.kind === 'rule') {
      doc.setDrawColor(200);
      doc.line(PAGE.margin, y, right, y);
      y += 6;
      continue;
    }
    if (b.kind === 'bullet' || b.kind === 'number') {
      const indent = PAGE.margin + 6 + b.level * 18;
      let mark = '•';
      if (b.kind === 'number') {
        const key = b.list * 10 + b.level;
        numbers.set(key, (numbers.get(key) ?? 0) + 1);
        mark = b.level ? `${String.fromCharCode(96 + Math.min(26, numbers.get(key)!))})` : `${numbers.get(key)}.`;
      }
      if (y + s.size * 1.4 > bottom) newPage();
      font({});
      doc.setFontSize(s.size);
      doc.text(mark, indent, y + s.size);
      write(inlineRuns(b.text), indent + 16, s.size, {});
      continue;
    }
    if (b.kind === 'quote') {
      const top = y;
      write(inlineRuns(b.text), PAGE.margin + 12, s.size, s);
      doc.setDrawColor(190);
      doc.setLineWidth(2);
      doc.line(PAGE.margin + 2, top + 2, PAGE.margin + 2, y - 2);
      doc.setLineWidth(1);
      continue;
    }
    write(inlineRuns(b.text), PAGE.margin, s.size, s);
    if (b.kind === 'title') {
      doc.setDrawColor(220);
      doc.line(PAGE.margin, y + 4, right, y + 4);
      y += 10;
    }
  }

  // Page numbers and where it comes from, at the foot of each page.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(150);
    doc.text(pdfSafe(t('Fiche faite avec Kompaly')), PAGE.margin, PAGE.h - 28);
    if (pages > 1) doc.text(`${i} / ${pages}`, right, PAGE.h - 28, { align: 'right' });
  }
  return doc.output('blob');
}
