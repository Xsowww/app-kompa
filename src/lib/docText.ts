// Text inside PDF and Word files, read in the browser (Drive search and Kompaly).
// pdf.js and mammoth are heavy: downloaded the first time a document is read.

import { loadPdfjs } from './pdf';

export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/**
 * A page's text from pdf.js's pieces. Many PDFs place each word (or a few letters) on its own, with no space
 * character between them: a space is put where there is a gap on the line, a line break where the line changes,
 * so that « droit civil » is not read as « droitcivil ».
 */
export function pageText(items: (PdfTextItem | object)[]) {
  let out = '';
  let prev: { end: number; y: number; h: number } | null = null;
  for (const it of items) {
    if (!('str' in it)) continue;
    const x = it.transform[4] ?? 0;
    const y = it.transform[5] ?? 0;
    const h = Math.abs(it.height || it.transform[3] || 10);
    const last = out[out.length - 1];
    if (prev && it.str && last && !/\s/.test(last) && !/^\s/.test(it.str)) {
      if (Math.abs(y - prev.y) > prev.h * 0.5) out += '\n';
      else if (x - prev.end > Math.min(h, prev.h) * 0.15) out += ' ';
    }
    out += it.str;
    if (it.hasEOL) out += '\n';
    if (it.str) prev = { end: x + it.width, y, h };
  }
  return out;
}

/** Text of each page, until about `maxChars` characters; `total` is the document's page count. */
export async function pdfPages(blob: Blob, maxChars: number, maxPages = 400): Promise<{ pages: string[]; total: number }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    let size = 0;
    for (let i = 1; i <= Math.min(doc.numPages, maxPages) && size < maxChars; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      const text = pageText(content.items);
      pages.push(text);
      size += text.length;
    }
    return { pages, total: doc.numPages };
  } finally {
    void task.destroy();
  }
}

export async function docxText(blob: Blob): Promise<string> {
  const mammoth = await import('mammoth');
  return (await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() })).value;
}
