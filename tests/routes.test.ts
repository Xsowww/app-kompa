import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The server answers 404 to an address the app doesn't have: its list must follow the app's routes.
describe('routes', () => {
  it('the server knows every page of the app', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const server = readFileSync('server/index.mjs', 'utf8');
    const routes = [...app.matchAll(/<Route path="([^"*]+)"/g)].map(m => '/' + m[1].replace(/^\//, '')).concat('/');
    const known = JSON.parse(server.match(/const APP_ROUTES = new Set\((\[[^\]]+\])\)/)![1].replace(/'/g, '"')) as string[];
    expect(new Set(known)).toEqual(new Set(routes));
  });
});
