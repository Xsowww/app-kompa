import { Fragment, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Mic, House, FolderClosed, CalendarDays, CalendarRange, NotebookText, Search, FileText, Folder, CalendarClock, Settings2, ChartNoAxesColumn, ListChecks, Users, Trash2, ArrowLeftRight, UserRound, UserPlus, MessageSquareText } from 'lucide-react';
import { FeedbackDialog } from '../components/FeedbackDialogs';
import { openFeedback } from '../lib/feedback';
import { useAuth } from '../store/auth';
import Copilot from '../copilot/Copilot';
import Tour from '../components/Tour';
import { startProactive } from '../copilot/proactive';
import { registerNavigate, search, type SearchHit } from '../copilot/actions';
import Logo from '../components/Logo';
import Avatar from '../components/Avatar';
import FocusTimer from '../components/FocusTimer';
import { cx } from '../lib/utils';
import { adminPendingCount, checkIsAdmin, cloudEnabled } from '../lib/supabase';
import { startReminders } from '../lib/reminderScheduler';
import { useAgendaNews, totalAgendaNews, watchAgendaNews } from '../store/agendaNews';
import { useUi } from '../store/ui';
import { useGroupActivity, totalUnread } from '../store/groupActivity';
import { useTrashCount } from '../lib/trash';
import { useSettings } from '../store/settings';
import { WORDS } from '../lib/usage';
import { ContextMenu, ReminderAlerts } from '../components/Overlays';
import { PENDING_INVITE } from '../App';
import { JoinedDialog } from '../pages/groups/Joined';
import RecPill from '../pages/record/RecPill';
import { useInvitations } from '../pages/groups/join';
import { needsCredentials, savedAccounts, type SavedAccount } from '../lib/accounts';

const SPACE_COLORS = { home: 'var(--color-brand-500)', drive: '#3b6fd8', calendar: '#d9483b', notes: '#d48a17' };

const NAV = [
  { to: '/', label: 'Accueil', icon: House, end: true, color: SPACE_COLORS.home },
  { to: '/calendrier', label: 'Calendrier', icon: CalendarDays, color: SPACE_COLORS.calendar },
  { to: '/taches', label: 'Tâches', icon: ListChecks, color: '#2f9e6b' },
  { to: '/notes', label: 'Notes', icon: NotebookText, color: SPACE_COLORS.notes },
  { to: '/drive', label: 'Drive', icon: FolderClosed, color: SPACE_COLORS.drive },
  // Phones: from the home page (the tab bar is full).
  { to: '/enregistrer', label: 'Enregistrer', icon: Mic, color: '#e5484d', phone: false },
  // `section`: a small title above this entry in the sidebar (what is shared with others comes after).
  { to: '/groupes', label: 'Groupes', icon: Users, color: '#1f8a8a', section: 'Espaces partagés' },
  { to: '/agendas', label: 'Agendas partagés', short: 'Agendas', icon: CalendarRange, color: '#7a5ad6' },
];

