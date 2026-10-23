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
    if (!d || !el || !total) return;
    let cancelled = false;
    let io: IntersectionObserver | undefined;
    const width = el.clientWidth - 32;
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
      if (canvas.dataset.drawn) return;
      canvas.dataset.drawn = '1';
      // (Goes on when more pages are added; stops by itself, on an error, once the document is closed.)
      queue = queue.then(async () => {
        const { page, viewport } = await viewportOf(Number(canvas.dataset.page));
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        size(canvas, viewport);
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise.catch(() => undefined);
      });
      // Closed while drawing (pdf.js: « Transport destroyed »): nothing left to draw.
      queue = queue.catch(() => undefined);
    };
    void (async () => {
      try {
        const { viewport } = await viewportOf(goTo || 1);
        if (cancelled) return;
        const waiting = [...el.querySelectorAll<HTMLCanvasElement>('canvas:not([data-drawn])')];
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
    };
  }, [total, shown, target]);

  if (failed)
    return <p className="rounded-md bg-surface px-6 py-10 text-center text-[13px] text-stone-600 shadow-2xl">{t('Impossible d’afficher ce PDF. Télécharge-le pour l’ouvrir.')}</p>;

  return (
    <div ref={box} role="document" aria-label={title} className="h-[82vh] w-[min(1000px,92vw)] overflow-y-auto rounded-md bg-stone-200 p-4 shadow-2xl">
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
