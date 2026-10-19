import type { FileCategory } from '../store/drive';
import { t } from '../i18n';

const BADGE: Record<Exclude<FileCategory, 'folder'>, { label: string; color: string }> = {
  image: { label: 'IMG', color: '#c2417a' },
  pdf: { label: 'PDF', color: '#d9483b' },
  video: { label: 'VID', color: '#7a5ad6' },
  audio: { label: t('SON'), color: '#1f8fa8' },
  text: { label: 'TXT', color: '#6f6c66' },
  doc: { label: 'DOC', color: '#3b6fd8' },
  sheet: { label: 'XLS', color: '#2f9e6b' },
  slides: { label: 'PPT', color: '#e0702f' },
  archive: { label: 'ZIP', color: '#b08417' },
  other: { label: t('FIC'), color: '#8a867e' },
};

/** Blend a #rrggbb colour with white (t = share of white). */
function tint(hex: string, t: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - t) + 255 * t);
  return `rgb(${ch(16)} ${ch(8)} ${ch(0)})`;
}

/** Flat document / folder icons, drawn once so the Drive feels like a real file manager. */
export default function FileIcon({ category, size = 40, ext, color }: { category: FileCategory; size?: number; ext?: string; color?: string }) {
  if (category === 'folder') {
    // Default blue, or three lighter shades of the folder's colour.
    const [back, front, edge] = color ? [tint(color, 0.22), tint(color, 0.4), tint(color, 0.55)] : ['#7ea6e0', '#9dbdec', '#b7cff3'];
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="shrink-0">
        <path d="M4 12.5A3.5 3.5 0 0 1 7.5 9h11.2a3.5 3.5 0 0 1 2.6 1.2l2.2 2.4h17A3.5 3.5 0 0 1 44 16.1V37a3.5 3.5 0 0 1-3.5 3.5h-33A3.5 3.5 0 0 1 4 37V12.5Z" fill={back} />
        <path d="M4 19.5A3.5 3.5 0 0 1 7.5 16h33a3.5 3.5 0 0 1 3.5 3.5V37a3.5 3.5 0 0 1-3.5 3.5h-33A3.5 3.5 0 0 1 4 37V19.5Z" fill={front} />
        <path d="M4 20.5A3.5 3.5 0 0 1 7.5 17h33a3.5 3.5 0 0 1 3.5 3.5v.6H4v-.6Z" fill={edge} />
      </svg>
    );
  }
  const b = BADGE[category];
  const label = (ext && ext.length <= 4 ? ext : b.label).toUpperCase();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <path d="M11 4.5h18.5L39 14v28a1.5 1.5 0 0 1-1.5 1.5h-26A1.5 1.5 0 0 1 10 42V6a1.5 1.5 0 0 1 1-1.5Z" fill="#fff" stroke="#d6d3d1" strokeWidth="1.2" />
      <path d="M29.5 4.5V12a2 2 0 0 0 2 2H39" fill="#f5f5f4" stroke="#d6d3d1" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="6" y="27" width={label.length > 3 ? 25 : 21} height="11" rx="2.5" fill={b.color} />
      <text x={label.length > 3 ? 18.5 : 16.5} y="35.2" textAnchor="middle" fontSize="7.4" fontWeight="700" fontFamily="Geist, sans-serif" fill="#fff" letterSpacing="0.3">
        {label}
      </text>
    </svg>
  );
}
