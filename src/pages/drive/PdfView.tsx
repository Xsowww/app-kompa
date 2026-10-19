import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { loadPdfjs } from '../../lib/pdf';
import { t } from '../../i18n';

const BATCH = 20; // pages drawn at once; more on demand

/**
 * A PDF drawn page by page with pdf.js, the same in every browser. The browser's own viewer in a frame was
 * blocked by the site's security rules in some browsers, and phones often don't show it inside a page at all.
 */
export default function PdfView({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(0);
  const [shown, setShown] = useState(BATCH);
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

  // Draw the pages that are not drawn yet (on load, then when more are asked for).
  useEffect(() => {
    const d = doc.current;
    const el = box.current;
    if (!d || !el || !total) return;
    let cancelled = false;
    void (async () => {
      const width = el.clientWidth - 32;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= Math.min(total, shown) && !cancelled; n++) {
        const canvas = el.querySelector<HTMLCanvasElement>(`canvas[data-page="${n}"]`);
        if (!canvas || canvas.dataset.drawn) continue;
        const page = await d.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / ratio}px`;
        canvas.style.height = `${viewport.height / ratio}px`;
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise.catch(() => undefined);
        canvas.dataset.drawn = '1';
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [total, shown]);

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
