import { Fragment, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, Mic, House, FolderClosed, CalendarDays, CalendarRange, NotebookText, Search, FileText, Folder, CalendarClock, Settings2, ChartNoAxesColumn, ListChecks, Users, Trash2, ArrowLeftRight, UserRound, UserPlus, LogOut, MessageSquareText, X } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { FeedbackDialog } from '../components/FeedbackDialogs';
import { openFeedback } from '../lib/feedback';
import { confirmLogout, useAuth } from '../store/auth';
import { loadUserData } from '../store/session';
import Copilot from '../copilot/Copilot';
import Tour from '../components/Tour';
import { startProactive } from '../copilot/proactive';
import { HIT_LABEL, linkToDriveFile, registerNavigate, search, type SearchHit } from '../copilot/actions';
import { useDrive } from '../store/drive';
import { findIn, fold, folding, highlightParts } from '../lib/textFind';
import Logo from '../components/Logo';
import Avatar from '../components/Avatar';
import FocusTimer from '../components/FocusTimer';
import { cx } from '../lib/utils';
import { adminPendingCount, checkIsAdmin, cloudEnabled } from '../lib/supabase';
import { prefetchGroups, useGroups } from '../store/groups';
import { startReminders } from '../lib/reminderScheduler';
import { useAgendaNews, totalAgendaNews, watchAgendaNews } from '../store/agendaNews';
import { useUi } from '../store/ui';
import { useGroupActivity, totalUnread } from '../store/groupActivity';
import { useTrashCount } from '../lib/trash';
import { useSettings } from '../store/settings';
import { WORDS, groupWords } from '../lib/usage';
import { ContextMenu, ReminderAlerts } from '../components/Overlays';
import { PENDING_INVITE } from '../App';
import { JoinedDialog } from '../pages/groups/Joined';
import RecPill, { RecBadge } from '../pages/record/RecPill';
import UploadCard from '../components/UploadCard';
import CreateButton from '../components/CreateButton';
import { useInvitations } from '../pages/groups/join';
import { needsCredentials, PROVIDER_NAMES, savedAccounts, type SavedAccount } from '../lib/accounts';
import { t, tn } from '../i18n';

const SPACE_COLORS = { home: 'var(--color-brand-500)', drive: '#3b6fd8', calendar: '#d9483b', notes: '#d48a17' };

const NAV = [
  { to: '/', label: t('Accueil'), icon: House, end: true, color: SPACE_COLORS.home },
  { to: '/calendrier', label: t('Calendrier'), icon: CalendarDays, color: SPACE_COLORS.calendar },
  { to: '/taches', label: t('Tâches'), icon: ListChecks, color: '#2f9e6b' },
  { to: '/notes', label: t('Notes'), icon: NotebookText, color: SPACE_COLORS.notes },
  { to: '/drive', label: t('Drive'), icon: FolderClosed, color: SPACE_COLORS.drive },
  // Phones: `more` = in the tab bar's « Plus » (5 spaces + Plus fit a narrow screen).
  { to: '/enregistrer', label: t('Enregistrer'), icon: Mic, color: '#e5484d', more: true },
  // `section`: a small title above this entry in the sidebar (what is shared with others comes after).
  { to: '/groupes', label: t('Groupes'), icon: Users, color: '#1f8a8a', section: t('Espaces partagés'), more: true },
  { to: '/agendas', label: t('Agendas partagés'), short: t('Agendas||court'), icon: CalendarRange, color: '#7a5ad6', more: true },
];

