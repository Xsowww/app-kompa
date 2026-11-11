import { safeImageBlob } from '../../lib/safeImage';
import { fmt } from '../../lib/dates';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, FileText, X, Loader2 } from 'lucide-react';
import { categoryOf, getFileUrl, isPlainText, type DriveItem } from '../../store/drive';
import { downloadItem } from './download';
import { cx, formatBytes, relativeWhen } from '../../lib/utils';
import FileIcon from '../../components/FileIcon';
import PdfView, { ZoomBar } from './PdfView';
import { useZoom } from './zoom';
import { trapTab } from '../../lib/a11y';
import { docxToHtml, pptxSlides, revokeSlides, type Slide } from './officePreview';
import { csvSheet, MAX_ROWS, xlsxSheets, type Sheet } from './sheets';
import { t } from '../../i18n';

// A page in the theme's colour (not white: the stone-* text turns light in the dark theme), never see-through: the
// glass styles' surface is, so it is laid on the page's own colour.
const OPAQUE = 'bg-paper [background-image:linear-gradient(var(--color-surface),var(--color-surface))]';
// Word documents rendered as a clean page (mammoth's HTML carries no styling of its own). A long link or word wraps.
const PAGE =
  `doc-preview max-h-[82vh] w-[min(820px,92vw)] overflow-auto rounded-md ${OPAQUE} break-words px-8 py-10 text-[14.5px] leading-relaxed text-stone-800 shadow-2xl md:px-16 md:py-14 ` +
  '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-[1.6em] [&_h1]:font-bold [&_h1]:leading-tight [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[1.3em] [&_h2]:font-semibold ' +
  '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_p]:my-2.5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 ' +
  '[&_a]:text-brand-700 [&_a]:underline [&_img]:my-3 [&_img]:max-w-full [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse ' +
  '[&_td]:border [&_td]:border-stone-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-stone-200 [&_th]:bg-stone-50 [&_th]:px-2 [&_th]:py-1 [&_*:first-child]:mt-0';

/** « modifié il y a 3 min », « modifié hier », « modifié le 3 oct. » */
const modified = (iso: string) => t('modifié {time}', { time: relativeWhen(iso) });

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/** The dialog on top of the others (a confirmation opened from the preview's header sits over it). */
const onTop = (el: HTMLElement | null) => {
  const dialogs = document.querySelectorAll('[aria-modal="true"]');
  return !!el && dialogs[dialogs.length - 1] === el;
};

/**
 * `getUrl` : d'où vient le contenu (par défaut le Drive personnel ; les groupes donnent le leur).
 * `when` : remplace « modifié … » sous le nom.
 * `actions` : boutons en plus dans l'en-tête (la corbeille y met Restaurer / Supprimer).
 * `onPrev` / `onNext` : le fichier d'avant / d'après dans la liste (← → aussi).
 * `notes` : les notes liées à ce fichier.
 */
