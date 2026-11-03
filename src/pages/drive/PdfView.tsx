import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import { loadPdfjs } from '../../lib/pdf';
import { useZoom, ZOOM_MAX, ZOOM_MIN } from './zoom';
import './pdf.css';
import { t } from '../../i18n';

const BATCH = 20; // pages in the list at once (each drawn once near the screen); more on demand
const MAX_CANVAS = 4096; // px of a page's drawing, at most: a big zoom on a sharp screen would take hundreds of MB

/** − 100 % + over a preview (a click on the percentage goes back to the width that fits), and what `children` add. */
export function ZoomBar({ zoom, zoomTo, children }: { zoom: number; zoomTo: (z: number) => void; children?: ReactNode }) {
  const btn = 'flex h-8 w-8 items-center justify-center rounded-full text-on-inverse/85 hover:bg-on-inverse/10 hover:text-on-inverse disabled:opacity-40 pointer-coarse:h-9 pointer-coarse:w-9';
  return (
    <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-inverse/90 px-1 text-[12.5px] text-on-inverse shadow-pop">
      <button type="button" className={btn} disabled={zoom <= ZOOM_MIN} onClick={() => zoomTo(zoom / 1.25)} title={t('Dézoomer')} aria-label={t('Dézoomer')}>
        <Minus size={15} />
      </button>
      <button type="button" className="tabular h-8 min-w-14 rounded-full px-1.5 font-medium hover:bg-on-inverse/10 pointer-coarse:h-9" onClick={() => zoomTo(1)} title={t('Taille ajustée')} aria-label={t('Zoom {n} %, revenir à la taille ajustée', { n: Math.round(zoom * 100) })}>
        {Math.round(zoom * 100)}&nbsp;%
      </button>
      <button type="button" className={btn} disabled={zoom >= ZOOM_MAX} onClick={() => zoomTo(zoom * 1.25)} title={t('Zoomer')} aria-label={t('Zoomer')}>
        <Plus size={15} />
      </button>
      {children}
    </div>
  );
}

/**
 * A PDF drawn page by page with pdf.js, the same in every browser. The browser's own viewer in a frame was
 * blocked by the site's security rules in some browsers, and phones often don't show it inside a page at all.
 * `page`: opened there (a search result), drawn first and scrolled to. Its text is laid over each page (invisible,
 * pdf.js's text layer): it can be selected and copied. Zoom with − / +, Ctrl + wheel or two fingers.
 */
