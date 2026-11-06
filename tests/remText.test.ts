import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import { readFileSync } from 'node:fs';
import { remText } from '../scripts/remText.mjs';

const run = (css: string, from = 'src/index.css') => postcss([remText]).process(css, { from }).css;

// Test n°3 (Gérard, Bernard, Marc, Paul): no way to make the text bigger. « Taille du texte » grows every text in rem.
describe('remText', () => {
  it('turns pixel font sizes and line heights into rem (the same at 100 %)', () => {
    expect(run('.a{font-size:13px;line-height:18px}')).toBe('.a{font-size:0.8125rem;line-height:1.125rem}');
    expect(run('.b{font-size:12.5px !important}')).toBe('.b{font-size:0.78125rem !important}');
  });
  it('leaves the rest alone: spacing, unitless line heights, clamp(), display sizes', () => {
    expect(run('.a{padding:13px;line-height:1.5;font-size:clamp(32px,10vw,42px)}')).toBe('.a{padding:13px;line-height:1.5;font-size:clamp(32px,10vw,42px)}');
    expect(run('.clock{font-size:40px}')).toBe('.clock{font-size:40px}');
  });
  it('keeps text-fix-* and the island in pixels', () => {
    expect(run('.text-fix-12{font-size:12px}')).toBe('.text-fix-12{font-size:12px}');
    expect(run('.min-\\[400px\\]\\:text-fix-12{@media (width>=400px){font-size:12px}}')).toContain('font-size:12px');
    expect(run('.isl{font-size:13px}', '/x/src/components/island.css')).toBe('.isl{font-size:13px}');
  });
  it('the sizes follow <html>: spacing in pixels, three text sizes', () => {
    const css = readFileSync('src/index.css', 'utf8');
    expect(css).toMatch(/--spacing: 4px;/);
    expect(css).toMatch(/html\[data-text='grand'\] \{\s*font-size: 112\.5%;/);
    expect(css).toMatch(/html\[data-text='tresgrand'\] \{\s*font-size: 125%;/);
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/postcss: \{ plugins: \[remText\] \}/);
    expect(readFileSync('public/theme.js', 'utf8')).toMatch(/cop-text/);
  });
});
