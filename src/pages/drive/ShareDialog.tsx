import { useState } from 'react';
import { Check, Copy, Link2, Loader2 } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { supabase, cloudEnabled } from '../../lib/supabase';
import { blobKey } from '../../lib/userStorage';
import { toast } from '../../store/ui';
import { cx } from '../../lib/utils';
import type { DriveItem } from '../../store/drive';

const DURATIONS = [
  { days: 1, label: '1 jour' },
  { days: 7, label: '7 jours' },
  { days: 30, label: '30 jours' },
];

/**
 * Temporary download link for one file (Supabase Storage signed URL). Anyone with the link
 * can open the file until it expires, or until the file goes to the trash (its content moves, see drive.ts).
 */
export default function ShareDialog({ item, onClose }: { item: DriveItem; onClose: () => void }) {
  const [days, setDays] = useState(7);
  const [link, setLink] = useState<{ url: string; days: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast('Lien copié dans le presse-papiers', 'success');
    } catch {
      toast('Copie impossible : sélectionne le lien et copie-le à la main', 'error');
    }
  };

  const create = async () => {
    if (!supabase) return;
    setBusy(true);
    // Files live under "<userId>/<itemId>" in the private "drive" bucket (see blobStore).
    const { data, error } = await supabase.storage.from('drive').createSignedUrl(blobKey(item.id).replace(':', '/'), days * 86400);
    setBusy(false);
    if (error || !data) return toast("Impossible de créer le lien. Le fichier est-il bien synchronisé ?", 'error');
    setLink({ url: data.signedUrl, days });
    setCopied(false);
    await copy(data.signedUrl);
  };

  return (
    <Modal open onClose={onClose} width={460}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Link2 size={16} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">Partager le lien</h3>
          <p className="truncate text-[12px] text-stone-500">{item.name}</p>
        </div>
      </div>

      {!cloudEnabled ? (
        <p className="mt-4 rounded-lg bg-stone-50 px-3.5 py-3 text-[13px] leading-relaxed text-stone-600">
          Le partage par lien n’existe que dans la version en ligne de Kompaly.
        </p>
      ) : (
        <>
          <p className="mt-4 text-[13px] text-stone-600">Toute personne qui a le lien pourra télécharger ce fichier, sans compte.</p>
          <p className="eyebrow mt-4">Le lien expire dans</p>
          <div className="mt-1.5 flex h-9 w-fit items-center rounded-lg bg-stone-100 p-0.5 text-[13px] pointer-coarse:h-10">
            {DURATIONS.map(d => (
              <button
                key={d.days}
                onClick={() => setDays(d.days)}
                className={cx('h-8 rounded-md px-3 font-medium transition-colors pointer-coarse:h-9', days === d.days ? 'bg-surface text-ink shadow-card' : 'text-stone-500 hover:text-ink')}
              >
                {d.label}
              </button>
            ))}
          </div>
          {link && (
            <div className="mt-4">
              <div className="flex gap-2">
                <input readOnly value={link.url} onFocus={e => e.target.select()} className="field min-w-0 flex-1 font-mono text-[11.5px] text-stone-600" />
                <button className="btn-secondary" onClick={() => void copy(link.url)}>
                  {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />} {copied ? 'Copié' : 'Copier'}
                </button>
              </div>
              <p className="mt-1.5 text-[12px] text-stone-500">
                Valable {link.days === 1 ? '24 heures' : `${link.days} jours`}. Mettre le fichier à la corbeille coupe le lien.
              </p>
            </div>
          )}
        </>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          Fermer
        </button>
        <button className="btn-primary" disabled={!cloudEnabled || busy} onClick={() => void create()}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} {link ? 'Nouveau lien' : 'Créer le lien'}
        </button>
      </div>
    </Modal>
  );
}
