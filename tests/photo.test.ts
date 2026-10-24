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
    expect(resolveVision({ GEMINI_API_KEY: 'k' })).toMatchObject({ kind: 'openai', model: 'gemini-flash-latest' });
    expect(resolveVision({ AI_PROVIDER: 'groq', AI_API_KEY: 'g' })).toBeNull();
    expect(resolveVision({ AI_PROVIDER: 'groq', AI_API_KEY: 'g', GEMINI_API_KEY: 'k' })?.apiKey).toBe('k');
  });
});
