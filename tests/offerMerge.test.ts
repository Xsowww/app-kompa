import { describe, expect, it } from 'vitest';
import { deleteOffer, mergeOffers } from '../src/copilot/offerMerge';
import type { CopilotOffer } from '../src/store/copilot';

describe('mergeOffers', () => {
  it('turns ten deletions of events into one button', () => {
    const offers = Array.from({ length: 10 }, (_, i) => deleteOffer('event', [`e${i}`], ['Yoga']));
    const out = mergeOffers(offers);
    expect(out).toHaveLength(1);
    expect(out[0].payload?.ids?.split(',')).toHaveLength(10);
    expect(out[0].label).toContain('10');
    expect(out[0].label).toContain('Yoga');
  });
  it('keeps one button per kind, ids without duplicate, other offers as they are', () => {
    const open: CopilotOffer = { label: 'Voir', kind: 'open', payload: { to: '/' } };
    const out = mergeOffers([deleteOffer('todo', ['a', 'b'], ['A', 'B']), open, deleteOffer('event', ['x'], ['X']), deleteOffer('todo', ['b', 'c'], ['B', 'C'])]);
    expect(out.map(o => o.kind)).toEqual(['confirm_delete', 'open', 'confirm_delete']);
    expect(out[0].payload?.ids).toBe('a,b,c');
    expect(out[2].payload?.ids).toBe('x');
    expect(out[2].label).toContain('X');
  });
  it('applies several waiting changes with one click', () => {
    const ch = (n: string): CopilotOffer => ({ label: n, kind: 'confirm_change', payload: { name: 'update_event', input: JSON.stringify({ event_id: n }) } });
    const out = mergeOffers([ch('1'), ch('2'), ch('3')]);
    expect(out).toHaveLength(1);
    expect(out[0].payload?.name).toBe('batch');
    expect(JSON.parse(out[0].payload!.input)).toHaveLength(3);
    expect(mergeOffers([ch('1')])[0].payload?.name).toBe('update_event');
  });
});
