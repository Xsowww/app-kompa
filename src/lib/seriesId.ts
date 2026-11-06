// The id that links the occurrences of a repeated event, or the days of an event over several days (« span-… »).
// The server keeps at most SERIES_MAX characters (events_series_check): « span- » + a whole UUID made 41, and a
// school-holidays .ics gives long UIDs (« …@education.gouv.fr »), so nights and holidays were refused (23514).
// A longer id becomes a short one, always the same for the same id: the days of one event stay linked.

/** The server's limit for my events (supabase/schema.sql, events.series); shared calendars allow more. */
export const SERIES_MAX = 40;

const SPAN = 'span-';

/** Two 32-bit FNV-1a hashes in base 36 (≈ 13 characters each): no collision in one account's series. */
function hash(s: string) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
  }
  return (a >>> 0).toString(36).padStart(7, '0') + (b >>> 0).toString(36).padStart(7, '0');
}

/** The series id as the server takes it: unchanged when short enough, else a short one (keeps « span- »). */
export function fitSeries<T extends string | undefined | null>(series: T): T {
  if (!series || series.length <= SERIES_MAX) return series;
  const span = series.startsWith(SPAN);
  return `${span ? SPAN : 's-'}${hash(series)}` as T;
}

/** A new series id (a random one, short enough): « span- » for the days of an event over several days. */
export function newSeries(span = false) {
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '');
  return `${span ? SPAN : ''}${id}`.slice(0, SERIES_MAX);
}
