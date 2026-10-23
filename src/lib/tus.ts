// The pure part of Supabase Storage's resumable uploads (TUS 1.0.0, `/storage/v1/upload/resumable`): pieces,
// headers, where to go on from. The requests themselves are in storageUpload.ts.

/** Supabase wants every piece of exactly 6 Mo (the last one excepted). Files up to this size go in one request. */
export const TUS_CHUNK = 6 * 1024 * 1024;

/** Where the piece starting at `offset` ends (exclusive): 6 Mo further, or the end of the file. */
export const chunkEnd = (offset: number, size: number) => Math.min(offset + TUS_CHUNK, size);

/** The pieces of a file from `offset` on, as [start, end) pairs. */
export function chunks(offset: number, size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let at = offset; at < size; at = chunkEnd(at, size)) out.push([at, chunkEnd(at, size)]);
  return out;
}

/** Base64 of the UTF-8 bytes (btoa alone only takes Latin-1). */
function base64(text: string) {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** `Upload-Metadata`: `key base64(value)` pairs, separated by commas. */
export const encodeMetadata = (meta: Record<string, string>) =>
  Object.entries(meta)
    .map(([k, v]) => `${k} ${base64(v)}`)
    .join(',');

/** Sent with every request: the session's token (the anon key when signed out), as supabase-js does. */
export const tusHeaders = (token: string, apikey: string, upsert: boolean): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  apikey,
  'x-upsert': String(upsert),
  'Tus-Resumable': '1.0.0',
});

export interface TusTarget {
  bucketName: string;
  objectName: string;
  contentType: string;
  cacheControl: string;
}

/** The POST that opens a session: the whole size and where the file goes. Answered 201 with a `Location`. */
export const creationHeaders = (base: Record<string, string>, size: number, target: TusTarget): Record<string, string> => ({
  ...base,
  'Upload-Length': String(size),
  'Upload-Metadata': encodeMetadata({ ...target }),
});

/** A PATCH sending the bytes from `offset` on. Answered 204 with the new `Upload-Offset`. */
export const patchHeaders = (base: Record<string, string>, offset: number): Record<string, string> => ({
  ...base,
  'Upload-Offset': String(offset),
  'Content-Type': 'application/offset+octet-stream',
});

/**
 * What a HEAD's answer means: the bytes the server already holds (go on from there); `gone`, the session expired
 * or never existed (start again from zero, in a new one); `busy`, another request still holds it (an aborted
 * PATCH the server has not let go of yet: ask again shortly); `error`, anything else.
 */
export function readOffset(status: number, header: string | null, size: number): number | 'gone' | 'busy' | 'error' {
  if (status === 404 || status === 410) return 'gone';
  if (status === 423) return 'busy';
  if (status < 200 || status >= 300) return 'error';
  const offset = header === null || header.trim() === '' ? NaN : Number(header);
  // Unreadable (or more than the file): nothing can safely follow in this session.
  return Number.isInteger(offset) && offset >= 0 && offset <= size ? offset : 'gone';
}

/** The error of a refused request, read like supabase-js (its JSON, else its text, else the HTTP status). */
export function tusError(status: number, statusText: string, body: string): { message: string; statusCode: string; status: number } {
  let err: { statusCode?: string | number; code?: string; message?: string; msg?: string; error?: string } | null = null;
  try {
    err = JSON.parse(body);
  } catch {
    /* not JSON */
  }
  const json = err && typeof err === 'object' ? err : null;
  const text = body.trim().slice(0, 300);
  let message = json ? (json.msg ?? json.message ?? json.error) : text && `HTTP ${status}: ${text}`;
  message ||= statusText || `HTTP ${status} error`;
  // The size refusal, whatever its words (storageError and groupError look for these).
  if (status === 413 && !/413|too large|maximum/i.test(message)) message = `Payload too large (413): ${message}`;
  return { message, statusCode: String(json?.statusCode || json?.code || status), status };
}
