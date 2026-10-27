// What search engines read: robots.txt, sitemap.xml, and the head of each public page.
// Each language has its own address (?lang=en…), announced with hreflang: Google crawls with an English
// browser, and without them it only ever saw the English page under the French description.

import { readFileSync } from 'node:fs';
import { PUBLIC_PAGES, pageHeads } from '../src/lib/seoPages.mjs';

export const LANGS = ['fr', 'en', 'es', 'de', 'it'];
const OG_LOCALE = { fr: 'fr_FR', en: 'en_GB', es: 'es_ES', de: 'de_DE', it: 'it_IT' };

/** The app's translations (keyed by the French text, as t() in src/i18n); a missing file: French. */
function dict(lang) {
  if (lang === 'fr') return {};
  try {
    return JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8'));
  } catch {
    return {};
  }
}
const HEADS = Object.fromEntries(
  LANGS.map(l => {
    const d = dict(l);
    return [l, pageHeads(fr => d[fr] || fr.split('||')[0])];
  }),
);

// Never the request's Host header: anyone could make robots.txt and sitemap.xml list their own site.
export const siteUrl = () => (process.env.SITE_URL || 'https://kompaly.com').replace(/\/+$/, '');

/** « /Connexion/ » → « /connexion » when it is a public page, else null. */
export const publicPage = path => {
  const p = path.replace(/(.)\/+$/, '$1').toLowerCase();
  return PUBLIC_PAGES.includes(p) ? p : null;
};

/** The language asked in the address (?lang=en), or null. */
export const langOf = search => {
  const l = new URLSearchParams(search).get('lang');
  return LANGS.includes(l) ? l : null;
};

const url = (page, lang) => `${siteUrl()}${page}${lang ? `?lang=${lang}` : ''}`;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Inside a JSON string of a <script> (the JSON-LD). */
const jsonEsc = s => JSON.stringify(String(s)).slice(1, -1).replace(/</g, '\\u003c');

/** The address of each version: x-default (the visitor's language) and one per language. */
const alternates = page => [['x-default', url(page, null)], ...LANGS.map(l => [l, url(page, l)])];

/**
 * index.html with the head of this public page in this language (null: the visitor's language, French
 * in the HTML): its title, description, own address (canonical) and the addresses of its other languages.
 */
export function withHead(html, page, lang) {
  const l = lang ?? 'fr';
  const { title, description } = HEADS[l][page];
  const links = [
    `<link rel="canonical" href="${esc(url(page, lang))}" />`,
    `<meta property="og:url" content="${esc(url(page, lang))}" />`,
    ...alternates(page).map(([hl, href]) => `<link rel="alternate" hreflang="${hl}" href="${esc(href)}" />`),
  ].join('\n    ');
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${l}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(description)}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(page === '/' ? 'Kompaly' : title)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(description)}`)
    .replace(/(<meta property="og:locale" content=")[^"]*/, `$1${OG_LOCALE[l]}`)
    // The app's description in the JSON-LD: the home page's, in this language.
    .replace(/("@type": "WebApplication",[\s\S]*?"description": ")[^"]*/, (_, head) => `${head}${jsonEsc(HEADS[l]['/'].description)}`)
    .replace('</head>', `  ${links}\n  </head>`);
}

export const robotsTxt = () => `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl()}/sitemap.xml\n`;

/**
 * Each listed page in every language (?lang=…: the address without it shows the same French page, under
 * another canonical), each listing its other languages and x-default (what Google asks for hreflang).
 */
// Only the pages worth finding in a search: sign-in and the legal pages stay reachable, but listing them in
// 5 languages made Google put the whole site aside (« Détectée, actuellement non indexée »).
const SITEMAP_PAGES = ['/', '/inscription'];

export function sitemapXml() {
  const entries = SITEMAP_PAGES.flatMap(page => {
    const links = alternates(page)
      .map(([hl, href]) => `    <xhtml:link rel="alternate" hreflang="${hl}" href="${esc(href)}"/>`)
      .join('\n');
    return LANGS.map(l => `  <url>\n    <loc>${esc(url(page, l))}</loc>\n${links}\n  </url>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`;
}
