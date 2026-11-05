import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, NotebookText, Search, FileText, Folder, CalendarClock, Settings2, ChartNoAxesColumn, ListChecks, Trash2, ArrowLeftRight, UserRound, UserPlus, LogOut, Sparkles, X } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { FeedbackDialog } from '../components/FeedbackDialogs';
import { confirmLogout, useAuth } from '../store/auth';
import { loadUserData } from '../store/session';
import Copilot, { KompalyEntry } from '../copilot/Copilot';
import Tour from '../components/Tour';
import { startProactive } from '../copilot/proactive';
import { HIT_LABEL, linkToDriveFile, registerNavigate, search, type SearchHit } from '../copilot/actions';
import { recentHits, rememberHit, searchCommands, suggestions } from '../copilot/commands';
import { useDrive } from '../store/drive';
import { findIn, fold, folding, highlightParts } from '../lib/textFind';
import Logo, { LogoMark } from '../components/Logo';
import { useFocus } from '../store/focus';
import Avatar from '../components/Avatar';
import FocusTimer, { FocusPill } from '../components/FocusTimer';
import { cx } from '../lib/utils';
import { adminPendingCount, checkIsAdmin, cloudEnabled } from '../lib/supabase';
import { prefetchGroups, useGroups } from '../store/groups';
import { startReminders } from '../lib/reminderScheduler';
import { startFeedRefresh } from '../lib/icsFeeds';
import NewsDialog from '../components/NewsDialog';
import { newsToShow, openNews } from '../lib/news';
import { useAgendaNews, totalAgendaNews, watchAgendaNews } from '../store/agendaNews';
import { useUi } from '../store/ui';
import { useGroupActivity, totalUnread } from '../store/groupActivity';
import { useTrashCount } from '../lib/trash';
import { useSettings } from '../store/settings';
import { groupWords } from '../lib/usage';
import { PHONE_TABS, type SpaceKey } from '../lib/navOrder';
import { HOME, SPACES, useNavOrder, useSpaceLabel } from './spaces';
import { ContextMenu, ReminderAlerts, ServiceBanner } from '../components/Overlays';
import { PENDING_INVITE } from '../App';
import { JoinedDialog } from '../pages/groups/Joined';
import { InviteDialog } from '../pages/groups/InviteDialog';
import RecPill, { RecBadge } from '../pages/record/RecPill';
import UploadCard from '../components/UploadCard';
import CreateButton from '../components/CreateButton';
import { useInvitations } from '../pages/groups/join';
import { needsCredentials, PROVIDER_NAMES, savedAccounts, type SavedAccount } from '../lib/accounts';
import { t, tn } from '../i18n';
import { useGlobalShortcuts } from './shortcuts';
import ErrorBoundary from '../components/ErrorBoundary';
import { watchAppBadge } from '../lib/appBadge';
import { watchBackOnline } from '../lib/backOnline';
import { Bubble, ProRail, type Extra } from './ProNav';
import { useBubble, useProEntrance } from './proMotion';

const SHARED: SpaceKey[] = ['groupes', 'agendas'];

