import { useDrive } from '../../store/drive';
import { SPACE } from '../../lib/blobStore';
import { formatBytes, cx } from '../../lib/utils';

const fileBytes = (list: { kind: string; size?: number }[]) => list.reduce((s, i) => s + (i.kind === 'file' ? (i.size ?? 0) : 0), 0);

/** How much of the Drive space is used (the trash counts until it is emptied). */
/** « 1 Go libre », « 1,5 Go utilisé », « 12 Ko utilisés » : plural from 2, as in French. */
const agree = (bytes: number, word: string) => (parseFloat(formatBytes(bytes).replace(',', '.')) >= 2 ? `${word}s` : word);

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
        aria-label="Espace du Drive utilisé"
        aria-valuemin={0}
        aria-valuemax={SPACE}
        aria-valuenow={used}
        aria-valuetext={`${formatBytes(used)} ${agree(used, "utilisé")} sur ${formatBytes(SPACE)}`}
      >
        <div className={cx('h-full rounded-full transition-[width] duration-500', tone)} style={{ width: `${Math.max(used ? 1 : 0, share * 100)}%` }} />
      </div>
      <span className="tabular">
        <span className="font-medium text-ink">{formatBytes(used)}</span> {agree(used, 'utilisé')} sur {formatBytes(SPACE)} · {formatBytes(left)} {agree(left, 'libre')}
        {inTrash > 0 && <> · dont {formatBytes(inTrash)} dans la corbeille</>}
      </span>
      {share >= 0.8 && <span className={share >= 0.95 ? 'text-red-600' : 'text-amber-600'}>{share >= 1 ? 'Plein' : 'Bientôt plein'} : vide la corbeille ou supprime des fichiers.</span>}
    </div>
  );
}
