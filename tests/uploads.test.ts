import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners = new Set<unknown>();
Object.assign(globalThis, {
  addEventListener: vi.fn((type: string, fn: unknown) => type === 'beforeunload' && listeners.add(fn)),
  removeEventListener: vi.fn((type: string, fn: unknown) => type === 'beforeunload' && listeners.delete(fn)),
});
const { useUploads, trackUpload, uploadSummary, dismissUploads, HIDE_AFTER, pauseUpload, resumeUpload, cancelUpload, pauseAll, resumeAll, cancelAll, sendUpload, isUploadAbort } = await import('../src/store/uploads');

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

const status = () => useUploads.getState().items.map(u => `${u.name}:${u.status}`);
const abortable = (signal: AbortSignal) =>
  new Promise<string>((ok, ko) => {
    const end = setTimeout(() => ok('stored'), 1000);
    signal.addEventListener('abort', () => {
      clearTimeout(end);
      ko(Object.assign(new Error('Upload aborted'), { name: 'AbortError' }));
    });
  });

describe('pause, resume, cancel', () => {
  it('pauses a file: « en pause » in the summary, its share kept until the next attempt says where it starts', () => {
    const a = trackUpload('a', 100);
    a.progress(60);
    const first = a.signal;
    pauseUpload(a.id);
    expect(first.aborted).toBe(true);
    expect(a.signal.aborted).toBe(false); // a fresh one for the next attempt
    // Never back to 0 % on its own: what the server kept is said by the next attempt.
    expect(useUploads.getState().items[0]).toMatchObject({ status: 'paused', loaded: 60 });
    expect(summary()).toMatchObject({ active: 0, paused: 1, percent: 60 });
    // The aborted request's late progress does not count.
    a.progress(80);
    expect(useUploads.getState().items[0].loaded).toBe(60);
    resumeUpload(a.id);
    expect(status()).toEqual(['a:active']);
    a.progress(54); // resumed from the last piece the server took
    expect(useUploads.getState().items[0].loaded).toBe(54);
  });

  it('waits while paused, then goes again (once)', async () => {
    const a = trackUpload('a', 10);
    const send = vi.fn(abortable);
    const run = sendUpload(a, send);
    await vi.advanceTimersByTimeAsync(300);
    pauseUpload(a.id);
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
    resumeUpload(a.id);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(run).resolves.toBe('stored');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('cancels a file: it leaves the card, nothing is kept, the others go on', async () => {
    const a = trackUpload('a', 10);
    const b = trackUpload('b', 10);
    const undo = vi.fn(async () => undefined);
    const run = sendUpload(a, abortable, undo);
    await vi.advanceTimersByTimeAsync(100);
    expect(cancelUpload(a.id)).toBe(true);
    await expect(run).resolves.toBeNull();
    expect(undo).toHaveBeenCalledWith(null);
    expect(a.cancelled).toBe(true);
    expect(status()).toEqual(['b:active']);
    // Its done() / fail() come too late: ignored.
    a.fail();
    expect(status()).toEqual(['b:active']);
    expect(cancelUpload(a.id)).toBe(false);
    const next = sendUpload(b, abortable);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(next).resolves.toBe('stored');
  });

  it('takes back what was stored when the cancel comes just as it ended', async () => {
    const a = trackUpload('a', 10);
    const undo = vi.fn(async () => undefined);
    const run = sendUpload(a, async () => {
      cancelUpload(a.id); // during the last step, too late to abort
      return 'stored';
    }, undo);
    await expect(run).resolves.toBeNull();
    expect(undo).toHaveBeenCalledWith('stored');
  });

  it('says « waiting » until a file of the batch starts', async () => {
    const a = trackUpload('a', 10);
    const b = trackUpload('b', 10);
    const waiting = () => useUploads.getState().items.map(u => !!u.waiting);
    expect(waiting()).toEqual([true, true]);
    pauseUpload(a.id);
    const run = sendUpload(a, async () => 'ok');
    await Promise.resolve();
    expect(waiting()).toEqual([true, true]); // paused before it began: still waiting
    resumeUpload(a.id);
    await run;
    expect(waiting()).toEqual([false, true]);
    await sendUpload(b, async () => 'ok');
    expect(waiting()).toEqual([false, false]);
  });

  it('a paused file waiting its turn is cancelled without being sent', async () => {
    const a = trackUpload('a', 10);
    pauseUpload(a.id);
    const send = vi.fn(abortable);
    const undo = vi.fn(async () => undefined);
    const run = sendUpload(a, send, undo);
    cancelUpload(a.id);
    await expect(run).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
    // What an earlier attempt left on the server (a resumable upload) is dropped.
    expect(undo).toHaveBeenCalledWith(null);
  });

  it('does not take an abort for a failure, and lets real errors through', async () => {
    expect(isUploadAbort(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
    expect(isUploadAbort(new Error('Failed to fetch'))).toBe(false);
    const a = trackUpload('a', 10);
    await expect(sendUpload(a, () => Promise.reject(new Error('Failed to fetch')))).rejects.toThrow('Failed to fetch');
  });

  it('pauses, resumes and cancels the whole batch', () => {
    const a = trackUpload('a', 10);
    trackUpload('b', 10);
    trackUpload('c', 10).done();
    pauseAll();
    expect(status()).toEqual(['a:paused', 'b:paused', 'c:done']);
    expect(summary()).toMatchObject({ active: 0, paused: 2, done: 1 });
    resumeAll([a.id]);
    expect(status()).toEqual(['a:active', 'b:paused', 'c:done']);
    expect(cancelAll()).toBe(2);
    expect(status()).toEqual(['c:done']);
  });

  it('a paused file may still end well (its last step was already done)', () => {
    const a = trackUpload('a', 10);
    pauseUpload(a.id);
    a.done();
    expect(status()).toEqual(['a:done']);
  });

  it('keeps asking before leaving while a file is paused, and the card stays', () => {
    const a = trackUpload('a', 10);
    const b = trackUpload('b', 10);
    a.done();
    pauseUpload(b.id);
    expect(listeners.size).toBe(1);
    vi.advanceTimersByTime(HIDE_AFTER * 2);
    dismissUploads();
    expect(status()).toEqual(['b:paused']);
    cancelUpload(b.id);
    expect(listeners.size).toBe(0);
  });

  it('hides by itself once the files left all went in (one cancelled)', () => {
    const a = trackUpload('a', 10);
    const b = trackUpload('b', 10);
    a.done();
    cancelUpload(b.id);
    expect(status()).toEqual(['a:done']);
    vi.advanceTimersByTime(HIDE_AFTER);
    expect(status()).toEqual([]);
  });

  it('a new import joins a paused one on the same card', () => {
    const a = trackUpload('a', 10);
    pauseUpload(a.id);
    trackUpload('b', 10);
    expect(status()).toEqual(['a:paused', 'b:active']);
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
