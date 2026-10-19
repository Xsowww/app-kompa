import { safeImageBlob } from '../../lib/safeImage';
import { fmt } from '../../lib/dates';
import { useEffect, useRef, useState } from 'react';
import { Download, X, Loader2 } from 'lucide-react';
import { categoryOf, getFileUrl, isPlainText, type DriveItem } from '../../store/drive';
import { downloadItem } from './download';
import { formatBytes, relativeTime } from '../../lib/utils';
import FileIcon from '../../components/FileIcon';
import PdfView from './PdfView';
import { trapTab } from '../../lib/a11y';
import { docxToHtml, pptxSlides, revokeSlides, type Slide } from './officePreview';

// Word documents rendered as a clean page (mammoth's HTML carries no styling of its own). Theme surface, not white:
// the stone-* text turns light in the dark theme.
const PAGE =
  'max-h-[82vh] w-[min(820px,92vw)] overflow-auto rounded-md bg-surface px-8 py-10 text-[14.5px] leading-relaxed text-stone-800 shadow-2xl md:px-16 md:py-14 ' +
  '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-[1.6em] [&_h1]:font-semibold [&_h1]:leading-tight [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[1.3em] [&_h2]:font-semibold ' +
  '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_p]:my-2.5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 ' +
  '[&_a]:text-brand-700 [&_a]:underline [&_img]:my-3 [&_img]:max-w-full [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse ' +
  '[&_td]:border [&_td]:border-stone-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-stone-200 [&_th]:bg-stone-50 [&_th]:px-2 [&_th]:py-1 [&_*:first-child]:mt-0';

/** « il y a 3 min », « hier », « le 3 oct. » */
const when = (iso: string) => {
  const rel = relativeTime(iso);
  return /^\d/.test(rel) ? `le ${rel}` : rel;
};

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/**
 * `getUrl` : d'où vient le contenu (par défaut le Drive personnel ; les groupes donnent le leur).
 * `actions` : boutons en plus dans l'en-tête (la corbeille y met Restaurer / Supprimer).
 */
export default function PreviewModal({
  item,
  onClose,
  getUrl = getFileUrl,
  actions,
}: {
  item: DriveItem;
  onClose: () => void;
  getUrl?: (id: string) => Promise<string | null>;
  actions?: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [failed, setFailed] = useState(false);
  const cat = categoryOf(item);
  // CSV keeps its spreadsheet icon but is shown as text.
  const plain = isPlainText(item);
  // Only the modern Office formats can be read in the browser (.doc / .ppt are binary).
  const office = extOf(item.name) === 'docx' ? 'docx' : extOf(item.name) === 'pptx' ? 'pptx' : null;

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
          URL.revokeObjectURL(original);
          if (!revoked) setMissing(true);
          return;
        }
      }
      current = u;
      setUrl(u);
      if (plain) setText((await (await fetch(u)).text()).slice(0, 200_000));
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
  }, [item.id, item.name, cat, plain, office, getUrl]);

  // Captured and stopped, like Modal: Échap closes the preview only, not Kompaly behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Modal for keyboard users too: focus inside, Tab kept inside, focus back to the file afterwards.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current!;
    const previous = document.activeElement as HTMLElement | null;
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onTab = (e: KeyboardEvent) => trapTab(e, el);
    document.addEventListener('keydown', onTab);
    return () => {
      document.removeEventListener('keydown', onTab);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={`Aperçu de ${item.name}`} className="fixed inset-0 z-[60] flex flex-col bg-[#0c0a09]/85" onMouseDown={onClose}>
      <header className="flex items-center gap-2 bg-[#0c0a09] px-3 py-3 text-white sm:gap-3 sm:px-5" onMouseDown={e => e.stopPropagation()}>
        <FileIcon category={cat} size={30} ext={item.name.split('.').pop()} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{item.name}</p>
          <p className="truncate text-[12px] text-white/65">
            {formatBytes(item.size)} · {item.deletedAt ? `supprimé le ${fmt(new Date(item.deletedAt), "d MMM 'à' HH:mm")}` : `modifié ${when(item.updatedAt)}`}
          </p>
        </div>
        {actions}
        <button onClick={() => downloadItem(item, getUrl)} className="btn h-8 bg-white/10 text-white hover:bg-white/20 max-sm:w-9 max-sm:px-0" aria-label="Télécharger">
          <Download size={15} /> <span className="hidden sm:inline">Télécharger</span>
        </button>
        <button data-autofocus onClick={onClose} className="rounded-md p-2.5 text-white/70 hover:bg-white/10 hover:text-white" title="Fermer (Échap)" aria-label="Fermer (Échap)">
          <X size={18} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-8">
        <div className="flex max-h-full max-w-full items-center justify-center" onMouseDown={e => e.stopPropagation()}>
          {missing ? (
            <p className="max-w-sm text-center text-white/70">Impossible d’afficher ce fichier. Vérifie ta connexion, puis réessaie.</p>
          ) : !url ? (
            <Loader2 className="animate-spin text-white/70" />
          ) : cat === 'image' ? (
            <img src={url} alt={item.name} className="max-h-[80vh] max-w-full rounded-md object-contain shadow-2xl" />
          ) : cat === 'pdf' ? (
            <PdfView url={url} title={item.name} />
          ) : cat === 'video' ? (
            <video src={url} controls autoPlay className="max-h-[80vh] max-w-full rounded-md" />
          ) : cat === 'audio' ? (
            <audio src={url} controls autoPlay />
          ) : office && !failed ? (
            office === 'docx' ? (
              html === null ? (
                <Loader2 className="animate-spin text-white/70" />
              ) : (
                <article className={PAGE} dangerouslySetInnerHTML={{ __html: html || '<p>Document vide.</p>' }} />
              )
            ) : slides === null ? (
              <Loader2 className="animate-spin text-white/70" />
            ) : (
              <div className="max-h-[82vh] w-[min(860px,92vw)] space-y-4 overflow-auto pb-2">
                {slides.length === 0 && <p className="text-center text-white/70">Cette présentation ne contient aucune diapositive.</p>}
                {slides.map((s, i) => (
                  <section key={i} className="rounded-lg bg-surface p-6 shadow-2xl md:p-8">
                    <p className="tabular text-[11px] font-medium uppercase tracking-wide text-stone-500">
                      Diapositive {i + 1}/{slides.length}
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
                    {!s.title && !s.paragraphs.length && !s.images.length && <p className="mt-3 text-[13px] text-stone-500">Diapositive sans texte.</p>}
                  </section>
                ))}
              </div>
            )
          ) : plain ? (
            <pre className="max-h-[80vh] w-[min(900px,92vw)] overflow-auto rounded-md bg-surface p-5 font-mono text-[12px] text-stone-800">{text || <span className="font-sans text-stone-500">Ce fichier est vide.</span>}</pre>
          ) : (
            <div className="rounded-xl bg-surface p-10 text-center">
              <FileIcon category={cat} size={64} ext={item.name.split('.').pop()} />
              <p className="mt-4 text-[14px] font-medium">{failed ? 'Ce fichier n’a pas pu être lu' : 'Pas d’aperçu pour ce type de fichier'}</p>
              {(cat === 'doc' || cat === 'slides') && !failed && <p className="mt-1 text-[13px] text-stone-500">L’aperçu fonctionne avec les formats .docx et .pptx.</p>}
              <button onClick={() => downloadItem(item, getUrl)} className="btn-primary mt-4">
                <Download size={15} /> Télécharger
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