export default function PdfView({ url, title, page: target }: { url: string; title: string; page?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(0);
  const [shown, setShown] = useState(() => Math.max(BATCH, target ?? 0));
  const scrolled = useRef(false);
  const [failed, setFailed] = useState(false);
  const doc = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const lib = useRef<typeof import('pdfjs-dist') | null>(null);
  // The pages' width, followed (a phone turned, a window resized): the pages are drawn again at the new width.
  const [width, setWidth] = useState(0);
  // Height / width of the first page (or the one asked for): the size of the pages not drawn yet.
  const [ratio, setRatio] = useState(1.414);
  const { zoom, zoomTo } = useZoom(box, pagesRef);
  const [current, setCurrent] = useState(1);

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
        lib.current = pdfjs;
        const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
        task = pdfjs.getDocument({ data });
        const d = await task.promise;
        if (cancelled) return;
        doc.current = d;
        const first = (await d.getPage(target && target > 1 && target <= d.numPages ? target : 1)).getViewport({ scale: 1 });
        if (cancelled) return;
        setRatio(first.height / first.width);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the page asked for only matters on opening
  }, [url]);

  const pageWidth = Math.max(1, Math.round(width * zoom));

  // Draw the pages as they come near the screen (on load, at another size, when more are asked for). Until then each
  // one has the size of the first (or the one asked for), so that the page asked for stays in place.
  useEffect(() => {
    const d = doc.current;
    const pdfjs = lib.current;
    const el = box.current;
    if (!d || !pdfjs || !el || !total || width <= 0) return;
    let cancelled = false;
    let rendering: import('pdfjs-dist').RenderTask | null = null;
    const at = String(pageWidth); // a page drawn at another size (or not finished) is drawn again
    const queued = new Set<HTMLElement>();
    const goTo = target && target > 1 && target <= Math.min(total, shown) && !scrolled.current ? target : 0;
    let queue = Promise.resolve();
    // One page at a time, in the order they come into view.
    const draw = (wrap: HTMLElement) => {
      if (wrap.dataset.drawn === at || queued.has(wrap)) return;
      queued.add(wrap);
      queue = queue.then(async () => {
        if (cancelled) return;
        const page = await d.getPage(Number(wrap.dataset.page));
        if (cancelled) return;
        const scale = pageWidth / page.getViewport({ scale: 1 }).width;
        const css = page.getViewport({ scale });
        const px = Math.min(window.devicePixelRatio || 1, 2, MAX_CANVAS / Math.max(css.width, css.height));
        const canvas = wrap.querySelector('canvas')!;
        canvas.width = Math.floor(css.width * px);
        canvas.height = Math.floor(css.height * px);
        Object.assign(wrap.style, { width: `${css.width}px`, height: `${css.height}px` });
        rendering = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: page.getViewport({ scale: scale * px }) });
        const ok = await rendering.promise.then(() => true).catch(() => false);
        rendering = null;
        if (!ok || cancelled) return;
        wrap.dataset.drawn = at;
        // The words, invisible over the drawing (drawn again with it, at its size).
        const layer = wrap.querySelector<HTMLElement>('.textLayer')!;
        layer.replaceChildren();
        wrap.style.setProperty('--total-scale-factor', String(scale));
        await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: css }).render().catch(() => undefined);
      });
      // Closed while drawing (pdf.js: « Transport destroyed »): nothing left to draw.
      queue = queue.catch(() => undefined);
    };
    const waiting = [...el.querySelectorAll<HTMLElement>('[data-page]')].filter(w => w.dataset.drawn !== at);
    if (goTo) {
      el.querySelector(`[data-page="${goTo}"]`)?.scrollIntoView({ block: 'start' });
      scrolled.current = true;
    }
    const io = new IntersectionObserver(entries => entries.forEach(e => e.isIntersecting && draw(e.target as HTMLElement)), { root: el, rootMargin: '100% 50%' });
    waiting.forEach(w => io.observe(w));
    return () => {
      cancelled = true;
      io.disconnect();
      rendering?.cancel();
    };
  }, [total, shown, target, width, pageWidth]);

  // « 3 / 12 »: the page at the top third of the view.
  useEffect(() => {
    const el = box.current;
    if (!el || !total) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const line = el.getBoundingClientRect().top + el.clientHeight / 3;
        let n = 1;
        for (const w of el.querySelectorAll<HTMLElement>('[data-page]')) {
          if (w.getBoundingClientRect().top > line) break;
          n = Number(w.dataset.page);
        }
        setCurrent(n);
      });
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
    };
  }, [total, pageWidth]);

  if (failed)
    return <p className="rounded-md bg-surface px-6 py-10 text-center text-[13px] text-stone-600 shadow-2xl">{t('Impossible d’afficher ce PDF. Télécharge-le pour l’ouvrir.')}</p>;

  return (
    <div className="relative">
      <div ref={box} role="document" aria-label={title} className="h-[min(82vh,calc(100dvh-8rem))] w-[min(1000px,calc(100vw-2rem))] touch-pan-x touch-pan-y overflow-auto rounded-md [scrollbar-gutter:stable] bg-stone-200 p-4 pb-16 shadow-2xl max-sm:p-2 max-sm:pb-16">
        {!total && (
          <div className="flex h-full items-center justify-center text-stone-500">
            <Loader2 size={22} className="animate-spin" />
          </div>
        )}
        <div ref={pagesRef} className="w-max min-w-full">
          {Array.from({ length: Math.min(total, shown) }, (_, i) => (
            <div
              key={i}
              data-page={i + 1}
              className="pdf-page relative mx-auto mb-4 bg-white shadow last:mb-0"
              style={{ width: pageWidth, height: Math.round(pageWidth * ratio) }}
            >
              <canvas aria-label={t('Page {page} sur {total}', { page: i + 1, total })} className="block h-full w-full" />
              <div className="textLayer" />
            </div>
          ))}
        </div>
        {total > shown && (
          <button type="button" className="btn-secondary mx-auto mt-2 flex" onClick={() => setShown(s => s + BATCH)}>
            {t('Afficher les pages suivantes ({shown} sur {total})', { shown, total })}
          </button>
        )}
      </div>
      {total > 0 && (
        <ZoomBar zoom={zoom} zoomTo={zoomTo}>
          <span className="mx-1 h-4 w-px bg-on-inverse/20" aria-hidden />
          <span className="tabular px-2 font-medium" aria-label={t('Page {page} sur {total}', { page: current, total })}>
            {current} / {total}
          </span>
        </ZoomBar>
      )}
    </div>
  );
}