const HIT_ICON: Record<SearchHit['type'], typeof FileText> = {
  dossier: Folder,
  fichier: FileText,
  note: NotebookText,
  'dossier de notes': Folder,
  événement: CalendarClock,
  tâche: ListChecks,
  'note partagée': NotebookText,
  'événement partagé': CalendarClock,
  page: LayoutGrid,
  réglage: Settings2,
  action: Sparkles,
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
  // Affichage Pro: a capsule at the top right of a computer's page; its results open leftwards, under it.
  const pro = useSettings(s => s.pro);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The groups' and shared calendars' notes and events already read too (no request to the server).
  const named = q.trim() ? search(q, 8, useGroups.getState()) : [];
  // Pages, Profil's tabs and quick actions: those whose name starts with what is typed first, the others last.
  const commands = q.trim() ? searchCommands(q) : [];
  const leading = commands.filter(c => fold(c.title).startsWith(fold(q.trim())));
  // An empty field: the results chosen lately (read when the field gets the focus), then « Nouvelle tâche »…
  const [recent, setRecent] = useState<SearchHit[]>([]);
  // Files whose content has the words (not already found by their name), after the rest.
  // With the query they answer: those of a previous one (typed fast, then Entrée) are not shown nor opened.
  const [content, setContent] = useState<{ q: string; hits: FileHit[]; more: boolean }>({ q: '', hits: [], more: false });
  const fresh = content.q === q.trim();
  const inFiles = fresh ? content.hits : [];
  const [reading, setReading] = useState(false);
  const [indexed, setIndexed] = useState(0);
  // Last line when there are more files than shown: the Drive's own search (names and content, everything).
  const seeAll: SearchHit | null = fresh && content.more ? { type: 'dossier', id: 'drive-search', title: t('Voir tout dans tes fichiers'), where: '', to: `/drive?q=${encodeURIComponent(q.trim())}` } : null;
  const empty = !q.trim();
  const shortcuts = empty ? suggestions() : [];
  const hits: (SearchHit | FileHit)[] = empty
    ? [...recent, ...shortcuts]
    : [...leading, ...named, ...inFiles.filter(f => !named.some(h => h.type === 'fichier' && h.id === f.id)), ...commands.filter(c => !leading.includes(c)), ...(seeAll ? [seeAll] : [])];
  const shown = open && (empty ? hits.length > 0 : hits.length > 0 || fresh);
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
      // (Not a Ctrl+K already used: inside a note it is the link.)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.defaultPrevented && inputRef.current?.offsetParent) {
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

  useEffect(() => {
    if (shown) document.getElementById(`recherche-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, shown]);

  const go = (hit: SearchHit) => {
    rememberHit(hit);
    if (hit.run) hit.run();
    else navigate(hit.to);
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
        onFocus={() => (clearTimeout(closing.current), setRecent(recentHits()), setActive(0), setOpen(true), startReading())}
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
        aria-expanded={shown}
        aria-controls="recherche-resultats"
        aria-activedescendant={open && hits[active] ? `recherche-${active}` : undefined}
        // A card-like field (border + surface): the grey tint alone barely stood out from the page, light or dark.
        className={cx(
          'h-10 w-full border border-transparent bg-surface pl-9 pr-14 text-[13.5px] text-ink outline-none transition placeholder:text-stone-500 hover:border-stone-200 focus:border-focus focus:ring-1 focus:ring-focus',
          pro ? 'rounded-full' : 'rounded-[14px]',
        )}
      />
      <span aria-hidden className={cx('kbd pointer-events-none absolute top-1/2 hidden -translate-y-1/2 sm:inline-flex', pro ? 'right-3 rounded-full' : 'right-2')}>{isMac ? '⌘' : t('Ctrl')} K</span>
      {/* Not before the files' content answered this query (no « Aucun résultat » flashing while it is looked for). */}
      {shown && (
        // Over the « + » button and Kompaly; never past the bottom of the screen (phones: nor under the tab bar): a long
        // list scrolls inside. Computers: wider than the field, the long titles whole.
        <div
          id="recherche-resultats"
          role="listbox"
          aria-label={t('Résultats de recherche')}
          className={cx(
            'enter absolute left-0 right-0 top-12 z-[55] max-h-[calc(100dvh-13rem)] overflow-y-auto overscroll-contain rounded-[18px] border border-stone-200 bg-surface p-1 shadow-pop lg:max-h-[calc(100dvh-4.5rem)]',
            pro ? 'rounded-[22px] lg:left-auto lg:w-[min(460px,calc(100vw-8rem))]' : 'lg:right-auto lg:w-[min(460px,calc(100vw-20rem))]',
          )}
          // Its scrollbar dragged with the mouse: the field keeps the focus (the list stays open).
          onMouseDown={e => e.preventDefault()}
        >
          {/* The field keeps the focus (and the list stays open) while « Effacer la recherche » is pressed. */}
          {hits.length === 0 && !empty && (
            <div onMouseDown={e => e.preventDefault()}>
              <EmptyState
                size="sm"
                tone="search"
                title={t('Aucun résultat pour «\u00a0{q}\u00a0»', { q: q.trim() })}
                text={reading ? t('Je lis encore le contenu de tes fichiers\u00a0: réessaie dans un instant.') : undefined}
                action={{ label: t('Effacer la recherche'), icon: X, onClick: () => (setQ(''), inputRef.current?.focus()) }}
              />
            </div>
          )}
          {hits.map((h, i) => {
            const Icon = h === seeAll ? Search : HIT_ICON[h.type];
            // Empty field: « Récents », then « Raccourcis ».
            const heading = empty && (i === 0 && recent.length ? t('Récents') : i === recent.length ? t('Raccourcis') : null);
            return (
              <Fragment key={h.type + h.id}>
              {heading && <p role="presentation" className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-stone-500">{heading}</p>}
              <button
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
                  {h.snippet ? (
                    <span className="block truncate text-[12px] text-stone-500" title={h.snippet}>
                      {highlight(h.snippet, q)}
                    </span>
                  ) : (
                    h.where && <span className="block truncate text-[12px] text-stone-500">{h.where}</span>
                  )}
                </span>
                {h !== seeAll && <span className="inline-block shrink-0 text-[11px] text-stone-500 first-letter:uppercase">{HIT_LABEL[h.type]}</span>}
              </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Other accounts of this device in one click, or a new one (see lib/accounts). `avatar`: phones' top bar, the avatar opens it (« Profil et réglages » first). */
function AccountSwitch({ currentId, avatar, pro }: { currentId: string; avatar?: boolean; pro?: boolean }) {
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
        // Affichage Pro: also on a computer (no side bar there), at the end of the top right cluster.
        className={avatar ? cx('hit inline-flex h-9 w-9 items-center justify-center rounded-full', pro ? 'pro-avatar' : 'lg:hidden') : 'icon-btn'}
        title={avatar ? t('Profil et comptes') : t('Changer de compte')}
        aria-label={avatar ? t('Profil et comptes') : t('Changer de compte')}
        aria-haspopup="menu"
        data-tour={avatar ? 'profil' : undefined}
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(avatar ? { x: r.right, y: r.bottom + 8 } : { x: r.left, y: r.top - 8 - 44 * (savedAccounts().filter(a => a.id !== currentId).length + 2) });
        }}
      >
        {avatar ? <Avatar size={30} /> : <ArrowLeftRight size={15} />}
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={avatar ? t('Profil et comptes') : t('Changer de compte')}
          onClose={() => setMenu(null)}
          items={[
            ...(avatar ? [{ label: t('Profil et réglages'), icon: <Settings2 size={15} />, onClick: () => navigate('/profil') }, { label: '', divider: true, onClick: () => {} }] : []),
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
  // Affichage Pro (Profil › Apparence): the floating pill of icons instead of the side bar, the top right cluster.
  const pro = useSettings(st => st.pro);
  const label = useSpaceLabel();
  const order = useNavOrder();
  const navigate = useNavigate();
  const user = useAuth(s => s.user)!;
  const trashCount = useTrashCount();
  // A phone with a focus session running (its pill in the bar, outside Pro where it is the island): the bar keeps to the
  // screen, the logo's mark only and Kompaly's button without its word on the narrowest phones.
  const focusing = useFocus(s => !!s.phase);
  const proOn = useSettings(s => s.pro);
  const tight = focusing && !proOn;
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
  // A page's fixed head (index.css › page-head) draws the piece of the wallpaper behind it (Verre, Liquid Glass): where
  // it is against the page, kept up to date as its page scrolls, changes or the window is resized.
  useEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const page = document.body.getBoundingClientRect();
      // A picture (Affichage Pro) is drawn « cover », centred: the same size and offset here.
      const ratio = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wp-ratio'));
      let [w, h, x, y] = [page.width, page.height, page.left, page.top];
      if (ratio > 0) {
        [w, h] = page.width / page.height > ratio ? [page.width, page.width / ratio] : [page.height * ratio, page.height];
        [x, y] = [page.left + (page.width - w) / 2, page.top + (page.height - h) / 2];
      }
      document.querySelectorAll<HTMLElement>('.page-head').forEach(head => {
        const r = head.getBoundingClientRect();
        head.style.setProperty('--wp-size', `${w}px ${h}px`);
        head.style.setProperty('--wp-pos', `${x - r.left}px ${y - r.top}px`);
      });
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const main = document.getElementById('contenu');
    const seen = new MutationObserver(later);
    if (main) seen.observe(main, { childList: true, subtree: true });
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-pro', 'data-style'] });
    document.addEventListener('scroll', later, { capture: true, passive: true });
    window.addEventListener('resize', later);
    later();
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      document.removeEventListener('scroll', later, { capture: true });
      window.removeEventListener('resize', later);
    };
  }, []);
  // Affichage Pro: another space's cards come in one after the other (layout/proMotion).
  useProEntrance(pro, pathname);
  // ?, /, N, G then a letter, Ctrl+J (layout/shortcuts).
  useGlobalShortcuts(navigate);
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
  // Timetables followed by link: read again when due (lib/icsFeeds).
  useEffect(() => startFeedRefresh(), [user.id]);
  // « Nouveautés » once per account after a release (not to an account newer than it), a moment after the page is up.
  useEffect(() => {
    if (!newsToShow(useSettings.getState().newsSeen, user.createdAt)) return;
    const id = setTimeout(openNews, 1500);
    return () => clearTimeout(id);
  }, [user.id, user.createdAt]);

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
  // Installed app: what is late and the news, as a number on its icon (lib/appBadge).
  useEffect(() => watchAppBadge(), [user.id]);
  // Back online: « De retour en ligne · N changements envoyés » (lib/backOnline).
  useEffect(() => watchBackOnline(), [user.id]);

  // Screen readers: the new page's name, said once it opened (the content changed, the focus stayed where it was).
  const [announced, setAnnounced] = useState('');
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = '';
    const id = setTimeout(() => setAnnounced(document.title.replace(/ · Kompaly$/, '')), 300);
    return () => clearTimeout(id);
  }, [pathname]);

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
  // What « Plus » holds besides the spaces (phones; Affichage Pro on a computer too).
  const extra: Extra[] = [
    ...(isAdmin ? [{ to: '/admin', label: t('Administration'), aria: adminLabel, icon: ChartNoAxesColumn, color: '#5e6470', count: adminPending, urgent: true }] : []),
    { to: '/corbeille', label: t('Corbeille'), aria: trashLabel, icon: Trash2, color: '#78716c', count: trashCount },
  ];
  // A space with news, as its icon says it (the pill and the phone's bar show only a number).
  const newsLabel = (to: string) =>
    to === '/agendas'
      ? tn(agendaNews, '{n} nouveauté dans tes agendas partagés', '{n} nouveautés dans tes agendas partagés')
      : tn(groupNews, '{n} nouveauté dans tes {groups}', '{n} nouveautés dans tes {groups}', { groups: groupWords(usage).groups });

  return (
    <div className="flex h-full">
      <a href="#contenu" className="skip-link" onClick={e => { e.preventDefault(); document.getElementById('contenu')?.focus(); }}>
        {t('Aller au contenu')}
      </a>
      {/* Sidebar (desktop); Affichage Pro: a floating pill of icons (layout/ProNav). */}
      {pro ? (
        <ProRail order={order} news={news} newsLabel={newsLabel} label={label} extra={extra} />
      ) : (
      <aside aria-label={t('Barre latérale')} className="m-3 mr-0 hidden w-[244px] shrink-0 flex-col rounded-[24px] bg-surface px-3 pb-3 pt-4 lg:flex">
        <div className="mb-6 px-2">
          <Logo />
        </div>
        <nav aria-label={t('Navigation principale')} className="flex flex-1 flex-col gap-1">
          {[HOME, ...order.map(k => SPACES[k])].map((n, i) => {
            // « Espaces partagés » over the shared spaces when they come last, together.
            const rest = order.slice(i - 1);
            const sharedFromHere = i > 1 && SHARED.includes(order[i - 1]) && !SHARED.includes(order[i - 2]) && rest.every(k => SHARED.includes(k));
            return (
            <Fragment key={n.to}>
            {sharedFromHere && <p className="mb-1 mt-5 px-2.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-stone-500">{t('Espaces partagés')}</p>}
            <NavLink
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx(
                  // rounded-lg: as every other row of the bar (Kompaly, Nouveautés, Session focus, Profil), the same shape at rest, hovered and chosen.
                  'flex h-10 items-center gap-3 rounded-lg border px-2.5 text-[14px] font-medium transition-colors',
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
                      className="ml-auto rounded-full bg-brand-solid px-1.5 text-[11px] font-semibold leading-[18px] text-on-brand tabular"
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
            );
          })}
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
        {/* Computers; phones and tablets have it at the top of Profil (pages/profile), the corner is the « + » button's. */}
        <KompalyEntry />
        <button
          type="button"
          onClick={() => openNews()}
          className="mb-2 flex h-10 items-center gap-3 rounded-lg px-2.5 text-left text-[14px] text-stone-500 transition-colors hover:bg-stone-100 hover:text-ink"
        >
          <Sparkles size={18} strokeWidth={1.9} aria-hidden />
          {t('Nouveautés')}
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
      )}

      <div className={cx('flex min-w-0 flex-1 flex-col', pro && 'pro-column')}>
        {/* Wide screens: the header, like every page, keeps to the same centred column (1180 px of content, the pages'
            `max-w-[1180px]` or `max-w-[1244px]` with their padding), so the search and the bin line up with it. */}
        <header className="mx-auto flex h-14 w-full max-w-[1244px] shrink-0 items-center gap-3 px-4 short:h-12 md:px-8">
          <span className="lg:hidden">{tight ? <LogoMark /> : <Logo />}</span>
          {/* Affichage Pro: at the right, beside the avatar (the page's title has the left). */}
          <div className={pro ? 'pro-search hidden lg:block' : 'hidden flex-1 lg:block'}>
            <GlobalSearch />
          </div>
          {/* Phones: a focus session running, and Kompaly when his character is hidden. */}
          <span className="ml-auto flex items-center gap-1 lg:hidden">
            <FocusPill />
            <KompalyEntry phone compact={tight} />
          </span>
          <button
            ref={searchBtn}
            type="button"
            className="icon-btn lg:hidden"
            title={t('Rechercher')}
            aria-label={t('Rechercher')}
            aria-expanded={searchOpen}
            aria-controls={searchOpen ? 'recherche-mobile' : undefined}
            onClick={() => setSearchOpen(o => !o)}
          >
            <Search size={18} strokeWidth={1.9} />
          </button>
          {/* Computers: a small bin at the top right (phones and Affichage Pro: in « Plus »). */}
          {!pro && (
          <NavLink to="/corbeille" className={({ isActive }) => cx('icon-btn relative ml-auto hidden lg:inline-flex', isActive && 'bg-stone-100 text-ink')} title={t('Corbeille')} aria-label={trashLabel}>
            <Trash2 size={18} strokeWidth={1.9} />
            {trashCount > 0 && <span className="tabular absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-stone-500 px-1 text-center text-[10px] font-semibold leading-4 text-white" aria-hidden>{trashCount > 99 ? '99+' : trashCount}</span>}
          </NavLink>
          )}
          <AccountSwitch currentId={user.id} avatar pro={pro} />
        </header>
        <ServiceBanner inline />
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
          {/* A page that breaks gives way alone: the menus stay, another page opens normally. */}
          <ErrorBoundary page resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {announced}
          </p>
          <FeedbackDialog />
          <NewsDialog />
          <ReminderAlerts />
          <JoinedDialog />
          <InviteDialog />
          <RecPill />
          <UploadCard />
          {/* Bottom right, after the page in the Tab order: what this space creates (store/create). */}
          <CreateButton />
        </main>
      </div>

      {/* Bottom nav (mobile): every space, the last ones under « Plus ». */}
      <PhoneTabBar
        order={order}
        news={news}
        label={label}
        extra={extra}
        pro={pro}
      />

      <Copilot />
      <Tour />
    </div>
  );
}

/** A finger sliding on the tab bar opens a tab once it rests on it this long (ms), not every tab it crosses. */
const SLIDE_REST = 120;

/**
 * Phones: Accueil and the first spaces of the person's order (lib/navOrder), and « Plus » for the others (then Corbeille,
 * Administration), shown in a panel just above the bar: every space is reached from the bar.
 */
function PhoneTabBar({ order, news, label, extra, pro }: { order: SpaceKey[]; news: (to: string) => number; label: (n: { to: string; label: string }) => string; extra: Extra[]; pro: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLElement>(null);
  const main = [HOME, ...order.slice(0, PHONE_TABS).map(k => SPACES[k])];
  const more = [
    ...order.slice(PHONE_TABS).map(k => SPACES[k]).map(n => {
      const count = news(n.to);
      return { ...n, aria: count ? `${label(n)}, ${tn(count, '{n} nouveauté', '{n} nouveautés')}` : label(n), count, urgent: false };
    }),
    ...extra,
  ];
  const current = more.find(n => pathname === n.to || pathname.startsWith(`${n.to}/`));
  const navigate = useNavigate();
  // A finger sliding along the bar: the page follows the tab the finger rests on (a tab merely passed over is not
  // opened); over « Plus » the panel opens, and lifting on one of its spaces goes there. The whole slide is one
  // history step: « Retour » then goes back to where it started, not to a tab passed on the way.
  const slide = useRef<{ x: number; y: number; on: boolean; last: string | null; pushed: boolean; wait?: ReturnType<typeof setTimeout> } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const slideTo = (to: string) => {
    const s = slide.current;
    if (s) clearTimeout(s.wait);
    if (to === location.pathname) return;
    navigate(to, { replace: !!s?.pushed });
    if (s) s.pushed = true;
  };
  const onSlideDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') slide.current = { x: e.clientX, y: e.clientY, on: false, last: null, pushed: false };
  };
  const onSlideMove = (e: ReactPointerEvent) => {
    const s = slide.current;
    if (!s) return;
    if (!s.on && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10) return;
    s.on = true;
    const key = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-tab]')?.dataset.tab ?? null;
    if (key === s.last) return;
    s.last = key;
    clearTimeout(s.wait);
    setHover(key?.startsWith('p:') ? key.slice(2) : null);
    if (!key || key.startsWith('p:')) return;
    navigator.vibrate?.(5);
    if (key === 'more') return setOpen(true);
    s.wait = setTimeout(() => slideTo(key), SLIDE_REST);
  };
  const onSlideEnd = (e: ReactPointerEvent) => {
    const s = slide.current;
    if (s) clearTimeout(s.wait);
    setHover(null);
    if (!s?.on || e.type === 'pointercancel') return void (slide.current = null);
    // The click that ends a slide must not toggle « Plus » or open anything else.
    const swallow = (c: MouseEvent) => (c.stopPropagation(), c.preventDefault());
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    // Lifted on a space: there at once (in « Plus », or a tab left before its pause was over).
    if (hover) {
      setOpen(false);
      slideTo(hover);
    } else if (s.last && s.last !== 'more' && !s.last.startsWith('p:')) slideTo(s.last);
    slide.current = null;
  };
  const moreNews = more.some(n => n.to !== '/corbeille' && n.count > 0);

  // Another page: the panel goes. A press anywhere else, or Échap, closes it.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    if (!slide.current) panel.current?.querySelector<HTMLElement>('a')?.focus(); // opened by a slide: the finger chooses, no focus ring
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

  // Sideways (short): the icon beside its name, on one line, a lower bar.
  // Affichage Pro: icons only, round, the white bubble sliding under the chosen one (index.css › pro-tab).
  const tab = (active: boolean) =>
    pro
      ? cx('pro-tab', active ? 'text-[#14161f]' : 'text-white/65 hover:text-white')
      : cx('flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[17px] py-1.5 text-[10px] font-semibold tracking-[-0.01em] transition-colors max-[339px]:text-[9px] short:flex-row short:justify-center short:gap-1.5 short:py-2 short:text-[12px] [&_svg]:shrink-0', active ? 'bg-white text-[#14161f]' : 'text-white/60 hover:text-white');
  const Shown = current?.icon ?? LayoutGrid;
  const bubble = useBubble(bar, '[aria-current="page"], [data-here]', [pathname, open, pro, order.join()]);

  return (
    <>
      {open && (
        <div
          ref={panel}
          id="nav-more-panel"
          // As many columns as fit (76 px at least): one row from 360 px wide, 2 on narrower phones; on a wide screen
          // (landscape, tablet) a compact panel at the right, above « Plus », not a wide sheet of white.
          className="enter fixed bottom-[calc(max(12px,env(safe-area-inset-bottom))+4.5rem)] short:bottom-[calc(max(12px,env(safe-area-inset-bottom))+3.75rem)] left-[max(12px,env(safe-area-inset-left))] right-[max(12px,env(safe-area-inset-right))] z-[45] grid grid-cols-[repeat(auto-fit,minmax(76px,1fr))] gap-1.5 rounded-[22px] border border-stone-200 bg-surface p-2 shadow-pop sm:left-auto sm:w-[440px] lg:hidden"
        >
          {more.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              aria-label={n.aria}
              data-tab={`p:${n.to}`}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cx('relative flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-[16px] px-1 text-center text-[12px] font-semibold leading-tight transition-colors', hover === n.to ? 'bg-stone-200 text-ink' : isActive ? 'bg-stone-100 text-ink' : 'text-stone-600 hover:bg-stone-50')}
            >
              <n.icon size={22} strokeWidth={1.9} style={{ color: n.color }} aria-hidden />
              <span>{label(n)}</span>
              {n.count > 0 && (
                <span className={cx('absolute right-2 top-2 min-w-[18px] rounded-full px-1 text-center text-[10.5px] font-semibold leading-[18px] tabular', n.to === '/corbeille' ? 'bg-stone-200 text-stone-600' : n.urgent ? 'bg-red-500 text-white' : 'bg-urgent text-white')} aria-hidden>
                  {n.count > 9 ? '9+' : n.count}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      )}
      <nav ref={bar} aria-label={t('Navigation principale')} className={cx(pro ? 'pro-tabbar' : 'left-[max(12px,env(safe-area-inset-left))] right-[max(12px,env(safe-area-inset-right))] rounded-[22px] p-1', 'fixed bottom-[max(12px,env(safe-area-inset-bottom))] z-30 flex touch-none select-none bg-tile-dark shadow-pop ring-1 ring-white/10 lg:hidden')}
        onPointerDown={onSlideDown}
        onPointerMove={onSlideMove}
        onPointerUp={onSlideEnd}
        onPointerCancel={onSlideEnd}
      >
        {pro && <Bubble at={bubble} />}
        {main.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} data-tab={n.to} draggable={false} className={({ isActive }) => tab(isActive)} aria-label={pro && news(n.to) ? `${label(n)}, ${tn(news(n.to), '{n} nouveauté', '{n} nouveautés')}` : undefined}>
            {({ isActive }) => (
              <>
                <n.icon size={pro ? 21 : 19} strokeWidth={isActive ? 2.2 : 1.9} style={{ color: isActive ? n.color : undefined }} />
                <span className={pro ? 'sr-only' : 'max-w-full truncate'}>{(n as { short?: string }).short || label(n)}</span>
                {pro && news(n.to) > 0 && (
                  <span aria-hidden className="pro-count tabular">
                    {news(n.to) > 9 ? '9+' : news(n.to)}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
        {/* In one of them: the tab shows which (its icon and name), else « Plus ». */}
        <button
          ref={button}
          id="nav-more"
          data-tab="more"
          type="button"
          aria-expanded={open}
          aria-controls={open ? 'nav-more-panel' : undefined}
          aria-label={`${current ? t('Plus d’espaces (ici : {space})', { space: label(current) }) : t('Plus d’espaces')}${!open && moreNews ? `, ${t('nouveautés')}` : ''}`}
          onClick={() => setOpen(o => !o)}
          // Affichage Pro: the bubble under it when the page is one of its spaces (open too: the X on it).
          data-here={pro && current ? '' : undefined}
          className={tab(pro ? !!current : !!current && !open)}
        >
          <span className="relative">
            {open ? <X size={pro ? 21 : 19} strokeWidth={2.2} /> : <Shown size={pro ? 21 : 19} strokeWidth={current ? 2.2 : 1.9} style={{ color: current ? current.color : undefined }} />}
            {!open && moreNews && <span className={cx('absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2', current ? 'ring-white' : 'ring-tile-dark')} aria-hidden />}
          </span>
          <span className={pro ? 'sr-only' : 'max-w-full truncate'}>{open ? t('Fermer') : current ? ((current as { short?: string }).short || label(current)) : t('Plus')}</span>
        </button>
      </nav>
    </>
  );
}