const HIT_ICON: Record<SearchHit['type'], typeof FileText> = {
  dossier: Folder,
  fichier: FileText,
  note: NotebookText,
  'dossier de notes': Folder,
  événement: CalendarClock,
  tâche: ListChecks,
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** `onDone(cancelled)`: closed with Échap (true) or a result chosen (false). */
function GlobalSearch({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: (cancelled: boolean) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = q.trim() ? search(q, 8) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only the copy on screen (the desktop one is hidden below 1024 px: AppShell opens the other).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && inputRef.current?.offsetParent) {
        e.preventDefault();
        // Not from behind an open dialog (file preview…): its results would sit under the dimmed backdrop.
        if (document.querySelector('[aria-modal="true"]')) return;
        if (document.activeElement !== inputRef.current) before.current = document.activeElement as HTMLElement | null;
        inputRef.current.focus();
        inputRef.current.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Keyboard users: back where they were after Échap, on the page content after a result (not on <body>).
  const before = useRef<HTMLElement | null>(null);
  const leave = (to: HTMLElement | null) => {
    inputRef.current?.blur();
    if (!onDone) setTimeout(() => (to?.isConnected ? to : document.getElementById('contenu'))?.focus(), 0);
  };

  const go = (hit: SearchHit) => {
    navigate(hit.to);
    setQ('');
    setOpen(false);
    leave(null);
    onDone?.(false);
  };

  return (
    <div className={cx('relative w-full', !onDone && 'max-w-[300px]')}>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={q}
        onChange={e => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          // The arrows move in the results, not the caret.
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(a => (e.key === 'ArrowDown' ? Math.min(a + 1, hits.length - 1) : Math.max(a - 1, 0)));
          }
          if (e.key === 'Enter' && hits[active]) go(hits[active]);
          if (e.key === 'Escape') {
            e.stopPropagation(); // only the search closes (not Kompaly open behind it)
            setQ('');
            leave(before.current);
            onDone?.(true);
          }
        }}
        placeholder="Rechercher"
        aria-label="Rechercher dans tes fichiers, notes, événements et tâches"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && !!q.trim()}
        aria-controls="recherche-resultats"
        aria-activedescendant={open && hits[active] ? `recherche-${active}` : undefined}
        // A card-like field (border + surface): the grey tint alone barely stood out from the page, light or dark.
        className="h-10 w-full rounded-[14px] border border-transparent bg-surface pl-9 pr-14 text-[13.5px] text-ink outline-none transition placeholder:text-stone-500 hover:border-stone-200 focus:border-focus focus:ring-1 focus:ring-focus"
      />
      <span aria-hidden className="kbd pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 sm:inline-flex">{isMac ? '⌘' : 'Ctrl'} K</span>
      {open && q.trim() && (
        <div id="recherche-resultats" role="listbox" aria-label="Résultats de recherche" className="enter absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-[18px] border border-stone-200 bg-surface p-1 shadow-pop">
          {hits.length === 0 && <p className="px-3 py-5 text-center text-[13px] text-stone-500 [overflow-wrap:anywhere]">Aucun résultat pour «&nbsp;{q}&nbsp;»</p>}
          {hits.map((h, i) => {
            const Icon = HIT_ICON[h.type];
            return (
              <button
                key={h.type + h.id}
                id={`recherche-${i}`}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                onMouseDown={() => go(h)}
                onMouseEnter={() => setActive(i)}
                className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left', i === active && 'bg-stone-100')}
              >
                <Icon size={15} className="shrink-0 text-stone-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{h.title}</span>
                  <span className="block truncate text-[12px] text-stone-500">{h.where}</span>
                </span>
                <span className="inline-block shrink-0 text-[11px] text-stone-500 first-letter:uppercase">{h.type}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Other accounts of this device in one click, or a new one (see lib/accounts). */
function AccountSwitch({ currentId }: { currentId: string }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const others = menu ? savedAccounts().filter(a => a.id !== currentId) : [];
  const open = (a: SavedAccount) => {
    if (needsCredentials(a)) return void useAuth.getState().addAccount(a.email);
    void useAuth.getState().switchAccount(a.id).then(r => {
      if (r === 'credentials') void useAuth.getState().addAccount(a.email);
    });
  };
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        title="Changer de compte"
        aria-label="Changer de compte"
        aria-haspopup="menu"
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.top - 8 - 44 * (savedAccounts().filter(a => a.id !== currentId).length + 1) });
        }}
      >
        <ArrowLeftRight size={15} />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Changer de compte"
          onClose={() => setMenu(null)}
          items={[
            ...others.map(a => ({ label: `${a.name || a.email} · ${a.email}`, icon: <UserRound size={15} />, onClick: () => open(a) })),
            ...(others.length ? [{ label: '', divider: true, onClick: () => {} }] : []),
            { label: 'Ajouter un compte', icon: <UserPlus size={15} />, onClick: () => void useAuth.getState().addAccount() },
          ]}
        />
      )}
    </>
  );
}

