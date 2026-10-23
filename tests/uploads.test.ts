import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners = new Set<unknown>();
Object.assign(globalThis, {
  addEventListener: vi.fn((type: string, fn: unknown) => type === 'beforeunload' && listeners.add(fn)),
  removeEventListener: vi.fn((type: string, fn: unknown) => type === 'beforeunload' && listeners.delete(fn)),
});
const { useUploads, trackUpload, uploadSummary, dismissUploads, HIDE_AFTER } = await import('../src/store/uploads');

const summary = () => uploadSummary(useUploads.getState().items);

beforeEach(() => {
  vi.useFakeTimers();
  // Leftovers of the last test: emptied, then settled (no more beforeunload).
  useUploads.setState({ items: [] });
  dismissUploads();
});

describe('upload card store', () => {
  it('adds up the bytes of every file', () => {
    const a = trackUpload('a.pdf', 1000);
    trackUpload('b.pdf', 3000);
    a.progress(500);
    expect(summary()).toMatchObject({ total: 2, active: 2, percent: 12 });
    a.done();
    expect(summary()).toMatchObject({ done: 1, active: 1, percent: 25 });
    // Progress past the end or after done() changes nothing.
    a.progress(5000);
    expect(summary().percent).toBe(25);
  });

  it('counts files when no size is known (stored in this browser)', () => {
    const a = trackUpload('a', 0);
    trackUpload('b', 0);
    expect(summary().percent).toBe(0);
    a.done();
    expect(summary().percent).toBe(50);
  });

  it('learns a size given later', () => {
    const a = trackUpload('drive.pdf', 0);
    a.progress(200, 800);
    expect(useUploads.getState().items[0]).toMatchObject({ size: 800, loaded: 200 });
    expect(summary().percent).toBe(25);
  });

  it('hides by itself once everything went in', () => {
    const a = trackUpload('a', 10);
    a.done();
    expect(useUploads.getState().items).toHaveLength(1);
    vi.advanceTimersByTime(HIDE_AFTER);
    expect(useUploads.getState().items).toHaveLength(0);
  });

  it('stays when a file failed, until closed', () => {
    const a = trackUpload('a', 10);
    const b = trackUpload('b', 10);
    a.done();
    b.fail();
    expect(summary()).toMatchObject({ done: 1, failed: 1, active: 0, percent: 100 });
    vi.advanceTimersByTime(HIDE_AFTER * 3);
    expect(useUploads.getState().items.map(u => u.status)).toEqual(['done', 'error']);
    dismissUploads();
    expect(useUploads.getState().items).toHaveLength(0);
  });

  it('starts a new card once the last import is over', () => {
    trackUpload('old', 10).fail();
    trackUpload('new', 10);
    expect(useUploads.getState().items.map(u => u.name)).toEqual(['new']);
  });

  it('asks before leaving the page only while a file is on its way', () => {
    expect(listeners.size).toBe(0);
    const a = trackUpload('a', 10);
    const b = trackUpload('b', 10);
    expect(listeners.size).toBe(1);
    a.done();
    expect(listeners.size).toBe(1);
    b.fail();
    expect(listeners.size).toBe(0);
  });
});

describe('cardItems', () => {
  it('leaves out the files the open folder already shows, but keeps its failures and the others', async () => {
    const { cardItems } = await import('../src/store/uploads');
    const items = [
      { id: 'a', name: 'a.pdf', size: 10, loaded: 5, status: 'active' as const, where: 'drive:f1' },
      { id: 'b', name: 'b.pdf', size: 10, loaded: 10, status: 'done' as const, where: 'drive:f1' },
      { id: 'c', name: 'c.pdf', size: 10, loaded: 0, status: 'error' as const, where: 'drive:f1' },
      { id: 'd', name: 'd.pdf', size: 10, loaded: 2, status: 'active' as const, where: 'drive:f2' },
    ];
    expect(cardItems(items, 'drive:f1').map(u => u.id)).toEqual(['c', 'd']);
    expect(cardItems(items, null).map(u => u.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
