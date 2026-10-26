// A small FLAC encoder for the pieces of a recorded class: the same sound as the WAV, bit for bit, about half the size.
// Mono, 16 kHz, 16-bit; each block keeps the best of FLAC's fixed predictors (order 0 to 4) with Rice-coded residuals.
// Less data for the student's phone plan and for the server (Render counts what it sends to the transcription).

import { RATE } from './audio';

const BLOCK = 4096;

class Bits {
  private buf = new Uint8Array(1 << 16);
  private len = 0; // bytes written
  private acc = 0; // pending bits (at most 31 kept)
  private n = 0;
  private grow(need: number) {
    if (this.len + need <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + need));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  /** Writes the `count` low bits of `v` (count ≤ 24). */
  put(v: number, count: number) {
    this.grow(4);
    this.acc = (this.acc << count) | (v & ((1 << count) - 1));
    this.n += count;
    while (this.n >= 8) {
      this.n -= 8;
      this.buf[this.len++] = (this.acc >>> this.n) & 0xff;
    }
    this.acc &= (1 << this.n) - 1;
  }
  unary(q: number) {
    while (q >= 24) {
      this.put(0, 24);
      q -= 24;
    }
    this.put(1, q + 1);
  }
  align() {
    if (this.n) this.put(0, 8 - this.n);
  }
  get size() {
    return this.len;
  }
  bytes(from = 0, to = this.len) {
    return this.buf.subarray(from, to);
  }
}

