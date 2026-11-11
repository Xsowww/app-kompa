import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotes } from '../store/notes';
import { toast } from '../store/ui';
import { sharedNote, takeShared } from '../lib/shareTarget';
import { linkToNote } from '../copilot/actions';
import { t, tn } from '../i18n';

/** Read once per share, even when React runs the page's effect twice (development). */
let receiving: Promise<{ note: string | null; files: number }> | null = null;

async function receive(params: URLSearchParams) {
  const { text, files } = await takeShared(params);
  const made = sharedNote(text);
  const note = made ? useNotes.getState().createNote(made).id : null;
  let count = 0;
  if (files.length) {
    const { uploadPending } = await import('./drive/upload');
    count = (await uploadPending(files.map(file => ({ file, dirs: [] })), null).catch(() => ({ count: 0 }))).count;
  }
  return { note, files: count };
}

/**
 * /partage: a text, a link or files shared from another app to the installed Kompaly (manifest's share_target).
 * A text or a link becomes a new note, files go to the Drive; then the page opens where they are.
 */
export default function SharePage() {
  const navigate = useNavigate();
  useEffect(() => {
    // What was kept can't be read (storage refused in private browsing, a damaged entry): said as « rien n’est arrivé »,
    // rather than this page left on « Ajout… » for good.
    receiving ??= receive(new URLSearchParams(location.search)).catch(() => ({ note: null, files: 0 }));
    let alive = true;
    void receiving.then(({ note, files }) => {
      receiving = null;
      if (!alive) return;
      const filesText = tn(files, '{n} fichier ajouté à tes fichiers', '{n} fichiers ajoutés à tes fichiers');
      if (note) {
        navigate(linkToNote(note), { replace: true });
        toast(files ? `${t('Note créée avec ce qui a été partagé')} · ${filesText}` : t('Note créée avec ce qui a été partagé'), 'success', files ? { label: t('Voir mes fichiers'), run: () => navigate('/drive') } : undefined);
      } else if (files) {
        navigate('/drive', { replace: true });
        toast(filesText, 'success');
      } else {
        navigate('/', { replace: true });
        toast(t('Rien n’est arrivé de ce partage. Réessaie depuis l’autre appli.'), 'error');
      }
    });
    return () => {
      alive = false;
    };
  }, [navigate]);
  return (
    <p role="status" className="p-6 text-center text-[13px] text-stone-500">
      {t('Ajout de ce qui a été partagé…')}
    </p>
  );
}
