// Notes ↔ Drive: a note saved in the Drive as a Word file, and a Word, Markdown or text file of the Drive opened as a
// note (the course recorded, a revision sheet…) to be edited in Kompaly. The note keeps a link to the file.

import { useNotes, type Note } from '../../store/notes';
import { getFileBlob, useDrive, type DriveItem } from '../../store/drive';
import { tablesToLines } from './noteUtils';
import { fileName, markdownForWord, noteToMarkdown } from './exportNote';

const OPENABLE = /\.(docx|md|markdown|txt)$/i;

export const canOpenAsNote = (item: Pick<DriveItem, 'kind' | 'name'>) => item.kind === 'file' && OPENABLE.test(item.name);

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A plain text: one paragraph per line (empty lines dropped, the editor spaces its paragraphs). */
export const plainTextToHtml = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(l => l.trim())
    .map(l => `<p>${escape(l)}</p>`)
    .join('');

/** A new note made from the file (null: its content could not be read), linked to it. */
export async function openFileAsNote(item: DriveItem): Promise<Note | null> {
  const blob = await getFileBlob(item.id);
  if (!blob) return null;
  const ext = item.name.split('.').pop()!.toLowerCase();
  let html: string;
  if (ext === 'docx') {
    const { docxToHtml } = await import('../drive/officePreview');
    html = tablesToLines(await docxToHtml(blob));
  } else if (ext === 'txt') html = plainTextToHtml(await blob.text());
  else {
    const { markdownToHtml } = await import('../../lib/docx');
    html = markdownToHtml(await blob.text());
  }
  const title = item.name.replace(/\.[^.]+$/, '').trim();
  const store = useNotes.getState();
  const note = store.createNote({ title, content: html });
  store.updateNote(note.id, { links: [{ kind: 'file', id: item.id }] });
  return useNotes.getState().notes.find(n => n.id === note.id) ?? note;
}

/** The note as a Word file at the root of the Drive; `images`: the note had pictures (Word gets the text only). */
export async function saveNoteToDrive(note: Note): Promise<{ file: DriveItem | null; images: boolean }> {
  const { markdownToDocx, DOCX_MIME } = await import('../../lib/docx');
  const blob = await markdownToDocx(markdownForWord(noteToMarkdown(note)), { title: note.title });
  const [file] = await useDrive.getState().uploadFiles([new File([blob], `${fileName(note.title)}.docx`, { type: DOCX_MIME })], null);
  return { file, images: /<img\b/i.test(note.content) };
}
