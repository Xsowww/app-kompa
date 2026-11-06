import { describe, expect, it } from 'vitest';
import { cleanPhotos, resolveVision } from '../server/photo.mjs';

const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('photo → fiche', () => {
  it('accepts 1 to 4 real pictures only', () => {
    expect(cleanPhotos([jpeg])?.[0].mime).toBe('image/jpeg');
    expect(cleanPhotos([])).toBeNull();
    expect(cleanPhotos([jpeg, jpeg, jpeg, jpeg, jpeg])).toBeNull();
    expect(cleanPhotos(['data:text/html;base64,PGI+'])).toBeNull();
    expect(cleanPhotos(['https://exemple.fr/a.jpg'])).toBeNull();
  });
  it('who reads them', () => {
    expect(resolveVision({})).toBeNull();
    expect(resolveVision({ GEMINI_API_KEY: 'k' })).toMatchObject({ kind: 'gemini', models: ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'] });
    expect(resolveVision({ AI_PROVIDER: 'groq', AI_API_KEY: 'g' })).toBeNull();
    expect(resolveVision({ AI_PROVIDER: 'groq', AI_API_KEY: 'g', GEMINI_API_KEY: 'k' })?.apiKey).toBe('k');
  });
});

describe('photo → fiche : Gemini', () => {
  it('turns thinking off, and moves to the next model when one is retired', async () => {
    const { readPhotos, photoStatus } = await import('../server/photo.mjs');
    const { vi } = await import('vitest');
    const calls: { url: string; body: { generationConfig: { thinkingConfig?: unknown } } }[] = [];
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      if (calls.length === 1) return new Response(JSON.stringify({ error: { message: 'models/gemini-2.5-flash is not found' } }), { status: 404 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '# Liste\n\n- brosse' }] } }] }), { status: 200 });
    });
    const text = await readPhotos({ kind: 'gemini', apiKey: 'k', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] }, [{ url: '', mime: 'image/jpeg', data: 'AAAA' }], 'fr');
    f.mockRestore();
    expect(text).toBe('# Liste\n\n- brosse');
    expect(calls[0].url).toContain('gemini-2.5-flash:streamGenerateContent?alt=sse');
    expect(calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(calls[1].url).toContain('gemini-2.5-flash-lite:streamGenerateContent');
    expect(photoStatus.model).toBe('gemini-2.5-flash-lite (0)');
  });
});

describe('photo → fiche : Gemini plus récent', () => {
  it('asks for minimal thinking, then low, then none when the setting is refused', async () => {
    const { readPhotos, photoStatus } = await import('../server/photo.mjs');
    const { vi } = await import('vitest');
    const configs: unknown[] = [];
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const cfg = JSON.parse(String(init?.body)).generationConfig.thinkingConfig;
      configs.push(cfg ?? null);
      if (cfg) return new Response(JSON.stringify({ error: { message: 'Thinking level is not supported for this model.' } }), { status: 400 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 });
    });
    await readPhotos({ kind: 'gemini', apiKey: 'k', models: ['gemini-flash-latest'] }, [{ url: '', mime: 'image/jpeg', data: 'AAAA' }], 'fr');
    f.mockRestore();
    expect(configs).toEqual([{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null]);
    expect(photoStatus.model).toBe('gemini-flash-latest');
  });
});

/** An SSE answer from Gemini, its parts sent `gap` ms apart (and then nothing more, `hang`: the model stalls). */
function sse(parts: string[], { gap = 0, hang = false, finish = 'STOP' } = {}) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(c) {
        for (const [i, p] of parts.entries()) {
          if (gap) await new Promise(r => setTimeout(r, gap));
          const last = i === parts.length - 1 && !hang;
          c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] }, ...(last && { finishReason: finish }) }] })}\r\n\r\n`));
        }
        if (!hang) c.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('photo → fiche : jamais 2 minutes pour rien', () => {
  it('reads the sheet as Gemini writes it', async () => {
    const { readGeminiStream } = await import('../server/photo.mjs');
    const got = await readGeminiStream(sse(['# Titre', '\n\n- un', '\n- deux']), { stopAt: Date.now() + 5000, firstBy: Date.now() + 5000, abort() {} });
    expect(got).toEqual({ text: '# Titre\n\n- un\n- deux', partial: false, finish: 'STOP' });
  });

  it('keeps what was read when the time is up (with a note), instead of a timeout', async () => {
    const { readGeminiStream } = await import('../server/photo.mjs');
    let aborted = false;
    const got = await readGeminiStream(sse(['# Long cours', '\n- a'], { hang: true }), { stopAt: Date.now() + 300, firstBy: Date.now() + 300, abort: () => (aborted = true) });
    expect(got).toMatchObject({ text: '# Long cours\n- a', partial: true });
    expect(aborted).toBe(true);
  });

  it('cuts a model that repeats itself', async () => {
    const { cutLoop, readGeminiStream } = await import('../server/photo.mjs');
    const start = '# Biologie\n\n- La cellule est l’unité du vivant.\n';
    const loop = '- Le noyau contient l’ADN.\n';
    expect(cutLoop(start + loop.repeat(30))).toBe((start + loop).trimEnd());
    expect(cutLoop(start + loop)).toBeNull();
    const got = await readGeminiStream(sse([start, ...Array(40).fill(loop)], { hang: true }), { stopAt: Date.now() + 5000, firstBy: Date.now() + 5000, abort() {} });
    expect(got).toMatchObject({ text: (start + loop).trimEnd(), partial: true, finish: 'LOOP' });
  });

  it('an overloaded model gives way to the next one', async () => {
    const { readPhotos, photoStatus } = await import('../server/photo.mjs');
    const { vi } = await import('vitest');
    const urls: string[] = [];
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      urls.push(String(url));
      if (urls.length === 1) return new Response(JSON.stringify({ error: { message: 'The model is overloaded.' } }), { status: 503 });
      return sse(['# Fiche\n', '- ok']);
    });
    const text = await readPhotos({ kind: 'gemini', apiKey: 'k', models: ['gemini-2.5-flash', 'gemini-flash-lite-latest'] }, [{ url: '', mime: 'image/jpeg', data: 'AAAA' }], 'fr');
    f.mockRestore();
    expect(text).toBe('# Fiche\n- ok');
    expect(urls[1]).toContain('gemini-flash-lite-latest');
    expect(photoStatus.model).toBe('gemini-flash-lite-latest (minimal)');
  });
});
