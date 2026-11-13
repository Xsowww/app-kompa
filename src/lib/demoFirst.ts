// The sentence a visitor typed in the home page's demo (pages/LandingPage › HeroDemo keeps it in localStorage
// `kompaly-demo`, JSON { text, at }) becomes the new account's first event or task, read like the calendar's quick add
// (lib/dates › parseQuickAdd). Pure parts tested in tests/demoFirst.test.ts; addDemoItem() does the rest.

import { parseQuickAdd, toKey } from './dates';
import type { Usage } from './usage';

export const DEMO_KEY = 'kompaly-demo';
/** Older than a day: the visitor came back another time, the sentence is no longer theirs to find. */
const MAX_AGE = 24 * 3600e3;

const USAGES: readonly Usage[] = ['etudes', 'travail', 'perso'];

/** The sentence kept by the demo and the life it was tried in, or null (nothing, damaged, too old, or written « in the future »). */
export function readDemo(raw: string | null, now = new Date()): { text: string; at: Date; usage?: Usage; from?: Date } | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { text?: unknown; at?: unknown; usage?: unknown; from?: unknown };
    const text = typeof d.text === 'string' ? d.text.trim().slice(0, 160) : '';
    const at = typeof d.at === 'string' ? new Date(d.at) : null;
    if (!text || !at || Number.isNaN(at.getTime())) return null;
    const age = now.getTime() - at.getTime();
    const usage = USAGES.find(u => u === d.usage);
    // An example's days read from its week (the next one, from its Monday): never more than a week and a day ahead.
    const from = typeof d.from === 'string' ? new Date(d.from) : null;
    const ahead = from && !Number.isNaN(from.getTime()) && from > at && from.getTime() - at.getTime() <= 8 * 864e5 ? from : null;
    return age <= MAX_AGE && age >= -5 * 60e3 ? { text, at, ...(usage && { usage }), ...(ahead && { from: ahead }) } : null;
  } catch {
    return null;
  }
}

export type DemoPlan =
  | { kind: 'event'; title: string; date: string; start: string; end?: string; endDate?: string; important?: boolean }
  | { kind: 'task'; title: string; date?: string };

/**
 * What the sentence becomes, as the demo showed it: an event when it has an hour (on its day, today without one),
 * else a task (for its day, or without one). Read from the moment it was typed (« demain » is the demo's tomorrow),
 * unless that lands in the past: then from now. Null when there is nothing to add or the date doesn't exist.
 */
export function demoPlan(text: string, at: Date, now = new Date()): DemoPlan | null {
  const today = toKey(now);
  let p = parseQuickAdd(text, at);
  if (p.date && p.date < today) p = parseQuickAdd(text, now);
  if (p.impossible || !p.title.trim()) return null;
  const title = p.title.trim();
  if (p.start) {
    const date = p.date && p.date >= today ? p.date : today;
    return { kind: 'event', title, date, start: p.start, ...(p.end && { end: p.end }), ...(p.endDate && p.endDate > date && { endDate: p.endDate }), ...(p.important && { important: true }) };
  }
  return { kind: 'task', title, ...(p.date && p.date >= today && { date: p.date }) };
}
