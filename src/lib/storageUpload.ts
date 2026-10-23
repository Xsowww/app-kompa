import { supabase } from './supabase';
import { TUS_CHUNK, chunkEnd, creationHeaders, patchHeaders, readOffset, tusError, tusHeaders } from './tus';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '');
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Same fields as supabase-js's StorageApiError, so storageError() and groupError() read it the same way. */
export type UploadError = Error & { status?: number; statusCode: string };

const fail = (message: string, statusCode: string, status?: number): UploadError => Object.assign(new Error(message), { statusCode, status });
/** Stopped by its signal (a pause or a cancellation, store/uploads): `name` is 'AbortError', see isUploadAbort(). */
const aborted = (): UploadError => Object.assign(new Error('Upload aborted'), { name: 'AbortError', statusCode: 'aborted' });
/** Same message as a failed fetch, which the error helpers read as « no connection ». */
const offline = () => fail('Failed to fetch', '');
const isOffline = (e: UploadError | null) => e?.message === 'Failed to fetch' && e.statusCode === '';

/** Asked again this many times when the network says it is there but no answer comes (a server out of reach…). */
const RETRIES = 5;

/**
 * Waits for the network: until it is back (`online`), or a few seconds while the browser thinks it is there (a
 * flaky wifi, a server out of reach). Rejects with an AbortError when the signal stops it (a pause, a cancellation).
 */
const backOnline = (tries: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      removeEventListener('online', back);
      signal?.removeEventListener('abort', stop);
      if (ok) resolve();
      else reject(aborted());
    };
    const back = () => done(true);
    const stop = () => done(false);
    const timer = navigator.onLine ? setTimeout(back, 2000 * 2 ** tries) : undefined;
    addEventListener('online', back);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
  });

const cleanPath = (path: string) => path.replace(/^\/|\/$/g, '').replace(/\/+/g, '/');
type Options = { upsert?: boolean; cacheControl?: string };

/**
 * Sends a file to Storage, like supabase-js's `storage.from(bucket).upload(path, blob, …)`, made with XMLHttpRequest
 * (fetch says nothing about upload progress). `onProgress` gets the bytes of the file the server has, or is
 * receiving. `signal` stops it (a pause or a cancellation): the error is then an AbortError.
 *
 * Up to 6 Mo: one request (the standard upload). Stopped, it starts over from the first byte the next time: a
 * matter of seconds for such a file, and always safe.
 * Beyond: Supabase's resumable upload (TUS), in pieces of 6 Mo. Stopped, the pieces the server took are kept
 * (only the one on its way is lost) and the next call with the same bucket, path and file goes on from there; its
 * progress does not go back below the level reached (it stays there while the lost part is sent again).
 * A cancelled file's session is closed with abandonUpload().
 */
// The server refused the resumable upload (no such route, its answer unreadable from the page): the standard one, as before.
let tusOff = false;

export async function storageUpload(bucket: string, path: string, blob: Blob, options: Options, onProgress?: (loaded: number) => void, signal?: AbortSignal): Promise<{ error: UploadError | null }> {
  if (!supabase || !url || !key) return { error: fail('Storage is not configured', '500', 500) };
  if (signal?.aborted) return { error: aborted() };
  // Network lost on the way: the file waits for it, then goes on (over 6 Mo, from what the server kept; a smaller
  // one from its start). The files after it wait their turn. A failure only if no answer ever comes while online.
  for (let tries = 0; ; ) {
    const r = blob.size > TUS_CHUNK && !tusOff ? await resumable(bucket, cleanPath(path), blob, options, onProgress, signal) : await standard(bucket, cleanPath(path), blob, options, onProgress, signal);
    if (!isOffline(r.error)) return r;
    if (navigator.onLine && ++tries > RETRIES) {
      await abandonUpload(bucket, path);
      return r;
    }
    try {
      await backOnline(tries, signal);
    } catch (e) {
      return { error: e as UploadError };
    }
  }
}

const token = async () => (await supabase!.auth.getSession()).data.session?.access_token ?? key!;
/** Removes an object that may have been written (best effort). */
const removeObject = (bucket: string, path: string) =>
  supabase!.storage
    .from(bucket)
    .remove([path])
    .catch(() => undefined);

