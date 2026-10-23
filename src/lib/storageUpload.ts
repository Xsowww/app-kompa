import { supabase } from './supabase';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Same fields as supabase-js's StorageApiError, so storageError() and groupError() read it the same way. */
export type UploadError = Error & { status?: number; statusCode: string };

const fail = (message: string, statusCode: string, status?: number): UploadError => Object.assign(new Error(message), { statusCode, status });
/** Stopped by its signal (a pause or a cancellation, store/uploads): `name` is 'AbortError', see isUploadAbort(). */
const aborted = (): UploadError => Object.assign(new Error('Upload aborted'), { name: 'AbortError', statusCode: 'aborted' });

/**
 * The request supabase-js's `storage.from(bucket).upload(path, blob, …)` sends (POST of a form with
 * `cacheControl` and the file, `x-upsert`, apikey, the session's token), made with XMLHttpRequest:
 * fetch says nothing about upload progress. `onProgress` gets the bytes of the file sent so far.
 * `signal` stops it (xhr.abort): the error is then an AbortError. Stopped once every byte was sent, the server may
 * have stored the object: it is removed (stopped earlier, nothing was written).
 */
export async function storageUpload(
  bucket: string,
  path: string,
  blob: Blob,
  options: { upsert?: boolean; cacheControl?: string },
  onProgress?: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<{ error: UploadError | null }> {
  if (!supabase || !url || !key) return { error: fail('Storage is not configured', '500', 500) };
  if (signal?.aborted) return { error: aborted() };
  const { data } = await supabase.auth.getSession();
  if (signal?.aborted) return { error: aborted() };
  const body = new FormData();
  body.append('cacheControl', options.cacheControl ?? '3600');
  body.append('', blob);
  const clean = path.replace(/^\/|\/$/g, '').replace(/\/+/g, '/');
  const client = supabase;
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    let sent = false;
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const end = (error: UploadError | null) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({ error });
    };
    xhr.open('POST', `${url.replace(/\/+$/, '')}/storage/v1/object/${bucket}/${clean}`);
    xhr.setRequestHeader('apikey', key);
    xhr.setRequestHeader('Authorization', `Bearer ${data.session?.access_token ?? key}`);
    xhr.setRequestHeader('x-upsert', String(options.upsert ?? false));
    // The form adds a few hundred bytes around the file: the share sent, applied to the file's size.
    xhr.upload.onprogress = e => e.lengthComputable && e.total && onProgress?.(Math.round((e.loaded / e.total) * blob.size));
    xhr.upload.onload = () => (sent = true);
    xhr.onabort = () => {
      if (!sent) return end(aborted());
      // The answer was still to come: the file may be stored. Removed before saying so (best effort).
      void client.storage
        .from(bucket)
        .remove([clean])
        .catch(() => undefined)
        .then(() => end(aborted()));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return end(null);
      // Like supabase-js: the server's JSON error, or the HTTP status when there is none.
      let err: { statusCode?: string; code?: string; message?: string; msg?: string; error?: string } | null = null;
      try {
        err = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      const message = err?.msg ?? err?.message ?? err?.error ?? (xhr.statusText || `HTTP ${xhr.status} error`);
      end(fail(message, String(err?.statusCode || err?.code || xhr.status), xhr.status));
    };
    // Same message as a failed fetch, which the error helpers read as « no connection ».
    xhr.onerror = xhr.ontimeout = () => end(fail('Failed to fetch', ''));
    xhr.send(body);
  });
}
