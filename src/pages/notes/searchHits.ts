import type { Node as PmNode } from '@tiptap/pm/model';
import { fold, folding, original } from '../../lib/textFind';

/**
 * Where `query` is in a note's document (accents and case aside), as editor positions; when the words are not side by
 * side (the search also finds a note that has them apart), where each word of two letters or more is.
 */
export function findHits(doc: PmNode, query: string): { from: number; to: number }[] {
  const find = (q: string) => {
    const out: { from: number; to: number }[] = [];
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      // The block's text, and the place in the document of each of its characters (an image or a line break: one).
      let text = '';
      const at: number[] = [];
      node.forEach((child, offset) => {
        const s = child.isText ? child.text! : '￼';
        for (let i = 0; i < s.length; i++) at.push(pos + 1 + offset + i);
        text += s;
      });
      const { folded, map } = folding(text);
      for (let i = folded.indexOf(q); i >= 0; i = folded.indexOf(q, i + q.length)) {
        const o = original(map, i, q.length);
        out.push({ from: at[o.at], to: at[o.at + o.len - 1] + 1 });
      }
      return false;
    });
    return out;
  };
  const q = fold(query.trim());
  if (!q) return [];
  const whole = find(q);
  return whole.length ? whole : q.split(/\s+/).filter(w => w.length > 1).flatMap(find).sort((a, b) => a.from - b.from);
}
