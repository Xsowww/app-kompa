// The small rules of the group screens, apart from React (tested in tests/groupsLogic.test.ts).
import { normalize } from '../../lib/utils';
import { locale, t } from '../../i18n';

interface Member {
  userId: string;
  name: string;
  joinedAt: string;
  isOwner: boolean;
  role: 'lecteur' | 'editeur';
  canInvite: boolean;
}

/** Who takes over when the owner leaves: offered first, the member there the longest (as the database does without a choice). */
export const defaultHeir = (members: Member[], me: string | undefined) =>
  [...members].filter(m => m.userId !== me).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0]?.userId ?? null;

/** The words of a member's rights (« Lecteur », « Éditeur · peut inviter »), seen by every member. */
export const roleLabel = (m: Pick<Member, 'isOwner' | 'role' | 'canInvite'>) =>
  m.isOwner ? t('Propriétaire') : [m.role === 'lecteur' ? t('Lecteur') : t('Éditeur'), m.canInvite && t('peut inviter')].filter(Boolean).join(' · ');

// ── Lists of notes and files: search and order ───────────────────────────────────
export type NoteSort = 'modifiees' | 'creees' | 'titre';
export type FileSort = 'recents' | 'nom' | 'taille';

/** Each word typed found in the name (accents and case aside). */
export const matchesQuery = (name: string, query: string) => {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const n = normalize(name);
  return words.every(w => n.includes(w));
};

const byName = (a: string, b: string) => a.localeCompare(b, locale(), { numeric: true, sensitivity: 'base' });

export function sortNotes<T extends { title: string; createdAt: string; updatedAt: string }>(list: T[], sort: NoteSort, query = ''): T[] {
  const out = list.filter(n => matchesQuery(n.title, query));
  if (sort === 'titre') return out.sort((a, b) => byName(a.title, b.title));
  if (sort === 'creees') return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function sortFiles<T extends { name: string; size: number; createdAt: string }>(list: T[], sort: FileSort, query = ''): T[] {
  const out = list.filter(f => matchesQuery(f.name, query));
  if (sort === 'nom') return out.sort((a, b) => byName(a.name, b.name));
  if (sort === 'taille') return out.sort((a, b) => b.size - a.size);
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── @mentions in a note's comments ────────────────────────────────────────────────
/** The name being typed after « @ » just before the caret (null: not typing one). */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]{0,30})$/u.exec(text.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

/** The text with « @Léa » in place of what was being typed, and where the caret goes. */
export function insertMention(text: string, at: { start: number; query: string }, name: string): { text: string; caret: number } {
  const before = `${text.slice(0, at.start)}@${name} `;
  return { text: before + text.slice(at.start + 1 + at.query.length).replace(/^ /, ''), caret: before.length };
}

/** The members named in a comment (« @Léa », « @Léa Martin »), longest names first so that « @Léa » isn't « @Léa Martin ». */
export function mentionsIn(text: string, members: { userId: string; name: string }[]): string[] {
  const found = new Set<string>();
  let rest = text;
  for (const m of [...members].sort((a, b) => b.name.length - a.name.length)) {
    const name = m.name.trim();
    if (!name) continue;
    const re = new RegExp(`(^|\\s)@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s.,;:!?…)»])`, 'giu');
    if (re.test(rest)) {
      found.add(m.userId);
      rest = rest.replace(re, '$1');
    }
  }
  return [...found];
}

/** Changed after it was proposed (by someone, more than a minute later): « modifié par Léa · hier ». */
export const changedAfter = (e: { createdAt: string; createdBy: string | null; updatedAt: string | null; updatedBy: string | null }) =>
  !!e.updatedAt && (e.updatedBy !== e.createdBy || Date.parse(e.updatedAt) - Date.parse(e.createdAt) > 60_000);
