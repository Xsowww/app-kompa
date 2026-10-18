import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth';
import { peekAfterLogin, rememberAfterLogin } from './lib/afterLogin';
import { cx } from './lib/utils';
import { loadUserData, useWelcome } from './store/session';
import { toast } from './store/ui';
import AuthPage from './pages/AuthPage';
import MfaPage from './pages/MfaPage';
import { DialogHost, Toasts } from './components/Overlays';

// The app itself loads after the sign-in page: someone on /connexion doesn't wait for Kompaly and the editor.
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
const GroupsPage = lazy(() => import('./pages/groups/GroupsPage'));
const AgendasPage = lazy(() => import('./pages/groups/AgendasPage'));
const TrashPage = lazy(() => import('./pages/trash/TrashPage'));
const WelcomePage = lazy(() => import('./pages/WelcomePage'));
// The public home page, for visitors not signed in (and search engines).
const LandingPage = lazy(() => import('./pages/LandingPage'));

const TITLES: Record<string, string> = {
  '/': 'Accueil',
  '/drive': 'Drive',
  '/calendrier': 'Calendrier',
  '/notes': 'Notes',
  '/taches': 'Tâches',
  '/groupes': 'Groupes',
  '/agendas': 'Agendas partagés',
  '/corbeille': 'Corbeille',
  '/profil': 'Profil',
  '/admin': 'Administration',
  '/connexion': 'Connexion',
  '/inscription': 'Inscription',
  '/mot-de-passe-oublie': 'Mot de passe oublié',
  '/reinitialisation': 'Nouveau mot de passe',
  '/securite': 'Sécurité',
  '/bienvenue': 'Bienvenue',
  '/mentions-legales': 'Mentions légales',
  '/confidentialite': 'Confidentialité',
  '/conditions': 'Conditions d’utilisation',
};

/** Pages offered to search engines (same list as the sitemap, server/index.mjs). */
const INDEXED = new Set(['/', '/connexion', '/inscription', '/mentions-legales', '/confidentialite', '/conditions']);

/** The tab says where you are (history, several tabs open). */
function PageTitle() {
  const { pathname } = useLocation();
  const guest = useAuth(s => !s.user);
  useEffect(() => {
    const page = TITLES[pathname.replace(/(.)\/+$/, '$1').toLowerCase()]; // « /taches/ » and « /Taches » too
    // A visitor on « / » sees the public home page: the full name, as in index.html (search results).
    document.title = guest && pathname === '/' ? 'Kompaly · Agenda, notes, fichiers et tâches au même endroit' : page ? `${page} · Kompaly` : 'Page introuvable · Kompaly';
    // Search engines: only the public pages (home, sign-in, sign-up, legal) belong in their results.
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = INDEXED.has(pathname) ? 'index, follow' : 'noindex';
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

/** While a page's code arrives (slow network): the name pulsing, shown only after a short moment. */
function Loading({ full }: { full?: boolean }) {
  return (
    <div className={cx('late-show flex items-center justify-center', full ? 'min-h-dvh bg-paper' : 'h-full min-h-40')} role="status" aria-label="Chargement">
      <span className="animate-pulse text-[15px] font-semibold tracking-tight text-stone-500">kompaly</span>
    </div>
  );
}

/** « de Léa », « d’Admin » */
const ofName = (n: string) => (/^[aeiouyàâäéèêëîïôöûüùh]/i.test(n) ? `d’${n}` : `de ${n}`);

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
          if (name) toast(`Tu es sur le compte ${ofName(name)}`, 'success');
        } else if (sessionStorage.getItem('cop-account-switched')) {
          sessionStorage.removeItem('cop-account-switched');
          const name = useAuth.getState().user?.name;
          toast(`Un autre compte s’est connecté dans un autre onglet${name ? ` : tu es maintenant sur le compte ${ofName(name)}` : ''}. Tu peux passer d’un compte à l’autre depuis le menu de ton profil.`);
        }
      });
  }, []);

  if (!ready)
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper" role="status" aria-label="Chargement">
        <span className="animate-pulse text-[15px] font-semibold tracking-tight text-stone-400">kompaly</span>
      </div>
    );

  return (
    <BrowserRouter>
      <PageTitle />
      <Routes>
        <Route path="/connexion" element={<GuestOnly><AuthPage key="login" mode="login" /></GuestOnly>} />
        <Route path="/inscription" element={<GuestOnly><AuthPage key="register" mode="register" /></GuestOnly>} />
        <Route path="/mot-de-passe-oublie" element={<GuestOnly><AuthPage key="forgot" mode="forgot" /></GuestOnly>} />
        <Route path="/reinitialisation" element={<AuthPage key="reset" mode="reset" />} />
        <Route path="/securite" element={<MfaPage />} />
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
          <Route path="progression" element={<Navigate to="/taches" replace />} />
          <Route path="groupes" element={<Suspense fallback={<Loading />}><GroupsPage /></Suspense>} />
          <Route path="agendas" element={<Suspense fallback={<Loading />}><AgendasPage /></Suspense>} />
          <Route path="corbeille" element={<Suspense fallback={<Loading />}><TrashPage /></Suspense>} />
          <Route path="profil" element={<Suspense fallback={<Loading />}><ProfilePage /></Suspense>} />
          <Route path="admin" element={<Suspense fallback={<Loading />}><AdminPage /></Suspense>} />
        </Route>
        <Route path="*" element={<Suspense fallback={<Loading full />}><NotFoundPage /></Suspense>} />
      </Routes>
      <Toasts />
      <DialogHost />
    </BrowserRouter>
  );
}
