// Hears the class: the microphone (a class in a room) or the sound of a browser tab (a class on Teams, Zoom,
// YouTube… in Chrome). The sound is cut into pieces of about 20 s, at a pause, ready to be written down.

import { RATE, Resampler, findCut, peak } from './audio';

export type SourceKind = 'micro' | 'onglet';

export interface Piece {
  /** Seconds since the start of the recording. */
  start: number;
  end: number;
  samples: Float32Array;
}

export interface Capture {
  stop: (flush?: boolean) => void;
  /** The tab shared, when the browser says (« Teams – Cours de droit »). */
  label: string;
}

export class CaptureError extends Error {}

const MAX_PIECE = 35; // seconds: past this, the piece is cut even without a pause

export const canShareTab = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad/i.test(navigator.userAgent);
export const canUseMic = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

async function openStream(kind: SourceKind): Promise<MediaStream> {
  if (kind === 'micro') {
    if (!canUseMic()) throw new CaptureError('Ce navigateur ne donne pas accès au micro.');
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const name = (e as Error)?.name;
      throw new CaptureError(
        name === 'NotAllowedError' ? 'Accès au micro refusé : autorise-le dans la barre d’adresse (icône à gauche), puis réessaie.' : name === 'NotFoundError' ? 'Aucun micro trouvé sur cet appareil.' : 'Le micro n’a pas pu démarrer.',
      );
    }
  }
  if (!canShareTab()) throw new CaptureError('Le son d’un onglet ne peut être écouté que sur ordinateur, dans Chrome ou Edge.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false } as MediaTrackConstraints,
      // Chrome: offer the tabs first, never this one, and keep listening if the student switches tab in the share bar.
      ...({ preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include' } as object),
    });
  } catch (e) {
    throw new CaptureError((e as Error)?.name === 'NotAllowedError' ? 'Partage annulé.' : 'Le partage n’a pas pu démarrer.');
  }
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach(t => t.stop());
    throw new CaptureError('Aucun son partagé : choisis l’onglet de ton cours et coche « Partager aussi l’audio de l’onglet ».');
  }
  return stream;
}

/**
 * Starts hearing. `offset`: seconds already recorded (when listening starts again after a break),
 * `target`: length of a piece in seconds. `onLevel` gets the loudest sample of each ~0.1 s.
 */
export async function startCapture(
  kind: SourceKind,
  opts: { offset: number; target: number; onPiece: (p: Piece) => void; onLevel?: (peak: number) => void; onEnded: () => void },
): Promise<Capture> {
  const stream = await openStream(kind);
  const audio = stream.getAudioTracks()[0];
  const ctx = new AudioContext();
  try {
    // A real file (public/tap-worklet.js): the site's security rules refuse a module given inline.
    await ctx.audioWorklet.addModule('/tap-worklet.js');
  } catch {
    stream.getTracks().forEach(t => t.stop());
    void ctx.close();
    throw new CaptureError('Ce navigateur ne sait pas traiter le son en direct : essaie avec Chrome, Edge ou Firefox à jour.');
  }
  const source = ctx.createMediaStreamSource(new MediaStream([audio]));
  const tap = new AudioWorkletNode(ctx, 'kompaly-tap');
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(tap).connect(mute).connect(ctx.destination);
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

  const resampler = new Resampler(ctx.sampleRate);
  const buf = new Float32Array(RATE * (MAX_PIECE + 5));
  let n = 0;
  let emitted = 0; // samples already handed out, since this capture started
  let stopped = false;

  const emit = (upTo: number) => {
    if (upTo <= 0) return;
    const samples = buf.slice(0, upTo);
    const start = opts.offset + emitted / RATE;
    emitted += upTo;
    buf.copyWithin(0, upTo, n);
    n -= upTo;
    opts.onPiece({ start, end: opts.offset + emitted / RATE, samples });
  };

  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (stopped) return;
    const block = resampler.push(e.data);
    opts.onLevel?.(peak(e.data));
    if (n + block.length > buf.length) emit(n); // never happens with findCut's force, kept as a guard
    buf.set(block, n);
    n += block.length;
    if (n >= opts.target * RATE) {
      const cut = findCut(buf.subarray(0, n), opts.target, n >= MAX_PIECE * RATE);
      if (cut !== null) emit(cut);
    }
  };

  const end = () => {
    if (stopped) return;
    stop(true);
    opts.onEnded();
  };
  // The tab closed, the share stopped from Chrome's bar, the micro unplugged.
  audio.addEventListener('ended', end);
  stream.getVideoTracks().forEach(t => t.addEventListener('ended', end));

  function stop(flush = true) {
    if (stopped) return;
    if (flush) emit(n);
    stopped = true;
    tap.port.onmessage = null;
    stream.getTracks().forEach(t => t.stop());
    void ctx.close().catch(() => undefined);
  }

  return { stop, label: kind === 'onglet' ? audio.label || stream.getVideoTracks()[0]?.label || '' : audio.label };
}
