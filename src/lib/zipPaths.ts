import type { DriveItem } from '../store/drive';
import { t } from '../i18n';

/**
 * Where each file and folder goes in the zip: its path from the chosen items (a folder keeps its content inside it).
 * Two items with the same name in one folder: « nom (2).pdf ». Pure (tested in tests/driveZip.test.ts).
 */
export function zipPaths(items: Pick<DriveItem, 'id' | 'name' | 'kind' | 'parentId'>[], roots: string[]): { id: string; path: string; folder: boolean }[] {
  const children = new Map<string | null, typeof items>();
  for (const i of items) children.set(i.parentId, [...(children.get(i.parentId) ?? []), i]);
  const out: { id: string; path: string; folder: boolean }[] = [];
  const walk = (list: typeof items, dir: string) => {
    const taken = new Set<string>();
    for (const i of list) {
      // Names Windows can open too: no \ / : * ? " < > |, no dot or space at the end, never « . » or « .. ».
      const clean = i.name.replace(/[\\/:*?"<>|]/g, '-').replace(/[.\s]+$/, '').trim() || t('Sans titre');
      const dot = i.kind === 'file' ? clean.lastIndexOf('.') : -1;
      const [base, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
      let name = clean;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
      taken.add(name.toLowerCase());
      out.push({ id: i.id, path: dir + name, folder: i.kind === 'folder' });
      if (i.kind === 'folder') walk(children.get(i.id) ?? [], `${dir}${name}/`);
    }
  };
  const set = new Set(roots);
  walk(items.filter(i => set.has(i.id)), '');
  return out;
}
