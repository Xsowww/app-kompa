import { Ban, Check } from 'lucide-react';
import { FOLDER_COLORS } from '../store/drive';
import { cx } from '../lib/utils';

/**
 * Row of colour dots for folders (Drive and notes); `value` undefined when the selected folders differ.
 * `defaultColor`: what a folder without a colour looks like there (light blue in the Drive, grey in the notes).
 */
export function FolderColorPicker({ value, onPick, defaultColor = '#9dbdec' }: { value: string | null | undefined; onPick: (key: string | null) => void; defaultColor?: string }) {
  return (
    <div className="px-2 pb-1.5 pt-1">
      <p className="text-[11px] font-medium text-stone-500">Couleur du dossier</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {[null, ...Object.keys(FOLDER_COLORS)].map(key => {
          const on = value === key;
          const label = key ? FOLDER_COLORS[key].label : 'Par défaut';
          return (
            <button
              key={key ?? 'none'}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={on}
              onClick={() => onPick(key)}
              className={cx('hit-sm flex h-[22px] w-[22px] items-center justify-center rounded-full ring-offset-1 ring-offset-surface transition pointer-coarse:h-7 pointer-coarse:w-7', on ? 'ring-2 ring-stone-400' : 'hover:ring-2 hover:ring-stone-200')}
              style={{ background: key ? FOLDER_COLORS[key].color : defaultColor }}
            >
              {on && <Check size={12} strokeWidth={3} className="text-white" />}
              {!key && !on && <Ban size={11} className="text-white/90" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
