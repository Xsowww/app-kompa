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
    expect(resolveVision({ GEMINI_API_KEY: 'k' })).toMatchObject({ kind: 'gemini', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'] });
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
    expect(calls[0].url).toContain('gemini-2.5-flash:generateContent');
    expect(calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(calls[1].url).toContain('gemini-2.5-flash-lite:generateContent');
    expect(photoStatus.model).toBe('gemini-2.5-flash-lite');
  });
});
