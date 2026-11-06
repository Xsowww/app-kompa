/**
 * Kompaly in the Affichage Pro: the two dots of the app's mark (you, the big one, and your friend, the small blue one),
 * without a face or sparkles. The big dot takes the text colour. `live`: the small dot breathes (he has something to say).
 */
export default function KompalyMark({ size = 20, live, className }: { size?: number; live?: boolean; className?: string }) {
  return (
    <svg viewBox="6.4 5.9 20 20" width={size} height={size} className={className} aria-hidden>
      <circle cx="13.5" cy="16.5" r="5.5" fill="currentColor" />
      <circle cx="22" cy="12.5" r="2.75" fill="#5b80ff" className={live ? 'kmark-live' : undefined} />
    </svg>
  );
}
