// A sheet written in Markdown (the small subset of lib/docx) turned into a real PDF file, laid out in the browser.
// jsPDF is only downloaded when a PDF is made.

import { parseMarkdown, inlineRuns, type Block, type Run } from './docx';
import { t } from '../i18n';

// The PDF's built-in fonts only know the Western European letters (WinAnsi): the other signs a sheet often has are
// written in words or plain signs (« œ » too: jsPDF measures it too narrow, the next word would overlap it). shortcut: no Greek or Asian script; embed a Unicode font if users need them.
const WRITE_AS: Record<string, string> = {
  '→': '->', '⇒': '=>', '←': '<-', '⇐': '<=', '↔': '<->', '⇔': '<=>', '⟶': '->', '⟹': '=>', '⟵': '<-', '⟺': '<=>', '↦': '|->', '⇌': '<=>', '⇄': '<=>', '↑': '^', '↓': 'v',
  '≤': '<=', '≥': '>=', '⩽': '<=', '⩾': '>=', '≠': '!=', '≈': '~', '≃': '~', '≅': '~', '∼': '~', '≡': '==', '≪': '<<', '≫': '>>', '−': '-', '∓': '-/+', '∗': '*', '⋅': '·', '∘': 'o', '∕': '/',
  '√': 'racine de ', '∛': 'racine cubique de ', '∞': 'infini', '∑': 'somme', '∏': 'produit', '∫': 'intégrale', '∮': 'intégrale', '∂': 'd', '∆': 'Delta', '∇': 'nabla', '∝': ' proportionnel à ',
  '∈': ' appartient à ', '∉': " n'appartient pas à ", '∀': 'pour tout ', '∃': 'il existe ', '∄': "il n'existe pas ", '∅': 'Ø', '∩': ' inter ', '∪': ' union ',
  '⊂': ' inclus dans ', '⊆': ' inclus dans ', '⊄': " non inclus dans ", '⊃': ' contient ', '⊇': ' contient ', '∧': ' et ', '∨': ' ou ', '∴': 'donc', '∵': 'car',
  '⊥': ' perpendiculaire à ', '∥': ' parallèle à ', '∠': 'angle ', '′': "'", '″': "''", 'ℓ': 'l', 'ℏ': 'h barre', '℃': '°C',
  'ℝ': 'R', 'ℕ': 'N', 'ℤ': 'Z', 'ℚ': 'Q', 'ℂ': 'C', '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
  'α': 'alpha', 'β': 'bêta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ϵ': 'epsilon', 'ζ': 'zêta', 'η': 'êta', 'θ': 'thêta', 'ϑ': 'thêta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'µ',
  'ν': 'nu', 'ξ': 'xi', 'ο': 'o', 'π': 'pi', 'ρ': 'rhô', 'σ': 'sigma', 'ς': 'sigma', 'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'ϕ': 'phi', 'χ': 'khi', 'ψ': 'psi', 'ω': 'oméga',
  'Α': 'A', 'Β': 'B', 'Γ': 'Gamma', 'Δ': 'Delta', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Θ': 'Thêta', 'Ι': 'I', 'Κ': 'K', 'Λ': 'Lambda', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'Xi', 'Ο': 'O', 'Π': 'Pi',
  'Ρ': 'P', 'Σ': 'Sigma', 'Τ': 'T', 'Υ': 'Y', 'Φ': 'Phi', 'Χ': 'X', 'Ψ': 'Psi', 'Ω': 'Oméga',
  'œ': 'oe', 'Œ': 'OE', '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '★': '*', '☆': '*', '‐': '-', '‑': '-', '‒': '-', '―': '—', '‹': '<', '›': '>',
  '\u2002': ' ', '\u2003': ' ', '\u2009': ' ', '\u202f': ' ', '\u00a0': ' ',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
};
// What WinAnsi has beyond Latin-1.
const WIN_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
// Exponents: « x² » stays (², ³ and ¹ are in the font), the others are written « 10^-3 », « Ca^2+ », « x^(n+1) ».
const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i' };
const SUP_RUN = /[⁰¹²³⁴-⁹⁺⁻⁼⁽⁾ⁿⁱ]+/g;
/** Left out: emoji, accents left alone after NFC, invisible signs. Any other sign the font lacks shows as « ? ». */
const DROP = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\p{M}\p{Cf}\p{Cc}]/u;

/** Text the PDF fonts can draw: the signs above in words, emoji left out, any other sign as « ? ». */
export function pdfSafe(text: string): string {
  let out = '';
  const exponents = text.normalize('NFC').replace(SUP_RUN, run => {
    if (/^[¹²³]+$/.test(run)) return run;
    const plain = [...run].map(c => SUP[c]).join('');
    return '^' + (plain.length > 1 && !/^[+-]?\d+[+-]?$/.test(plain) ? `(${plain})` : plain);
  });
  for (const c of exponents) {
    const code = c.codePointAt(0)!;
    if (c in WRITE_AS) out += WRITE_AS[c];
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_EXTRA.has(c)) out += c;
    else if (c === '\t') out += ' ';
    else if (!DROP.test(c)) out += '?';
  }
  return out.replace(/ {2,}/g, ' '); // « A ∩ B » → « A inter B », not two spaces each side
}

// jsPDF lacks the regular and italic Helvetica widths of these signs (it measures them all 0.53 em): « ½ » drawn wider than
// measured would overlap the next word. Widths from Helvetica's metrics, in hundredths of an em like jsPDF's table.
const HELVETICA_WIDTHS: Record<string, number> = {
  '¦': 26, '\u00ad': 33.3, '¹': 33.3, '²': 33.3, '³': 33.3, '¶': 53.7, '¼': 83.4, '½': 83.4, '¾': 83.4, 'Ð': 72.2, '×': 58.4, 'Ý': 66.7, 'Þ': 66.7, 'ð': 55.6,
  'ý': 50, 'þ': 55.6, '€': 55.6, 'Š': 66.7, 'Œ': 100, 'Ž': 61.1, 'š': 50, 'œ': 94.4, 'ž': 50,
};
function fixWidths(doc: import('jspdf').jsPDF) {
  for (const style of ['normal', 'italic', 'bold', 'bolditalic']) {
    doc.setFont('helvetica', style);
    const widths = (doc.getFont() as { metadata?: { Unicode?: { widths?: Record<number, number> } } }).metadata?.Unicode?.widths;
    if (!widths) continue;
    for (const [c, w] of Object.entries(HELVETICA_WIDTHS)) widths[c.charCodeAt(0)] ??= w;
  }
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
  fixWidths(doc);
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
