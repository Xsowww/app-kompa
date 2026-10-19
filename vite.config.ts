import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { handleCopilot } from './server/copilot.mjs';
import { loadPublicEnv } from './server/publicEnv.mjs';

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
        if (!(await handleCopilot(req, res, env)) && !(await handlePush(req, res)) && !(await handleCours(req, res, env))) next();
      });
    },
  };
}

/**
 * Faster start: the page asks for its files in parallel instead of one after the other. index.html gets
 * the app (boot) and its styles at once, and a small preload.js (no inline script: the CSP forbids them)
 * that adds, before anything runs, the dictionary of the visitor's language and the first page they
 * will see (the app when a session is kept on this device, else the home page).
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
      const css = [...(boot.viteMetadata?.importedCss ?? [])].map(f => `/${f}`);
      const map = {
        dict: Object.fromEntries(['en', 'es', 'de', 'it'].map(l => [l, withDeps(`/src/i18n/${l}.json`)])),
        app: [...withDeps('/src/layout/AppShell.tsx'), ...withDeps('/src/pages/Dashboard.tsx')],
        home: withDeps('/src/pages/LandingPage.tsx'),
      };
      const code = `(function(){var m=${JSON.stringify(map)},d=document;function p(a){for(var i=0;i<a.length;i++){var l=d.createElement('link');l.rel='modulepreload';l.href=a[i];d.head.appendChild(l)}}
var g;try{g=localStorage.getItem('cop-lang')}catch(e){}if(!g){var n=navigator.languages||[navigator.language];for(var i=0;i<n.length;i++){var c=String(n[i]||'').slice(0,2).toLowerCase();if(c==='fr'||m.dict[c]){g=c;break}}}if(g&&m.dict[g])p(m.dict[g]);
var s=false;try{for(var k=0;k<localStorage.length;k++)if(/^sb-.+-auth-token$/.test(localStorage.key(k)||'')){s=true;break}if(!s)for(k=0;k<sessionStorage.length;k++)if(/^sb-.+-auth-token$/.test(sessionStorage.key(k)||'')){s=true;break}}catch(e){}
p(s?m.app:location.pathname==='/'?m.home:[])})();`;
      const file = this.getFileName(this.emitFile({ type: 'asset', name: 'preload.js', source: code }));
      const tags = [
        `<script src="/${file}"></script>`,
        ...withDeps('/src/boot.tsx').map(u => `<link rel="modulepreload" crossorigin href="${u}">`),
        ...css.map(u => `<link rel="stylesheet" crossorigin href="${u}">`),
      ].join('\n    ');
      html.source = String(html.source).replace('</head>', `    ${tags}\n  </head>`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') } as Record<string, string>;
  return {
    plugins: [tailwindcss(), react(), copilotApi(env), preloadPlugin()],
    // The commit being deployed (lib/freshness: an old tab on a public page reloads to the new version).
    define: { __BUILD__: JSON.stringify((process.env.RENDER_GIT_COMMIT ?? '').slice(0, 7)) },
  };
});
