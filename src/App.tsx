import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './store/auth';
import { arrivedWithLink, inRecovery, linkError } from './lib/supabase';
import { peekAfterLogin, rememberAfterLogin } from './lib/afterLogin';
import { useWelcome } from './store/welcome';
import { applyAppearance, storedStyle, storedTheme, useSettings } from './store/settings';
import { toast } from './store/ui';
import { DialogHost, ServiceBanner, Toasts } from './components/Overlays';
import { t } from './i18n';
import { PUBLIC_PAGES, pageHeads } from './lib/seoPages.mjs';
import { quietly } from './page';
import { keepInvite, readInvite } from './pages/groups/invitePending';
import { rememberLegalFrom } from './pages/legal/back';

/**
 * A page's code, loaded the first time it opens. Offline, a page not opened yet can't arrive: rather than the
 * browser's « no connection » page (lib/page reloads on a failed load), its link goes back to the page you were on,
 * with a word. React.lazy keeps a load's outcome for good, so the next visit tries again.
 */
function lazyPage(load: () => Promise<{ default: React.ComponentType }>) {
  const fresh = () =>
    lazy(() =>
      load().then(
        // undefined: lib/page is reloading the page for a new version; the loading screen stays until then.
        m => m ?? new Promise<never>(() => {}),
        (e: unknown) => {
          if (navigator.onLine !== false) throw e;
          let done = false;
          const NotYet = () => {
            const back = history.length > 1;
            useEffect(() => {
              if (done) return; // StrictMode runs effects twice
              done = true;
              Lazy = fresh();
              toast(t('Cette page s’ouvrira au retour de la connexion.'));
              if (back) history.back();
            }, [back]);
            return back ? null : <p className="p-6 text-center text-[13px] text-stone-500">{t('Cette page s’ouvrira au retour de la connexion.')}</p>;
          };
          return { default: NotYet };
        },
      ),
    );
  let Lazy = fresh();
  const Page = () => <Lazy />;
  Page.load = load;
  return Page;
}

// The app itself loads after the sign-in page: someone on /connexion doesn't wait for Kompaly and the editor.
// Two-step sign-in: only the few accounts that turned it on need this page.
const MfaPage = lazy(() => import('./pages/MfaPage'));
// Sign-in and sign-up: their own code, out of the app's start (preloaded by index.html on those addresses,
// vite.config › preloadPlugin), so someone signed in doesn't download it at every start.
const AuthPage = lazy(() => import('./pages/AuthPage'));
const AppShell = lazy(() => import('./layout/AppShell'));
const Dashboard = lazyPage(() => import('./pages/Dashboard'));
const DrivePage = lazyPage(() => import('./pages/drive/DrivePage'));
const LegalPage = lazy(() => import('./pages/legal/LegalPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const CalendarPage = lazyPage(() => import('./pages/calendar/CalendarPage'));
const NotesPage = lazyPage(() => import('./pages/notes/NotesPage'));
const ProfilePage = lazyPage(() => import('./pages/profile/ProfilePage'));
const AdminPage = lazyPage(() => import('./pages/admin/AdminPage'));
const TasksPage = lazyPage(() => import('./pages/tasks/TasksPage'));
const RecordPage = lazyPage(() => import('./pages/record/RecordPage'));
const GroupsPage = lazyPage(() => import('./pages/groups/GroupsPage'));
const AgendasPage = lazyPage(() => import('./pages/groups/AgendasPage'));
const TrashPage = lazyPage(() => import('./pages/trash/TrashPage'));
// What another app shared to Kompaly (installed app, manifest's share_target): into a note and the Drive.
const SharePage = lazy(() => import('./pages/SharePage'));
const WelcomePage = lazy(() => import('./pages/WelcomePage'));
const ConfirmPage = lazy(() => import('./pages/ConfirmPage'));
// The public home page, for visitors not signed in (and search engines).
const LandingPage = lazy(() => import('./pages/LandingPage'));
const InvitePage = lazy(() => import('./pages/groups/InvitePage'));

/** Signed in and online: the main pages' code arrives while nothing else happens, so they open offline too. */
const PREFETCH: (() => Promise<unknown>)[] = [
  ...[Dashboard, CalendarPage, TasksPage, NotesPage, DrivePage, RecordPage, ProfilePage, GroupsPage, AgendasPage, TrashPage].map(p => p.load),
  () => import('./pages/notes/NoteEditor'), // a note opened offline
];
let prefetched = false;
function prefetchPages() {
  if (prefetched) return;
  prefetched = true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return; // the visitor asked to spare their data
  const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500));
  // Cut off on the way: the rest once the connection is back.
  const next = (i: number): unknown => i < PREFETCH.length && idle(() => void quietly(PREFETCH[i]).then(() => next(i + 1), () => addEventListener('online', () => next(i), { once: true })));
  setTimeout(() => next(0), 5000);
}

