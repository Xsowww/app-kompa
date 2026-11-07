/**
 * « Taille du texte » (Profil › Apparence, store/settings): the text follows the font size of <html> (100 %, 112.5 %,
 * 125 %, and the browser's own setting). The sources keep their usual pixel sizes (`text-[13px]`, `font-size: 13px`):
 * this PostCSS plugin (vite.config) turns every font size and line height written as plain pixels into rem
 * (13px → 0.8125rem, the same at 100 %). The spacing stays in pixels (index.css › --spacing): only the text grows, the
 * layout keeps its breakpoints. A size that must not grow is written `text-fix-12` (index.css); display sizes (28 px
 * and more: big titles, the clock, counters, already easy to read) and the island (a fixed shape, its own CSS) keep
 * their pixels. Tested in tests/remText.test.ts.
 */
export const remText = {
  postcssPlugin: 'kompaly-rem-text',
  /** @param {{ prop: string, value: string, parent?: { parent?: unknown, selector?: string }, source?: { input?: { file?: string } } }} decl */
  Declaration(decl) {
    if (decl.prop !== 'font-size' && decl.prop !== 'line-height') return;
    if (/island(Hub)?\.css$/.test(decl.source?.input?.file ?? '')) return;
    for (let n = /** @type {any} */ (decl.parent); n; n = n.parent) if (n.selector?.includes('text-fix-')) return;
    const m = /^(-?\d*\.?\d+)px(\s*!important)?$/.exec(decl.value.trim());
    if (m && (decl.prop === 'line-height' || Number(m[1]) < 28)) decl.value = `${+(Number(m[1]) / 16).toFixed(5)}rem${m[2] ?? ''}`;
  },
};
