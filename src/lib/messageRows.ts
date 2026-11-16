// Kompaly's island (components/Island): a message shown as a heading and rows. Tested in tests/messageRows.test.ts.

/**
 * A message made of « Label : value » lines under a first line (the morning brief: « Aujourd’hui : … », « À faire : … »,
 * « Prochain examen : … »): its heading and its rows, to be read at a glance rather than as one block. Null otherwise.
 */
export function messageRows(text: string): { head: string; rows: { label: string; value: string }[] } | null {
  const [head, ...rest] = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (rest.length < 2 || rest.length > 4) return null;
  const rows = rest.map(l => /^(.{2,40}?)\s:\s(.+)$/u.exec(l)).map(m => m && { label: m[1], value: m[2].replace(/\.$/, '').replace(/^\p{Ll}/u, c => c.toUpperCase()) });
  return rows.every(Boolean) ? { head: head.replace(/\s:$/, ''), rows: rows as { label: string; value: string }[] } : null;
}
