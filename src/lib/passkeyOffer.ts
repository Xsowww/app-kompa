import { useAuth } from '../store/auth';
import { toast, useUi } from '../store/ui';
import { useSettings } from '../store/settings';
import { useWelcome } from '../store/welcome';
import { passkeysAvailable, remembered } from './supabase';
import { t } from '../i18n';

/** Phones and tablets (a finger, no mouse): Face ID or a fingerprint is how they open. Never on a computer. */
export const touchDevice = () => typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

/** Nothing else on screen asks for attention: the app shown (questionnaire done), no menu (« + »), no window open. */
const quiet = () =>
  !useWelcome.getState().pending &&
  !useWelcome.getState().checking &&
  location.pathname !== '/bienvenue' &&
  // Kompaly's panel stays in the page, hidden (aria-hidden, inert) while closed: only what is shown counts.
  ![...document.querySelectorAll<HTMLElement>('[role="menu"], [aria-modal="true"], [role="dialog"]')].some(e => !e.closest('[aria-hidden="true"], [inert]') && e.getClientRects().length > 0);

const OFFER = () => t('La prochaine fois, connecte-toi avec Face ID ou ton empreinte ?');

/**
 * After a sign-in with the password (and the phone's code, with two-factor on), on a phone or tablet that has Face ID or
 * a fingerprint reader: offered once per account (its settings, on every device) once the questionnaire is done, when no
 * menu or window is open. Closed (✕) or accepted, it never comes back; Settings › Account says how to do it later.
 */
export async function offerPasskey(userId: string) {
  if (!remembered() || !touchDevice()) return; // a shared device, or a computer
  const key = `cop-passkey-offer:${userId}`;
  try {
    if (localStorage.getItem(key)) return;
  } catch {
    return; // storage blocked: it would come back at each sign-in
  }
  if (useSettings.getState().passkeyOffered) return;
  if (!(await passkeysAvailable())) return;
  const device = await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false);
  if (!device) return;
  const mine = await useAuth
    .getState()
    .listPasskeys()
    .catch(() => null);
  if (!mine || mine.length) return;
  // The questionnaire first, then a calm moment on the app (checked every second, for 10 minutes at most).
  for (let i = 0; i < 600 && !quiet(); i++) await new Promise(r => setTimeout(r, 1000));
  await new Promise(r => setTimeout(r, 1500));
  if (!quiet() || useAuth.getState().user?.id !== userId || useSettings.getState().passkeyOffered) return;
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* the account's settings remember it */
  }
  useSettings.getState().set({ passkeyOffered: true });
  toast(
    OFFER(),
    'info',
    {
      label: t('Activer'),
      run: () =>
        void useAuth
          .getState()
          .addPasskey()
          .then(
            ok => ok && toast(t('C’est prêt : la prochaine fois, connecte-toi avec Face ID ou ton empreinte.'), 'success'),
            e => toast((e as Error).message, 'error'),
          ),
    },
    { duration: 15000 },
  );
  // A menu (« + ») or a window opened meanwhile: the offer gives way rather than covering it.
  const watch = new MutationObserver(() => {
    const shown = useUi.getState().toasts.find(x => x.text === OFFER());
    if (!shown) return watch.disconnect();
    if (!quiet()) {
      useUi.getState().dismissToast(shown.id);
      watch.disconnect();
    }
  });
  watch.observe(document.body, { childList: true, subtree: true });
}
