import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Coffee, FastForward, Pause, Play, Square, Timer } from 'lucide-react';
import { useFocus, focusLeft, mmss, type FocusPhase } from '../store/focus';
import { useSettings } from '../store/settings';
import { toast } from '../store/ui';
import { t, tn } from '../i18n';
import './focusIsland.css';

/** How long the island stays open after a start, a change of phase or a button used, before it shrinks back. */
const OPEN_FOR = 4000;
/** The length of the closing spring (focusIsland.css › --fi-close-t): the island leaves the page after it. */
const LEAVE_MS = 420;

/** The ring of the time left, emptying as the session goes, as on the iPhone's island. */
function Ring({ left, size, children }: { left: number; size: number; children?: React.ReactNode }) {
  const r = 15;
  const len = 2 * Math.PI * r;
  return (
    <span className="fi-ring" style={{ width: size, height: size }} aria-hidden>
      <svg className="fi-ring-svg" viewBox="0 0 36 36" width={size} height={size}>
        <circle cx="18" cy="18" r={r} className="fi-ring-track" />
        <circle cx="18" cy="18" r={r} className="fi-ring-bar" strokeDasharray={len} strokeDashoffset={len * (1 - left)} transform="rotate(-90 18 18)" />
      </svg>
      {children}
    </span>
  );
}

/** « 24:58 », each figure rolling in when it changes (the iPhone's countdowns do that). */
function Digits({ text }: { text: string }) {
  return (
    <>
      {[...text].map((c, i) => (
        <span key={`${i}-${c}`} className={c === ':' ? 'fi-colon' : 'fi-digit'}>
          {c}
        </span>
      ))}
    </>
  );
}

/**
 * Affichage Pro: while a focus session runs, the iPhone's « Dynamic Island » at the top centre of the screen (under the
 * notch on an iPhone). It springs out open (« Concentration · Bloc de 25 min », the countdown, +5 min, pause, arrêter),
 * shrinks after a few seconds to a small black pill (ring + time) that stays while the session runs; a tap opens it
 * again. Mounted by FocusPill (FocusTimer.tsx), on every screen size, only in Pro.
 */
