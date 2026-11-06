// Reads the text of a Drive file so Kompaly can summarise it, make a revision sheet or a quiz.
// Loaded on demand: pdf.js and mammoth are only downloaded the first time a file is read.

import { useDrive, categoryOf } from '../store/drive';
import { blobStore } from '../lib/blobStore';
import { blobKey } from '../lib/userStorage';
import { docxText, pdfPages } from '../lib/docText';

export const MAX_FILE_CHARS = 30_000;

export interface FileText {
  name: string;
  text: string;
  pages?: number;
  truncated: boolean;
}

const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'xml', 'tex', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'css', 'sql', 'yaml', 'yml'];

/** Text of a Drive file, or an error message the AI can relay. */
export async function readFileText(id: string): Promise<FileText | { error: string }> {
  const item = useDrive.getState().items.find(i => i.id === id && i.kind === 'file');
  if (!item) return { error: 'fichier introuvable (donne un id de fichier venant de search_site ou list_drive_folder)' };
  if (!readableFile(item.name, item.mime ?? '')) return unreadable(item.name, item.mime ?? '');
  const blob = await blobStore.get(blobKey(item.id));
  if (!blob) return { error: 'contenu du fichier indisponible' };
  return blobText(blob, item.name, item.mime ?? '');
}

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const readableFile = (name: string, mime: string) => {
  const cat = categoryOf({ kind: 'file', name, mime });
  const ext = extOf(name);
  return cat === 'pdf' || cat === 'text' || ext === 'docx' || TEXT_EXT.includes(ext) || mime.startsWith('text/');
};
const unreadable = (name: string, mime: string) => ({ error: `je ne sais pas lire ce type de fichier (${extOf(name) || mime || 'inconnu'}) : seulement PDF, docx et fichiers texte` });

/** The text of a file's content (a Drive file, or a group's shared file), cut at `max` characters. */
export async function blobText(blob: Blob, name: string, mime: string, max = MAX_FILE_CHARS): Promise<FileText | { error: string }> {
  if (!readableFile(name, mime)) return unreadable(name, mime);
  const cat = categoryOf({ kind: 'file', name, mime });
  const ext = extOf(name);
  let text: string;
  let pages: number | undefined;
  try {
    if (cat === 'pdf') {
      const pdf = await pdfPages(blob, max);
      text = pdf.pages.map((p, i) => `[Page ${i + 1}]\n${p.replace(/[ \t]+/g, ' ').trim()}`).join('\n\n');
      pages = pdf.total;
    }
    else if (ext === 'docx') text = await docxText(blob);
    else text = await blob.text();
  } catch {
    return { error: 'impossible de lire ce fichier (protégé ou abîmé ?)' };
  }
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return { error: cat === 'pdf' ? 'ce PDF ne contient pas de texte sélectionnable (probablement un scan)' : 'le fichier est vide' };
  const truncated = text.length > max;
  return { name, text: truncated ? `${text.slice(0, max)}\n[… tronqué]` : text, pages, truncated };
}
