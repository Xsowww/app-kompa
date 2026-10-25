// « Fiche depuis une photo » : photos of notes (handwritten or printed) → read by the AI (server/photo.mjs) →
// a sheet to check and correct → a PDF in the Drive, or downloaded.

import { useEffect, useRef, useState } from 'react';
import { Camera, FileDown, ImagePlus, Loader2, ScanText, X } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { useDrive } from '../../store/drive';
import { saveBlob } from './download';
import { toast } from '../../store/ui';
import { CoursError, readPhotoSheet } from '../../lib/recorder/api';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';

const MAX_PHOTOS = 4;

/** A photo made lighter (1600 px at most, JPEG): enough to read handwriting on a full page, quick to send from a phone. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.8);
}

const sheetTitle = (md: string) => /^#\s+(.+)$/m.exec(md)?.[1].replace(/[*_`#]/g, '').trim().slice(0, 80) || t('Fiche');

function failure(e: unknown): string {
  const code = e instanceof CoursError ? e.code : '';
  if (code === 'disabled' || code === 'http_404') return t('La lecture des photos n’est pas encore activée sur Kompaly.');
  if (code === 'daily_limit' || code === 'site_limit') return t('Limite du jour atteinte : réessaie demain.');
  if (code === 'rate_limited') return t('Beaucoup de demandes en ce moment : réessaie dans une minute.');
  if (code === 'too_large') return t('Photos trop lourdes : enlève-en une et réessaie.');
  // 524: Cloudflare gave up waiting for the server.
  if (code === 'timeout' || code === 'http_504' || code === 'http_524') return t('La lecture a pris trop de temps. Réessaie, une photo à la fois.');
  if (code === 'network') return t('Pas de réponse. Vérifie ta connexion et réessaie.');
  return t('La lecture n’a pas marché. Réessaie avec une photo plus nette.');
}

export default function PhotoSheetDialog({ folderId, onClose }: { folderId: string | null; onClose: () => void }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [step, setStep] = useState<'pick' | 'reading' | 'check'>('pick');
  const [md, setMd] = useState('');
  const [html, setHtml] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'check' && !editing) void import('../../lib/docx').then(m => setHtml(m.markdownToHtml(md)));
  }, [step, editing, md]);

  const add = async (files: FileList | null) => {
    const list = [...(files ?? [])].filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!list.length) return;
    setError('');
    const room = MAX_PHOTOS - photos.length;
    if (list.length > room) toast(t('{n} photos au plus par fiche.', { n: MAX_PHOTOS }), 'info');
    const out: string[] = [];
    for (const f of list.slice(0, Math.max(0, room))) {
      try {
        out.push(await shrink(f));
      } catch {
        setError(t('« {name} » n’a pas pu être ouverte : essaie une photo en JPEG ou PNG.', { name: f.name }));
      }
    }
    setPhotos(p => [...p, ...out].slice(0, MAX_PHOTOS));
  };

  const read = async () => {
    setStep('reading');
    setError('');
    try {
      setMd(await readPhotoSheet(photos));
      setEditing(false);
      setStep('check');
    } catch (e) {
      setError(failure(e));
      setStep('pick');
    }
  };

  const pdf = async () => {
    const { markdownToPdf } = await import('../../lib/fichePdf');
    const title = sheetTitle(md);
    return new File([await markdownToPdf(md, { title })], `${title.replace(/[/\\:*?"<>|]/g, '-')}.pdf`, { type: 'application/pdf' });
  };

  const save = async () => {
    setSaving(true);
    try {
      const [item] = await useDrive.getState().uploadFiles([await pdf()], folderId);
      if (item) {
        toast(t('Fiche enregistrée dans le Drive : {name}', { name: item.name }), 'success');
        onClose();
      }
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : t('La fiche n’a pas pu être enregistrée.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    const file = await pdf();
    saveBlob(file, file.name);
  };

  return (
    <Modal open onClose={() => step !== 'reading' && !saving && onClose()} width={step === 'check' ? 640 : 460}>
      <h3 className="flex items-center gap-2 text-[15px] font-semibold">
        <ScanText size={17} /> {t('Fiche depuis une photo')}
      </h3>

      {step !== 'check' ? (
        <>
          <p className="mt-1 text-[13px] text-stone-500">{t('Notes à la main, page imprimée, tableau : Kompaly lit tout et en fait une fiche en PDF.')}</p>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => void add(e.target.files).then(() => (e.target.value = ''))} />
          <input ref={gallery} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={e => void add(e.target.files).then(() => (e.target.value = ''))} />
          {photos.length > 0 && (
            <ul className="mt-4 grid grid-cols-4 gap-2" aria-label={t('Photos choisies')}>
              {photos.map((p, i) => (
                <li key={i} className="relative aspect-[3/4] overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
                  <img src={p} alt={t('Photo {n}', { n: i + 1 })} className="h-full w-full object-cover" />
                  {step === 'pick' && (
                    <button type="button" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white pointer-coarse:h-8 pointer-coarse:w-8" aria-label={t('Retirer la photo {n}', { n: i + 1 })} onClick={() => setPhotos(list => list.filter((_, j) => j !== i))}>
                      <X size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {step === 'pick' && photos.length < MAX_PHOTOS && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary h-11" onClick={() => camera.current?.click()}>
                <Camera size={16} /> {t('Prendre une photo')}
              </button>
              <button type="button" className="btn-secondary h-11" onClick={() => gallery.current?.click()}>
                <ImagePlus size={16} /> {photos.length ? t('Ajouter') : t('Choisir des photos')}
              </button>
            </div>
          )}
          {step === 'pick' && <p className="mt-2 text-[12px] text-stone-500">{t('Jusqu’à {n} photos, dans l’ordre des pages. Bien à plat, en pleine lumière.', { n: MAX_PHOTOS })}</p>}
          {error && <p className="mt-3 text-[13px] font-medium text-red-600 dark:text-red-400" role="alert">{error}</p>}
          {step === 'reading' && (
            <p className="mt-4 flex items-center gap-2 text-[13px] text-stone-600" role="status">
              <Loader2 size={15} className="animate-spin" /> {t('Lecture des photos… (jusqu’à une minute)')}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={step === 'reading'}>
              {t('Annuler')}
            </button>
            <button type="button" className="btn-primary" disabled={!photos.length || step === 'reading'} onClick={() => void read()}>
              {t('Créer la fiche')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[13px] text-stone-500">{t('Vérifie la fiche : tu peux corriger un mot mal lu.')}</p>
            <div className="flex shrink-0 rounded-lg bg-stone-100 p-0.5 text-[12.5px]" role="group" aria-label={t('Affichage')}>
              {[false, true].map(e => (
                <button key={String(e)} type="button" aria-pressed={editing === e} onClick={() => setEditing(e)} className={cx('rounded-md px-2.5 py-1 font-medium', editing === e ? 'bg-surface text-ink shadow-sm' : 'text-stone-500')}>
                  {e ? t('Modifier') : t('Aperçu||d’un fichier')}
                </button>
              ))}
            </div>
          </div>
          {editing ? (
            <textarea value={md} onChange={e => setMd(e.target.value)} aria-label={t('Texte de la fiche')} className="field mt-3 h-[52vh] w-full resize-none py-2 font-mono text-[13px] leading-relaxed" />
          ) : (
            <div className="doc-preview mt-3 max-h-[52vh] overflow-y-auto rounded-xl border border-stone-200 p-4 text-[14px] leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:border-stone-300 [&_blockquote]:pl-3 [&_blockquote]:text-stone-600 [&_h1]:text-[20px] [&_h1]:font-bold [&_h2]:mt-5 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6" dangerouslySetInnerHTML={{ __html: html }} />
          )}
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button type="button" className="btn-ghost mr-auto" onClick={() => setStep('pick')} disabled={saving}>
              {t('Autres photos')}
            </button>
            <button type="button" className="btn-secondary" onClick={() => void download()} disabled={saving || !md.trim()}>
              <FileDown size={15} /> <span className="max-sm:sr-only">{t('Télécharger')}</span>
            </button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving || !md.trim()}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : null} {t('Enregistrer dans le Drive')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
