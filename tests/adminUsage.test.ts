import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- server module in plain JavaScript
import { adminCheck, aiUsage, handleCopilot, overQuota } from '../server/copilot.mjs';
// @ts-expect-error -- server module in plain JavaScript
import { audioUsage, overAudioQuota } from '../server/cours.mjs';

const env = { SUPABASE_URL: 'https://projet.test', SUPABASE_ANON_KEY: 'anon', AI_DAILY_QUESTIONS: '30', AI_DAILY_BUDGET: '1000' };
const jwt = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const req = (token?: string) => ({ url: '/api/copilot/admin', method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {}, socket: { remoteAddress: '203.0.113.7' } });

/** Supabase stubbed: Auth knows the token's user, the database answers is_admin() for them. */
function supabase(admin: boolean) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push(`${url} ${init?.headers?.Authorization ?? ''}`);
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: '11111111-2222-3333-4444-555555555555' }));
    if (url.endsWith('/rest/v1/rpc/is_admin')) return new Response(JSON.stringify(admin));
    return new Response('{}', { status: 404 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('the admins’ figures (GET /api/copilot/admin)', () => {
  it('asks Supabase, with the caller’s own token, whether they are an admin', async () => {
    const token = jwt({ sub: 'u1', aal: 'aal2', n: 1 });
    const calls = supabase(true);
    expect(await adminCheck(req(token), env)).toBe('ok');
    expect(calls.some(c => c.includes('/rest/v1/rpc/is_admin') && c.endsWith(`Bearer ${token}`))).toBe(true);
  });

  it('refuses a signed-in account that is not an admin, and an admin without the phone’s code', async () => {
    supabase(false);
    expect(await adminCheck(req(jwt({ aal: 'aal2', n: 2 })), env)).toBe('forbidden');
    supabase(true);
    expect(await adminCheck(req(jwt({ aal: 'aal1', n: 3 })), env)).toBe('mfa');
    expect(await adminCheck(req(), env)).toBe('forbidden');
    expect(await adminCheck(req(jwt({ aal: 'aal2', n: 4 })), {})).toBe('forbidden'); // local mode: no admins
  });

  it('answers 403 to others and the figures to an admin, never an e-mail', async () => {
    overQuota('11111111-2222-3333-4444-555555555555', true, { id: 'anthropic' }, env);
    overQuota('11111111-2222-3333-4444-555555555555', false, { id: 'anthropic' }, env);
    overQuota('203.0.113.9', true, { id: 'anthropic' }, env);
    overAudioQuota('11111111-2222-3333-4444-555555555555', 90, { groq: true }, {});
    const out = (status: { code?: number; body?: string }) => ({
      statusCode: 0,
      setHeader: () => {},
      end(body: string) {
        status.code = this.statusCode;
        status.body = body;
      },
    });
    supabase(false);
    const refused: { code?: number; body?: string } = {};
    await handleCopilot(req(jwt({ aal: 'aal2', n: 5 })), out(refused), env);
    expect(refused.code).toBe(403);
    supabase(true);
    const ok: { code?: number; body?: string } = {};
    await handleCopilot(req(jwt({ aal: 'aal2', n: 6 })), out(ok), env);
    expect(ok.code).toBe(200);
    const body = JSON.parse(ok.body!);
    expect(body.ai.today.questions).toBeGreaterThanOrEqual(2);
    expect(body.ai.budget.left).toBe(1000 - body.ai.today.calls);
    expect(body.ai.top[0]).toMatchObject({ id: '11111111-2222-3333-4444-555555555555' });
    expect(body.ai.top.some((r: { id: string | null }) => r.id === '203.0.113.9')).toBe(false); // an address is never shown
    expect(body.audio.today).toBeGreaterThanOrEqual(1.5);
    expect(ok.body).not.toMatch(/@/);
  });

  it('counts the month with the day', () => {
    const before = aiUsage({ id: 'anthropic' }, env).month.questions;
    overQuota('99999999-2222-3333-4444-555555555555', true, { id: 'anthropic' }, env);
    expect(aiUsage({ id: 'anthropic' }, env).month.questions).toBe(before + 1);
    expect(audioUsage({}).month).toBeGreaterThanOrEqual(audioUsage({}).today);
  });
});
