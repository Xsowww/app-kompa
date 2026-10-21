import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain JavaScript module of the server
const { withHead, sitemapXml, publicPage, langOf } = await import('../server/seo.mjs');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('what search engines read', () => {
  it('gives each public page in each language its own title, description and addresses', () => {
    const en = withHead(html, '/', 'en');
    expect(en).toContain('<html lang="en"');
    expect(en).toContain('<title>Kompaly · Calendar, notes, files and tasks in one place</title>');
    expect(en).toContain('content="Kompaly brings your calendar');
    expect(en).toContain('<link rel="canonical" href="https://kompaly.com/?lang=en" />');
    expect(en).toContain('hreflang="x-default" href="https://kompaly.com/"');
    expect(en).toContain('hreflang="fr" href="https://kompaly.com/?lang=fr"');
    const fr = withHead(html, '/connexion', null);
    expect(fr).toContain('<title>Connexion · Kompaly</title>');
    expect(fr).toContain('<link rel="canonical" href="https://kompaly.com/connexion" />');
    expect(fr.match(/<title>/g)).toHaveLength(1);
  });

  it('lists every page in every language in the sitemap', () => {
    const xml = sitemapXml();
    expect(xml.match(/<url>/g)).toHaveLength(36); // 6 pages × (visitor's language + 5)
    expect(xml).toContain('<loc>https://kompaly.com/inscription?lang=de</loc>');
  });

  it('knows the public pages and languages only', () => {
    expect(publicPage('/Connexion/')).toBe('/connexion');
    expect(publicPage('/drive')).toBeNull();
    expect(langOf('?lang=it')).toBe('it');
    expect(langOf('?lang=xx')).toBeNull();
  });
});
