import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- server module in plain JavaScript
import { cleanSlots, readPlanning, readPhotos, photoStatus } from '../server/photo.mjs';
// @ts-expect-error -- server module in plain JavaScript
import { sendSlowly } from '../server/cours.mjs';

// Test n°3, blocker n°2: a planning's photo couldn't become events, and « Fiche depuis une photo » ended in a 504 after
// ~85 s (each model waited for in turn, the proxy cutting a silent request).

const photo = [{ url: '', mime: 'image/jpeg', data: 'AAAA' }];
const enc = new TextEncoder();
/** Gemini's SSE answer: its parts, then `hang` (a model that never ends). */
const sse = (parts: string[], { hang = false, delay = 0 } = {}) =>
  new Response(
    new ReadableStream({
      async start(c) {
        if (delay) await new Promise(r => setTimeout(r, delay));
        for (const [i, p] of parts.entries()) c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] }, ...(i === parts.length - 1 && !hang && { finishReason: 'STOP' }) }] })}\r\n\r\n`));
        if (!hang) c.close();
      },
    }),
    { status: 200 },
  );
const silent = (signal?: AbortSignal | null) =>
  new Response(
    new ReadableStream({
      start(c) {
        signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      },
    }),
    { status: 200 },
  );

afterEach(() => vi.restoreAllMocks());

describe('photo d’un planning → créneaux', () => {
  it('keeps real days and hours only, short titles, the note', () => {
    const got = cleanSlots('```json\n{"slots":[{"title":"Nuit","date":"2026-11-10","start":"21h","end":"7:00","place":"Service B"},{"title":"?","date":"2026-02-30","start":"9"},{"title":"","date":"2026-11-11"},{"title":"Repos","date":"2026-11-12","start":"25:00"}],"note":"Une case illisible le 14."}\n```');
    expect(got).toEqual({
      slots: [
        { title: 'Nuit', date: '2026-11-10', start: '21:00', end: '07:00', place: 'Service B' },
        { title: 'Repos', date: '2026-11-12' },
      ],
      note: 'Une case illisible le 14.',
    });
    expect(cleanSlots('pas du JSON')).toEqual({ slots: [] });
  });

  it('asks Gemini for JSON, with today and the person’s name', async () => {
    let body: { systemInstruction: { parts: { text: string }[] }; generationConfig: { responseMimeType?: string } } | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      body = JSON.parse(String(init?.body));
      return sse(['{"slots":[{"title":"Poste matin","date":"2026-11-09","start":"07:00","end":"14:00"}]}']);
    });
    const got = await readPlanning({ kind: 'gemini', apiKey: 'k', models: ['gemini-2.5-flash'] }, photo, { today: '2026-11-06', name: 'Yanis' });
    expect(got.slots).toEqual([{ title: 'Poste matin', date: '2026-11-09', start: '07:00', end: '14:00' }]);
    expect(body!.generationConfig.responseMimeType).toBe('application/json');
    expect(body!.systemInstruction.parts[0].text).toContain("Aujourd'hui : 2026-11-06. La personne s'appelle Yanis.");
  });

  it('passes the person’s message with the photo, and says what a photo that isn’t a planning shows', async () => {
    let sent = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      sent = String(init?.body);
      return sse(['{"slots":[],"note":"C’est la photo d’un chat : je ne lis que les plannings et emplois du temps."}']);
    });
    const got = await readPlanning({ kind: 'gemini', apiKey: 'k', models: ['gemini-2.5-flash'] }, photo, { today: '2026-11-06', hint: 'seulement\nla semaine <prochaine>' });
    expect(got).toEqual({ slots: [], note: 'C’est la photo d’un chat : je ne lis que les plannings et emplois du temps.' });
    expect(sent).toContain('Message de la personne : « seulement la semaine prochaine ».');
    expect(sent).toContain("Ce n'est pas un planning ni un emploi du temps");
  });
});

describe('photo : plus de 504 après 85 s', () => {
  it('a model that writes nothing gets a second one beside it: the first to finish wins', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      urls.push(String(url));
      return String(url).includes('flash-lite') ? sse(['# Fiche\n', '- vite']) : silent(init?.signal);
    });
    const t0 = Date.now();
    const text = await readPhotos({ kind: 'gemini', apiKey: 'k', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'], hedgeMs: 50 }, photo, 'fr');
    expect(text).toBe('# Fiche\n- vite');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(urls.map(u => u.match(/models\/([^:]+)/)?.[1])).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    expect(photoStatus.model).toContain('gemini-2.5-flash-lite');
  });

  it('a model already writing is not doubled', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      urls.push(String(url));
      return sse(['# Long\n', '- a', '\n- b'], { delay: 120 });
    });
    await readPhotos({ kind: 'gemini', apiKey: 'k', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'], hedgeMs: 400 }, photo, 'fr');
    expect(urls).toHaveLength(1);
  });

  it('the answer starts at once and the line is kept alive: an error comes in the body', async () => {
    const chunks: string[] = [];
    const res = { statusCode: 0, headers: {} as Record<string, string>, setHeader(k: string, v: string) { res.headers[k] = v; }, write(s: string) { chunks.push(s); }, end(s: string) { chunks.push(s); } };
    await sendSlowly(res, () => new Promise(r => setTimeout(() => r({ text: 'ok' }), 60)), 20);
    expect(res.statusCode).toBe(200);
    expect(chunks[0]).toBe(' ');
    expect(chunks.filter(c => c === ' ').length).toBeGreaterThan(1);
    expect(JSON.parse(chunks.join(''))).toEqual({ text: 'ok' });
    const failed: string[] = [];
    await sendSlowly({ ...res, write: (s: string) => failed.push(s), end: (s: string) => failed.push(s) }, async () => {
      const { ProviderError } = await import('../server/aiProviders.mjs');
      throw new ProviderError('timeout', 504, 'plus de temps');
    });
    expect(JSON.parse(failed.join(''))).toEqual({ error: 'timeout' });
  });
});