export default function AppShell() {
  const groupsLabel = (WORDS[useSettings(st => st.usage)] ?? WORDS.etudes).groups;
  const label = (n: { to: string; label: string }) => (n.to === '/groupes' ? groupsLabel : n.label);
  const navigate = useNavigate();
  const user = useAuth(s => s.user)!;
  const trashCount = useTrashCount();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchBtn = useRef<HTMLButtonElement>(null);
  // Another page: the search field opened on a phone closes.
  const { pathname } = useLocation();
  const [searchPath, setSearchPath] = useState(pathname);
  if (searchPath !== pathname) {
    setSearchPath(pathname);
    setSearchOpen(false);
  }
  // Ctrl+K on a narrow window: no search field in the header, open the one under it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !window.matchMedia('(min-width: 1024px)').matches) {
        e.preventDefault();
        if (!document.querySelector('[aria-modal="true"]')) setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const trashLabel = trashCount ? `Corbeille, ${trashCount} élément${trashCount > 1 ? 's' : ''}` : 'Corbeille';

  useEffect(() => registerNavigate(navigate), [navigate]);
  // Invitation links: joined, then a window says so (pages/groups/Joined). One opened before signing in
  // (App › RequireAuth) is joined now, without leaving the page shown after sign-in.
  const [pendingInvite] = useState(() => sessionStorage.getItem(PENDING_INVITE));
  useEffect(() => sessionStorage.removeItem(PENDING_INVITE), []);
  useInvitations(pendingInvite);
  useEffect(() => startProactive(), []);
  // Rappels des événements et des tâches (dans l'appli, et par notifications push en ligne).
  useEffect(() => startReminders(user.id), [user.id]);

  // Nouveautés dans les groupes : pastilles + notifications (version en ligne).
  useEffect(() => {
    if (!cloudEnabled) return;
    void useGroupActivity.getState().start();
    return () => useGroupActivity.getState().stop();
  }, [user.id]);
  const groupNews = useGroupActivity(s => Object.values(s.unread).reduce((n, c) => n + totalUnread(c), 0));
  // Shared calendars: what the others changed since my last visit (store/agendaNews).
  useEffect(() => (cloudEnabled ? watchAgendaNews() : undefined), [user.id]);
  const agendaNews = useAgendaNews(s => totalAgendaNews(s.news));
  const news = (to: string) => (to === '/groupes' ? groupNews : to === '/agendas' ? agendaNews : 0);

  // Lien « Administration » : seulement pour les comptes déclarés dans public.admins.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!cloudEnabled) return;
    let alive = true;
    checkIsAdmin().then(ok => alive && setIsAdmin(ok), () => {});
    return () => {
      alive = false;
    };
  }, [user.id]);
  // Pastille « à traiter » : signalements et avis encore ouverts, revus toutes les 2 minutes et au retour sur l'onglet.
  const adminPending = useUi(s => s.adminPending);
  useEffect(() => {
    if (!isAdmin) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void adminPendingCount().then(n => n !== null && useUi.setState({ adminPending: n }));
    };
    refresh();
    const t = setInterval(refresh, 120_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [isAdmin]);
  const adminLabel = adminPending ? `Administration, ${adminPending} élément${adminPending > 1 ? 's' : ''} à traiter` : 'Administration';

  return (
    <div className="flex h-full">
      <a href="#contenu" className="skip-link" onClick={e => { e.preventDefault(); document.getElementById('contenu')?.focus(); }}>
        Aller au contenu
      </a>
      {/* Sidebar (desktop) */}
      <aside aria-label="Barre latérale" className="m-3 mr-0 hidden w-[244px] shrink-0 flex-col rounded-[24px] bg-surface px-3 pb-3 pt-4 lg:flex">
        <div className="mb-6 px-2">
          <Logo />
        </div>
        <nav aria-label="Navigation principale" className="flex flex-1 flex-col gap-1">
          {NAV.map(n => (
            <Fragment key={n.to}>
            {'section' in n && <p className="mb-1 mt-5 px-2.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-stone-500">{n.section}</p>}
            <NavLink
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx(
                  'flex h-10 items-center gap-3 rounded-[14px] border px-2.5 text-[14px] font-medium transition-colors',
                  isActive ? 'border-transparent bg-ink font-semibold text-paper' : 'border-transparent text-stone-600 hover:bg-stone-100 hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <n.icon size={18} strokeWidth={1.9} style={{ color: isActive ? n.color : undefined }} />
                  {label(n)}
                  {news(n.to) > 0 && (
                    <span
                      className={cx('ml-auto rounded-full px-1.5 text-[11px] font-semibold leading-[18px] tabular', n.to === '/agendas' ? 'bg-red-500 text-white' : 'bg-brand-solid text-on-brand')}
                      aria-label={n.to === '/agendas' ? `${agendaNews} nouveautés dans tes agendas partagés` : `${groupNews} nouveautés dans tes ${groupsLabel.toLowerCase()}`}
                    >
                      {news(n.to)}
                    </span>
                  )}
                </>
              )}
            </NavLink>
            </Fragment>
          ))}
          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                cx(
                  'mt-4 flex h-10 items-center gap-3 rounded-lg border px-2.5 text-[14px] font-medium transition-colors',
                  isActive ? 'border-stone-200 bg-surface text-ink shadow-card' : 'border-transparent text-stone-500 hover:bg-stone-100 hover:text-ink',
                )
              }
            >
              <ChartNoAxesColumn size={18} strokeWidth={1.9} />
              Administration
              {adminPending > 0 && (
                <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-[18px] text-white tabular" aria-label={`${adminPending} à traiter`}>
                  {adminPending}
                </span>
              )}
            </NavLink>
          )}
        </nav>
        <NavLink
          to="/corbeille"
          aria-label={trashLabel}
          className={({ isActive }) =>
            cx(
              'mb-2 mt-2 flex h-10 items-center gap-3 rounded-lg border px-2.5 text-[14px] transition-colors',
              isActive ? 'border-stone-200 bg-surface font-medium text-ink shadow-card' : 'border-transparent text-stone-500 hover:bg-stone-100 hover:text-ink',
            )
          }
        >
          <Trash2 size={18} strokeWidth={1.9} />
          <span className="flex-1">Corbeille</span>
          {trashCount > 0 && <span className="tabular text-[11px] text-stone-500">{trashCount}</span>}
        </NavLink>
        <FocusTimer />
        <div className="flex items-center gap-1">
        <NavLink
          to="/profil"
          className={({ isActive }) => cx('group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-stone-100', isActive && 'bg-stone-100')}
          title="Profil et réglages"
        >
          <Avatar size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{user.name}</span>
            <span className="block truncate text-[11px] text-stone-500">Profil et réglages</span>
          </span>
          <Settings2 size={15} className="text-stone-400 transition-colors group-hover:text-ink" />
        </NavLink>
        <AccountSwitch currentId={user.id} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 px-4 md:px-8">
          <span className="lg:hidden">
            <Logo />
          </span>
          <div className="hidden flex-1 lg:block">
            <GlobalSearch />
          </div>
          <button
            ref={searchBtn}
            type="button"
            className="icon-btn ml-auto lg:hidden"
            title="Rechercher"
            aria-label="Rechercher"
            aria-expanded={searchOpen}
            aria-controls={searchOpen ? 'recherche-mobile' : undefined}
            onClick={() => setSearchOpen(o => !o)}
          >
            <Search size={18} strokeWidth={1.9} />
          </button>
          {isAdmin && (
            <NavLink to="/admin" className="icon-btn relative lg:hidden" title="Administration" aria-label={adminLabel}>
              <ChartNoAxesColumn size={18} strokeWidth={1.9} />
              {adminPending > 0 && (
                <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-[16px] text-white ring-2 ring-paper tabular" aria-hidden>
                  {adminPending > 9 ? '9+' : adminPending}
                </span>
              )}
            </NavLink>
          )}
          <NavLink to="/corbeille" className="icon-btn relative lg:hidden" title="Corbeille" aria-label={trashLabel}>
            <Trash2 size={18} strokeWidth={1.9} />
            {trashCount > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-paper" aria-hidden />}
          </NavLink>
          <NavLink to="/profil" className="inline-flex h-9 w-9 items-center justify-center rounded-full lg:hidden" title="Profil et réglages" aria-label="Profil et réglages">
            <Avatar size={30} />
          </NavLink>
        </header>
        {searchOpen && (
          <div id="recherche-mobile" className="px-4 pb-2 md:px-8 lg:hidden">
            <GlobalSearch
              autoFocus
              onDone={cancelled => {
                setSearchOpen(false);
                // Échap: back to the magnifier, not to the top of the page.
                if (cancelled) searchBtn.current?.focus();
                // A result opened: on the page content, not on <body>.
                else setTimeout(() => document.getElementById('contenu')?.focus(), 0);
              }}
            />
          </div>
        )}
        <main id="contenu" tabIndex={-1} className="min-h-0 flex-1 overflow-hidden pb-[calc(5.25rem+env(safe-area-inset-bottom))] outline-none lg:pb-0">
          <Outlet />
          <FeedbackDialog />
          <ReminderAlerts />
          <JoinedDialog />
          <RecPill />
          {/* « Avis ou bug » : always at hand, bottom right (above the tab bar on phones). */}
          <button
            type="button"
            onClick={() => openFeedback()}
            title="Donner mon avis ou signaler un bug"
            aria-label="Donner mon avis ou signaler un bug"
            className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-3 z-20 flex h-10 items-center gap-2 rounded-full border border-stone-200 bg-surface px-3 text-[12.5px] font-medium text-stone-600 shadow-pop transition-colors hover:border-stone-300 hover:text-ink lg:bottom-5 lg:right-5 lg:h-9"
          >
            <MessageSquareText size={16} strokeWidth={1.9} aria-hidden />
            <span className="hidden lg:inline">Avis ou bug</span>
          </button>
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav aria-label="Navigation principale" className="fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-[max(12px,env(safe-area-inset-left))] right-[max(12px,env(safe-area-inset-right))] z-30 flex rounded-[22px] bg-tile-dark p-1 shadow-pop ring-1 ring-white/10 lg:hidden">
        {NAV.filter(n => !('phone' in n)).map(n => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            // 7 spaces: each takes its share, the label shortened rather than pushed off a narrow screen.
            className={({ isActive }) => cx('flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[17px] py-1.5 text-[10px] font-semibold tracking-[-0.01em] transition-colors max-[379px]:text-[9px] max-[379px]:tracking-[-0.03em] max-[339px]:text-[8.5px]', isActive ? 'bg-white text-[#14161f]' : 'text-white/60 hover:text-white')}
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <n.icon size={19} strokeWidth={isActive ? 2.2 : 1.9} style={{ color: isActive ? n.color : undefined }} />
                  {news(n.to) > 0 && <span className={cx('absolute -right-1 -top-0.5 h-2 w-2 rounded-full ring-2', isActive ? 'ring-white' : 'ring-tile-dark', n.to === '/agendas' ? 'bg-red-500' : 'bg-urgent')} aria-label="nouveautés" />}
                </span>
                <span className="max-w-full truncate">{'short' in n ? n.short : label(n)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <Copilot />
      <Tour />
    </div>
  );
}
