// Sound helpers for « Enregistrer un cours », without the browser's audio objects (so they can be tested):
// down to 16 kHz, where to cut a piece (in a pause, not in the middle of a word) and the WAV file sent to the server.

export const RATE = 16_000;

/** Brings any sample rate down to 16 kHz (averaging what falls between two output samples: a simple low-pass, enough for speech). */
export class Resampler {
  private pos = 0; // where the next output sample is, in input samples (fractional)
  private carry: Float32Array = new Float32Array(0);
  private readonly step: number;
  constructor(inputRate: number) {
    this.step = inputRate / RATE;
  }

  push(input: Float32Array): Float32Array {
    const data = this.carry.length ? concat(this.carry, input) : input;
    const out: number[] = [];
    while (this.pos + this.step <= data.length) {
      const from = Math.floor(this.pos);
      const to = Math.max(from + 1, Math.floor(this.pos + this.step));
      let sum = 0;
      for (let i = from; i < to; i++) sum += data[i];
      out.push(sum / (to - from));
      this.pos += this.step;
    }
    const used = Math.floor(this.pos);
    this.carry = data.slice(used);
    this.pos -= used;
    return Float32Array.from(out);
  }
}

export function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export function rms(s: Float32Array, from = 0, to = s.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += s[i] * s[i];
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

export function peak(s: Float32Array): number {
  let m = 0;
  for (let i = 0; i < s.length; i++) m = Math.max(m, Math.abs(s[i]));
  return m;
}

/**
 * Where to end a piece of `s` (16 kHz) that is at least `min` seconds long: the middle of the quietest
 * 0.2 s between `min - 4` s and the end. null: no pause yet, wait for more sound (unless `force`).
 */
export function findCut(s: Float32Array, min: number, force = false): number | null {
  const win = RATE / 5;
  const start = Math.max(0, Math.floor((min - 4) * RATE));
  if (s.length < min * RATE && !force) return null;
  if (s.length - start < win) return force ? s.length : null;
  let best = start;
  let bestRms = Infinity;
  for (let i = start; i + win <= s.length; i += win / 2) {
    const r = rms(s, i, i + win);
    if (r < bestRms) {
      bestRms = r;
      best = i;
    }
  }
  // A real pause: well below the level of the piece. Otherwise wait, unless the piece is too long already.
  const level = rms(s, start, s.length);
  if (!force && bestRms > Math.max(0.004, level * 0.35)) return null;
  return best + win / 2;
}

/** Nobody speaking in this piece: not worth sending (and Whisper invents sentences on silence). */
export const isSilent = (s: Float32Array) => rms(s) < 0.0015 && peak(s) < 0.03;

/** 16 kHz mono 16-bit PCM WAV. */
export function encodeWav(s: Float32Array): Blob {
  const buf = new ArrayBuffer(44 + s.length * 2);
  const v = new DataView(buf);
  const str = (at: number, t: string) => [...t].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + s.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, s.length * 2, true);
  for (let i = 0; i < s.length; i++) {
    const x = Math.max(-1, Math.min(1, s[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
