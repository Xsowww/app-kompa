// Anti-robot check (Cloudflare Turnstile) before every call Supabase protects with a captcha:
// sign-up, sign-in, password check, forgotten password, confirmation e-mail sent again.
// Invisible for nearly everyone: a small box shows up only when Cloudflare wants a click.
//
// Off until VITE_TURNSTILE_SITE_KEY is set (.env.supabase.public). Turn the captcha on in Supabase
// (Authentication › Attack Protection) only AFTER the site with the key is online, or sign-ins fail.
// Test period: captcha off in Supabase first, then VITE_CAPTCHA_OFF=1 on Render; back on in the other order.

import { lang, t } from '../i18n';

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? '';
// Switched off for a test period with VITE_CAPTCHA_OFF=1 on the host (Render), together with the captcha in Supabase.
const OFF = /^(1|true|oui)$/i.test(String(import.meta.env.VITE_CAPTCHA_OFF ?? '').trim());
// Same test as lib/supabase (not imported from it: it imports this file).
export const captchaEnabled = !OFF && !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY && !!SITE_KEY;

interface Turnstile {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let script: Promise<Turnstile> | null = null;
function load(): Promise<Turnstile> {
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => {
      script = null; // next try loads it again
      reject(new Error('turnstile'));
    };
    document.head.appendChild(s);
  });
  return script;
}

const FAILED = t('La vérification anti-robot n’a pas abouti. Vérifie ta connexion et réessaie.');

function solve(): Promise<string> {
  return load().then(
    ts =>
      new Promise<string>((resolve, reject) => {
        // Shown only if Cloudflare asks for a click (appearance « interaction-only »).
        const host = document.createElement('div');
        host.setAttribute('role', 'dialog');
        host.setAttribute('aria-label', t('Vérification anti-robot'));
        host.className = 'fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 empty:hidden';
        document.body.appendChild(host);
        let id = '';
        const done = (fn: () => void) => {
          clearTimeout(timer);
          try {
            if (id) ts.remove(id);
          } catch {
            /* already gone */
          }
          host.remove();
          fn();
        };
        const timer = setTimeout(() => done(() => reject(new Error(FAILED))), 90_000);
        id = ts.render(host, {
          sitekey: SITE_KEY,
          appearance: 'interaction-only',
          language: lang,
          callback: (token: string) => done(() => resolve(token)),
          'error-callback': () => done(() => reject(new Error(FAILED))),
          'expired-callback': () => done(() => reject(new Error(FAILED))),
        });
      }),
    () => {
      throw new Error(FAILED);
    },
  );
}

// A token is good for 5 minutes and one use: one is made in advance when the sign-in page opens.
let ready: { token: Promise<string>; at: number } | null = null;

/** Starts the check in the background (sign-in page): the click on « Se connecter » doesn't wait. */
export function prefetchCaptcha() {
  if (!captchaEnabled || (ready && Date.now() - ready.at < 4 * 60_000)) return;
  const token = solve();
  token.catch(() => {
    if (ready?.token === token) ready = null;
  });
  ready = { token, at: Date.now() };
}

/** A fresh token for the next protected call, or undefined when the captcha is off. */
export async function captchaToken(): Promise<string | undefined> {
  if (!captchaEnabled) return undefined;
  const r = ready && Date.now() - ready.at < 4 * 60_000 ? ready : null;
  ready = null;
  return r ? r.token.catch(() => solve()) : solve();
}
