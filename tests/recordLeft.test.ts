import { describe, expect, it } from 'vitest';
// @ts-expect-error -- server module in plain JavaScript
import { audioLeft, handleCours, overAudioQuota } from '../server/cours.mjs';
import { recordedSeconds } from '../src/lib/recorder/course';

// « Il te reste 3 h 12 d'enregistrement aujourd'hui » on the Enregistrer page: the server's own count.
describe('ce qu’il reste d’enregistrement aujourd’hui', () => {
  it('counts down with what was written today, per account', () => {
    const env = { TRANSCRIBE_DAILY_MINUTES: '240' };
    expect(audioLeft('compte-a', env)).toEqual({ left: 4 * 3600, max: 4 * 3600 });
    overAudioQuota('compte-a', 48 * 60, { groq: true }, env);
    expect(audioLeft('compte-a', env)).toEqual({ left: 3 * 3600 + 12 * 60, max: 4 * 3600 });
    expect(audioLeft('compte-b', env).left).toBe(4 * 3600);
  });

  it('is in /api/cours/etat for the one asking (local mode: this computer)', async () => {
    const res = { statusCode: 0, body: '', setHeader() {}, end(b: string) { this.body = b; } };
    await handleCours({ url: '/api/cours/etat', method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res, {});
    expect(JSON.parse(res.body)).toMatchObject({ audioLeft: 4 * 3600, audioMax: 4 * 3600 });
  });
});

describe('la durée après une page fermée', () => {
  it('stops when the class was last heard, not at the reload', () => {
    const startedAt = Date.UTC(2026, 10, 6, 10, 0, 0);
    // 10 s heard, then the tab closed for 2 minutes: 10 s, not « 2 min ».
    expect(recordedSeconds({ startedAt }, startedAt + 10_000)).toBe(10);
    expect(recordedSeconds({ startedAt, paused: 120_000 }, startedAt + 130_000)).toBe(10);
  });
});
