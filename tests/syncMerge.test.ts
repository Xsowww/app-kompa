import { describe, expect, it } from 'vitest';
import { mergeRows } from '../src/lib/syncMerge';

type X = { id: string; v: string; trash?: boolean };
const toApp = (r: Record<string, unknown>): X => ({ id: r.id as string, v: r.v as string, ...(r.trash ? { trash: true } : {}) });
const trashed = (r: Record<string, unknown>) => !!r.trash;
const at = (s: string) => Date.parse(`2026-10-23T10:00:${s}Z`);

describe('mergeRows', () => {
  it('replaces changed rows, adds new ones, keeps the others', () => {
    const [live] = mergeRows([[{ id: 'a', v: '1' }, { id: 'b', v: '1' }]], [{ id: 'b', v: '2' }, { id: 'c', v: '1' }], new Map(), toApp, trashed);
    expect(live).toEqual([{ id: 'a', v: '1' }, { id: 'b', v: '2' }, { id: 'c', v: '1' }]);
  });
  it('moves a row between the list and the trash', () => {
    const [live, trash] = mergeRows([[{ id: 'a', v: '1' }], []], [{ id: 'a', v: '1', trash: true }], new Map(), toApp, trashed);
    expect(live).toEqual([]);
    expect(trash).toEqual([{ id: 'a', v: '1', trash: true }]);
  });
  it('takes out deleted rows, from the list and the trash', () => {
    const gone = new Map([['a', at('05')], ['t', at('05')]]);
    const [live, trash] = mergeRows([[{ id: 'a', v: '1' }, { id: 'b', v: '1' }], [{ id: 't', v: '1' }]], [], gone, toApp, trashed);
    expect(live).toEqual([{ id: 'b', v: '1' }]);
    expect(trash).toEqual([]);
  });
  it('the later of a deletion and a save wins', () => {
    const gone = new Map([['a', at('05')], ['b', at('05')]]);
    const rows = [
      { id: 'a', v: 'saved after', synced_at: `2026-10-23T10:00:09Z` },
      { id: 'b', v: 'saved before', synced_at: `2026-10-23T10:00:01Z` },
    ];
    const [live] = mergeRows([[{ id: 'a', v: '0' }, { id: 'b', v: '0' }]], rows, gone, toApp, trashed);
    expect(live).toEqual([{ id: 'a', v: 'saved after' }]);
  });
});
