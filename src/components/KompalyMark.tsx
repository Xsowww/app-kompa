import type { CSSProperties } from 'react';

/**
 * Kompaly's mark without its tile (components/Logo › LogoMark): you, the big dot in the colour of the text, and your
 * friend, the small blue one. Affichage Pro shows it where the drone's head was (no face, nothing that looks like an
 * emoji): the side pill, the top bar of phones, Profil. Sized and coloured like a lucide icon (`size`, currentColor).
 * `alert`: Kompaly has written — his small dot turns red and grows a little, like a badge (said in the button's name).
 */
export default function KompalyMark({ size = 24, className, alert, style }: { size?: number | string; className?: string; strokeWidth?: number | string; alert?: boolean; style?: CSSProperties }) {
  return (
    <svg viewBox="5.4 4.9 22 22" width={size} height={size} className={className} style={style} aria-hidden>
      <circle cx="13.5" cy="16.5" r="5.5" fill="currentColor" />
      <circle cx="22" cy="12.5" r={alert ? 3.4 : 2.75} fill={alert ? '#ff3b30' : 'var(--pro-etudes, #3d63dd)'} />
    </svg>
  );
}
