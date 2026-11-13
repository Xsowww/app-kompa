/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { handleCopilot } from './server/copilot.mjs';
import { loadPublicEnv } from './server/publicEnv.mjs';
import { guestHome, hasSession } from './src/lib/guestHome.mjs';
import { remText } from './scripts/remText.mjs';

// Public Supabase settings committed in .env.supabase.public (values in .env win).
loadPublicEnv();

/** Serves Copilot's API (and the push key, for notifications) during `npm run dev` (same handlers as server/index.mjs). */
function copilotApi(env: Record<string, string>): Plugin {
  return {
    name: 'copilot-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const { handlePush } = await import('./server/push.mjs');
        const { handleCours } = await import('./server/cours.mjs');
        const { handleInvite } = await import('./server/invite.mjs');
        if (!(await handleCopilot(req, res, env)) && !(await handlePush(req, res)) && !(await handleCours(req, res, env)) && !(await handleInvite(req, res, env))) next();
      });
    },
  };
}

/**
 * Faster start: the page asks for its files in parallel instead of one after the other. index.html gets
 * the styles at once, and a small preload.js (no inline script: the CSP forbids them) that adds, before
 * anything runs, the dictionary of the visitor's language and the code of the first page they will see:
 * the home page alone for a visitor on « / » (lib/guestHome), else the app (boot), with its shell when a
 * session is kept on this device, or the sign-in page on its addresses.
 */
function preloadPlugin(): Plugin {
  return {
    name: 'kompaly-preload',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).filter(c => c.type === 'chunk');
      const byModule = (end: string) => chunks.find(c => c.facadeModuleId?.endsWith(end)) ?? chunks.find(c => c.moduleIds.some(id => id.endsWith(end)));
      // A chunk and the chunks it imports statically (shared code), as /assets/… URLs.
      const withDeps = (end: string) => {
        const out = new Set<string>();
        const walk = (file: string) => {
          if (out.has(file)) return;
          out.add(file);
          const c = bundle[file];
          if (c?.type === 'chunk') c.imports.forEach(walk);
        };
        const c = byModule(end);
        if (c) walk(c.fileName);
        return [...out].map(f => `/${f}`);
      };
      const boot = byModule('/src/boot.tsx');
      const html = bundle['index.html'];
      if (!boot || html?.type !== 'asset') return;
      // The styles of the app and of the home page alone (src/page.ts), held by the chunks they share.
      const cssOf = (u: string) => {
        const c = bundle[u.slice(1)];
        return c?.type === 'chunk' ? [...(c.viteMetadata?.importedCss ?? [])] : [];
      };
      const css = [...new Set([...withDeps('/src/boot.tsx'), ...withDeps('/src/landing.tsx')].flatMap(cssOf))].map(f => `/${f}`);
      // Code loaded on demand with its own styles (Vite adds them once the code is there): both asked for at once.
      const withCss = (...ends: string[]) => {
        const js = [...new Set(ends.flatMap(withDeps))];
        return { js, css: [...new Set(js.flatMap(cssOf))].map(f => `/${f}`).filter(u => !css.includes(u)) };
      };
      const map = {
        dict: Object.fromEntries((['en', 'es', 'de', 'it'] as const).map(l => [l, [...withDeps(`/src/i18n/${l}.json`), ...withDeps(`/date-fns/locale/${l === 'en' ? 'en-GB' : l}.js`)]])),
        app: withCss('/src/layout/AppShell.tsx', '/src/pages/Dashboard.tsx'),
        boot: withDeps('/src/boot.tsx'),
        auth: withDeps('/src/pages/AuthPage.tsx'),
        home: withDeps('/src/pages/LandingPage.tsx'),
        landing: withDeps('/src/landing.tsx'),
        // « Affichage Pro » (cop-pro on this device, public/theme.js): the island on every page, and its home page.
        island: withCss('/src/components/Island.tsx'),
        dpro: withCss('/src/pages/DashboardPro.tsx'),
      };
      // The site's font (fonts.css), needed by every page's first words: asked for at once, not once the styles are read.
      const font = Object.keys(bundle).find(f => /\/plus-jakarta-sans-latin-wght-normal-[\w-]+\.woff2$/.test(f));
      // CSS preloaded with crossorigin as Vite's own links (its __vitePreload) so the same request serves both.
      const code = `(function(){var m=${JSON.stringify(map)},d=document;function p(a,y){for(var i=0;i<a.length;i++){var l=d.createElement('link');l.rel=y?'preload':'modulepreload';if(y){l.as='style';l.crossOrigin=''}l.href=a[i];d.head.appendChild(l)}}
var g=(/[?&]lang=([a-z]{2})/.exec(location.search)||[])[1];if(!g||!m.dict[g]&&g!=='fr'){g=void 0;try{g=localStorage.getItem('cop-lang')}catch(e){}}if(!g){var n=navigator.languages||[navigator.language];for(var i=0;i<n.length;i++){var c=String(n[i]||'').slice(0,2).toLowerCase();if(c==='fr'||m.dict[c]){g=c;break}}}if(g&&m.dict[g])p(m.dict[g]);
${hasSession}${guestHome}var s=hasSession();
p(guestHome()?m.landing:m.boot.concat(s?m.app.js:location.pathname==='/'?m.home:/^\\/(connexion|inscription|mot-de-passe-oublie|reinitialisation)\\/?$/.test(location.pathname)?m.auth:[]));
var o=s?[m.app]:[];try{if(s&&localStorage.getItem('cop-pro')){o.push(m.island);if(/^\\/(accueil)?\\/?$/.test(location.pathname))o.push(m.dpro)}}catch(e){}for(var j=0;j<o.length;j++){p(o[j].css,1);if(j)p(o[j].js)}})();`;
      const file = this.getFileName(this.emitFile({ type: 'asset', name: 'preload.js', source: code }));
      const tags = [
        `<script src="/${file}"></script>`,
        ...(font ? [`<link rel="preload" as="font" type="font/woff2" crossorigin href="/${font}">`] : []),
        ...css.map(u => `<link rel="stylesheet" crossorigin href="${u}">`),
      ].join('\n    ');
      html.source = String(html.source).replace('</head>', `    ${tags}\n  </head>`);
    },
  };
}

