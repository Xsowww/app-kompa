import { GROUP_COLORS, type Group } from '../../lib/groups';
import { groupColor } from './util';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';
import { useGroups } from '../../store/groups';
import { EmptyState, LoadErrorLine } from '../../components/EmptyState';

/**
 * A tab whose content couldn't be read (no connection…): said plainly, with « Réessayer », instead of loading forever.
 * `inline`: one line above content that stays on screen (the shared calendar).
 */
export function LoadFailed({ groupId, part, className, inline }: { groupId: string; part: 'members' | 'notes' | 'events' | 'files'; className?: string; inline?: boolean }) {
  const retry = () => void useGroups.getState().refresh(groupId, [part]);
  if (inline) return <LoadErrorLine onRetry={retry} className={className} />;
  return <EmptyState tone="error" title={t('Impossible de charger.')} onRetry={retry} className={className} />;
}

/** Pastille carrée du groupe : sa photo, sinon l'initiale sur sa couleur. */
export function GroupBadge({ group, size = 28 }: { group: Pick<Group, 'name' | 'color'> & { photo?: string | null }; size?: number }) {
  if (group.photo) return <img src={group.photo} alt="" width={size} height={size} className="shrink-0 rounded-lg object-cover" style={{ width: size, height: size }} />;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg font-semibold text-white"
      style={{ width: size, height: size, background: groupColor(group), fontSize: Math.round(size * 0.42) }}
    >
      {group.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Rond avec l'initiale d'un membre, couleur stable selon son identifiant. */
export function MemberDot({ userId, name, size = 24, className }: { userId: string; name: string; size?: number; className?: string }) {
  return (
    <span
      title={name}
      className={cx('flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface', className)}
      style={{ width: size, height: size, background: GROUP_COLORS[hash(userId) % GROUP_COLORS.length], fontSize: Math.round(size * 0.44) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

const COLOR_NAMES: Record<string, () => string> = {
  '#e8613c': () => t('Orange'),
  '#3b6fd8': () => t('Bleu'),
  '#2f9e6b': () => t('Vert'),
  '#7a5ad6': () => t('Violet'),
  '#d48a17': () => t('Ambre'),
  '#1f8a8a': () => t('Turquoise'),
};

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label={t('Couleur')}>
      {GROUP_COLORS.map(c => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_NAMES[c]()}
          onClick={() => onChange(c)}
          className={cx('hit h-7 w-7 rounded-full transition-transform hover:scale-110', value === c && 'ring-2 ring-offset-2')}
          style={{ background: c, ['--tw-ring-color' as string]: c }}
        />
      ))}
    </div>
  );
}