export default function PreviewModal({
  item,
  onClose,
  getUrl = getFileUrl,
  actions,
  when,
  page,
  onPrev,
  onNext,
  notes,
}: {
  item: DriveItem;
  onClose: () => void;
  getUrl?: (id: string) => Promise<string | null>;
  actions?: React.ReactNode;
  /** Replaces « modifié … » under the name (a group file says who shared it). */
  when?: string;
  /** A PDF opens on this page (a search result found there). */
  page?: number;
  onPrev?: () => void;
  onNext?: () => void;
  notes?: { id: string; title: string }[];
}) {
  const cat = categoryOf(item);
  const rootRef = useRef<HTMLDivElement>(null);
  const nav = useRef({ onPrev, onNext, onClose });
  useEffect(() => {
    nav.current = { onPrev, onNext, onClose };
  });

  // Captured and stopped, like Modal: Échap closes the preview only, not Kompaly behind it (nor the preview when a
  // confirmation is open over it). ← → go to the file before / after.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!onTop(rootRef.current)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        nav.current.onClose();
        return;
      }
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement;
      // Typing, a video's own keys, or text being selected in a PDF (the arrows extend the selection).
      if (el.closest('input, textarea, select, [contenteditable="true"], video, audio') || getSelection()?.toString()) return;
      const go = e.key === 'ArrowLeft' ? nav.current.onPrev : nav.current.onNext;
      if (!go) return;
      e.preventDefault();
      e.stopPropagation();
      go();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // Modal for keyboard users too: focus inside, Tab kept inside, focus back to the file afterwards.
  useEffect(() => {
    const el = rootRef.current!;
    const previous = document.activeElement as HTMLElement | null;
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onTab = (e: KeyboardEvent) => onTop(el) && trapTab(e, el);
    document.addEventListener('keydown', onTab);
    return () => {
      document.removeEventListener('keydown', onTab);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Phones: in the bottom corners, not over the middle of the text (the file fills the width there).
  const side = 'absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white/85 transition-colors hover:bg-black/70 hover:text-white max-sm:top-auto max-sm:bottom-3 max-sm:h-10 max-sm:w-10 max-sm:translate-y-0';
  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={t('Aperçu de {name}', { name: item.name })} className="fixed inset-0 z-[60] flex flex-col bg-[#0c0a09]/85" onMouseDown={onClose}>
      <header className="flex items-center gap-2 bg-[#0c0a09] px-3 py-3 text-white sm:gap-3 sm:px-5" onMouseDown={e => e.stopPropagation()}>
        <FileIcon category={cat} size={30} ext={item.name.split('.').pop()} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium" title={item.name}>{item.name}</p>
          <p className="truncate text-[12px] text-white/65">
            {formatBytes(item.size)} · {item.deletedAt ? t('supprimé le {date}', { date: fmt(new Date(item.deletedAt), t("d MMM 'à' HH:mm")) }) : (when ?? modified(item.updatedAt))}
          </p>
        </div>
        {actions}
        <button onClick={() => downloadItem(item, getUrl)} className="btn h-8 bg-white/10 text-white hover:bg-white/20 max-sm:w-9 max-sm:px-0" aria-label={t('Télécharger')}>
          <Download size={15} /> <span className="hidden sm:inline">{t('Télécharger')}</span>
        </button>
        <button data-autofocus onClick={onClose} className="rounded-md p-2.5 text-white/70 hover:bg-white/10 hover:text-white" title={t('Fermer (Échap)')} aria-label={t('Fermer (Échap)')}>
          <X size={18} />
        </button>
      </header>
      {notes && notes.length > 0 && (
        <nav aria-label={t('Notes liées')} className="flex flex-wrap items-center gap-1.5 bg-[#0c0a09] px-3 pb-2.5 text-[12px] text-white/70 sm:px-5" onMouseDown={e => e.stopPropagation()}>
          <span className="shrink-0 font-medium">{t('Notes liées')}</span>
          {notes.map(n => (
            <Link key={n.id} to={`/notes?note=${n.id}`} className="flex h-7 min-w-0 max-w-56 items-center gap-1.5 rounded-full bg-white/10 px-2.5 text-white/90 hover:bg-white/20 pointer-coarse:h-9">
              <FileText size={13} className="shrink-0" aria-hidden />
              <span className="truncate">{n.title || t('Sans titre')}</span>
            </Link>
          ))}
        </nav>
      )}
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4 md:p-8">
        {onPrev && (
          <button type="button" className={cx(side, 'left-2 md:left-4')} onMouseDown={e => e.stopPropagation()} onClick={onPrev} title={t('Fichier précédent (←)')} aria-label={t('Fichier précédent')}>
            <ChevronLeft size={22} />
          </button>
        )}
        <div className="flex max-h-full max-w-full items-center justify-center" onMouseDown={e => e.stopPropagation()}>
          <PreviewBody key={item.id} item={item} getUrl={getUrl} page={page} onClose={onClose} />
        </div>
        {onNext && (
          <button type="button" className={cx(side, 'right-2 md:right-4')} onMouseDown={e => e.stopPropagation()} onClick={onNext} title={t('Fichier suivant (→)')} aria-label={t('Fichier suivant')}>
            <ChevronRight size={22} />
          </button>
        )}
      </div>
    </div>
  );
}

/** The file itself, read again for each file (keyed by its id in the preview). */
function PreviewBody({ item, getUrl, page, onClose }: { item: DriveItem; getUrl: (id: string) => Promise<string | null>; page?: number; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [failed, setFailed] = useState(false);
  const cat = categoryOf(item);
  const ext = extOf(item.name);
  // Tables: Excel (.xlsx, read with jszip) and CSV / TSV. The other spreadsheets (.xls, .ods) are binary or zipped XML
  // of another kind: offered for download.
  const table = ext === 'xlsx' ? 'xlsx' : ext === 'csv' || ext === 'tsv' ? 'csv' : null;
  const plain = isPlainText(item) && !table;
  // Only the modern Office formats can be read in the browser (.doc / .ppt are binary).
  const office = ext === 'docx' ? 'docx' : ext === 'pptx' ? 'pptx' : null;

  useEffect(() => {
    let revoked = false;
    let current: string | null = null;
    let built: Slide[] = [];
    void getUrl(item.id).then(async u => {
      if (revoked) return u && URL.revokeObjectURL(u);
      if (!u) return setMissing(true);
      if (cat === 'pdf') {
        // Le type vient de celui qui a envoyé le fichier : un « .pdf » qui serait en fait du HTML
        // s'exécuterait dans le cadre. On impose le type PDF avant de l'afficher.
        const pdf = new Blob([await (await fetch(u)).blob()], { type: 'application/pdf' });
        URL.revokeObjectURL(u);
        if (revoked) return;
        u = URL.createObjectURL(pdf);
      }
      if (cat === 'image') {
        const original = u;
        try {
          const img = await safeImageBlob(await (await fetch(original)).blob(), item.name);
          URL.revokeObjectURL(original);
          if (revoked) return;
          u = URL.createObjectURL(img);
        } catch {
          // A drawing that can't be read: the download stays offered.
          URL.revokeObjectURL(original);
          if (!revoked) setFailed(true);
          return;
        }
      }
      current = u;
      setUrl(u);
      if (plain) setText((await (await fetch(u)).text()).slice(0, 200_000));
      if (table) {
        try {
          const res = await fetch(u);
          const s = table === 'xlsx' ? await xlsxSheets(await res.arrayBuffer()) : [csvSheet(await res.text(), item.name, ext === 'tsv' ? '\t' : undefined)];
          if (!revoked) setSheets(s);
        } catch {
          if (!revoked) setFailed(true);
        }
      }
      if (office) {
        try {
          const blob = await (await fetch(u)).blob();
          if (office === 'docx') {
            const h = await docxToHtml(blob);
            if (!revoked) setHtml(h);
          } else {
            const s = await pptxSlides(blob);
            if (revoked) revokeSlides(s);
            else {
              built = s;
              setSlides(s);
            }
          }
        } catch {
          if (!revoked) setFailed(true);
        }
      }
    });
    return () => {
      revoked = true;
      if (current) URL.revokeObjectURL(current);
      revokeSlides(built);
    };
  }, [item.id, item.name, cat, ext, plain, office, table, getUrl]);

  return missing ? (
    <p className="max-w-sm text-center text-white/70">{t('Impossible d’afficher ce fichier. Vérifie ta connexion, puis réessaie.')}</p>
  ) : !url ? (
    failed ? <p className="max-w-sm text-center text-white/70">{t('Ce fichier n’a pas pu être lu')}</p> : <Loader2 className="animate-spin text-white/70" />
  ) : cat === 'image' && !failed ? (
    // A damaged or mislabelled picture: say so instead of a broken image.
    <ZoomImage url={url} name={item.name} onError={() => setFailed(true)} onBackdrop={onClose} />
  ) : cat === 'pdf' ? (
    <PdfView url={url} title={item.name} page={page} />
  ) : cat === 'video' ? (
    <video src={url} controls autoPlay className="max-h-[80vh] max-w-full rounded-md" />
  ) : cat === 'audio' ? (
    <audio src={url} controls autoPlay />
  ) : table && !failed ? (
    sheets === null ? <Loader2 className="animate-spin text-white/70" /> : <SheetView sheets={sheets} />
  ) : office && !failed ? (
    office === 'docx' ? (
      html === null ? (
        <Loader2 className="animate-spin text-white/70" />
      ) : (
        <article className={PAGE} dangerouslySetInnerHTML={{ __html: html || `<p>${t('Document vide.')}</p>` }} />
      )
    ) : slides === null ? (
      <Loader2 className="animate-spin text-white/70" />
    ) : (
      <div className="doc-preview max-h-[82vh] w-[min(860px,92vw)] space-y-4 overflow-auto pb-2">
        {slides.length === 0 && <p className="text-center text-white/70">{t('Cette présentation ne contient aucune diapositive.')}</p>}
        {slides.map((s, i) => (
          <section key={i} className={`rounded-lg ${OPAQUE} p-6 shadow-2xl [overflow-wrap:anywhere] md:p-8`}>
            <p className="tabular text-[11px] font-medium uppercase tracking-wide text-stone-500">
              {t('Diapositive {n}/{total}', { n: i + 1, total: slides.length })}
            </p>
            {s.title && <h2 className="mt-2 text-[20px] font-semibold leading-snug tracking-[-0.01em] text-ink">{s.title}</h2>}
            {s.paragraphs.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-[14px] leading-relaxed text-stone-700">
                {s.paragraphs.map((p, j) => (
                  <li key={j} className="flex gap-2" style={{ paddingLeft: p.level * 18 }}>
                    <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-stone-400" />
                    <span>{p.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {s.images.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {s.images.map(src => (
                  <img key={src} src={src} alt="" className="max-h-56 max-w-full rounded border border-stone-200 object-contain" />
                ))}
              </div>
            )}
            {!s.title && !s.paragraphs.length && !s.images.length && <p className="mt-3 text-[13px] text-stone-500">{t('Diapositive sans texte.')}</p>}
          </section>
        ))}
      </div>
    )
  ) : plain ? (
    <pre className={`max-h-[80vh] w-[min(900px,92vw)] overflow-y-auto whitespace-pre-wrap rounded-md ${OPAQUE} p-5 font-mono text-[12px] text-stone-800 [overflow-wrap:anywhere] max-sm:p-4`}>{text || <span className="font-sans text-stone-500">{t('Ce fichier est vide.')}</span>}</pre>
  ) : (
    <div className={`rounded-xl ${OPAQUE} p-10 text-center`}>
      <FileIcon category={cat} size={64} ext={item.name.split('.').pop()} />
      <p className="mt-4 text-[14px] font-medium">{failed ? t('Ce fichier n’a pas pu être lu') : t('Pas d’aperçu pour ce type de fichier')}</p>
      {(cat === 'doc' || cat === 'slides') && !failed && <p className="mt-1 text-[13px] text-stone-500">{t('L’aperçu fonctionne avec les formats .docx et .pptx.')}</p>}
      {cat === 'sheet' && !failed && <p className="mt-1 text-[13px] text-stone-500">{t('L’aperçu fonctionne avec les formats .xlsx et .csv.')}</p>}
      <button onClick={() => downloadItem(item, getUrl)} className="btn-primary mt-4">
        <Download size={15} /> {t('Télécharger')}
      </button>
    </div>
  );
}

/** A picture that fits the screen, zoomed with a click, − / +, Ctrl + wheel or two fingers (then moved by scrolling). */
function ZoomImage({ url, name, onError, onBackdrop }: { url: string; name: string; onError: () => void; onBackdrop: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const { zoom, zoomTo } = useZoom(box, img);
  // The picture's size at zoom 1: as big as it is, or smaller to fit.
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const im = img.current;
      if (!im?.naturalWidth) return;
      const s = Math.min(1, el.clientWidth / im.naturalWidth, el.clientHeight / im.naturalHeight);
      setFit({ w: Math.round(im.naturalWidth * s), h: Math.round(im.naturalHeight * s) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const im = img.current;
    im?.addEventListener('load', measure);
    measure();
    return () => {
      ro.disconnect();
      im?.removeEventListener('load', measure);
    };
  }, []);
  return (
    <div className="relative">
      <div
        ref={box}
        className="flex h-[min(80vh,calc(100dvh-9rem))] w-[min(1100px,calc(100vw-2rem))] touch-pan-x touch-pan-y overflow-auto"
        // Beside the picture (a small one leaves room around it): closes, like the dark veil.
        onMouseDown={e => e.target === e.currentTarget && onBackdrop()}
      >
        <img
          ref={img}
          src={url}
          alt={name}
          draggable={false}
          onError={onError}
          onClick={e => {
            const r = box.current!.getBoundingClientRect();
            zoomTo(zoom > 1 ? 1 : 2, e.clientX - r.left, e.clientY - r.top);
          }}
          className={cx('m-auto max-w-none shrink-0 rounded-md shadow-2xl', zoom > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in')}
          style={fit ? { width: fit.w * zoom, height: fit.h * zoom } : { maxWidth: '100%', maxHeight: '100%' }}
        />
      </div>
      {fit && <ZoomBar zoom={zoom} zoomTo={zoomTo} />}
    </div>
  );
}

/** A spreadsheet's sheets as tables (column letters and row numbers, like a spreadsheet), one sheet at a time. */
function SheetView({ sheets }: { sheets: Sheet[] }) {
  const [at, setAt] = useState(0);
  const sheet = sheets[at];
  const letter = (i: number): string => (i >= 26 ? letter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
  if (!sheet || !sheet.rows.length) return <p className={`rounded-xl ${OPAQUE} px-8 py-10 text-center text-[13px] text-stone-600`}>{t('Ce fichier est vide.')}</p>;
  const width = sheet.rows[0].length;
  return (
    <div className={`flex max-h-[82vh] w-fit min-w-[min(420px,calc(100vw-2rem))] max-w-[min(1100px,calc(100vw-2rem))] flex-col overflow-hidden rounded-md ${OPAQUE} shadow-2xl`}>
      {sheets.length > 1 && (
        <div role="tablist" aria-label={t('Feuilles')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-stone-200 p-1.5">
          {sheets.map((s, i) => (
            <button key={i} role="tab" aria-selected={i === at} onClick={() => setAt(i)} className={cx('h-8 shrink-0 rounded-md px-3 text-[12.5px] font-medium pointer-coarse:h-9', i === at ? 'bg-stone-100 text-ink' : 'text-stone-500 hover:text-ink')}>
              {s.name || t('Feuille {n}', { n: i + 1 })}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-separate border-spacing-0 text-[12.5px] text-stone-800">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 border-b border-r border-stone-200 bg-stone-100 px-2" />
              {Array.from({ length: width }, (_, i) => (
                <th key={i} scope="col" className="sticky top-0 z-10 min-w-16 border-b border-r border-stone-200 bg-stone-100 px-2 py-1 text-center text-[11px] font-medium text-stone-500">
                  {letter(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                <th scope="row" className="tabular sticky left-0 z-10 border-b border-r border-stone-200 bg-stone-100 px-2 text-right text-[11px] font-medium text-stone-500">
                  {r + 1}
                </th>
                {row.map((cell, c) => (
                  <td key={c} title={cell.length > 40 ? cell : undefined} className={cx('max-w-[22rem] truncate border-b border-r border-stone-200 px-2 py-1', /^-?[\d\s.,]+%?$/.test(cell) && 'tabular text-right')}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.more && <p className="shrink-0 border-t border-stone-200 px-3 py-2 text-[12px] text-stone-500">{t('Aperçu des {n} premières lignes : télécharge le fichier pour tout voir.', { n: MAX_ROWS })}</p>}
    </div>
  );
}
