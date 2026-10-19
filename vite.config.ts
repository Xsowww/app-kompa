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

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') } as Record<string, string>;
  return {
    plugins: [tailwindcss(), react(), copilotApi(env)],
  };
});
