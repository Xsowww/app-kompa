// Spreadsheets shown as tables in the Drive's preview: CSV / TSV, and Excel (.xlsx) read with jszip (already used for
// .pptx and the Word export), no spreadsheet library. Values only, as Excel last saved them: no formulas, styles or
// merged cells. The XML is read with regular expressions (no DOM): Excel's files are machine-written and regular.

import { locale, t } from '../../i18n';

export interface Sheet {
  name: string;
  rows: string[][];
  /** Rows or columns left out (only the first MAX_ROWS × MAX_COLS are shown). */
  more: boolean;
}

export const MAX_ROWS = 500;
export const MAX_COLS = 50;
const MAX_SHEETS = 12;

/** Rows past MAX_ROWS and columns past MAX_COLS dropped, every row as long as the longest one. */
function trim(rows: string[][], name: string): Sheet {
  let more = rows.length > MAX_ROWS;
  const kept = rows.slice(0, MAX_ROWS).map(r => {
    if (r.length > MAX_COLS) more = true;
    return r.slice(0, MAX_COLS);
  });
  // Empty rows and columns at the end (often left by a spreadsheet) go.
  while (kept.length && kept[kept.length - 1].every(c => !c)) kept.pop();
  const width = Math.max(0, ...kept.map(r => {
    let w = r.length;
    while (w && !r[w - 1]) w--;
    return w;
  }));
  return { name, rows: kept.map(r => Array.from({ length: width }, (_, i) => r[i] ?? '')), more };
}

// ── CSV ──

/** The separator of a CSV: the one most used on its first line outside quotes (French Excel writes « ; »). */
export function csvSeparator(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && c in counts) counts[c]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n ? best : ',';
}

/** RFC 4180: quoted fields may hold the separator, line breaks and doubled quotes. */
export function parseCsv(text: string, sep = csvSeparator(text)): string[][] {
  text = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && !field) quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_ROWS) return rows; // enough to show (trim() says there is more)
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

export const csvSheet = (text: string, name: string, sep?: string) => trim(parseCsv(text, sep), name);

// ── Excel (.xlsx) ──

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** XML text: entities, and Excel's own « _x000D_ » escapes. */
export const xmlText = (s: string) =>
  s
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(e[1] === 'x' || e[1] === 'X' ? 2 : 1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : (ENTITIES[e] ?? m),
    )
    .replace(/_x([0-9a-f]{4})_/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const P = '(?:\\w+:)?'; // an optional namespace prefix (« x:row »)
/** The text of the <t> elements inside (a rich text cell is made of several runs; phonetic hints left out). */
const texts = (xml: string) =>
  [...xml.replace(new RegExp(`<${P}rPh\\b[\\s\\S]*?</${P}rPh>`, 'g'), '').matchAll(new RegExp(`<${P}t\\b[^>]*>([\\s\\S]*?)</${P}t>`, 'g'))].map(m => xmlText(m[1])).join('');

/** « BC12 » → column 54 (from 0). */
export const columnOf = (ref: string) => [...(/^[A-Z]+/i.exec(ref)?.[0] ?? '')].reduce((n, c) => n * 26 + c.toUpperCase().charCodeAt(0) - 64, 0) - 1;

/** Whether a number format shows a date or a time: Excel's built-in ones, or a custom one with d, m, y, h or s. */
export function isDateFormat(id: number, code?: string) {
  if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
  if (!code) return false;
  const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(bare) && !/^[#0.,\s%]*$/.test(bare);
}

/** An Excel serial date (days since 1899-12-30, or since 1904-01-01) as a local date, with its time when it has one. */
export function excelDate(serial: number, date1904 = false, lang = locale()) {
  const ms = Math.round((serial + (date1904 ? 1462 : 0) - 25569) * 86400000);
  const d = new Date(ms);
  const day = d.toLocaleDateString(lang, { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
  return serial % 1 ? `${day} ${d.toLocaleTimeString(lang, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' })}` : day;
}

const number = (v: string, lang: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString(lang, { maximumFractionDigits: 10, useGrouping: false }) : v;
};

/** The sheets of an .xlsx file (hidden ones left out), each as a table of texts. */
export async function xlsxSheets(data: ArrayBuffer | Uint8Array, lang = locale()): Promise<Sheet[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(data);
  const read = async (path: string) => (await zip.file(path)?.async('string')) ?? '';

  const workbook = await read('xl/workbook.xml');
  const date1904 = /date1904="(1|true)"/.test(workbook);
  const rels = new Map(
    [...(await read('xl/_rels/workbook.xml.rels')).matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)].map(m => {
      const target = attr(m[0], 'Target') ?? '';
      return [attr(m[0], 'Id') ?? '', target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`];
    }),
  );
  const strings = [...(await read('xl/sharedStrings.xml')).matchAll(new RegExp(`<${P}si\\b[^>]*>([\\s\\S]*?)</${P}si>`, 'g'))].map(m => texts(m[1]));

  // Number format of each cell style (the « s » of a cell), to know which numbers are dates.
  const styles = await read('xl/styles.xml');
  const formats = new Map([...styles.matchAll(new RegExp(`<${P}numFmt\\b[^>]*>`, 'g'))].map(m => [Number(attr(m[0], 'numFmtId')), xmlText(attr(m[0], 'formatCode') ?? '')]));
  const xfs = new RegExp(`<${P}cellXfs\\b[^>]*>([\\s\\S]*?)</${P}cellXfs>`).exec(styles)?.[1] ?? '';
  const dateStyle = [...xfs.matchAll(new RegExp(`<${P}xf\\b[^>]*>`, 'g'))].map(m => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    return isDateFormat(id, formats.get(id));
  });

  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(new RegExp(`<${P}sheet\\b[^>]*>`, 'g'))) {
    if (sheets.length >= MAX_SHEETS) break;
    if (/state="(hidden|veryHidden)"/.test(m[0])) continue;
    const path = rels.get(attr(m[0], 'r:id') ?? attr(m[0], 'id') ?? '');
    const xml = path ? await read(path) : '';
    const rows: string[][] = [];
    let next = 0;
    for (const r of xml.matchAll(new RegExp(`<${P}row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}row>)`, 'g'))) {
      const at = Number(attr(r[1], 'r') ?? next + 1) - 1;
      next = at + 1;
      if (at >= MAX_ROWS + 1) break;
      const row: string[] = [];
      let col = 0;
      for (const c of (r[2] ?? '').matchAll(new RegExp(`<${P}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}c>)`, 'g'))) {
        const ref = attr(c[1], 'r');
        col = ref ? columnOf(ref) : col;
        const type = attr(c[1], 't');
        const body = c[2] ?? '';
        const v = new RegExp(`<${P}v>([\\s\\S]*?)</${P}v>`).exec(body)?.[1];
        let text = '';
        if (type === 'inlineStr') text = texts(body);
        else if (v === undefined) text = '';
        else if (type === 's') text = strings[Number(v)] ?? '';
        else if (type === 'b') text = v === '1' ? t('VRAI') : t('FAUX');
        else if (type === 'str' || type === 'e') text = xmlText(v);
        else text = dateStyle[Number(attr(c[1], 's') ?? 0)] && Number.isFinite(Number(v)) ? excelDate(Number(v), date1904, lang) : number(v, lang);
        if (col < MAX_COLS + 1) row[col] = text;
        col++;
      }
      rows[at] = Array.from({ length: row.length }, (_, i) => row[i] ?? '');
    }
    sheets.push(trim(Array.from({ length: rows.length }, (_, i) => rows[i] ?? []), xmlText(attr(m[0], 'name') ?? '')));
  }
  return sheets;
}
