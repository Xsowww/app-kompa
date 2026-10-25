import { describe, expect, it } from 'vitest';
import { latestRelease, newsToShow } from '../src/lib/news';

describe('newsToShow', () => {
  const before = '2020-01-01T10:00:00Z';
  it('shows the release once, to accounts that existed before it', () => {
    expect(newsToShow('', before)).toBe(true);
    expect(newsToShow(latestRelease.id, before)).toBe(false);
    expect(newsToShow('', `${latestRelease.id}T08:00:00Z`)).toBe(false); // created the same day: nothing new
    expect(newsToShow('', undefined)).toBe(false);
  });
});
