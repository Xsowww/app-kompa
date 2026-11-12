import { useEffect, useState } from 'react';
import { useDrive, driveUsed } from '../../store/drive';
import { QUOTA, SPACE } from '../../lib/blobStore';
import { cloudEnabled, supabase } from '../../lib/supabase';
import { formatBytes, cx } from '../../lib/utils';
import { t, tn } from '../../i18n';

/** The number shown (« 1,5 » for « 1,5 Go »), for the singular or plural of « 1 Go libre », « 12 Ko utilisés ». */
const amount = (bytes: number) => parseFloat(formatBytes(bytes).replace(',', '.'));

/** `inline`: at the end of the Drive's breadcrumb row (computers), on one line. */
export default function StorageGauge({ inline = false }: { inline?: boolean }) {
  const items = useDrive(s => s.items);
  const trash = useDrive(s => s.trash);
  const inTrash = driveUsed([], trash);
  const mine = driveUsed(items, trash);
  // Online, the files sent to groups count too (storage_used: what the limit itself counts).
  const [online, setOnline] = useState(0);
  useEffect(() => {
    let live = true;
    void supabase?.rpc('storage_used').then(r => live && !r.error && setOnline(Number(r.data) || 0), () => {});
    return () => {
      live = false;
    };
  }, [mine]);
  const used = Math.max(mine, online);
  const share = Math.min(1, used / SPACE);
  const left = Math.max(0, SPACE - used);
  const tone = share >= 0.95 ? 'bg-red-500' : share >= 0.8 ? 'bg-amber-500' : 'bg-brand-500';

  // Local version: files stay in this browser, whose room has nothing to do with the online 1 GB.
  if (!cloudEnabled && !QUOTA)
    return used === 0 ? null : (
      <div className={cx('tabular text-[12px] text-stone-500', inline ? 'truncate' : 'mb-4')}>
        <span className="font-medium text-ink">{formatBytes(used)}</span> {tn(amount(used), 'utilisé sur cet appareil', 'utilisés sur cet appareil')}
        {inTrash > 0 && <> · {t('dont {size} dans la corbeille', { size: formatBytes(inTrash) })}</>}
      </div>
    );

  return (
    <div className={cx('flex items-center gap-x-3 text-[12px] text-stone-500', inline ? 'whitespace-nowrap' : 'mb-4 flex-wrap gap-y-1.5')}>
      <div
        className={cx('h-1.5 overflow-hidden rounded-full bg-stone-200', inline ? 'w-20 shrink-0' : 'w-full max-w-[220px]')}
        role="meter"
        aria-label={t('Espace de stockage utilisé')}
        aria-valuemin={0}
        aria-valuemax={SPACE}
        aria-valuenow={used}
        aria-valuetext={tn(amount(used), '{used} utilisé sur {total}', '{used} utilisés sur {total}', { used: formatBytes(used), total: formatBytes(SPACE) })}
      >
        <div className={cx('h-full rounded-full transition-[width] duration-500', tone)} style={{ width: `${Math.max(used ? 1 : 0, share * 100)}%` }} />
      </div>
      <span className="tabular">
        <span className="font-medium text-ink">{formatBytes(used)}</span> {tn(amount(used), 'utilisé sur {total}', 'utilisés sur {total}', { total: formatBytes(SPACE) })} · {tn(amount(left), '{size} libre', '{size} libres', { size: formatBytes(left) })}
        {inTrash > 0 && <> · {t('dont {size} dans la corbeille', { size: formatBytes(inTrash) })}</>}
      </span>
      {share >= 0.8 && <span className={share >= 0.95 ? 'text-red-600' : 'text-amber-600'}>{share >= 1 ? t('Plein : vide la corbeille ou supprime des fichiers.') : t('Bientôt plein : vide la corbeille ou supprime des fichiers.')}</span>}
    </div>
  );
}