export default function FocusIsland() {
  const phase = useFocus(s => s.phase);
  const paused = useFocus(s => s.pausedLeft !== null);
  const label = useFocus(s => s.label);
  const planned = useFocus(s => s.minutes);
  const focusMinutes = useSettings(s => s.focusMinutes);
  const breakMinutes = useSettings(s => s.breakMinutes);
  const [, setNow] = useState(0);

  // The phase drawn (the last one while the island leaves), and where the island is in its life: `in` the first frame
  // (tiny, at the notch), `on`, `out` (going back into the notch).
  const [seen, setSeen] = useState(phase);
  const [shown, setShown] = useState<FocusPhase | null>(phase);
  const [stage, setStage] = useState<'in' | 'on' | 'out'>('in');
  const [open, setOpen] = useState(false);
  // Re-arms the countdown to shrinking (a button used keeps it open a little longer).
  const [poke, setPoke] = useState(0);
  const [hover, setHover] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const mini = useRef<HTMLButtonElement>(null);
  const id = useId();

  // A session that starts, or a change of phase (the break begins, then ends): the island opens to say it. A session
  // found running when the app opens comes as the small pill.
  if (phase !== seen) {
    setSeen(phase);
    if (phase) {
      setShown(phase);
      if (!seen || stage === 'out') setStage('in');
      setOpen(true);
      setPoke(p => p + 1);
    } else {
      setStage('out');
      setOpen(false);
    }
  }

  // First frame tiny at the notch, then the spring.
  useEffect(() => {
    if (stage !== 'in' || !shown) return;
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => setStage('on'))));
    return () => cancelAnimationFrame(raf);
  }, [stage, shown]);

  // Gone back into the notch: off the page.
  useEffect(() => {
    if (stage !== 'out' || !shown) return;
    const timer = setTimeout(() => setShown(null), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [stage, shown]);

  // Phones: the page moves down under the top bar while the island is there, so it covers no title or button
  // (focusIsland.css › data-focus-island). The page heads redraw the wallpaper behind them as it moves (AppShell redraws
  // it on resize).
  const lane = !!shown && stage !== 'out';
  useEffect(() => {
    const root = document.documentElement;
    if (lane === 'focusIsland' in root.dataset) return;
    if (lane) root.dataset.focusIsland = '';
    else delete root.dataset.focusIsland;
    let frames = 0;
    let raf = 0;
    const redraw = () => {
      window.dispatchEvent(new Event('resize'));
      if (++frames < 28) raf = requestAnimationFrame(redraw);
    };
    raf = requestAnimationFrame(redraw);
    return () => cancelAnimationFrame(raf);
  }, [lane]);
  useEffect(() => () => void delete document.documentElement.dataset.focusIsland, []);

  // The countdown, every second. It also ends the phase when the time is up (the sidebar's timer may not be there).
  useEffect(() => {
    if (!phase) return;
    const timer = setInterval(() => {
      useFocus.getState().tick();
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // Open: back to the small pill after a few seconds, unless the mouse is on it or the keyboard in it.
  useEffect(() => {
    if (!open || hover || keyboard) return;
    const timer = setTimeout(() => setOpen(false), OPEN_FOR);
    return () => clearTimeout(timer);
  }, [open, hover, keyboard, poke]);

  // Open: a press elsewhere or Échap closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !root.current?.contains(document.activeElement)) return;
      e.stopPropagation();
      setOpen(false);
      setKeyboard(false);
      setTimeout(() => mini.current?.focus(), 0);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!shown) return null;

  const s = useFocus.getState();
  const left = focusLeft(s);
  const time = mmss(left);
  const focusing = shown === 'focus';
  const minutes = planned || (focusing ? focusMinutes : breakMinutes);
  const rest = phase ? Math.min(1, Math.max(0, left / (minutes * 60_000))) : 0;
  const status = focusing ? (paused ? t('En pause') : t('Concentration')) : paused ? t('Pause suspendue') : t('Temps de pause');
  const block = focusing ? t('Bloc de {n} min', { n: minutes }) : t('Pause de {n} min', { n: minutes });
  // With a subject, it is the title, and the length goes up with the state (« Concentration · 25 min »).
  const kicker = label ? `${status} · ${focusing ? t('{n} min', { n: minutes }) : label}` : status;
  const title = label && focusing ? label : block;
  const used = () => setPoke(p => p + 1);

  const stop = () => {
    const n = useFocus.getState().stop();
    if (n) toast(tn(n, '{n} minute de concentration comptée', '{n} minutes de concentration comptées'), 'success');
    // The island goes away with the button: the keyboard goes on with the page, not from the top of <body>.
    document.getElementById('contenu')?.focus({ preventScroll: true });
  };

  return createPortal(
    <div
      ref={root}
      className="fi"
      role="group"
      aria-label={t('Session focus')}
      data-stage={stage}
      data-open={open || undefined}
      data-phase={shown}
      data-paused={paused || undefined}
      onPointerEnter={e => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={() => setKeyboard(false)}
      // Keyboard only: a finger's tap leaves the focus on the button (Android) and would keep the island open.
      onFocus={e => setKeyboard((e.target as HTMLElement).matches(':focus-visible'))}
      onBlur={e => !root.current?.contains(e.relatedTarget as Node) && setKeyboard(false)}
    >
      <button
        ref={mini}
        type="button"
        className="fi-mini"
        inert={open}
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('{status}, encore {time}. Afficher les commandes', { status, time })}
        onClick={e => {
          setOpen(true);
          used();
          // From the keyboard (a click without a pointer): straight to the buttons.
          if (e.detail === 0) setTimeout(() => root.current?.querySelector<HTMLElement>('[data-fi-main]')?.focus(), 0);
        }}
      >
        <Ring left={rest} size={20} />
        <span className="fi-mini-time tabular">
          <Digits text={time} />
        </span>
      </button>

      <div id={id} className="fi-full" inert={!open}>
        <div className="fi-head">
          <Ring left={rest} size={44}>
            {focusing ? <Timer size={16} strokeWidth={2.4} /> : <Coffee size={16} strokeWidth={2.4} />}
          </Ring>
          <div className="fi-text">
            <small>{kicker}</small>
            <strong>{title}</strong>
          </div>
          <span className="fi-time tabular" role="timer" aria-label={t('Temps restant : {time}', { time })}>
            <Digits text={time} />
          </span>
        </div>
        <div className="fi-ctl">
          {focusing ? (
            <button
              type="button"
              className="fi-btn"
              onClick={() => {
                useFocus.getState().extend(5);
                used();
              }}
              aria-label={t('Ajouter 5 minutes')}
            >
              {t('+5 min')}
            </button>
          ) : (
            // Ready before the end of the break: the next session at once.
            <button
              type="button"
              className="fi-btn"
              onClick={() => {
                useFocus.getState().skipBreak();
                used();
              }}
            >
              <FastForward size={14} strokeWidth={2.4} aria-hidden /> {t('Passer la pause')}
            </button>
          )}
          <button
            type="button"
            data-fi-main
            className="fi-btn fi-round fi-pause"
            onClick={() => {
              const f = useFocus.getState();
              if (paused) f.resume();
              else f.pause();
              used();
            }}
            aria-label={paused ? t('Reprendre') : focusing ? t('Pause') : t('Suspendre')}
            title={paused ? t('Reprendre') : focusing ? t('Pause') : t('Suspendre')}
          >
            {paused ? <Play size={16} strokeWidth={2.6} fill="currentColor" aria-hidden /> : <Pause size={16} strokeWidth={2.6} fill="currentColor" aria-hidden />}
          </button>
          <button type="button" className="fi-btn fi-round fi-stop" onClick={stop} aria-label={t('Arrêter')} title={t('Arrêter')}>
            <Square size={13} strokeWidth={2.6} fill="currentColor" aria-hidden />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