const HIT_ICON: Record<SearchHit['type'], typeof FileText> = {
  dossier: Folder,
  fichier: FileText,
  note: NotebookText,
  'dossier de notes': Folder,
  événement: CalendarClock,
  tâche: ListChecks,
  'note partagée': NotebookText,
  'événement partagé': CalendarClock,
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// The text inside the Drive's PDF, Word… files (lib/textIndex): read in the background from the first time the
// search is used in this session (not at every start: it may download the files), then kept up to date.
let readingStarted = false;
const textIndex = () => import('../lib/textIndex');
type FileHit = SearchHit & { snippet: string };
/** Content results shown in the list; more than that: a last line « Voir tout dans le Drive ». */
const IN_FILES = 4;
/** A few words before the match, so that it shows on the one line of the result. */
function shortSnippet(snippet: string, q: string) {
  const { folded, map } = folding(snippet);
  const i = Math.max(0, findIn(folded, fold(q.trim())).at);
  const at = map ? map[i] : i;
  if (at <= 30) return snippet;
  const cut = snippet.indexOf(' ', at - 28);
  return `…${snippet.slice(cut >= 0 && cut < at ? cut + 1 : at - 24)}`;
}

/** The words searched for in bold, in an extract of a file (as typed, accents and case aside; also a word glued back). */
const highlight = (text: string, q: string) =>
  highlightParts(text, q).map((p, i) =>
    p.hit ? (
      <mark key={i} className="bg-transparent font-semibold text-ink">
        {p.text}
      </mark>
    ) : (
      p.text
    ),
  );

/** `onDone(cancelled)`: closed with Échap (true) or a result chosen (false). */
function GlobalSearch({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: (cancelled: boolean) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The groups' and shared calendars' notes and events already read too (no request to the server).
  const named = q.trim() ? search(q, 8, useGroups.getState()) : [];
  // Files whose content has the words (not already found by their name), after the rest.
  // With the query they answer: those of a previous one (typed fast, then Entrée) are not shown nor opened.
  const [content, setContent] = useState<{ q: string; hits: FileHit[]; more: boolean }>({ q: '', hits: [], more: false });
  const fresh = content.q === q.trim();
  const inFiles = fresh ? content.hits : [];
  const [reading, setReading] = useState(false);
  const [indexed, setIndexed] = useState(0);
  // Last line when there are more files than shown: the Drive's own search (names and content, everything).
  const seeAll: SearchHit | null = fresh && content.more ? { type: 'dossier', id: 'drive-search', title: t('Voir tout dans le Drive'), where: '', to: `/drive?q=${encodeURIComponent(q.trim())}` } : null;
  const hits: (SearchHit | FileHit)[] = [...named, ...inFiles.filter(f => !named.some(h => h.type === 'fichier' && h.id === f.id)), ...(seeAll ? [seeAll] : [])];
  const startReading = () => {
    if (readingStarted) return;
    readingStarted = true;
    setReading(true); // until the first pass says what it did
    void textIndex().then(m => m.startTextIndexing());
  };
  useEffect(() => {
    let off = () => {};
    let alive = true;
    void textIndex().then(m => {
      if (!alive) return;
      off = m.onIndexChange(() => {
        setReading(m.isIndexing());
        setIndexed(n => n + 1);
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  useEffect(() => {
    const query = q.trim();
    let cancelled = false;
    const timer = setTimeout(
      () =>
        void textIndex().then(async m => {
          const found = query.length < 2 ? [] : await m.searchFileContents(query, IN_FILES + 1);
          if (cancelled) return;
          const items = useDrive.getState().items;
          setContent({
            q: query,
            more: found.length > IN_FILES,
            hits: found.slice(0, IN_FILES).flatMap(f => {
              const it = items.find(i => i.id === f.id);
              return it ? [{ type: 'fichier' as const, id: it.id, title: it.name, where: '', snippet: shortSnippet(f.snippet, query), to: linkToDriveFile(it, f.page) }] : [];
            }),
          });
        }),
      query.length < 2 ? 0 : 200,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, indexed]);

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
        onFocus={() => (clearTimeout(closing.current), setOpen(true), startReading())}
        // Closed a moment later (a click on a result lands first); not if the field got the focus back meanwhile.
        onBlur={() => (closing.current = setTimeout(() => setOpen(false), 150))}
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
        placeholder={t('Rechercher')}
        // Also found by the guided tour (components/Tour), with the same t().
        aria-label={t('Rechercher dans tes fichiers, notes, événements et tâches')}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && !!q.trim()}
        aria-controls="recherche-resultats"
        aria-activedescendant={open && hits[active] ? `recherche-${active}` : undefined}
        // A card-like field (border + surface): the grey tint alone barely stood out from the page, light or dark.
        className="h-10 w-full rounded-[14px] border border-transparent bg-surface pl-9 pr-14 text-[13.5px] text-ink outline-none transition placeholder:text-stone-500 hover:border-stone-200 focus:border-focus focus:ring-1 focus:ring-focus"
      />
      <span aria-hidden className="kbd pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 sm:inline-flex">{isMac ? '⌘' : t('Ctrl')} K</span>
      {/* Not before the files' content answered this query (no « Aucun résultat » flashing while it is looked for). */}
      {open && q.trim() && (hits.length > 0 || fresh) && (
        <div id="recherche-resultats" role="listbox" aria-label={t('Résultats de recherche')} className="enter absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-[18px] border border-stone-200 bg-surface p-1 shadow-pop">
          {/* The field keeps the focus (and the list stays open) while « Effacer la recherche » is pressed. */}
          {hits.length === 0 && (
            <div onMouseDown={e => e.preventDefault()}>
              <EmptyState
                size="sm"
                tone="search"
                title={t('Aucun résultat pour «\u00a0{q}\u00a0»', { q: q.trim() })}
                text={reading ? t('Je lis encore le contenu de tes fichiers : réessaie dans un instant.') : undefined}
                action={{ label: t('Effacer la recherche'), icon: X, onClick: () => (setQ(''), inputRef.current?.focus()) }}
              />
            </div>
          )}
          {hits.map((h, i) => {
            const Icon = h === seeAll ? Search : HIT_ICON[h.type];
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
                  {'snippet' in h ? (
                    <span className="block truncate text-[12px] text-stone-500" title={h.snippet}>
                      {highlight(h.snippet, q)}
                    </span>
                  ) : (
                    h.where && <span className="block truncate text-[12px] text-stone-500">{h.where}</span>
                  )}
                </span>
                {h !== seeAll && <span className="inline-block shrink-0 text-[11px] text-stone-500 first-letter:uppercase">{HIT_LABEL[h.type]}</span>}
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
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const others = menu ? savedAccounts().filter(a => a.id !== currentId) : [];
  const open = (a: SavedAccount) => {
    if (needsCredentials(a)) return void useAuth.getState().addAccount(a.email);
    void useAuth.getState().switchAccount(a.id).then(r => {
      if (r === 'credentials') void useAuth.getState().addAccount(a.email);
    });
  };
  // As in Profile › Account › Session.
  const logout = async () => {
    if (!(await confirmLogout())) return;
    await useAuth.getState().logout();
    sessionStorage.removeItem('cop:greeted');
    await loadUserData();
    navigate('/connexion');
  };
  // What opening it will ask for, when not a click.
  const asks = (a: SavedAccount) => (!needsCredentials(a) ? '' : ` · ${a.provider ? PROVIDER_NAMES[a.provider] : t('mot de passe')}`);
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        title={t('Changer de compte')}
        aria-label={t('Changer de compte')}
        aria-haspopup="menu"
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.top - 8 - 44 * (savedAccounts().filter(a => a.id !== currentId).length + 2) });
        }}
      >
        <ArrowLeftRight size={15} />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={t('Changer de compte')}
          onClose={() => setMenu(null)}
          items={[
            ...others.map(a => ({ label: `${a.name || a.email} · ${a.email}${asks(a)}`, icon: <UserRound size={15} />, onClick: () => open(a) })),
            ...(others.length ? [{ label: '', divider: true, onClick: () => {} }] : []),
            { label: t('Ajouter un compte'), icon: <UserPlus size={15} />, onClick: () => void useAuth.getState().addAccount() },
            { label: t('Se déconnecter'), icon: <LogOut size={15} />, onClick: () => void logout() },
          ]}
        />
      )}
    </>
  );
}

export default function AppShell() {
  const usage = useSettings(st => st.usage);
  const groupsLabel = (WORDS[usage] ?? WORDS.etudes).groups;
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
  const trashLabel = trashCount ? tn(trashCount, 'Corbeille, {n} élément', 'Corbeille, {n} éléments') : t('Corbeille');

  useEffect(() => registerNavigate(navigate), [navigate]);
  // Invitation links: joined, then a window says so (pages/groups/Joined). One opened before signing in
  // (App › RequireAuth) is joined now, without leaving the page shown after sign-in.
  const [pendingInvite] = useState(() => sessionStorage.getItem(PENDING_INVITE));
  useEffect(() => sessionStorage.removeItem(PENDING_INVITE), []);
  useInvitations(pendingInvite);
  useEffect(() => startProactive(), []);
  // Shared spaces read in the background once the page is up: their pages open at once.
  useEffect(() => {
    if (!cloudEnabled) return;
    const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500));
    const id = idle(() => prefetchGroups());
    return () => (window.cancelIdleCallback ?? clearTimeout)(id as number);
  }, [user.id]);
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
    const timer = setInterval(refresh, 120_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [isAdmin]);
  const adminLabel = adminPending ? tn(adminPending, 'Administration, {n} élément à traiter', 'Administration, {n} éléments à traiter') : t('Administration');

  return (
    <div className="flex h-full">
      <a href="#contenu" className="skip-link" onClick={e => { e.preventDefault(); document.getElementById('contenu')?.focus(); }}>
        {t('Aller au contenu')}
      </a>
      {/* Sidebar (desktop) */}
      <aside aria-label={t('Barre latérale')} className="m-3 mr-0 hidden w-[244px] shrink-0 flex-col rounded-[24px] bg-surface px-3 pb-3 pt-4 lg:flex">
        <div className="mb-6 px-2">
          <Logo />
        </div>
        <nav aria-label={t('Navigation principale')} className="flex flex-1 flex-col gap-1">
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
                  {n.to === '/enregistrer' && <RecBadge />}
                  {news(n.to) > 0 && (
                    <span
                      className={cx('ml-auto rounded-full px-1.5 text-[11px] font-semibold leading-[18px] tabular', n.to === '/agendas' ? 'bg-red-500 text-white' : 'bg-brand-solid text-on-brand')}
                      aria-label={
                        n.to === '/agendas'
                          ? tn(agendaNews, '{n} nouveauté dans tes agendas partagés', '{n} nouveautés dans tes agendas partagés')
                          : tn(groupNews, '{n} nouveauté dans tes {groups}', '{n} nouveautés dans tes {groups}', { groups: groupWords(usage).groups })
                      }
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
              {t('Administration')}
              {adminPending > 0 && (
                <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-[18px] text-white tabular" aria-label={t('{n} à traiter', { n: adminPending })}>
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
              'mt-2 flex h-10 items-center gap-3 rounded-lg border px-2.5 text-[14px] transition-colors',
              isActive ? 'border-stone-200 bg-surface font-medium text-ink shadow-card' : 'border-transparent text-stone-500 hover:bg-stone-100 hover:text-ink',
            )
          }
        >
          <Trash2 size={18} strokeWidth={1.9} />
          <span className="flex-1">{t('Corbeille')}</span>
          {trashCount > 0 && <span className="tabular text-[11px] text-stone-500">{trashCount}</span>}
        </NavLink>
        {/* Computers; phones and tablets have it at the top of Profil (pages/profile), the corner is the « + » button's. */}
        <button
          type="button"
          onClick={() => openFeedback()}
          title={t('Donner mon avis ou signaler un bug')}
          className="mb-2 flex h-10 items-center gap-3 rounded-lg px-2.5 text-left text-[14px] text-stone-500 transition-colors hover:bg-stone-100 hover:text-ink"
        >
          <MessageSquareText size={18} strokeWidth={1.9} aria-hidden />
          {t('Avis ou bug')}
        </button>
        <FocusTimer />
        <div className="flex items-center gap-1">
        <NavLink
          to="/profil"
          className={({ isActive }) => cx('group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-stone-100', isActive && 'bg-stone-100')}
          title={t('Profil et réglages')}
        >
          <Avatar size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{user.name}</span>
            <span className="block truncate text-[11px] text-stone-500">{t('Profil et réglages||sous le nom, court')}</span>
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
            title={t('Rechercher')}
            aria-label={t('Rechercher')}
            aria-expanded={searchOpen}
            aria-controls={searchOpen ? 'recherche-mobile' : undefined}
            onClick={() => setSearchOpen(o => !o)}
          >
            <Search size={18} strokeWidth={1.9} />
          </button>
          <NavLink to="/profil" className="hit inline-flex h-9 w-9 items-center justify-center rounded-full lg:hidden" title={t('Profil et réglages')} aria-label={t('Profil et réglages')}>
            <Avatar size={30} />
          </NavLink>
        </header>
        {searchOpen && (
          <div id="recherche-mobile" role="search" className="px-4 pb-2 md:px-8 lg:hidden">
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
        {/* Pages scroll to the bottom edge (under the tab bar on phones); their scroll area ends with `pb-room`, so the « + » button and the tab bar never cover the last buttons. */}
        <main id="contenu" tabIndex={-1} className="min-h-0 flex-1 overflow-hidden outline-none">
          <Outlet />
          <FeedbackDialog />
          <ReminderAlerts />
          <JoinedDialog />
          <RecPill />
          <UploadCard />
          {/* Bottom right, after the page in the Tab order: what this space creates (store/create). */}
          <CreateButton />
        </main>
      </div>

      {/* Bottom nav (mobile): every space, the last ones under « Plus ». */}
      <PhoneTabBar
        news={news}
        label={label}
        extra={[
          ...(isAdmin ? [{ to: '/admin', label: t('Administration'), aria: adminLabel, icon: ChartNoAxesColumn, color: '#5e6470', count: adminPending, urgent: true }] : []),
          { to: '/corbeille', label: t('Corbeille'), aria: trashLabel, icon: Trash2, color: '#78716c', count: trashCount },
        ]}
      />

      <Copilot />
      <Tour />
    </div>
  );
}

type Extra = { to: string; label: string; aria: string; icon: typeof House; color: string; count: number; urgent?: boolean };

/**
 * Phones: Accueil, Calendrier, Tâches, Notes, Drive, and « Plus » for the others (Enregistrer, Groupes, Agendas partagés,
 * Corbeille, Administration), shown in a panel just above the bar: every space is reached from the bar.
 */
function PhoneTabBar({ news, label, extra }: { news: (to: string) => number; label: (n: { to: string; label: string }) => string; extra: Extra[] }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const main = NAV.filter(n => !('more' in n));
  const more = [...NAV.filter(n => 'more' in n).map(n => ({ ...n, aria: label(n), count: news(n.to), urgent: n.to === '/agendas' })), ...extra];
  const current = more.find(n => pathname === n.to || pathname.startsWith(`${n.to}/`));
  const moreNews = more.some(n => n.to !== '/corbeille' && n.count > 0);

  // Another page: the panel goes. A press anywhere else, or Échap, closes it.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('a')?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const tab = (active: boolean) =>
    cx('flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[17px] py-1.5 text-[10px] font-semibold tracking-[-0.01em] transition-colors max-[339px]:text-[9px]', active ? 'bg-white text-[#14161f]' : 'text-white/60 hover:text-white');
  const Shown = current?.icon ?? LayoutGrid;

  return (
    <>
      {open && (
        <div
          ref={panel}
          id="nav-more-panel"
          className="enter fixed bottom-[calc(max(12px,env(safe-area-inset-bottom))+4.5rem)] left-[max(12px,env(safe-area-inset-left))] right-[max(12px,env(safe-area-inset-right))] z-[45] grid grid-cols-3 gap-1.5 rounded-[22px] border border-stone-200 bg-surface p-2 shadow-pop lg:hidden"
        >
          {more.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              aria-label={n.aria}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cx('relative flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-[16px] px-1 text-center text-[12px] font-semibold leading-tight transition-colors', isActive ? 'bg-stone-100 text-ink' : 'text-stone-600 hover:bg-stone-50')}
            >
              <n.icon size={22} strokeWidth={1.9} style={{ color: n.color }} aria-hidden />
              <span>{n.label}</span>
              {n.count > 0 && (
                <span className={cx('absolute right-2 top-2 min-w-[18px] rounded-full px-1 text-center text-[10.5px] font-semibold leading-[18px] tabular', n.to === '/corbeille' ? 'bg-stone-200 text-stone-600' : n.urgent ? 'bg-red-500 text-white' : 'bg-urgent text-white')} aria-hidden>
                  {n.count > 9 ? '9+' : n.count}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      )}
      <nav aria-label={t('Navigation principale')} className="fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-[max(12px,env(safe-area-inset-left))] right-[max(12px,env(safe-area-inset-right))] z-30 flex rounded-[22px] bg-tile-dark p-1 shadow-pop ring-1 ring-white/10 lg:hidden">
        {main.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => tab(isActive)}>
            {({ isActive }) => (
              <>
                <n.icon size={19} strokeWidth={isActive ? 2.2 : 1.9} style={{ color: isActive ? n.color : undefined }} />
                <span className="max-w-full truncate">{label(n)}</span>
              </>
            )}
          </NavLink>
        ))}
        {/* In one of them: the tab shows which (its icon and name), else « Plus ». */}
        <button
          ref={button}
          id="nav-more"
          type="button"
          aria-expanded={open}
          aria-controls={open ? 'nav-more-panel' : undefined}
          aria-label={current ? t('Plus d’espaces (ici : {space})', { space: current.label }) : t('Plus d’espaces')}
          onClick={() => setOpen(o => !o)}
          className={tab(!!current && !open)}
        >
          <span className="relative">
            {open ? <X size={19} strokeWidth={2.2} /> : <Shown size={19} strokeWidth={current ? 2.2 : 1.9} style={{ color: current ? current.color : undefined }} />}
            {!open && moreNews && <span className={cx('absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2', current ? 'ring-white' : 'ring-tile-dark')} aria-label={t('nouveautés')} />}
          </span>
          <span className="max-w-full truncate">{open ? t('Fermer') : current ? (('short' in current && typeof current.short === 'string' && current.short) || current.label) : t('Plus')}</span>
        </button>
      </nav>
    </>
  );
}