/**
 * The service worker (public/sw.js) names its offline copy of the app after the build: each new version online is
 * a new worker, which keeps its own files and deletes the former ones once it takes over.
 */
function swVersion(): Plugin {
  return {
    name: 'kompaly-sw-version',
    apply: 'build',
    writeBundle(options, bundle) {
      const file = join(options.dir ?? 'dist', 'sw.js');
      if (!existsSync(file)) return;
      const id = createHash('sha256').update(Object.keys(bundle).sort().join('\n')).digest('hex').slice(0, 12);
      writeFileSync(file, readFileSync(file, 'utf8').replace("const VERSION = 'dev';", `const VERSION = '${id}';`));
    },
  };
}

/**
 * The small pieces the public pages share (home page, sign-in, legal pages: the logo, a select, Kompaly's face, the
 * demo…): one file. Left to themselves they became nine tiny ones on the home page, each a request.
 */
const PUBLIC_UI = /\/src\/(components\/(FileIcon|Logo|SelectField|LanguagePicker)\.tsx|copilot\/Character\.tsx|pages\/landingDemo\.ts|pages\/legal\/links\.ts|lib\/(limits|usage)\.ts)$/;

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') } as Record<string, string>;
  return {
    plugins: [tailwindcss(), react(), copilotApi(env), preloadPlugin(), swVersion()],
    // « Taille du texte »: the text in rem (scripts/remText).
    css: { postcss: { plugins: [remText] } },
    // The commit being deployed (lib/freshness: an old tab on a public page reloads to the new version).
    define: { __BUILD__: JSON.stringify((process.env.RENDER_GIT_COMMIT ?? '').slice(0, 7)) },
    // Fewer, bigger files: all the icons (with React, which they need) in one instead of ~35 tiny ones,
    // and date-fns in one (other languages' month names load apart, see i18n).
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id: string) =>
            id.includes('/node_modules/lucide-react/')
              ? 'icons'
              : id.includes('/node_modules/date-fns/') && !/\/locale\/(?!fr\b)/.test(id)
                ? 'date'
                : PUBLIC_UI.test(id)
                  ? 'public'
                  : // Its own small file: else the public pieces would take it, and the first script would wait for them.
                    id.endsWith('/src/i18n/index.ts')
                    ? 'i18n'
                    : undefined,
        },
      },
    },
    // Only this checkout's tests (not the copies of the repo that tools keep under .claude/).
    test: { exclude: ['**/node_modules/**', '.claude/**', 'dist/**'] },
  };
});
