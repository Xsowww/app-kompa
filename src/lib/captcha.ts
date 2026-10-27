// Anti-robot check (Cloudflare Turnstile) before every call Supabase protects with a captcha:
// sign-up, sign-in, password check, forgotten password, confirmation e-mail sent again.
// Invisible for nearly everyone: a Kompaly window with the box opens only when Cloudflare wants a click.
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

/**
 * The window shown when Cloudflare wants a click: Kompaly's own card (drone, title, one line), the box in the
 * middle, « Annuler ». Present but transparent until then: the box runs inside it, and moving it would reload it.
 */
function windowFor(onCancel: () => void) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4 opacity-0 pointer-events-none transition-opacity duration-200';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'captcha-title');
  overlay.innerHTML = `
    <div class="w-full max-w-[360px] rounded-3xl border border-stone-200 bg-surface p-6 text-center text-ink shadow-2xl">
      <img src="/kompaly/drone-mail.png" alt="" width="160" height="100" class="mx-auto -mt-2 h-[100px] w-auto drop-shadow-[0_6px_10px_rgba(0,0,0,0.18)]" />
      <h2 id="captcha-title" class="mt-2 text-[19px] font-bold tracking-[-0.01em]"></h2>
      <p class="mt-1 text-[14px] text-stone-500"></p>
      <div data-box class="mt-5 flex min-h-[68px] justify-center"></div>
      <button type="button" class="btn-ghost mt-3 text-[13px]"></button>
    </div>`;
  overlay.querySelector('h2')!.textContent = t('Une petite vérification');
  overlay.querySelector('p')!.textContent = t('Coche la case : c’est pour bloquer les robots, pas toi.');
  const cancel = overlay.querySelector('button')!;
  cancel.textContent = t('Annuler');
  cancel.addEventListener('click', onCancel);
  overlay.addEventListener('keydown', e => e.key === 'Escape' && onCancel());
  document.body.appendChild(overlay);
  return {
    box: overlay.querySelector<HTMLElement>('[data-box]')!,
    show: () => {
      overlay.classList.remove('opacity-0', 'pointer-events-none');
      cancel.focus();
    },
    remove: () => overlay.remove(),
  };
}

function solve(): Promise<string> {
  return load().then(
    ts =>
      new Promise<string>((resolve, reject) => {
        let id = '';
        const done = (fn: () => void) => {
          clearTimeout(timer);
          try {
            if (id) ts.remove(id);
          } catch {
            /* already gone */
          }
          win.remove();
          fn();
        };
        const win = windowFor(() => done(() => reject(new Error(FAILED))));
        const timer = setTimeout(() => done(() => reject(new Error(FAILED))), 90_000);
        id = ts.render(win.box, {
          sitekey: SITE_KEY,
          appearance: 'interaction-only', // invisible for nearly everyone; the window opens only for a click
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
          language: lang,
          'before-interactive-callback': win.show,
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
