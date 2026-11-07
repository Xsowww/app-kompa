import { describe, expect, it } from 'vitest';
import { latestRelease, newsToShow } from '../src/lib/news';

describe('newsToShow', () => {
  const before = '2020-01-01T10:00:00Z';
  const plain = { ...latestRelease, everyone: false };
  it('shows a release once, to accounts that existed before it', () => {
    expect(newsToShow('', before, plain)).toBe(true);
    expect(newsToShow(plain.id, before, plain)).toBe(false);
    expect(newsToShow('', `${plain.id}T08:00:00Z`, plain)).toBe(false); // created the same day: nothing new
    expect(newsToShow('', undefined, plain)).toBe(false);
  });
  it('shows a release « for everyone » once, even to a new account', () => {
    const all = { ...latestRelease, everyone: true };
    expect(newsToShow('', `${all.id}T08:00:00Z`, all)).toBe(true);
    expect(newsToShow('', undefined, all)).toBe(true);
    expect(newsToShow(all.id, before, all)).toBe(false);
  });
});