/** The request supabase-js sends: POST of a form with `cacheControl` and the file, `x-upsert`, apikey, the token. */
async function standard(bucket: string, clean: string, blob: Blob, options: Options, onProgress?: (loaded: number) => void, signal?: AbortSignal): Promise<{ error: UploadError | null }> {
  const bearer = await token();
  if (signal?.aborted) return { error: aborted() };
  const body = new FormData();
  body.append('cacheControl', options.cacheControl ?? '3600');
  body.append('', blob);
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    let sent = false;
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const end = (error: UploadError | null) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({ error });
    };
    xhr.open('POST', `${url}/storage/v1/object/${bucket}/${clean}`);
    xhr.setRequestHeader('apikey', key!);
    xhr.setRequestHeader('Authorization', `Bearer ${bearer}`);
    xhr.setRequestHeader('x-upsert', String(options.upsert ?? false));
    // Starts from 0 (again, after a pause).
    onProgress?.(0);
    // The form adds a few hundred bytes around the file: the share sent, applied to the file's size.
    xhr.upload.onprogress = e => e.lengthComputable && e.total && onProgress?.(Math.round((e.loaded / e.total) * blob.size));
    xhr.upload.onload = () => (sent = true);
    xhr.onabort = () => {
      if (!sent) return end(aborted());
      // The answer was still to come: the file may be stored. Removed before saying so.
      void removeObject(bucket, clean).then(() => end(aborted()));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return end(null);
      const e = tusError(xhr.status, xhr.statusText, xhr.responseText);
      end(fail(e.message, e.statusCode, e.status));
    };
    xhr.onerror = xhr.ontimeout = () => end(offline());
    xhr.send(body);
  });
}

// ── Resumable (TUS) ──────────────────────────────────────────────────────────

interface Session {
  blob: Blob;
  /** The session's address (the creation's `Location`); none until it is open. */
  location?: string;
  /** The most the progress said: a resumed file does not go back (from zero again only in a new session). */
  reached: number;
}
/** Open sessions, by `bucket/path`: what a resumed file goes on with. Forgotten once over. */
const sessions = new Map<string, Session>();

interface Answer {
  status: number;
  statusText: string;
  text: string;
  header(name: string): string | null;
}

/**
 * One request; rejects with an AbortError (its signal) or « Failed to fetch » (no answer). `onSent`: every byte
 * of the body left (the answer may still not come).
 */
function request(method: string, target: string, headers: Record<string, string>, body: Blob | null, signal?: AbortSignal, onUpload?: (loaded: number) => void, onSent?: () => void): Promise<Answer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);
    xhr.open(method, target);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (body) {
      xhr.upload.onprogress = e => onUpload?.(Math.min(e.loaded, body.size));
      xhr.upload.onload = () => onSent?.();
    }
    xhr.onabort = () => (done(), reject(aborted()));
    xhr.onerror = xhr.ontimeout = () => (done(), reject(offline()));
    xhr.onload = () => (done(), resolve({ status: xhr.status, statusText: xhr.statusText, text: xhr.responseText, header: n => xhr.getResponseHeader(n) }));
    xhr.send(body);
  });
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => (signal?.removeEventListener('abort', stop), resolve()), ms);
    const stop = () => (clearTimeout(t), reject(aborted()));
    signal?.addEventListener('abort', stop, { once: true });
  });

const refused = (a: Answer) => {
  const e = tusError(a.status, a.statusText, a.text);
  return fail(e.message, e.statusCode, e.status);
};

/** Closes a session on the server (best effort): what it held is dropped. */
async function closeSession(s: Session) {
  if (s.location) await request('DELETE', s.location, tusHeaders(await token(), key!, false), null).catch(() => undefined);
}