const TITLES: Record<string, string> = {
  '/': t('Accueil'),
  '/drive': t('Fichiers'),
  '/calendrier': t('Calendrier'),
  '/notes': t('Notes'),
  '/taches': t('Tâches'),
  '/enregistrer': t('Enregistrer'),
  '/groupes': t('Groupes'),
  '/agendas': t('Agendas partagés'),
  '/corbeille': t('Corbeille'),
  '/partage': t('Partage'),
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
  '/tarifs': t('Tarifs'),
  '/a-propos': t('Qui fait Kompaly\u00a0?'),
};

/** Pages offered to search engines (the sitemap's, server/seo.mjs), with their title and description. */
const INDEXED = new Set(PUBLIC_PAGES);
const HEADS = pageHeads(t);

/** The tab says where you are (history, several tabs open). */
function PageTitle() {
  const { pathname, search } = useLocation();
  // The page left for the legal pages: their « Retour » goes straight back to it (pages/legal/back).
  useEffect(() => rememberLegalFrom(pathname, search, window.history.state?.idx), [pathname, search]);
  const guest = useAuth(s => !s.user);
  useEffect(() => {
    const page = TITLES[pathname.replace(/(.)\/+$/, '$1').toLowerCase()]; // « /taches/ » and « /Taches » too
    // A visitor on « / » sees the public home page: the full name, as in index.html (search results).
    document.title = guest && pathname === '/' ? t('Kompaly · Agenda, notes et fichiers au même endroit, avec une IA') : page ? `${page} · Kompaly` : t('Page introuvable · Kompaly');
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

/**
 * Goes to `to`, with the loading screen meanwhile (never an empty page). Unlike <Navigate>, it goes again when another
 * navigation lands here before it (a sign-in page sending to « / » while the account needed the questionnaire left
 * a blank « / » for good: the page change runs as a transition, still waiting for the questionnaire's code).
 */
function Redirect({ to }: { to: string }) {
  const navigate = useNavigate();
  const { key } = useLocation();
  useEffect(() => {
    void navigate(to, { replace: true });
  }, [navigate, to, key]);
  return <Loading full />;
}

/** The questionnaire couldn't be checked (new device, offline): the app opens and offers it, once per visit. */
let offeredProfile = false;
function FinishProfile() {
  const navigate = useNavigate();
  useEffect(() => {
    if (offeredProfile) return;
    offeredProfile = true;
    toast(t('Termine ton profil : quelques questions pour adapter Kompaly.'), 'info', { label: t('Terminer'), run: () => void navigate('/bienvenue') }, { duration: 0 });
  }, [navigate]);
  return null;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuth(s => s.user);
  const mfaStep = useAuth(s => s.mfaStep);
  const welcome = useWelcome(s => s.pending);
  const unsure = useWelcome(s => s.unsure);
  const checking = useWelcome(s => s.checking);
  const { pathname, search } = useLocation();
  // An address the app doesn't have (the shell's « * » route below): its own page, without the app around it.
  const unknown = useParams()['*'] !== undefined;
  // Not signed in: « / » is the public home page, the other pages of the app ask to sign in.
  if (!user) {
    if (unknown) return <Suspense fallback={<Loading full />}><NotFoundPage /></Suspense>;
    // An invitation link opened signed out: its own page (who invites to what), the link kept on this device for after
    // the sign-up and its e-mail confirmation (pages/groups/invitePending; AppShell joins it).
    if (/[?&](rejoindre|invitation)=/.test(search)) {
      if (readInvite(search)) keepInvite(pathname + search);
      return <Suspense fallback={<Loading full />}><InvitePage /></Suspense>;
    }
    if (pathname !== '/') rememberAfterLogin(pathname + search); // the page asked for, opened once signed in
    return pathname === '/' ? <Suspense fallback={<Loading full />}><LandingPage /></Suspense> : <Navigate to="/connexion" replace />;
  }
  if (mfaStep) return <Redirect to="/securite" />;
  // The account is being loaded: not the app empty, then a jump to the questionnaire.
  if (checking) return <Loading full />;
  if (welcome) return <Redirect to="/bienvenue" />;
  return (
    <>
      {unsure && <FinishProfile />}
      {children}
    </>
  );
}

/** The welcome questionnaire: only for a signed-in account that hasn't answered it yet. */
function WelcomeOnly({ children }: { children: React.ReactNode }) {
  const user = useAuth(s => s.user);
  const mfaStep = useAuth(s => s.mfaStep);
  const welcome = useWelcome(s => s.pending || s.unsure);
  if (!user) return <Redirect to="/connexion" />;
  if (mfaStep) return <Redirect to="/securite" />;
  return welcome ? children : <Redirect to="/" />;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const user = useAuth(s => s.user);
  const mfaStep = useAuth(s => s.mfaStep);
  return user ? <Redirect to={mfaStep ? '/securite' : peekAfterLogin()} /> : children;
}

/** The new-password page only after a reset e-mail (or to say its link expired). */
function ResetOnly({ children }: { children: React.ReactNode }) {
  const user = useAuth(s => s.user);
  // A link in the address is checked by Supabase first (its event sets inRecovery); the form itself refuses without it.
  return linkError || inRecovery() || arrivedWithLink ? children : <Navigate to={user ? '/profil?onglet=compte' : '/mot-de-passe-oublie'} replace />;
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
/** It fades out (index.html › .boot[data-out]) instead of vanishing; renamed at once, so nothing waits on it any more. */
function fadeBoot() {
  const el = document.getElementById('boot');
  if (!el) return;
  el.id = 'boot-out';
  el.dataset.out = '';
  setTimeout(() => el.remove(), 260);
}
function BootHold() {
  useLayoutEffect(() => {
    bootHolds++;
    return () => {
      bootHolds--;
      // After the commit: the next loading (if any) holds it before this runs, else the page is already there.
      queueMicrotask(() => bootHolds || fadeBoot());
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

/**
 * The signed-in account's data (store/session, with every store: downloaded only then); signed out, only the theme
 * last used on this device. The sign-in and sign-up pages thus open without the app's code.
 */
const loadAccount = () =>
  useAuth.getState().user
    ? import('./store/session').then(m => m.loadUserData())
    : applyAppearance({ ...useSettings.getState(), theme: storedTheme() ?? 'auto', style: storedStyle() ?? 'classique', pro: false }, false);

/** « d’Admin », not « de Admin »: the French sentence differs (each language translates both the same way). */
const elides = (n: string) => /^[aeiouyàâäéèêëîïôöûüùh]/i.test(n);

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void useAuth
      .getState()
      .init()
      .then(loadAccount)
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

  const signedIn = useAuth(s => !!s.user);
  useEffect(() => {
    if (ready && signedIn) prefetchPages();
  }, [ready, signedIn]);

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
        <Route path="/connexion" element={<GuestOnly><Suspense fallback={<Loading full />}><AuthPage key="login" mode="login" /></Suspense></GuestOnly>} />
        <Route path="/inscription" element={<GuestOnly><Suspense fallback={<Loading full />}><AuthPage key="register" mode="register" /></Suspense></GuestOnly>} />
        <Route path="/mot-de-passe-oublie" element={<GuestOnly><Suspense fallback={<Loading full />}><AuthPage key="forgot" mode="forgot" /></Suspense></GuestOnly>} />
        <Route path="/reinitialisation" element={<ResetOnly><Suspense fallback={<Loading full />}><AuthPage key="reset" mode="reset" /></Suspense></ResetOnly>} />
        {/* The links of our e-mails (lib/emailLink): signed in or not, the code in the address decides. */}
        <Route path="/confirmer" element={<Suspense fallback={<Loading full />}><ConfirmPage /></Suspense>} />
        <Route path="/securite" element={<Suspense fallback={<Loading full />}><MfaPage /></Suspense>} />
        <Route path="/bienvenue" element={<WelcomeOnly><Suspense fallback={<Loading full />}><WelcomePage /></Suspense></WelcomeOnly>} />
        <Route path="/mentions-legales" element={<Suspense fallback={<Loading full />}><LegalPage doc="mentions" /></Suspense>} />
        <Route path="/confidentialite" element={<Suspense fallback={<Loading full />}><LegalPage doc="confidentialite" /></Suspense>} />
        <Route path="/conditions" element={<Suspense fallback={<Loading full />}><LegalPage doc="conditions" /></Suspense>} />
        <Route path="/tarifs" element={<Suspense fallback={<Loading full />}><LegalPage key="tarifs" doc="tarifs" /></Suspense>} />
        {/* Typed by hand by visitors looking for the price. */}
        <Route path="/prix" element={<Navigate to="/tarifs" replace />} />
        {/* « Fichiers » is the Drive's name in the app: its address typed by hand. */}
        <Route path="/fichiers" element={<Navigate to="/drive" replace />} />
        <Route path="/a-propos" element={<Suspense fallback={<Loading full />}><LegalPage key="apropos" doc="apropos" /></Suspense>} />
        <Route path="/contact" element={<Navigate to="/a-propos" replace />} />
        <Route path="/presse" element={<Navigate to="/a-propos" replace />} />
        <Route path="/qui-sommes-nous" element={<Navigate to="/a-propos" replace />} />
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
          <Route path="partage" element={<Suspense fallback={<Loading />}><SharePage /></Suspense>} />
          <Route path="accueil" element={<Navigate to="/" replace />} />
          {/* Signed in: « introuvable » inside the app, its menu still there. */}
          <Route path="*" element={<Suspense fallback={<Loading />}><NotFoundPage inShell /></Suspense>} />
        </Route>
      </Routes>
      <ServiceBanner />
      <Toasts />
      <DialogHost />
    </BrowserRouter>
  );
}
