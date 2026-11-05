import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../store/auth';
import { afterSignIn } from '../store/welcome';
import { toast } from '../store/ui';
import { afterLink, parseEmailLink } from '../lib/emailLink';
import { t } from '../i18n';

const loadUserData = () => import('../store/session').then(m => m.loadUserData());

/**
 * kompaly.com/confirmer?token_hash=…&type=… — where the links of our e-mails lead (not a supabase.co address):
 * the code is checked here, then the account opens where it should (questionnaire, new password, Profil…).
 */
export default function ConfirmPage() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const link = parseEmailLink(search);
  const [failed, setFailed] = useState(false);
  const started = useRef(false); // once: StrictMode runs effects twice, and a code works only once

  useEffect(() => {
    if (!link || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const user = await useAuth.getState().confirmLink(link.tokenHash, link.type);
        const next = afterLink(link.type);
        if (link.type === 'email_change') {
          toast(user ? t('Ta nouvelle adresse est confirmée.') : t('Lien accepté : confirme aussi depuis l’autre adresse.'), 'success');
          return navigate(user ? next! : '/connexion', { replace: true });
        }
        if (useAuth.getState().mfaStep) return navigate('/securite', { replace: true });
        if (next) return navigate(next, { replace: true });
        await loadUserData();
        if (link.type === 'signup' || link.type === 'email') toast(t('Adresse confirmée, bienvenue !'), 'success');
        navigate(afterSignIn(), { replace: true });
      } catch {
        // Expired, already used, or opened twice: an open session means the account is already in.
        if (useAuth.getState().user && link.type !== 'recovery') return navigate(afterSignIn(), { replace: true });
        setFailed(true);
      }
    })();
  }, [link, navigate]);

  if (!link) return <Navigate to="/connexion" replace />;
  return (
    <div className="flex min-h-dvh flex-col bg-paper px-4 py-6 sm:px-8">
      <Link to="/" aria-label={t('Accueil')} className="inline-flex self-start rounded-md">
        <Logo />
      </Link>
      <main className="m-auto w-full max-w-[420px] rounded-[28px] bg-surface p-7 text-center shadow-card sm:p-9">
        {failed ? (
          <>
            <h1 className="text-[22px] leading-tight">{t('Ce lien ne marche plus')}</h1>
            <p className="mt-2 text-[14px] text-stone-600">
              {link.type === 'recovery'
                ? t('Il a expiré ou il a déjà servi. Demande un nouveau lien pour changer ton mot de passe.')
                : t('Il a expiré ou il a déjà servi. Si ton adresse est déjà confirmée, connecte-toi simplement ; sinon, demande un nouveau mail depuis la page de connexion.')}
            </p>
            <Link to={link.type === 'recovery' ? '/mot-de-passe-oublie' : '/connexion'} className="btn-primary mt-6 h-11 w-full text-[15px]">
              {link.type === 'recovery' ? t('Recevoir un nouveau lien') : t('Se connecter')}
            </Link>
          </>
        ) : (
          <div role="status" aria-live="polite">
            <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-[3px] border-stone-200 border-t-brand-500 motion-reduce:animate-none" aria-hidden />
            <p className="mt-4 text-[15px] font-medium">{t('Vérification du lien…')}</p>
          </div>
        )}
      </main>
    </div>
  );
}