async function resumable(bucket: string, clean: string, blob: Blob, options: Options, onProgress?: (loaded: number) => void, signal?: AbortSignal): Promise<{ error: UploadError | null }> {
  const id = `${bucket}/${clean}`;
  let s = sessions.get(id);
  if (s?.blob !== blob) sessions.set(id, (s = { blob, reached: 0 }));
  const session = s;
  const report = (loaded: number) => onProgress?.((session.reached = Math.max(session.reached, loaded)));
  const endpoint = `${url}/storage/v1/upload/resumable`;
  const headers = async () => tusHeaders(await token(), key!, options.upsert ?? false);
  // Every byte of the last piece left, its answer not yet in: the object may be complete.
  let lastSent = false;
  // Times round again (session gone, busy, offset not the one expected): a few, then it is a failure.
  let detours = 0;
  const again = (a: Answer) => {
    if (++detours > 6) throw refused(a);
  };
  try {
    for (;;) {
      let offset = 0;
      if (!s.location) {
        // A new session (the first time, or the previous one expired).
        const fallBack = () => {
          tusOff = true;
          sessions.delete(id);
          return standard(bucket, clean, blob, options, onProgress, signal);
        };
        let a: Answer;
        try {
          a = await request('POST', endpoint, creationHeaders(await headers(), blob.size, { bucketName: bucket, objectName: clean, contentType: blob.type || 'application/octet-stream', cacheControl: options.cacheControl ?? '3600' }), null, signal);
        } catch (e) {
          if ((e as Error).name !== 'AbortError' && navigator.onLine) return await fallBack();
          throw e;
        }
        const at = a.header('Location');
        if ((a.status === 201 && !at) || [404, 405, 501].includes(a.status)) return await fallBack();
        if (a.status !== 201 || !at) throw refused(a);
        s.location = new URL(at, endpoint).href;
      } else {
        // Resumed: where the server is.
        const a = await request('HEAD', s.location, await headers(), null, signal);
        const next = readOffset(a.status, a.header('Upload-Offset'), blob.size);
        if (next === 'error') throw refused(a);
        if (next === 'gone') {
          again(a);
          // From zero, in a new one (the bar starts again too: it says what is true).
          s.location = undefined;
          s.reached = 0;
          continue;
        }
        if (next === 'busy') {
          again(a);
          await wait(1000, signal);
          continue;
        }
        offset = next;
      }
      report(offset);
      let detour: Answer | null = null;
      while (offset < blob.size) {
        const from = offset;
        const to = chunkEnd(from, blob.size);
        const a = await request('PATCH', s.location, patchHeaders(await headers(), from), blob.slice(from, to), signal, n => report(from + n), () => (lastSent = to === blob.size));
        lastSent = false;
        if (a.status === 204 || a.status === 200) {
          const said = Number(a.header('Upload-Offset'));
          offset = Number.isInteger(said) && said > from ? said : to;
          report(offset);
          continue;
        }
        // Not where it thought (409), still held (423), gone (404 / 410): asks the server where it is.
        if ([404, 409, 410, 423].includes(a.status)) {
          detour = a;
          break;
        }
        throw refused(a);
      }
      if (!detour) break;
      again(detour);
      if (detour.status === 423) await wait(1000, signal);
    }
    sessions.delete(id);
    return { error: null };
  } catch (e) {
    const err = (e as UploadError).statusCode !== undefined ? (e as UploadError) : offline();
    // Network lost: the session stays, the next call (once it is back) asks the server where it is and goes on.
    if (isOffline(err)) return { error: err };
    if (err.name === 'AbortError') {
      // Paused (or cancelled, see abandonUpload): the pieces taken stay for the next call. Stopped as the last one
      // had left: the object may be complete; removed, and the next call starts afresh (as the standard upload).
      if (lastSent) {
        sessions.delete(id);
        await removeObject(bucket, clean);
        await closeSession(s);
      }
      return { error: err };
    }
    // A failure: nothing will go on with it.
    sessions.delete(id);
    void closeSession(s);
    return { error: err };
  }
}

/**
 * A cancelled file: its TUS session (if one is open) is closed on the server, so what it held is dropped. The
 * standard upload has nothing to close (a stopped request stores nothing).
 */
export async function abandonUpload(bucket: string, path: string) {
  const id = `${bucket}/${cleanPath(path)}`;
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  await closeSession(s);
}
