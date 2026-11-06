import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
// @ts-expect-error -- server module in plain JavaScript
import { handleCopilot, quotaOf, isSmallTalk } from '../server/copilot.mjs';
// @ts-expect-error -- server module in plain JavaScript
import { chatSystem, chatSystemBlocks, TOOLS } from '../server/copilotPrompt.mjs';

/** A POST /api/copilot/chat as the page sends it, from this computer (local mode: no account). */
function request(body: unknown) {
  const req = Object.assign(new EventEmitter(), {
    url: '/api/copilot/chat',
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    resume() {},
  });
  setTimeout(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  }, 0);
  const res = { statusCode: 0, body: '', setHeader() {}, end(s: string) { res.body = s; } };
  return { req, res };
}
const question = (text: string) => ({ messages: [{ role: 'user', content: [{ type: 'text', text: '[Contexte]\nDate : …' }, { type: 'text', text }] }] });
const env = { AI_PROVIDER: 'groq', AI_API_KEY: 'k', AI_DAILY_QUESTIONS: '30', AI_DAILY_BUDGET: '100000' };
const groqAnswer = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });

afterEach(() => vi.restoreAllMocks());

describe('le compteur de questions ne compte que les vraies réponses (rapport n°3, majeur 5)', () => {
  it('a question the AI never answered is not counted', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"error":{"message":"down"}}', { status: 500 }));
    const before = quotaOf('127.0.0.1', env).used;
    const { req, res } = request(question('Organise ma semaine'));
    await handleCopilot(req, res, env);
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(quotaOf('127.0.0.1', env).used).toBe(before);
  });

  it('an answered question is counted once', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => groqAnswer('Voilà.'));
    const before = quotaOf('127.0.0.1', env).used;
    const { req, res } = request(question('Organise ma semaine'));
    await handleCopilot(req, res, env);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).quota.used).toBe(before + 1);
  });

  it('an empty answer is not counted', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => groqAnswer(''));
    const before = quotaOf('127.0.0.1', env).used;
    const { req, res } = request(question('Organise ma semaine'));
    await handleCopilot(req, res, env);
    expect(quotaOf('127.0.0.1', env).used).toBe(before);
    expect(res.statusCode).toBe(200);
  });

  it('« Je suis là », « merci », « salut » are small talk, not questions', async () => {
    for (const s of ['Je suis là', 'je suis la !', 'Merci beaucoup', 'ok', 'Salut', 'coucou :)', 'Bonsoir Kompaly', "D'accord."]) expect(isSmallTalk(s)).toBe(true);
    for (const s of ['oui', 'Salut, ajoute dentiste mardi', 'merci de planifier mes révisions', 'Je suis là demain à 9h ?']) expect(isSmallTalk(s)).toBe(false);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => groqAnswer('Coucou !'));
    const before = quotaOf('127.0.0.1', env).used;
    const { req, res } = request(question('Je suis là'));
    await handleCopilot(req, res, env);
    expect(res.statusCode).toBe(200);
    expect(quotaOf('127.0.0.1', env).used).toBe(before);
  });

  it('a question whose next step fails (after a tool) gives its count back', async () => {
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (++n === 1 ? new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_events', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }), { status: 200 }) : new Response('{}', { status: 500 })));
    const before = quotaOf('127.0.0.1', env).used;
    const first = request({ ...question('Mes événements ?'), turn: 'tour-1' });
    await handleCopilot(first.req, first.res, env);
    expect(quotaOf('127.0.0.1', env).used).toBe(before + 1);
    const step = request({
      turn: 'tour-1',
      messages: [
        ...question('Mes événements ?').messages,
        { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'list_events', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '[]' }] },
      ],
    });
    await handleCopilot(step.req, step.res, env);
    expect(step.res.statusCode).toBeGreaterThanOrEqual(500);
    expect(quotaOf('127.0.0.1', env).used).toBe(before);
  });
});

describe('le prompt dit les faits publics et les règles d’honnêteté (rapport n°3, majeur 3)', () => {
  const facts = { provider: { id: 'anthropic', label: 'Claude' }, env: {} };
  const prompt = chatSystem({}, facts);
  it('knows who makes Kompaly, the prices and the « Lieu » field', () => {
    expect(prompt).toContain('Léo Boucher');
    expect(prompt).toContain('tout est gratuit');
    expect(prompt).toMatch(/champ « Lieu »/);
    expect(prompt).toContain('E-mail de conseils');
  });
  it('is no compliance tool, never invents quotes, never promises a reminder it did not set', () => {
    expect(prompt).toMatch(/n'est pas un outil de conformité/);
    expect(prompt).toMatch(/n'invente jamais un titre/);
    expect(prompt).toMatch(/Ne promets jamais de le prévenir/);
    expect(prompt).toMatch(/« enregistre » à false/);
  });
  it('points to the planning photo button instead of refusing images', () => {
    expect(prompt).not.toContain('Un planning en photo ne se transforme pas en événements');
    expect(prompt).toContain('Photo d\'un planning');
  });
  it('always says « tu »', () => expect(prompt).toContain('tutoie toujours'));
  it('works in shared calendars and groups', () => {
    const names = TOOLS.map((x: { name: string }) => x.name);
    for (const n of ['choose_agenda', 'move_event', 'list_group_files', 'read_group_file', 'share_note_to_group']) expect(names).toContain(n);
    const add = TOOLS.find((x: { name: string }) => x.name === 'add_event');
    expect(Object.keys(add.input_schema.properties)).toEqual(expect.arrayContaining(['agenda', 'place']));
  });
  it('Claude: the rules are one cached block, the same for everyone; the person comes after', () => {
    const a = chatSystemBlocks({ userName: 'Léa', persona: 'pote' }, facts);
    const b = chatSystemBlocks({ userName: 'Hugo' }, facts);
    expect(a[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(a[0].text).toBe(b[0].text);
    expect(a[0].text).not.toContain('Léa');
    expect(a[1].text).toContain('Léa');
    expect(a.map((x: { text: string }) => x.text).join('\n\n')).toBe(chatSystem({ userName: 'Léa', persona: 'pote' }, facts));
  });
});
