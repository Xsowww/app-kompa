import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain JavaScript module of the server
const { withHead, withPreloads, sitemapXml, publicPage, langOf } = await import('../server/seo.mjs');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('what search engines read', () => {
  it('gives each public page in each language its own title, description and addresses', () => {
    const en = withHead(html, '/', 'en');
    expect(en).toContain('<html lang="en"');
    expect(en).toContain('<title>Kompaly · Calendar, notes and files in one place, with an AI</title>');
    expect(en).toContain('content="Kompaly brings your calendar');
    expect(en).toContain('<link rel="canonical" href="https://kompaly.com/?lang=en" />');
    expect(en).toContain('hreflang="x-default" href="https://kompaly.com/"');
    expect(en).toContain('hreflang="fr" href="https://kompaly.com/?lang=fr"');
    const fr = withHead(html, '/connexion', null);
    expect(fr).toContain('<title>Connexion · Kompaly</title>');
    expect(fr).toContain('<link rel="canonical" href="https://kompaly.com/connexion" />');
    expect(fr.match(/<title>/g)).toHaveLength(1);
  });

  it('translates the description of the JSON-LD', () => {
    const ld = (h: string) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h)![1])['@graph'].find((x: { '@type': string }) => x['@type'] === 'WebApplication').description;
    expect(ld(withHead(html, '/', 'en'))).toMatch(/^Kompaly brings your calendar/);
    expect(ld(withHead(html, '/connexion', 'de'))).toMatch(/^Kompaly /);
    expect(ld(withHead(html, '/connexion', 'de'))).not.toMatch(/réunit/);
    expect(ld(withHead(html, '/', null))).toMatch(/^Kompaly réunit ton agenda/);
  });

  it('lists the pages worth finding, in every language, in the sitemap', () => {
    const xml = sitemapXml();
    expect(xml.match(/<url>/g)).toHaveLength(10); // home and sign-up × 5 languages
    expect(xml).toContain('<loc>https://kompaly.com/inscription?lang=de</loc>');
    expect(xml).not.toContain('/connexion');
    expect(xml).not.toContain('/mentions-legales');
    // The address without ?lang is the same French page: only in the hreflang (x-default), not listed twice.
    expect(xml).not.toContain('<loc>https://kompaly.com/</loc>');
    expect(xml).toContain('hreflang="x-default" href="https://kompaly.com/"');
  });

  it('knows the public pages and languages only', () => {
    expect(publicPage('/Connexion/')).toBe('/connexion');
    expect(publicPage('/drive')).toBeNull();
    expect(langOf('?lang=it')).toBe('it');
    expect(langOf('?lang=xx')).toBeNull();
  });
});

// Sign-up and sign-in opened by a link: their code is asked for with the page, not after preload.js.
describe('the sign-in pages’ code named in their HTML', () => {
  it('adds a modulepreload per built file, and nothing else', () => {
    const out = withPreloads(html, ['/assets/boot-Ab1.js', '/assets/AuthPage-x_Y.js', 'https://evil.example/x.js', '/assets/a.js"><script>', 42]);
    expect(out.match(/rel="modulepreload"/g)).toHaveLength(2);
    expect(out).toContain('<link rel="modulepreload" crossorigin href="/assets/AuthPage-x_Y.js">');
    expect(out).not.toContain('evil');
    expect(out).not.toContain('"><script>');
    expect(withPreloads(html, null)).toBe(html);
  });
});
