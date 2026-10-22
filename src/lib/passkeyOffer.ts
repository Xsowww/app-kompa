import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { passkeysAvailable } from './supabase';
import { t } from '../i18n';

/**
 * After a sign-in with the password, on a phone or computer that has Face ID, a fingerprint reader or
 * Windows Hello: offered once per account and device (Profile › Account says how to do it later).
 */
export async function offerPasskey(userId: string) {
  const key = `cop-passkey-offer:${userId}`;
  try {
    if (localStorage.getItem(key)) return;
  } catch {
    return; // storage blocked: it would come back at each sign-in
  }
  if (!(await passkeysAvailable())) return;
  const device = await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false);
  if (!device) return;
  const mine = await useAuth
    .getState()
    .listPasskeys()
    .catch(() => null);
  if (!mine || mine.length) return;
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* asked again next time */
  }
  toast(t('La prochaine fois, connecte-toi avec Face ID ou ton empreinte ?'), 'info', {
    label: t('Activer'),
    run: () =>
      void useAuth
        .getState()
        .addPasskey()
        .then(
          ok => ok && toast(t('C’est prêt : la prochaine fois, connecte-toi avec Face ID ou ton empreinte.'), 'success'),
          e => toast((e as Error).message, 'error'),
        ),
  });
}