function crc8(b: Uint8Array) {
  let c = 0;
  for (const x of b) {
    c ^= x;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}
function crc16(b: Uint8Array) {
  let c = 0;
  for (const x of b) {
    c ^= x << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

/** Residuals of FLAC's fixed predictor of this order (the first `order` samples are written as they are). */
function residual(x: Int32Array, order: number): Int32Array {
  const r = new Int32Array(x.length - order);
  for (let i = order; i < x.length; i++) {
    const p = order === 0 ? 0 : order === 1 ? x[i - 1] : order === 2 ? 2 * x[i - 1] - x[i - 2] : order === 3 ? 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3] : 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
    r[i - order] = x[i] - p;
  }
  return r;
}

const zig = (v: number) => (v >= 0 ? v * 2 : -v * 2 - 1);

/** Best Rice parameter for these residuals and the bits it costs. */
function rice(r: Int32Array, from: number, to: number): [number, number] {
  let sum = 0;
  for (let i = from; i < to; i++) sum += zig(r[i]);
  const n = to - from;
  let best = 0;
  let bestBits = Infinity;
  const guess = n && sum > n ? Math.floor(Math.log2(sum / n)) : 0;
  for (let k = Math.max(0, guess - 1); k <= Math.min(14, guess + 1); k++) {
    let bits = n * (k + 1);
    for (let i = from; i < to; i++) bits += zig(r[i]) >>> k;
    if (bits < bestBits) {
      bestBits = bits;
      best = k;
    }
  }
  return [best, bestBits];
}

function subframe(w: Bits, x: Int32Array) {
  if (x.every(v => v === x[0])) {
    // Digital silence: one value for the whole block (CONSTANT).
    w.put(0, 8);
    w.put(x[0], 16);
    return;
  }
  // Pick the order and the partitions (2^p equal parts) that cost the fewest bits.
  let plan: { order: number; p: number; bits: number; r: Int32Array } = { order: 0, p: 0, bits: Infinity, r: new Int32Array(0) };
  for (let order = 0; order <= Math.min(4, x.length - 1); order++) {
    const r = residual(x, order);
    for (let p = 0; p <= 4; p++) {
      const parts = 1 << p;
      if (x.length % parts || x.length / parts <= order) break;
      let bits = 4 + 16 * order;
      const each = x.length / parts;
      for (let i = 0; i < parts; i++) bits += 4 + rice(r, i ? i * each - order : 0, (i + 1) * each - order)[1];
      if (bits < plan.bits) plan = { order, p, bits, r };
    }
  }
  if (plan.bits >= x.length * 16) {
    // Noise that doesn't compress: the samples as they are (VERBATIM).
    w.put(0b00000010, 8);
    for (const v of x) w.put(v, 16);
    return;
  }
  const { order, p, r } = plan;
  w.put(0, 1);
  w.put(0b001000 | order, 6); // FIXED
  w.put(0, 1); // no wasted bits
  for (let i = 0; i < order; i++) w.put(x[i], 16);
  w.put(0, 2); // Rice, 4-bit parameters
  w.put(p, 4);
  const parts = 1 << p;
  const each = x.length / parts;
  for (let i = 0; i < parts; i++) {
    const from = i ? i * each - order : 0;
    const to = (i + 1) * each - order;
    const [k] = rice(r, from, to);
    w.put(k, 4);
    for (let j = from; j < to; j++) {
      const z = zig(r[j]);
      w.unary(z >>> k);
      if (k) w.put(z & ((1 << k) - 1), k);
    }
  }
}

/** Frame number as FLAC writes it (UTF-8-like, up to 31 bits). */
function frameNumber(w: Bits, n: number) {
  if (n < 0x80) return w.put(n, 8);
  const bytes = n < 0x800 ? 2 : n < 0x10000 ? 3 : n < 0x200000 ? 4 : n < 0x4000000 ? 5 : 6;
  w.put((0xff00 >> bytes) & 0xff | (n >>> (6 * (bytes - 1))), 8);
  for (let i = bytes - 2; i >= 0; i--) w.put(0x80 | ((n >>> (6 * i)) & 0x3f), 8);
}

/** 16 kHz mono 16-bit FLAC, lossless. */
export function encodeFlac(s: Float32Array): Blob {
  const pcm = new Int32Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const x = Math.max(-1, Math.min(1, s[i]));
    pcm[i] = Math.trunc(x < 0 ? x * 0x8000 : x * 0x7fff); // the same samples as encodeWav
  }
  const w = new Bits();
  w.put(0x664c, 16);
  w.put(0x6143, 16); // « fLaC »
  w.put(1, 1); // last metadata block
  w.put(0, 7); // STREAMINFO
  w.put(34, 24);
  w.put(BLOCK, 16);
  w.put(BLOCK, 16);
  w.put(0, 24); // frame sizes unknown
  w.put(0, 24);
  w.put(RATE >>> 4, 16);
  w.put(RATE & 0xf, 4);
  w.put(0, 3); // 1 channel
  w.put(15, 5); // 16 bits
  w.put(0, 4); // total samples: 36 bits (high 4 bits are 0 here)
  w.put(pcm.length >>> 16, 16);
  w.put(pcm.length & 0xffff, 16);
  for (let i = 0; i < 16; i++) w.put(0, 8); // MD5 not computed (allowed)

  for (let f = 0, at = 0; at < pcm.length; f++, at += BLOCK) {
    const x = pcm.subarray(at, Math.min(pcm.length, at + BLOCK));
    const start = w.size;
    w.put(0b11111111111110, 14);
    w.put(0, 1);
    w.put(0, 1); // fixed block size
    w.put(x.length === BLOCK ? 0b1100 : 0b0111, 4); // 4096, or the size written after the header
    w.put(0b0101, 4); // 16 kHz
    w.put(0, 4); // mono
    w.put(0b100, 3); // 16 bits
    w.put(0, 1);
    frameNumber(w, f);
    if (x.length !== BLOCK) w.put(x.length - 1, 16);
    w.put(crc8(w.bytes(start)), 8);
    subframe(w, x);
    w.align();
    w.put(crc16(w.bytes(start)), 16);
  }
  return new Blob([w.bytes().slice()], { type: 'audio/flac' });
}

let worker: Worker | null | undefined;
let nextId = 0;
const waiting = new Map<number, { samples: Float32Array; done: (b: Blob) => void }>();

/** encodeFlac in a worker (the page stays smooth); on the page itself where workers fail. */
export function encodeFlacAsync(samples: Float32Array): Promise<Blob> {
  if (worker === undefined) {
    try {
      worker = new Worker(new URL('./flacWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; blob: Blob }>) => {
        waiting.get(e.data.id)?.done(e.data.blob);
        waiting.delete(e.data.id);
      };
      worker.onerror = () => {
        worker = null; // broken: the pieces still waiting are encoded here
        for (const w of waiting.values()) w.done(encodeFlac(w.samples));
        waiting.clear();
      };
    } catch {
      worker = null;
    }
  }
  if (!worker) return Promise.resolve(encodeFlac(samples));
  const id = nextId++;
  const w = worker;
  return new Promise(done => {
    waiting.set(id, { samples, done });
    w.postMessage({ id, samples });
  });
}
