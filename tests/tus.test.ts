import { describe, expect, it } from 'vitest';
import { TUS_CHUNK, chunkEnd, chunks, creationHeaders, encodeMetadata, patchHeaders, readOffset, tusError, tusHeaders } from '../src/lib/tus';

const MB = 1024 * 1024;
const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));

describe('TUS pieces', () => {
  it('cuts in pieces of exactly 6 Mo, the last one excepted', () => {
    expect(TUS_CHUNK).toBe(6 * MB);
    const size = 20 * MB;
    const all = chunks(0, size);
    expect(all.map(([a, b]) => b - a)).toEqual([6 * MB, 6 * MB, 6 * MB, 2 * MB]);
    expect(all[0][0]).toBe(0);
    expect(all.at(-1)![1]).toBe(size);
    // Contiguous.
    for (let i = 1; i < all.length; i++) expect(all[i][0]).toBe(all[i - 1][1]);
  });

  it('goes on from the offset the server gives', () => {
    expect(chunks(12 * MB, 20 * MB)).toEqual([
      [12 * MB, 18 * MB],
      [18 * MB, 20 * MB],
    ]);
    // An offset off the 6 Mo grid (a piece partly kept): 6 Mo from there, as tus-js-client.
    expect(chunkEnd(7 * MB, 20 * MB)).toBe(13 * MB);
    expect(chunks(20 * MB, 20 * MB)).toEqual([]);
    expect(chunks(0, 6 * MB)).toEqual([[0, 6 * MB]]);
    expect(chunks(0, 6 * MB + 1)).toEqual([
      [0, 6 * MB],
      [6 * MB, 6 * MB + 1],
    ]);
  });
});

describe('TUS resume offset (HEAD)', () => {
  it('reads Upload-Offset', () => {
    expect(readOffset(200, '12582912', 20 * MB)).toBe(12 * MB);
    expect(readOffset(204, '0', 20 * MB)).toBe(0);
    expect(readOffset(200, String(20 * MB), 20 * MB)).toBe(20 * MB);
  });
  it('starts again in a new session when it is gone or unreadable', () => {
    expect(readOffset(404, null, 10)).toBe('gone');
    expect(readOffset(410, null, 10)).toBe('gone');
    expect(readOffset(200, null, 10)).toBe('gone'); // header not readable (CORS): cannot go on safely
    expect(readOffset(200, 'abc', 10)).toBe('gone');
    expect(readOffset(200, '11', 10)).toBe('gone');
    expect(readOffset(200, '-1', 10)).toBe('gone');
  });
  it('waits while held, fails otherwise', () => {
    expect(readOffset(423, null, 10)).toBe('busy');
    expect(readOffset(403, null, 10)).toBe('error');
    expect(readOffset(500, '3', 10)).toBe('error');
  });
});

describe('TUS headers', () => {
  const base = tusHeaders('tok', 'anon', true);
  it('carries the token, the key, upsert and the protocol version', () => {
    expect(base).toEqual({ authorization: 'Bearer tok', apikey: 'anon', 'x-upsert': 'true', 'Tus-Resumable': '1.0.0' });
    expect(tusHeaders('tok', 'anon', false)['x-upsert']).toBe('false');
  });
  it('creation: length and metadata', () => {
    const h = creationHeaders(base, 20 * MB, { bucketName: 'drive', objectName: 'u1/f1', contentType: 'video/mp4', cacheControl: '60' });
    expect(h['Upload-Length']).toBe(String(20 * MB));
    expect(h['Tus-Resumable']).toBe('1.0.0');
    const pairs = Object.fromEntries(h['Upload-Metadata'].split(',').map(p => p.split(' ')).map(([k, v]) => [k, decode(v)]));
    expect(pairs).toEqual({ bucketName: 'drive', objectName: 'u1/f1', contentType: 'video/mp4', cacheControl: '60' });
  });
  it('piece: offset and content type', () => {
    const h = patchHeaders(base, 6 * MB);
    expect(h).toMatchObject({ 'Upload-Offset': String(6 * MB), 'Content-Type': 'application/offset+octet-stream', authorization: 'Bearer tok' });
  });
  it('metadata in base64 of UTF-8', () => {
    expect(encodeMetadata({ bucketName: 'drive' })).toBe(`bucketName ${btoa('drive')}`);
    const [, v] = encodeMetadata({ objectName: 'élève/€.pdf' }).split(' ');
    expect(decode(v)).toBe('élève/€.pdf');
    expect(encodeMetadata({ a: 'x', b: 'y' })).toBe(`a ${btoa('x')},b ${btoa('y')}`);
  });
});

describe('TUS errors', () => {
  it('reads the JSON error like supabase-js', () => {
    expect(tusError(403, '', JSON.stringify({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }))).toEqual({
      message: 'new row violates row-level security policy',
      statusCode: '403',
      status: 403,
    });
  });
  it('a size refusal always says 413', () => {
    const e = tusError(413, '', 'Maximum size exceeded');
    expect(e.statusCode).toBe('413');
    expect(e.message).toMatch(/413|too large/i);
    expect(tusError(413, '', '').message).toMatch(/413/);
  });
  it('plain text or nothing', () => {
    expect(tusError(500, '', 'boom').message).toBe('HTTP 500: boom');
    expect(tusError(502, 'Bad Gateway', '').message).toBe('Bad Gateway');
    expect(tusError(502, '', '').message).toBe('HTTP 502 error');
  });
});
