import type { Note } from '../../store/notes';
import { t, lang, locale } from '../../i18n';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const fileName = (title: string) => (title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || t('Note')).slice(0, 120);

const PRINT_CSS = `
@page { size: A4; margin: 20mm 18mm 22mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 11pt/1.6 'Geist', 'Helvetica Neue', Arial, sans-serif; color: #1c1b19; }
header { border-bottom: 1px solid #e7e5e4; padding-bottom: 10pt; margin-bottom: 16pt; }
header h1 { font-size: 21pt; line-height: 1.2; letter-spacing: -0.01em; margin: 0; font-weight: 600; }
header p { margin: 4pt 0 0; font-size: 9pt; color: #78716c; }
main > :first-child { margin-top: 0; }
h1, h2, h3 { break-after: avoid; page-break-after: avoid; font-weight: 600; line-height: 1.3; }
h1 { font-size: 16pt; margin: 18pt 0 6pt; }
h2 { font-size: 13.5pt; margin: 16pt 0 5pt; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; }
p { margin: 0 0 6pt; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 6pt; padding-left: 18pt; }
li > p { margin: 0 0 2pt; }
li::marker { color: #78716c; }
ul[data-type='taskList'] { list-style: none; padding-left: 0; }
ul[data-type='taskList'] li { display: flex; gap: 7pt; align-items: flex-start; break-inside: avoid; }
ul[data-type='taskList'] li > label { flex: none; margin-top: 2.5pt; }
ul[data-type='taskList'] li > label span { display: none; }
ul[data-type='taskList'] li > div { flex: 1; }
ul[data-type='taskList'] input { appearance: none; -webkit-appearance: none; width: 10pt; height: 10pt; margin: 0; border: 1pt solid #57534e; border-radius: 2pt; display: block; position: relative; }
ul[data-type='taskList'] input:checked { background: #1c1b19; border-color: #1c1b19; }
ul[data-type='taskList'] input:checked::after { content: ''; position: absolute; left: 2.8pt; top: 0.6pt; width: 2.6pt; height: 5.4pt; border: solid #fff; border-width: 0 1.3pt 1.3pt 0; transform: rotate(45deg); }
ul[data-type='taskList'] li[data-checked='true'] > div { color: #78716c; text-decoration: line-through; }
blockquote { margin: 0 0 8pt; padding: 2pt 0 2pt 10pt; border-left: 2pt solid #d6d3d1; color: #44403c; }
code { font-family: 'Geist Mono', Menlo, Consolas, monospace; font-size: 9.5pt; background: #f5f5f4; border-radius: 2pt; padding: 0 2pt; }
pre { background: #f5f5f4; border-radius: 4pt; padding: 8pt 10pt; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; }
a { color: inherit; }
mark { background: #fdecb2; padding: 0 1pt; }
hr { border: none; border-top: 1px solid #d6d3d1; margin: 14pt 0; }
img { display: block; max-width: 100%; height: auto; margin: 8pt 0; border-radius: 4pt; break-inside: avoid; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #d6d3d1; padding: 4pt 6pt; }
`;

/** Builds the standalone printable HTML document of a note. */
export function notePrintHtml(note: Note, subtitle?: string) {
  const date = new Date(note.updatedAt).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(note.title)}</title><style>${PRINT_CSS}</style></head>
