/** The Dashboard's day line: which hours it spans, where its hour marks go (minutes since midnight). */
export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 8 h to 22 h, wider when the day's events or the time now go beyond (whole hours, up to midnight). */
export function dayWindow(starts: number[], ends: number[], now: number) {
  const from = Math.floor(Math.min(8 * 60, now, ...starts) / 60) * 60;
  const to = Math.min(24 * 60, Math.ceil(Math.max(22 * 60, now, ...starts, ...ends) / 60) * 60);
  return { from, to: Math.max(to, from + 60) };
}

/** Every 4 hours from the start (6 on a long day), and the end; a mark closer than half a step to the end gives way. */
export function hourTicks(from: number, to: number) {
  const step = to - from > 16 * 60 ? 6 * 60 : 4 * 60;
  const ticks: number[] = [];
  for (let m = from; m < to; m += step) ticks.push(m);
  if (ticks.length > 1 && to - ticks[ticks.length - 1] < step / 2) ticks.pop();
  ticks.push(to);
  return ticks;
}

export interface LabelSpot {
  /** 0: the line just above the bar, 1 and 2 above it. */
  row: number;
  /** Its widest, in % of the bar: up to the next name on the same line. */
  max: number;
  /** From its dot to the right, or ending at its dot (the last one, near the right edge). */
  align: 'start' | 'end';
}

/**
 * Where the names of the coming events go (their dots at `pcts`, from left to right): on the first line above the
 * bar that has room (the previous name on it at least `gap` % before), up to 3 lines. Each name stops before the
 * next one on its line; the last one near the right edge ends at its dot and shares the room with the one before.
 */
export function labelSpots(pcts: number[], gap = 18, lines = 3): LabelSpot[] {
  const last: (number | null)[] = Array(lines).fill(null);
  const rows = pcts.map(p => {
    let row = last.findIndex(q => q === null || p - q >= gap);
    if (row < 0) row = last.indexOf(Math.min(...(last as number[]))); // all busy: under the oldest one
    last[row] = p;
    return row;
  });
  const spots: LabelSpot[] = pcts.map((p, i) => {
    const next = pcts.find((_, j) => j > i && rows[j] === rows[i]);
    return { row: rows[i], align: next === undefined && 100 - p < gap ? 'end' : 'start', max: Math.min(48, (next ?? 100) - p - 1) };
  });
  spots.forEach((s, i) => {
    if (s.align !== 'end') return;
    const prev = [...pcts.keys()].reverse().find(j => j < i && rows[j] === s.row);
    const room = pcts[i] - (prev === undefined ? 0 : pcts[prev]);
    s.max = Math.min(48, prev === undefined ? room - 1 : room / 2 - 1);
    if (prev !== undefined) spots[prev].max = Math.min(spots[prev].max, room / 2 - 1);
  });
  return spots.map(s => ({ ...s, max: Math.max(4, s.max) }));
}
