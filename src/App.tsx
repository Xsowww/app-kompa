import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth';
import { peekAfterLogin, rememberAfterLogin } from './lib/afterLogin';
import { loadUserData, useWelcome } from './store/session';
import { toast } from './store/ui';
import AuthPage from './pages/AuthPage';
import { DialogHost, ServiceBanner, Toasts } from './components/Overlays';
import { t } from './i18n';
import { PUBLIC_PAGES, pageHeads } from './lib/seoPages.mjs';

// The app itself loads after the sign-in page: someone on /connexion doesn't wait for Kompaly and the editor.
// Two-step sign-in: only the few accounts that turned it on need this page.
const MfaPage = lazy(() => import('./pages/MfaPage'));
const AppShell = lazy(() => import('./layout/AppShell'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const DrivePage = lazy(() => import('./pages/drive/DrivePage'));
const LegalPage = lazy(() => import('./pages/legal/LegalPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const CalendarPage = lazy(() => import('./pages/calendar/CalendarPage'));
const NotesPage = lazy(() => import('./pages/notes/NotesPage'));
const ProfilePage = lazy(() => import('./pages/profile/ProfilePage'));
const AdminPage = lazy(() => import('./pages/admin/AdminPage'));
const TasksPage = lazy(() => import('./pages/tasks/TasksPage'));
const RecordPage = lazy(() => import('./pages/record/RecordPage'));
const GroupsPage = lazy(() => import('./pages/groups/GroupsPage'));
const AgendasPage = lazy(() => import('./pages/groups/AgendasPage'));
const TrashPage = lazy(() => import('./pages/trash/TrashPage'));
const WelcomePage = lazy(() => import('./pages/WelcomePage'));
// The public home page, for visitors not signed in (and search engines).
const LandingPage = lazy(() => import('./pages/LandingPage'));

const TITLES: Record<string, string> = {
  '/': t('Accueil'),
  '/drive': t('Drive'),
  '/calendrier': t('Calendrier'),
  '/notes': t('Notes'),
  '/taches': t('Tâches'),
  '/enregistrer': t('Enregistrer'),
  '/groupes': t('Groupes'),
  '/agendas': t('Agendas partagés'),
  '/corbeille': t('Corbeille'),
  '/profil': t('Profil'),
  '/admin': t('Administration'),
  '/connexion': t('Connexion'),
  '/inscription': t('Inscription'),
  '/mot-de-passe-oublie': t('Mot de passe oublié'),
  '/reinitialisation': t('Nouveau mot de passe'),
  '/securite': t('Sécurité'),
  '/bienvenue': t('Bienvenue'),
  '/mentions-legales': t('Mentions légales'),
  '/confidentialite': t('Confidentialité'),
  '/conditions': t('Conditions d’utilisation'),
};

/** Pages offered to search engines (the sitemap's, server/seo.mjs), with their title and description. */
const INDEXED = new Set(PUBLIC_PAGES);
const HEADS = pageHeads(t);

/** The tab says where you are (history, several tabs open). */
function PageTitle() {
  const { pathname } = useLocation();
  const guest = useAuth(s => !s.user);
  useEffect(() => {
    const page = TITLES[pathname.replace(/(.)\/+$/, '$1').toLowerCase()]; // « /taches/ » and « /Taches » too
    // A visitor on « / » sees the public home page: the full name, as in index.html (search results).
    document.title = guest && pathname === '/' ? t('Kompaly · Agenda, notes, fichiers et tâches au même endroit') : page ? `${page} · Kompaly` : t('Page introuvable · Kompaly');
    // Search engines: only the public pages (home, sign-in, sign-up, legal) belong in their results.
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = INDEXED.has(pathname) ? 'index, follow' : 'noindex';
    // In the page's language (the HTML's is French, or the one of ?lang=…).
    const description = HEADS[pathname]?.description;
    if (description) document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', description);
  }, [pathname, guest]);
  return null;
}

export const PENDING_INVITE = 'cop-invite';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuth(s => s.user);
  const mfaStep = useAuth(s => s.mfaStep);
  const welcome = useWelcome(s => s.pending);
  const { pathname, search } = useLocation();
  // Not signed in: « / » is the public home page, the other pages of the app ask to sign in.
  if (!user) {
    // An invitation link opened signed out: kept for after sign-in (AppShell opens it).
    if (/[?&](rejoindre|invitation)=/.test(search)) sessionStorage.setItem(PENDING_INVITE, pathname + search);
    else if (pathname !== '/') rememberAfterLogin(pathname + search); // the page asked for, opened once signed in
    return pathname === '/' ? <Suspense fallback={<Loading full />}><LandingPage /></Suspense> : <Navigate to="/connexion" replace />;
  }
  if (mfaStep) return <Navigate to="/securite" replace />;
  return welcome ? <Navigate to="/bienvenue" replace /> : children;
}

/** The welcome questionnaire: only for a signed-in account that hasn't answered it yet. */
function WelcomeOnly({ children }: { children: React.ReactNode }) {
  const user = useAuth(s => s.user);
  const mfaStep = useAuth(s => s.mfaStep);
  const welcome = useWelcome(s => s.pending);
  if (!user) return <Navigate to="/connexion" replace />;
  if (mfaStep) return <Navigate to="/securite" replace />;
  return welcome ? children : <Navigate to="/" replace />;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const user = useAuth(s => s.user);
  const mfaStep = useAuth(s => s.mfaStep);
  return user ? <Navigate to={mfaStep ? '/securite' : peekAfterLogin()} replace /> : children;
}

/** Kompaly's mark, styled by index.html (.boot-*): the same as the startup screen, its small dot moving. */
const BootMark = ({ size }: { size: number }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
    <rect className="boot-tile" width="32" height="32" rx="8" />
    <circle className="boot-me" cx="13.5" cy="16.5" r="5.5" />
    <circle className="boot-friend" cx="22" cy="12.5" r="2.75" />
  </svg>
);

// The startup screen of index.html (#boot) stays while the first loadings follow one another (session, the shell,
// the page), and goes once none is left: the very same element, so no jump and no restart of its motion.
let bootHolds = 0;
function BootHold() {
  useLayoutEffect(() => {
    bootHolds++;
    return () => {
      bootHolds--;
      // After the commit: the next loading (if any) holds it before this runs, else the page is already there.
      queueMicrotask(() => bootHolds || document.getElementById('boot')?.remove());
    };
  }, []);
  return null;
}

/** While a page's code arrives (slow network): the startup screen, or (later) the same drawn again after a short moment. */
function Loading({ full }: { full?: boolean }) {
  const [boot] = useState(() => !!document.getElementById('boot'));
  if (boot) return <BootHold />;
  if (full)
    return (
      <div className="boot late-show" role="status" aria-label={t('Chargement')}>
        <BootMark size={56} />
        <span>kompaly</span>
      </div>
    );
  return (
    <div className="late-show flex h-full min-h-40 items-center justify-center" role="status" aria-label={t('Chargement')}>
      <BootMark size={28} />
    </div>
  );
}

/** « d’Admin », not « de Admin »: the French sentence differs (each language translates both the same way). */
const elides = (n: string) => /^[aeiouyàâäéèêëîïôöûüùh]/i.test(n);

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void useAuth
      .getState()
      .init()
      .then(loadUserData)
      .finally(() => {
        setReady(true);
        if (sessionStorage.getItem('cop-own-switch')) {
          sessionStorage.removeItem('cop-own-switch');
          sessionStorage.removeItem('cop-account-switched');
          const name = useAuth.getState().user?.name;
          if (name) toast(elides(name) ? t('Tu es sur le compte d’{name}', { name }) : t('Tu es sur le compte de {name}', { name }), 'success');
        } else if (sessionStorage.getItem('cop-account-switched')) {
          sessionStorage.removeItem('cop-account-switched');
          const name = useAuth.getState().user?.name;
          toast(
            !name
              ? t('Un autre compte s’est connecté dans un autre onglet. Tu peux passer d’un compte à l’autre depuis le menu de ton profil.')
              : elides(name)
                ? t('Un autre compte s’est connecté dans un autre onglet : tu es maintenant sur le compte d’{name}. Tu peux passer d’un compte à l’autre depuis le menu de ton profil.', { name })
                : t('Un autre compte s’est connecté dans un autre onglet : tu es maintenant sur le compte de {name}. Tu peux passer d’un compte à l’autre depuis le menu de ton profil.', { name }),
          );
        }
      });
  }, []);

  if (!ready) return (
    <>
      <Loading full />
      <ServiceBanner />
    </>
  );

  return (
    <BrowserRouter>
      <PageTitle />
      <Routes>
        <Route path="/connexion" element={<GuestOnly><AuthPage key="login" mode="login" /></GuestOnly>} />
        <Route path="/inscription" element={<GuestOnly><AuthPage key="register" mode="register" /></GuestOnly>} />
        <Route path="/mot-de-passe-oublie" element={<GuestOnly><AuthPage key="forgot" mode="forgot" /></GuestOnly>} />
        <Route path="/reinitialisation" element={<AuthPage key="reset" mode="reset" />} />
        <Route path="/securite" element={<Suspense fallback={<Loading full />}><MfaPage /></Suspense>} />
        <Route path="/bienvenue" element={<WelcomeOnly><Suspense fallback={<Loading full />}><WelcomePage /></Suspense></WelcomeOnly>} />
        <Route path="/mentions-legales" element={<Suspense fallback={<Loading full />}><LegalPage doc="mentions" /></Suspense>} />
        <Route path="/confidentialite" element={<Suspense fallback={<Loading full />}><LegalPage doc="confidentialite" /></Suspense>} />
        <Route path="/conditions" element={<Suspense fallback={<Loading full />}><LegalPage doc="conditions" /></Suspense>} />
        <Route element={<RequireAuth><Suspense fallback={<Loading full />}><AppShell /></Suspense></RequireAuth>}>
          <Route index element={<Suspense fallback={<Loading />}><Dashboard /></Suspense>} />
          <Route path="drive" element={<Suspense fallback={<Loading />}><DrivePage /></Suspense>} />
          <Route path="calendrier" element={<Suspense fallback={<Loading />}><CalendarPage /></Suspense>} />
          <Route path="notes" element={<Suspense fallback={<Loading />}><NotesPage /></Suspense>} />
          <Route path="taches" element={<Suspense fallback={<Loading />}><TasksPage /></Suspense>} />
          <Route path="enregistrer" element={<Suspense fallback={<Loading />}><RecordPage /></Suspense>} />
          <Route path="progression" element={<Navigate to="/taches" replace />} />
          <Route path="groupes" element={<Suspense fallback={<Loading />}><GroupsPage /></Suspense>} />
          <Route path="agendas" element={<Suspense fallback={<Loading />}><AgendasPage /></Suspense>} />
          <Route path="corbeille" element={<Suspense fallback={<Loading />}><TrashPage /></Suspense>} />
          <Route path="profil" element={<Suspense fallback={<Loading />}><ProfilePage /></Suspense>} />
          <Route path="admin" element={<Suspense fallback={<Loading />}><AdminPage /></Suspense>} />
        </Route>
        <Route path="*" element={<Suspense fallback={<Loading full />}><NotFoundPage /></Suspense>} />
      </Routes>
      <ServiceBanner />
      <Toasts />
      <DialogHost />
    </BrowserRouter>
  );
}
