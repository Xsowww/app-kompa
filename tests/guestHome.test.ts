import { describe, expect, it } from 'vitest';
import { guestHome } from '../src/lib/guestHome.mjs';

// A storage with the given keys.
const store = (...keys: string[]) => ({ length: keys.length, key: (i: number) => keys[i] ?? null });
const at = (url: string, local = store(), session = store()) => {
  Object.assign(globalThis, { location: new URL(url), localStorage: local, sessionStorage: session });
  return guestHome();
};

describe('guestHome', () => {
  it('gives the home page alone to a visitor on « / »', () => {
    expect(at('https://kompaly.com/')).toBe(true);
    expect(at('https://kompaly.com/?lang=en&utm_source=x')).toBe(true);
    expect(at('https://kompaly.com/#questions', store('cop-lang'))).toBe(true);
  });
  it('gives the app to a kept session, another page or an address meant for the app', () => {
    expect(at('https://kompaly.com/', store('sb-abc-auth-token'))).toBe(false);
    expect(at('https://kompaly.com/', store(), store('sb-abc-auth-token'))).toBe(false);
    expect(at('https://kompaly.com/connexion')).toBe(false);
    expect(at('https://kompaly.com/?rejoindre=K7P2')).toBe(false);
    expect(at('https://kompaly.com/?error=access_denied')).toBe(false);
    expect(at('https://kompaly.com/#access_token=x&type=signup')).toBe(false);
  });
});
