// Hears the class: the microphone (a class in a room) or the sound of a browser tab (a class on Teams, Zoom,
// YouTube… in Chrome). The sound is cut into pieces of about 20 s, at a pause, ready to be written down.

import { RATE, Resampler, findCut, peak } from './audio';
import { t } from '../../i18n';

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


/** A phone or a tablet: the computer's sound can't be shared from there at all. */
export const onPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
/** The computer's sound: only Chrome and Edge (and the Kompaly app installed from them) share it, on a computer. */
export const canShareComputer = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !onPhone();
export const canUseMic = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

async function openStream(kind: SourceKind): Promise<MediaStream> {
  if (kind === 'micro') {
    if (!canUseMic()) throw new CaptureError(t('Ce navigateur ne donne pas accès au micro.'));
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const name = (e as Error)?.name;
      throw new CaptureError(
        name === 'NotAllowedError' ? t('Accès au micro refusé : autorise-le dans la barre d’adresse (icône à gauche), puis réessaie.') : name === 'NotFoundError' ? t('Aucun micro trouvé sur cet appareil.') : t('Le micro n’a pas pu démarrer.'),
      );
    }
  }
  if (!canShareComputer()) throw new CaptureError(t('Le son de l’ordinateur s’enregistre avec Chrome ou Edge, sur ordinateur.'));
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      // « Écran entier » chosen first: the only choice that carries the computer's whole sound.
      // The picture isn't used: as small as the browser allows.
      video: { displaySurface: 'monitor', frameRate: 1, width: { max: 640 }, height: { max: 360 } } as MediaTrackConstraints,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false } as MediaTrackConstraints,
      // Chrome: tabs first, never this one, keep listening if the student switches tab in the share bar,
      // the computer's sound with a whole screen (Windows), a window's own sound where Chrome can.
      ...({ preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include', monitorTypeSurfaces: 'include', windowAudio: 'window' } as object),
    });
  } catch (e) {
    throw new CaptureError((e as Error)?.name === 'NotAllowedError' ? t('Partage annulé.') : t('Le partage n’a pas pu démarrer.'));
  }
  if (!stream.getAudioTracks().length) {
    const surface = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
    stream.getTracks().forEach(t => t.stop());
    throw new CaptureError(noSoundHelp(surface));
  }
  return stream;
}

const isMac = () => /Mac/.test(navigator.userAgent) && !/iPhone|iPad/.test(navigator.userAgent);

/** The share came without sound: what to do instead. */
export function noSoundHelp(surface: string | undefined, mac = isMac()): string {
  if (surface === 'monitor')
    return mac
      ? t('Pas de son : active le son dans la fenêtre de partage. S’il n’y est pas, mets Chrome à jour et autorise-le dans Réglages Système › Confidentialité › Enregistrement de l’écran et de l’audio système.')
      : t('Pas de son : active « Partager aussi l’audio du système » dans la fenêtre de partage.');
  return t('Pas de son : choisis « Écran entier » et active le son.');
}

/**
 * Starts hearing. `offset`: seconds already recorded (when listening starts again after a break),
 * `target`: length of a piece in seconds. `onLevel` gets the loudest sample of each ~0.1 s.
 */
export async function startCapture(
  kind: SourceKind,
  opts: { offset: number; target: () => number; onPiece: (p: Piece) => void; onLevel?: (peak: number) => void; onEnded: () => void },
): Promise<Capture> {
  // Made right away, while the click still counts: iPhone and Safari only let sound start from a click.
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new CaptureError(t('Ce navigateur ne sait pas traiter le son : mets-le à jour.'));
  const ctx = new Ctx();
  let stream: MediaStream;
  try {
    stream = await openStream(kind);
  } catch (e) {
    void ctx.close().catch(() => undefined);
    throw e;
  }
  const audio = stream.getAudioTracks()[0];
  try {
    // A real file (public/tap-worklet.js): the site's security rules refuse a module given inline.
    await ctx.audioWorklet.addModule('/tap-worklet.js');
  } catch {
    stream.getTracks().forEach(t => t.stop());
    void ctx.close();
    throw new CaptureError(t('Ce navigateur ne sait pas traiter le son en direct : mets-le à jour.'));
  }
  const source = ctx.createMediaStreamSource(new MediaStream([audio]));
  const tap = new AudioWorkletNode(ctx, 'kompaly-tap');
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(tap).connect(mute).connect(ctx.destination);
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

  const resampler = new Resampler(ctx.sampleRate);
  const buf = new Float32Array(RATE * 60);
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
    const target = opts.target();
    if (n >= target * RATE) {
      // Cut in a pause; past 1.7 × the length, cut anyway.
      const cut = findCut(buf.subarray(0, n), target, n >= Math.max(target + 6, target * 1.7) * RATE);
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
