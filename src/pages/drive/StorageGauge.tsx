import { useDrive } from '../../store/drive';
import { SPACE } from '../../lib/blobStore';
import { formatBytes, cx } from '../../lib/utils';
import { t, tn } from '../../i18n';

const fileBytes = (list: { kind: string; size?: number }[]) => list.reduce((s, i) => s + (i.kind === 'file' ? (i.size ?? 0) : 0), 0);

/** How much of the Drive space is used (the trash counts until it is emptied). */
/** The number shown (« 1,5 » for « 1,5 Go »), for the singular or plural of « 1 Go libre », « 12 Ko utilisés ». */
const amount = (bytes: number) => parseFloat(formatBytes(bytes).replace(',', '.'));

export default function StorageGauge() {
  const items = useDrive(s => s.items);
  const trash = useDrive(s => s.trash);
  const inTrash = fileBytes(trash);
  const used = fileBytes(items) + inTrash;
  const share = Math.min(1, used / SPACE);
  const left = Math.max(0, SPACE - used);
  const tone = share >= 0.95 ? 'bg-red-500' : share >= 0.8 ? 'bg-amber-500' : 'bg-brand-500';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-stone-500">
      <div
        className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-stone-200"
        role="meter"
        aria-label={t('Espace du Drive utilisé')}
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
