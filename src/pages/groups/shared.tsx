import { Search } from 'lucide-react';
import { GROUP_COLORS, type Group } from '../../lib/groups';
import { groupColor } from './util';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';
import { useGroups } from '../../store/groups';
import { EmptyState, LoadErrorLine } from '../../components/EmptyState';
import { SelectField } from '../../components/Pickers';

/** Above a group's notes or files: how many, a search, and the order. */
export function ListTools<T extends string>({ count, query, onQuery, placeholder, sort, onSort, sorts }: {
  count: string;
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  sort: T;
  onSort: (s: T) => void;
  sorts: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3">
      {/* Phones: the count on its own line, the search and the order side by side under it. */}
      <p className="eyebrow mr-auto max-sm:w-full">{count}</p>
      <div className="relative min-w-0 flex-1 basis-40 sm:max-w-[260px]">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden />
        <input type="search" value={query} onChange={e => onQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="field h-9 w-full pl-8 text-[13px]" />
      </div>
      <SelectField<T> className="h-9 w-40 shrink-0 text-[13px] sm:w-48" label={t('Trier')} value={sort} onChange={onSort} options={sorts} />
    </div>
  );
}

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

/**
 * Rond d'un membre : la photo de son profil, sinon son initiale sur la couleur de son profil (ou une couleur stable
 * selon son identifiant, quand la base ne les donne pas encore).
 */
export function MemberDot({ userId, name, size = 24, className, photo, color }: { userId: string; name: string; size?: number; className?: string; photo?: string | null; color?: string | null }) {
  if (photo)
    return <img src={photo} alt="" title={name} width={size} height={size} className={cx('shrink-0 rounded-full object-cover ring-2 ring-surface', className)} style={{ width: size, height: size }} />;
  return (
    <span
      title={name}
      className={cx('flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface', className)}
      style={{ width: size, height: size, background: color ?? GROUP_COLORS[hash(userId) % GROUP_COLORS.length], fontSize: Math.round(size * 0.44) }}
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
