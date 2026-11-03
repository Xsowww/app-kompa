import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../../components/Overlays';
import { useAuth } from '../../store/auth';
import { prefetchGroups, useGroups } from '../../store/groups';
import { toast } from '../../store/ui';
import type { DriveItem } from '../../store/drive';
import { blobStore } from '../../lib/blobStore';
import { blobKey } from '../../lib/userStorage';
import type { Group } from '../../lib/groups';
import { GroupBadge } from './shared';
import { groupWordsNow, shareFiles } from './util';
import { locale, t, tn } from '../../i18n';

/**
 * « Partager dans un groupe… » from the Drive (as from a note): a copy of the files goes to the group chosen here,
 * among those where I may add some (the database checks it again); my files stay private.
 */
export default function ShareToGroupDialog({ items, onClose }: { items: DriveItem[] | null; onClose: () => void }) {
  const me = useAuth(s => s.user?.id);
  const groups = useGroups(s => s.groups);
  const myRoles = useGroups(s => s.myRoles);
  const navigate = useNavigate();
  useEffect(() => {
    if (items) prefetchGroups();
  }, [items]);
  const w = groupWordsNow();
  const list = groups
    .filter(g => g.kind === 'groupe' && (g.ownerId === me || (myRoles[g.id] ?? 'editeur') === 'editeur'))
    .sort((a, b) => a.name.localeCompare(b.name, locale()));

  const share = async (g: Group) => {
    const files = items ?? [];
    onClose();
    const ok = await shareFiles(g, files.map(i => ({ name: i.name, blob: () => blobStore.get(blobKey(i.id)) })));
    if (ok) toast(tn(ok, '{n} fichier partagé avec « {name} »', '{n} fichiers partagés avec « {name} »', { name: g.name }), 'success', { label: t('Voir'), run: () => navigate(`/groupes?g=${g.id}&onglet=fichiers`) });
  };

  return (
    <Modal open={!!items} onClose={onClose} width={420}>
      {items && (
        <div>
          <h3 className="text-[15px] font-semibold">{t('Partager dans {a}…', { a: w.a })}</h3>
          <p className="mt-1 text-[13px] text-stone-500">
            {items.length === 1 ? t('Choisis où mettre une copie de « {name} » ; ton fichier reste privé.', { name: items[0].name }) : t('Choisis où mettre une copie des {n} fichiers ; ils restent privés.', { n: items.length })}
          </p>
          <div className="mt-3 max-h-[320px] overflow-y-auto">
            {list.length === 0 && <p className="p-6 text-center text-[13px] text-stone-500">{t('{none} où tu peux ajouter des fichiers.', { none: w.none })}</p>}
            {list.map(g => (
              <button key={g.id} onClick={() => void share(g)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-stone-50">
                <GroupBadge group={g} size={26} />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{g.name}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button className="btn-secondary" onClick={onClose}>{t('Annuler')}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