<body><header><h1>${esc(note.title)}</h1><p>${esc(subtitle ? `${subtitle} · ` : '')}${esc(t('Modifiée le {date}', { date }))}</p></header><main>${note.content}</main></body></html>`;
}

/**
 * Prints the note from a hidden iframe: the browser dialog offers « Enregistrer en PDF ».
 * Resolves once print() has been called.
 */
export function printNote(note: Note, subtitle?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.dataset.notePrint = '';
    // Pas de « allow-scripts » : un code caché dans la note (sauvegarde importée) ne s'exécute pas.
    frame.sandbox.add('allow-same-origin', 'allow-modals');
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
    document.body.appendChild(frame);
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) {
      frame.remove();
      return reject(new Error(t('Impression impossible')));
    }
    doc.open();
    doc.write(notePrintHtml(note, subtitle));
    doc.close();
    // Inputs from the stored HTML keep their « checked » attribute; make sure the property follows.
    doc.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(i => (i.checked = i.hasAttribute('checked')));

    const cleanup = () => setTimeout(() => frame.remove(), 1000);
    const go = () => {
      try {
        win.focus();
        win.addEventListener('afterprint', cleanup, { once: true });
        win.print();
        // Some browsers never fire afterprint: remove the frame anyway later.
        setTimeout(() => frame.isConnected && frame.remove(), 60_000);
        resolve();
      } catch (e) {
        frame.remove();
        reject(e instanceof Error ? e : new Error(t('Impression impossible')));
      }
    };
    const imgs = Array.from(doc.images).filter(i => !i.complete);
    if (!imgs.length) return void setTimeout(go, 50);
    let left = imgs.length;
    const done = () => --left === 0 && go();
    imgs.forEach(i => {
      i.addEventListener('load', done, { once: true });
      i.addEventListener('error', done, { once: true });
    });
  });
}

// ── Markdown ────────────────────────────────────────────────────────

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/([*_`[\]])/g, '\\$1');
  if (!(node instanceof HTMLElement)) return '';
  const inner = () => Array.from(node.childNodes).map(inline).join('');
  switch (node.tagName) {
    case 'STRONG':
    case 'B':
      return wrap(inner(), '**');
    case 'EM':
    case 'I':
      return wrap(inner(), '*');
    case 'S':
    case 'DEL':
      return wrap(inner(), '~~');
    case 'MARK':
      return wrap(inner(), '==');
    case 'CODE':
      return '`' + (node.textContent ?? '') + '`';
    case 'A':
      return `[${inner()}](${node.getAttribute('href') ?? ''})`;
    case 'IMG':
      return `![${node.getAttribute('alt') ?? ''}](${node.getAttribute('src') ?? ''})`;
    case 'BR':
      return '  \n';
    default:
      return inner();
  }
}

/** Keeps spaces outside the markers (`** bold**` is not bold in Markdown). */
function wrap(text: string, mark: string) {
  const m = /^(\s*)(.*?)(\s*)$/s.exec(text)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

function block(el: Element, indent = ''): string {
  const out: string[] = [];
  for (const node of Array.from(el.children)) {
    switch (node.tagName) {
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
        out.push(`${'#'.repeat(Number(node.tagName[1]) + 1)} ${inline(node).trim()}`);
        break;
      case 'P':
        out.push(indent + inline(node).trim());
        break;
      case 'BLOCKQUOTE':
        out.push(block(node).split('\n').map(l => `> ${l}`.trimEnd()).join('\n'));
        break;
      case 'PRE':
        out.push('```\n' + (node.textContent ?? '') + '\n```');
        break;
      case 'HR':
        out.push('---');
        break;
      case 'IMG':
        out.push(inline(node));
        break;
      case 'UL':
      case 'OL': {
        const task = node.getAttribute('data-type') === 'taskList';
        const items = Array.from(node.children).filter(li => li.tagName === 'LI');
        out.push(
          items
            .map((li, i) => {
              const marker = task ? `- [${li.getAttribute('data-checked') === 'true' ? 'x' : ' '}]` : node.tagName === 'OL' ? `${i + 1}.` : '-';
              const body = task ? li.querySelector(':scope > div') ?? li : li;
              const lines = block(body, '').split('\n\n').filter(Boolean);
              const first = lines.shift() ?? '';
              const pad = ' '.repeat(marker.length + 1);
              return `${indent}${marker} ${first}${lines.map(l => '\n' + l.split('\n').map(x => indent + pad + x).join('\n')).join('')}`;
            })
            .join('\n'),
        );
        break;
      }
      default:
        if (node.children.length) out.push(block(node, indent));
        else if (node.textContent?.trim()) out.push(indent + inline(node).trim());
    }
  }
  return out.join('\n\n');
}

export function noteToMarkdown(note: Note): string {
  const root = new DOMParser().parseFromString(`<body>${note.content}</body>`, 'text/html').body;
  return `# ${note.title}\n\n${block(root).replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function downloadMarkdown(note: Note) {
  const blob = new Blob([noteToMarkdown(note)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName(note.title)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
