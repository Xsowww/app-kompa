import { describe, expect, it } from 'vitest';
import { encodeFlac } from '../src/lib/recorder/flac';
import { encodeWav } from '../src/lib/recorder/audio';
// @ts-expect-error plain JS server module
import { flacSeconds } from '../server/cours.mjs';

/** A minimal FLAC reader for what encodeFlac writes (mono 16-bit: CONSTANT, VERBATIM, FIXED + Rice). */
function decode(b: Uint8Array): Int16Array {
  let pos = 0;
  const bit = () => (b[pos >> 3] >> (7 - (pos++ & 7))) & 1;
  const bits = (n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + bit(); return v; };
  const signed = (n: number) => { const v = bits(n); return v >= 2 ** (n - 1) ? v - 2 ** n : v; };
  const total = (b[21] & 0xf) * 2 ** 32 + ((b[22] << 24) >>> 0) + (b[23] << 16) + (b[24] << 8) + b[25];
  const out = new Int16Array(total);
  let at = 0;
  pos = 42 * 8;
  while (at < total) {
    expect(bits(14)).toBe(0b11111111111110);
    bits(2);
    const bs = bits(4);
    bits(12);
    const first = bits(8); // frame number: skip its continuation bytes
    let extra = first >= 0xc0 ? (first >= 0xe0 ? (first >= 0xf0 ? 3 : 2) : 1) : 0;
    while (extra--) bits(8);
    const size = bs === 0b1100 ? 4096 : bits(16) + 1;
    bits(8); // CRC-8
    bits(1);
    const type = bits(6);
    bits(1);
    const x = new Int32Array(size);
    if (type === 0) x.fill(signed(16));
    else if (type === 1) for (let i = 0; i < size; i++) x[i] = signed(16);
    else {
      const order = type & 7;
      for (let i = 0; i < order; i++) x[i] = signed(16);
      bits(2);
      const p = bits(4);
      const each = size >> p;
      let i = order;
      for (let part = 0; part < 1 << p; part++) {
        const k = bits(4);
        for (let n = part ? each : each - order; n > 0; n--) {
          let q = 0;
          while (!bit()) q++;
          const z = q * 2 ** k + bits(k);
          const r = z & 1 ? -(z + 1) / 2 : z / 2;
          const pred = order === 0 ? 0 : order === 1 ? x[i - 1] : order === 2 ? 2 * x[i - 1] - x[i - 2] : order === 3 ? 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3] : 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
          x[i++] = pred + r;
        }
      }
    }
    pos = (pos + 7) & ~7;
    bits(16); // CRC-16
    out.set(x, at);
    at += size;
  }
  return out;
}

describe('encodeFlac', () => {
  const voice = Float32Array.from({ length: 16000 * 3 + 777 }, (_, i) => 0.3 * Math.sin(i / 20) * Math.sin(i / 900) + 0.05 * Math.sin(i / 3.1));
  const cases: [string, Float32Array][] = [
    ['voice', voice],
    ['silence', new Float32Array(9000)],
    ['noise', Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i * 12.9898) * 1.3)],
    ['tiny', Float32Array.from({ length: 5 }, (_, i) => i / 10)],
  ];
  for (const [name, s] of cases)
    it(`gives back the exact samples of the WAV (${name})`, async () => {
      const flac = new Uint8Array(await encodeFlac(s).arrayBuffer());
      const wav = new Int16Array((await encodeWav(s).arrayBuffer()).slice(44));
      expect(Array.from(decode(flac))).toEqual(Array.from(wav));
      expect(flacSeconds(Buffer.from(flac))).toBeCloseTo(s.length / 16000, 6);
    });
  it('is smaller than the WAV for a voice', async () => {
    expect((await encodeFlac(voice).arrayBuffer()).byteLength).toBeLessThan((await encodeWav(voice).arrayBuffer()).byteLength * 0.75);
  });
  it('refuses what is not a 16 kHz mono FLAC', () => {
    expect(flacSeconds(Buffer.from('RIFF0000WAVEfmt '))).toBeNull();
  });
});
