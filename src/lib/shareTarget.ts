// What another app shares to the installed Kompaly (manifest's share_target): the service worker keeps it
// (public/sw.js › receiveShare) and the page /partage (pages/SharePage) reads it here, once.

export interface SharedText {
  title: string;
  text: string;
  url: string;
}

const CACHE = 'kompaly-share';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isWeb = (u: string) => /^https?:\/\//i.test(u);

/**
 * The note made of a shared text or link (null when there is neither): titled with what was shared, else its first
 * line, else the site's name; the text in paragraphs; the link last (unless the text already has it).
 */
export function sharedNote({ title, text, url }: SharedText): { title: string; content: string } | null {
  const body = text.trim();
  const link = url.trim();
  if (!body && !link) return null;
  let site = '';
  try {
    site = isWeb(link) ? new URL(link).hostname.replace(/^www\./, '') : '';
  } catch {
    /* not an address: no site name */
  }
  const first = body.split('\n').find(l => l.trim())?.trim() ?? '';
  const name = (title.trim() || (first.length <= 80 ? first : `${first.slice(0, 79)}…`) || site || link).slice(0, 200);
  const paragraphs = body
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`);
  if (link && !body.includes(link)) paragraphs.push(`<p>${isWeb(link) ? `<a href="${esc(link)}">${esc(link)}</a>` : esc(link)}</p>`);
  return { title: name, content: paragraphs.join('') };
}

/** What the worker kept (and the address's own ?title=&text=&url=, a share sent as GET); emptied once read. */
export async function takeShared(params: URLSearchParams): Promise<{ text: SharedText; files: File[] }> {
  const text: SharedText = { title: params.get('title') ?? '', text: params.get('text') ?? '', url: params.get('url') ?? '' };
  const files: File[] = [];
  // The worker's store can be refused (private browsing) or hold a damaged entry: what the address carries still comes.
  try {
    if (!('caches' in globalThis) || !(await caches.has(CACHE))) return { text, files };
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      if (req.url.endsWith('/texte')) {
        const kept = (await res.json().catch(() => ({}))) as Partial<SharedText>;
        text.title ||= String(kept.title ?? '');
        text.text ||= String(kept.text ?? '');
        text.url ||= String(kept.url ?? '');
      } else {
        const blob = await res.blob();
        const raw = res.headers.get('X-Name') ?? 'fichier';
        let name = raw;
        try {
          name = decodeURIComponent(raw);
        } catch {
          /* a « % » of the name itself: kept as it is */
        }
        files.push(new File([blob], name, { type: blob.type }));
      }
    }
    await caches.delete(CACHE);
  } catch {
    /* nothing more than what was read so far */
  }
  return { text, files };
}
