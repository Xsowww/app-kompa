// One button per kind of thing asked, never one per item: ten events to delete → « Supprimer les 10 événements ».
// A click on one of ten buttons greys out the nine others (only the last message's buttons are live), so a
// request on many items must end with a single button that does it all. Pure: tested in tests/offerMerge.test.ts.

import type { CopilotOffer } from '../store/copilot';
import { t, tn } from '../i18n';

const SEP = '\u001f'; // between the titles kept in a payload (a title never holds it)

const sameTitle = (titles: string[]) => titles.length > 1 && titles.every(x => x === titles[0]);

function deleteLabel(what: string, titles: string[]) {
  const n = titles.length;
  if (n === 1) return what === 'items' ? t('Mettre « {name} » à la corbeille', { name: titles[0] }) : t('Supprimer « {title} »', { title: titles[0] });
  if (what === 'event')
    return sameTitle(titles) ? tn(n, 'Supprimer l’événement « {title} »', 'Supprimer les {n} événements « {title} »', { title: titles[0] }) : tn(n, 'Supprimer {n} événement', 'Supprimer les {n} événements');
  if (what === 'todo')
    return sameTitle(titles) ? tn(n, 'Supprimer la tâche « {title} »', 'Supprimer les {n} tâches « {title} »', { title: titles[0] }) : tn(n, 'Supprimer {n} tâche', 'Supprimer les {n} tâches');
  return tn(n, 'Mettre {n} élément à la corbeille', 'Mettre {n} éléments à la corbeille');
}

/** The payload of a deletion offer: its ids and their titles (for the merged label). */
export const deleteOffer = (what: 'event' | 'todo' | 'items', ids: string[], titles: string[]): CopilotOffer => ({
  label: deleteLabel(what, titles),
  kind: 'confirm_delete',
  payload: { what, ids: ids.join(','), titles: titles.join(SEP) },
});

/**
 * Merges the offers of one answer: every deletion of the same kind becomes one button (ids together, no
 * duplicate), every change waiting for a click becomes one « Appliquer » button; the other offers stay as they are.
 */
export function mergeOffers(offers: CopilotOffer[]): CopilotOffer[] {
  const out: CopilotOffer[] = [];
  const deletes = new Map<string, { ids: string[]; titles: string[] }>();
  const changes: { name: string; input: unknown; label: string }[] = [];
  for (const o of offers) {
    const p = o.payload ?? {};
    if (o.kind === 'confirm_delete' && p.what) {
      const ids = (p.ids ?? '').split(',').filter(Boolean);
      const titles = p.titles ? p.titles.split(SEP) : ids.map(() => o.label);
      const d = deletes.get(p.what) ?? { ids: [], titles: [] };
      ids.forEach((id, i) => {
        if (d.ids.includes(id)) return;
        d.ids.push(id);
        d.titles.push(titles[i] ?? titles[0]);
      });
      if (!deletes.has(p.what)) {
        deletes.set(p.what, d);
        out.push(o); // placeholder, replaced below at the same place
      }
    } else if (o.kind === 'confirm_change' && p.name) {
      const list = p.name === 'batch' ? (JSON.parse(p.input ?? '[]') as typeof changes) : [{ name: p.name, input: JSON.parse(p.input ?? '{}'), label: o.label }];
      if (!changes.length) out.push(o);
      changes.push(...list);
    } else out.push(o);
  }
  return out.map(o => {
    const p = o.payload ?? {};
    if (o.kind === 'confirm_delete' && p.what && deletes.has(p.what)) {
      const d = deletes.get(p.what)!;
      return deleteOffer(p.what as 'event' | 'todo' | 'items', d.ids, d.titles);
    }
    if (o.kind === 'confirm_change' && changes.length > 1)
      return { label: tn(changes.length, 'Appliquer {n} changement', 'Appliquer les {n} changements'), kind: 'confirm_change', payload: { name: 'batch', input: JSON.stringify(changes) } };
    return o;
  });
}
