import { describe, expect, it, vi } from 'vitest';
import { report, serviceFetch, useService } from '../src/lib/serviceStatus';

describe('bandeau service perturbé', () => {
  it('two failures in a row, then the first answer clears it', async () => {
    expect(useService.getState().state).toBe('ok');
    report(false);
    expect(useService.getState().state).toBe('ok');
    report(false);
    expect(useService.getState().state).toBe('down');
    report(true);
    expect(useService.getState().state).toBe('ok');
  });
  it('a server error counts, a 404 or an abort does not', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    f.mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('', { status: 404 }));
    await serviceFetch('x');
    await serviceFetch('x');
    expect(useService.getState().state).toBe('ok');
    f.mockRejectedValueOnce(Object.assign(new Error('a'), { name: 'AbortError' })).mockRejectedValueOnce(Object.assign(new Error('a'), { name: 'AbortError' }));
    await expect(serviceFetch('x')).rejects.toThrow();
    await expect(serviceFetch('x')).rejects.toThrow();
    expect(useService.getState().state).toBe('ok');
    f.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response('', { status: 522 }));
    await expect(serviceFetch('x')).rejects.toThrow();
    await serviceFetch('x');
    expect(useService.getState().state).toBe('down');
    f.mockRestore();
    report(true);
  });
});
