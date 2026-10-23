import type { CopilotPose } from '../store/copilot';

export type CopilotMood = 'idle' | 'happy' | 'talk' | 'think' | 'alert' | 'sleep';

interface Props {
  pose: CopilotPose;
  look?: { x: number; y: number }; // -1..1
  blink?: boolean;
  mood?: CopilotMood;
  size?: number;
}

// Kompaly is a little grey drone (one 3D picture, public/kompaly/drone.webp). His face is drawn on its screen
// and animated here. He waits at the right edge of the screen and flies out of it.
// (The former character, a round head with a pilot headset, is in git: commit 57d97ba, src/copilot/Character.tsx.)
const POSE: Record<CopilotPose, string> = {
  hidden: 'translateX(66%) rotate(-10deg)',
  peek: 'translateX(30%) rotate(-7deg)',
  open: 'translateX(2%) rotate(-2deg)',
};

/** The glowing face, in a 100 × 80 box laid on the screen. */
function Face({ mood, x, y, blink }: { mood: CopilotMood; x: number; y: number; blink: boolean }) {
  const line = { fill: 'none', stroke: '#fff', strokeWidth: 4.5, strokeLinecap: 'round' as const };
  let eyes;
  if (mood === 'happy') eyes = [24, 58].map(cx => <path key={cx} d={`M${cx + x} ${39 + y} q9 -12 18 0`} {...line} strokeWidth={5.5} />);
  else if (mood === 'sleep') eyes = [25, 59].map(cx => <path key={cx} d={`M${cx} 38 q8 6 16 0`} {...line} strokeWidth={5.5} />);
  else {
    const r = mood === 'alert' ? 10.5 : 8.5;
    eyes = [33, 67].map(cx => <ellipse key={cx} cx={cx + x} cy={36 + y} rx={r} ry={blink ? 1.2 : r} fill="#fff" />);
  }
  const mx = 50 + x * 0.6;
  const mouth = {
    talk: <ellipse cx={mx} cy="56" rx="7" ry="5" fill="#fff" className="cop-talk" />,
    alert: <circle cx={mx} cy="57" r="4.5" {...line} />,
    think: <path d={`M${mx - 7} 57 h14`} {...line} />,
    sleep: <ellipse cx={mx} cy="56" rx="3" ry="2.2" fill="#fff" />,
    happy: <path d={`M${mx - 12} 52 q12 13 24 0 z`} fill="#fff" />,
    idle: <path d={`M${mx - 9} 55 q9 7 18 0`} {...line} />,
  }[mood];
  return (
    <>
      {eyes}
      {mouth}
      {mood === 'think' && [78, 86, 94].map((cx, i) => <circle key={cx} cx={cx} cy="12" r="3" fill="#fff" className="cop-dot" style={{ animationDelay: `${i * 0.25}s` }} />)}
    </>
  );
}

const GLOW = 'drop-shadow(0 0 2px rgba(255,255,255,.9)) drop-shadow(0 0 6px rgba(255,255,255,.45))';

export default function Character({ pose, look = { x: -1, y: 0 }, blink = false, mood = 'idle', size = 112 }: Props) {
  const lx = mood === 'think' ? -5 : look.x * 6;
  const ly = mood === 'think' ? -5 : look.y * 4;
  const float = mood === 'alert' ? 'cop-bounce' : mood === 'sleep' ? 'cop-hover cop-slow' : 'cop-hover';

  return (
    <div className="pointer-events-none relative select-none" style={{ width: size, height: (size * 140) / 124 }} aria-hidden>
      <div
        className="absolute inset-x-0 top-[22%]"
        style={{ pointerEvents: 'visiblePainted', transform: POSE[pose], transformOrigin: '100% 50%', transition: 'transform 480ms cubic-bezier(.34,1.45,.64,1)' }}
      >
        <div className={float}>
          <div className={mood === 'alert' ? 'cop-wiggle' : undefined} style={{ position: 'relative', width: '125%', marginLeft: '-12%' }}>
            <img src="/kompaly/drone.webp" alt="" width={360} height={225} draggable={false} className="block h-auto w-full drop-shadow-[0_6px_10px_rgba(0,0,0,0.25)]" />
            <svg viewBox="0 0 100 80" className="absolute overflow-visible" style={{ left: '28.9%', top: '10.9%', width: '36%', height: '45.9%', filter: GLOW }}>
              <Face mood={mood} x={lx} y={ly} blink={blink} />
            </svg>
            {mood === 'sleep' && (
              <span className="absolute -top-[18%] right-[18%] font-black text-brand-400">
                <span className="cop-z absolute text-[15px]">z</span>
                <span className="cop-z absolute -top-3 left-2 text-[11px]" style={{ animationDelay: '1.1s' }}>z</span>
              </span>
            )}
            {mood === 'alert' && <span className="absolute -top-[26%] right-[22%] text-[22px] font-black text-amber-400 [text-shadow:0_0_8px_rgb(255_190_60/0.7)]">!</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small head used as an avatar in the conversation panel. */
export function CopilotAvatar({ size = 28 }: { size?: number }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: (size * 77) / 96 }} aria-hidden>
      <img src="/kompaly/drone-head.webp" alt="" width={96} height={77} className="block h-full w-full" />
      <svg viewBox="0 0 100 80" className="absolute" style={{ left: '15%', top: '16.5%', width: '70%', height: '69%', filter: GLOW }}>
        <Face mood="idle" x={0} y={0} blink={false} />
      </svg>
    </span>
  );
}
