import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { loadPdfjs } from '../../lib/pdf';
import { t } from '../../i18n';

const BATCH = 20; // pages in the list at once (each drawn once near the screen); more on demand

/**
 * A PDF drawn page by page with pdf.js, the same in every browser. The browser's own viewer in a frame was
 * blocked by the site's security rules in some browsers, and phones often don't show it inside a page at all.
 * `page`: opened there (a search result), drawn first and scrolled to.
 */
export default function PdfView({ url, title, page: target }: { url: string; title: string; page?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(0);
  const [shown, setShown] = useState(() => Math.max(BATCH, target ?? 0));
  const scrolled = useRef(false);
  const [failed, setFailed] = useState(false);
  const doc = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  // The pages' width, followed (a phone turned, a window resized): the pages are drawn again at the new width.
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const pad = parseFloat(getComputedStyle(el).paddingLeft) || 16;
      setWidth(Math.floor(el.clientWidth - 2 * pad));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [failed]);

  useEffect(() => {
    let cancelled = false;
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | null = null;
    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
        task = pdfjs.getDocument({ data });
        const d = await task.promise;
        if (cancelled) return;
        doc.current = d;
        setTotal(d.numPages);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      doc.current = null;
      void task?.destroy();
    };
  }, [url]);

  // Draw the pages as they come near the screen (on load, then when more are asked for). Until then each one is as
  // big as the first (or the one asked for), so that the page asked for stays in place once those above are drawn.
  useEffect(() => {
    const d = doc.current;
    const el = box.current;
    if (!d || !el || !total || width <= 0) return;
    let cancelled = false;
    let io: IntersectionObserver | undefined;
    let rendering: import('pdfjs-dist').RenderTask | null = null;
    const at = String(width); // a page drawn at another width (or not finished) is drawn again
    const queued = new Set<HTMLCanvasElement>();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const goTo = target && target > 1 && target <= Math.min(total, shown) && !scrolled.current ? target : 0;
    const viewportOf = async (n: number) => {
      const page = await d.getPage(n);
      return { page, viewport: page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio }) };
    };
    const size = (c: HTMLCanvasElement, v: { width: number; height: number }) => Object.assign(c.style, { width: `${v.width / ratio}px`, height: `${v.height / ratio}px` });
    // One page at a time, in the order they come into view.
    let queue = Promise.resolve();
    const draw = (canvas: HTMLCanvasElement) => {
      if (canvas.dataset.drawn === at || queued.has(canvas)) return;
      queued.add(canvas);
      // (Goes on when more pages are added; stops by itself, on an error, once the document is closed.)
      queue = queue.then(async () => {
        if (cancelled) return;
        const { page, viewport } = await viewportOf(Number(canvas.dataset.page));
        if (cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        size(canvas, viewport);
        rendering = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport });
        await rendering.promise.then(() => (canvas.dataset.drawn = at)).catch(() => undefined);
        rendering = null;
      });
      // Closed while drawing (pdf.js: « Transport destroyed »): nothing left to draw.
      queue = queue.catch(() => undefined);
    };
    void (async () => {
      try {
        const { viewport } = await viewportOf(goTo || 1);
        if (cancelled) return;
        const waiting = [...el.querySelectorAll<HTMLCanvasElement>('canvas')].filter(c => c.dataset.drawn !== at);
        waiting.forEach(c => size(c, viewport));
        if (goTo) {
          el.querySelector(`canvas[data-page="${goTo}"]`)?.scrollIntoView({ block: 'start' });
          scrolled.current = true;
        }
        io = new IntersectionObserver(entries => entries.forEach(e => e.isIntersecting && draw(e.target as HTMLCanvasElement)), { root: el, rootMargin: '100% 0px' });
        waiting.forEach(c => io!.observe(c));
      } catch {
        // Closed meanwhile.
      }
    })();
    return () => {
      cancelled = true;
      io?.disconnect();
      rendering?.cancel();
    };
  }, [total, shown, target, width]);

  if (failed)
    return <p className="rounded-md bg-surface px-6 py-10 text-center text-[13px] text-stone-600 shadow-2xl">{t('Impossible d’afficher ce PDF. Télécharge-le pour l’ouvrir.')}</p>;

  return (
    <div ref={box} role="document" aria-label={title} className="h-[min(82vh,calc(100dvh-8rem))] w-[min(1000px,calc(100vw-2rem))] overflow-y-auto rounded-md [scrollbar-gutter:stable] bg-stone-200 p-4 shadow-2xl max-sm:p-2">
      {!total && (
        <div className="flex h-full items-center justify-center text-stone-500">
          <Loader2 size={22} className="animate-spin" />
        </div>
      )}
      {Array.from({ length: Math.min(total, shown) }, (_, i) => (
        <canvas key={i} data-page={i + 1} aria-label={t('Page {page} sur {total}', { page: i + 1, total })} className="mx-auto mb-4 block bg-white shadow last:mb-0" />
      ))}
      {total > shown && (
        <button type="button" className="btn-secondary mx-auto mt-2 flex" onClick={() => setShown(s => s + BATCH)}>
          {t('Afficher les pages suivantes ({shown} sur {total})', { shown, total })}
        </button>
      )}
    </div>
  );
}
