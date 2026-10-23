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
