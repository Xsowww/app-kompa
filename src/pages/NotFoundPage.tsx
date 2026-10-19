import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Logo from '../components/Logo';
import { t } from '../i18n';

/** An address that leads nowhere (a typo, an old link): say so, and one way back. */
export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-dvh flex-col bg-paper px-4 py-6 sm:px-8">
      <header>
        <Link to="/" className="inline-flex rounded-lg" aria-label={t('Kompaly, accueil')}>
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-[440px] rounded-[28px] bg-surface p-7 text-center shadow-card sm:p-9">
          {/* The logo's two dots, the small one gone off on its own. */}
          <svg viewBox="0 0 120 64" width="120" height="64" className="mx-auto" aria-hidden>
            <circle cx="34" cy="36" r="20" fill="var(--color-ink)" />
            <circle cx="98" cy="14" r="9" fill="#3d63dd" />
            <path d="M58 30 Q72 12 86 16" fill="none" stroke="var(--color-stone-300)" strokeWidth="2.5" strokeDasharray="2 6" strokeLinecap="round" />
          </svg>
          <p className="eyebrow mt-6">{t('Erreur 404')}</p>
          <h1 className="mt-1.5 text-[26px] leading-tight">{t('Cette page est introuvable')}</h1>
          <p className="mt-3 truncate rounded-lg bg-stone-50 px-3 py-1.5 font-mono text-[12px] text-stone-500" title={pathname}>
            kompaly.com{pathname}
          </p>
          <Link to="/" className="btn-primary mt-6 h-11 w-full text-[15px]">
            <ArrowLeft size={16} aria-hidden /> {t('Retour à l’accueil')}
          </Link>
        </div>
      </main>
    </div>
  );
}
