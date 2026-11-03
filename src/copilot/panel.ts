// Small rules of Kompaly's panel (Copilot.tsx), kept apart to be tested.

import { addDays } from 'date-fns';
import { fmtDay, toKey } from '../lib/dates';
import { t } from '../i18n';

/** « Aujourd’hui », « Hier » or the date: the line above the first message of each day. */
export function dayLabel(at: string, now = new Date()) {
  const key = toKey(new Date(at));
  if (key === toKey(now)) return t('Aujourd’hui');
  if (key === toKey(addDays(now, -1))) return t('Hier');
  return fmtDay(new Date(at), 'EEEE d MMMM');
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a remark's bubble hides the least of the page: of the places tried (the first is the usual one, beside
 * Kompaly), the first over nothing, else the one over the fewest points. `busy(x, y)`: a card is at that point.
 */
export function leastCovering(places: Box[], busy: (x: number, y: number) => boolean, grid = 3): number {
  let best = 0;
  let fewest = Infinity;
  places.forEach((p, i) => {
    let n = 0;
    for (let a = 0; a < grid; a++) for (let b = 0; b < grid; b++) if (busy(p.left + ((a + 0.5) / grid) * p.width, p.top + ((b + 0.5) / grid) * p.height)) n++;
    if (n < fewest) {
      best = i;
      fewest = n;
    }
  });
  return best;
}
