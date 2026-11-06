import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- server module in plain JavaScript
import { handleCopilot } from '../server/copilot.mjs';

// « Mode simple uniquement » (Profil › Kompaly): the server sends nothing to the AI, even if an old tab still asks.
const env = { AI_PROVIDER: 'anthropic', AI_API_KEY: 'cle-de-test' };

function post(url: string, body: unknown) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as Readable & Record<string, unknown>;
  Object.assign(req, { url, method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } });
  const res = {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(b: string) {
      this.body = b;
    },
  };
  return { req, res };
}

afterEach(() => vi.unstubAllGlobals());

describe('rien ne part à une IA sans qu’on le demande', () => {
  it('refuses a question sent with « Mode simple uniquement », without calling the AI', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => (calls.push(String(url)), new Response('{}')));
    const { req, res } = post('/api/copilot/chat', { simpleOnly: true, messages: [{ role: 'user', content: 'Résume mon cours' }] });
    await handleCopilot(req, res, env);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'simple_only' });
    expect(calls).toEqual([]);
  });

  it('no longer has the spontaneous remark phrased by the AI (/api/copilot/nudge)', async () => {
    const { req, res } = post('/api/copilot/nudge', { situation: { fichier: 'bilan-medical.pdf' } });
    await handleCopilot(req, res, env);
    expect(res.statusCode).toBe(404);
  });

  it('the app never calls it either', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const files = readdirSync('src', { recursive: true }).map(String).filter(f => /\.tsx?$/.test(f));
    for (const f of files) expect(readFileSync(`src/${f}`, 'utf8'), f).not.toContain("'nudge'");
  });
});
