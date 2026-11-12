import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutGrid, Megaphone, Settings2, Trash2, X, type LucideIcon } from 'lucide-react';
import FocusTimer from '../components/FocusTimer';
import Avatar from '../components/Avatar';
import KompalyMark from '../components/KompalyMark';
import { toggleKompaly, useCopilot } from '../store/copilot';
import { useRecorder } from '../store/recorder';
import { useAuth } from '../store/auth';
import { newsName, openNews } from '../lib/news';
import { cx } from '../lib/utils';
import { useBackClose } from '../lib/backClose';
import { t } from '../i18n';
import type { SpaceKey } from '../lib/navOrder';
import { HOME, SPACES, type Space } from './spaces';
import { useBubble, type BubbleAt } from './proMotion';

/** What « Plus » holds besides the spaces (Administration; Corbeille too on phones outside Pro). */
export type Extra = { to: string; label: string; aria: string; icon: LucideIcon; color: string; count: number; urgent?: boolean };

/** Affichage Pro, computers: the spaces in the floating pill after « Accueil »; the others are under « Plus ». */
export const PRO_RAIL = 5;

const isIn = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

/** The white bubble under the chosen icon (layout/proMotion › useBubble says where). */
export function Bubble({ at }: { at: BubbleAt }) {
  if (!at) return null;
  return (
    <span
      aria-hidden
      className={cx('pro-bubble', at.moved && 'pro-bubble-moves')}
      style={{ width: at.w, height: at.h, transform: `translate(${at.x}px, ${at.y}px)` }}
    />
  );
}

/** A small mark on an icon: a number (news) or a dot (a class being recorded, a new message). */
function Mark({ count, tone = 'news' }: { count?: number; tone?: 'news' | 'rec' | 'dot' }) {
  if (tone !== 'news') return <span aria-hidden className={cx('pro-dot', tone === 'rec' && 'pro-dot-rec')} />;
  if (!count) return null;
  return (
    <span aria-hidden className="pro-count tabular">
      {count > 9 ? '9+' : count}
    </span>
  );
}

function useRecording() {
  return useRecorder(s => !!s.session && s.session.phase !== 'done');
}

type Props = {
  order: SpaceKey[];
  news: (to: string) => number;
  newsLabel: (to: string) => string;
  label: (n: { to: string; label: string }) => string;
  extra: Extra[];
};

/**
 * Affichage Pro on a computer: the side bar becomes a floating pill of icons at the left, vertically centred (the
 * mock-up « Kompaly Verre »): Accueil and the first spaces, Kompaly's mark, and « Plus » for everything else the side
 * bar had (the other spaces, Session focus, Administration, Profil); Nouveautés and Corbeille are at the top right,
 * beside the search (ProTopActions). The name of each icon in a bubble beside it on hover and keyboard focus; the white
 * bubble slides under the page you are on.
 */
export function ProRail({ order, news, newsLabel, label, extra }: Props) {
  const { pathname } = useLocation();
  const user = useAuth(s => s.user);
  const kompalyOpen = useCopilot(s => s.pose === 'open');
  const unread = useCopilot(s => s.unread);
  const recording = useRecording();
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  const rail = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [bottom, setBottom] = useState(16);

  const main: Space[] = [HOME, ...order.slice(0, PRO_RAIL).map(k => SPACES[k])];
  const others = order.slice(PRO_RAIL).map(k => SPACES[k]);
  // In « Plus »: the page you are on is one of its spaces, Profil or Administration.
  const here = others.find(n => isIn(pathname, n.to)) ?? extra.find(n => isIn(pathname, n.to));
  const inMore: { icon: LucideIcon; color?: string; name: string } | null = here
    ? { icon: here.icon, color: here.color, name: label(here) }
    : isIn(pathname, '/profil')
      ? { icon: Settings2, name: t('Profil et réglages') }
      : null;
  const moreNews = others.some(n => news(n.to) > 0) || extra.some(n => n.urgent && n.count > 0);
  const MoreIcon = open ? X : (inMore?.icon ?? LayoutGrid);

  const bubble = useBubble(rail, '[aria-current="page"], [data-here]', [pathname, order.join(), open]);

  // Another page: the panel goes. A press elsewhere, or Échap, closes it (back on « Plus »).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const at = e.target as Node;
      if (!panel.current?.contains(at) && !more.current?.contains(at)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.stopPropagation();
      setOpen(false);
      more.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (keyboard: boolean) => {
    if (!open) {
      // Its foot on the pill's foot (the pill is centred: the panel grows upwards from « Plus »).
      const r = rail.current?.getBoundingClientRect();
      if (r) setBottom(Math.max(12, window.innerHeight - r.bottom));
      if (keyboard) setTimeout(() => panel.current?.querySelector<HTMLElement>('a, button')?.focus(), 0);
    }
    setOpen(o => !o);
  };

  const row = (key: string, icon: LucideIcon, color: string, text: string, opts: { to?: string; onClick?: () => void; aria?: string; end?: ReactNode }) => {
    const Icon = icon;
    const inner = (
      <>
        <span className="pro-tile" style={{ '--c': color } as CSSProperties} aria-hidden>
          <Icon size={16} strokeWidth={2.1} />
        </span>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {opts.end}
      </>
    );
    return opts.to ? (
      <NavLink key={key} to={opts.to} aria-label={opts.aria} className="pro-row" onClick={() => setOpen(false)}>
        {inner}
      </NavLink>
    ) : (
      <button key={key} type="button" aria-label={opts.aria} className="pro-row" onClick={opts.onClick}>
        {inner}
      </button>
    );
  };

  return (
    <>
      <nav ref={rail} aria-label={t('Navigation principale')} className="pro-rail">
        <Bubble at={bubble} />
        {main.map(n => {
          const count = news(n.to);
          const name = label(n);
          return (
            <NavLink key={n.to} to={n.to} end={n.end} className="pro-rail-btn" aria-label={count ? newsLabel(n.to) : name} style={{ '--c': n.color } as CSSProperties}>
              <n.icon size={21} strokeWidth={1.9} aria-hidden />
              {n.to === '/enregistrer' && recording ? <Mark tone="rec" /> : <Mark count={count} />}
              <span className="pro-tip" aria-hidden>
                {name}
              </span>
            </NavLink>
          );
        })}
        <span className="pro-rail-sep" aria-hidden />
        <button
          type="button"
          className="pro-rail-btn"
          onClick={() => toggleKompaly()}
          aria-expanded={kompalyOpen}
          aria-controls="copilot-panel"
          aria-label={unread ? t('Demander à Kompaly (nouveau message)') : t('Demander à Kompaly')}
        >
          <KompalyMark size={26} alert={unread} />
          <span className="pro-tip" aria-hidden>
            {t('Kompaly')}
          </span>
        </button>
        <button
          ref={more}
          type="button"
          className="pro-rail-btn"
          data-here={inMore && !open ? '' : undefined}
          aria-expanded={open}
          aria-controls="pro-more"
          aria-label={`${inMore ? t('Plus (ici : {space})', { space: inMore.name }) : t('Plus')}${!open && moreNews ? `, ${t('nouveautés')}` : ''}`}
          onClick={e => toggle(e.detail === 0)}
          style={{ '--c': inMore?.color || undefined } as CSSProperties}
        >
          <MoreIcon size={21} strokeWidth={1.9} aria-hidden />
          {!open && moreNews && <Mark tone="dot" />}
          <span className="pro-tip" aria-hidden>
            {open ? t('Fermer') : t('Plus')}
          </span>
        </button>
      </nav>

      {/* Always there (hidden when closed): « Session focus » keeps its timer running in it. */}
      <div
        ref={panel}
        id="pro-more"
        role="group"
        aria-label={t('Plus')}
        inert={!open}
        data-open={open || undefined}
        className="pro-more"
        style={{ bottom }}
      >
        {user && (
          <NavLink to="/profil" className="pro-row pro-row-me" onClick={() => setOpen(false)}>
            <Avatar size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-ink">{user.name}</span>
              <span className="block truncate text-[12px] font-medium text-stone-500">{t('Profil et réglages||sous le nom, court')}</span>
            </span>
            <Settings2 size={16} className="text-stone-500" aria-hidden />
          </NavLink>
        )}
        {(others.length > 0 || extra.length > 0) && <span className="pro-more-sep" aria-hidden />}
        {others.map(n => {
          const count = news(n.to);
          return row(n.to, n.icon, n.color, label(n), { to: n.to, aria: count ? newsLabel(n.to) : undefined, end: count > 0 && <span className="pro-pill-count tabular" aria-hidden>{count > 9 ? '9+' : count}</span> });
        })}
        {extra.map(e => row(e.to, e.icon, e.color, e.label, { to: e.to, aria: e.aria, end: e.count > 0 && <span className="pro-pill-count pro-pill-urgent tabular" aria-hidden>{e.count}</span> }))}
        <div className="pro-more-focus">
          <FocusTimer />
        </div>
      </div>
    </>
  );
}

/** A count that never gets wider than its button. */
const capped = (n: number, max: number) => (n > max ? `${max}+` : String(n));

/**
 * Affichage Pro on a computer: Nouveautés and Corbeille as two round glass buttons at the top right, between the search
 * and the avatar (no longer in « Plus »). Nouveautés has a red number while the latest ones are unread, the bin a grey
 * one, how many things it holds; their name in a bubble under them on hover and on keyboard focus.
 */
export function ProTopActions({ unread, trash, trashLabel }: { unread: number; trash: number; trashLabel: string }) {
  return (
    <div className="hidden shrink-0 items-center gap-2 lg:flex">
      <button type="button" className="pro-hbtn" onClick={() => openNews()} aria-label={newsName(unread)}>
        <Megaphone size={18} strokeWidth={1.9} aria-hidden />
        {unread > 0 && (
          <span aria-hidden className="pro-count tabular">
            {capped(unread, 9)}
          </span>
        )}
        <span className="pro-tip" aria-hidden>
          {t('Nouveautés')}
        </span>
      </button>
      <NavLink to="/corbeille" className="pro-hbtn" aria-label={trashLabel}>
        <Trash2 size={18} strokeWidth={1.9} aria-hidden />
        {trash > 0 && (
          <span aria-hidden className="pro-count pro-count-muted tabular">
            {capped(trash, 99)}
          </span>
        )}
        <span className="pro-tip" aria-hidden>
          {t('Corbeille')}
        </span>
      </NavLink>
    </div>
  );
}

/**
 * Affichage Pro on phones and tablets: Kompaly in the top bar, his mark and his name in a glass capsule (not the drone's
 * head), a red dot when he has written. His panel opens from it, as from the computer's pill.
 */
export function ProKompalyButton() {
  const open = useCopilot(s => s.pose === 'open');
  const unread = useCopilot(s => s.unread);
  return (
    <button
      type="button"
      onClick={() => toggleKompaly()}
      aria-expanded={open}
      aria-controls="copilot-panel"
      aria-label={unread ? t('Demander à Kompaly (nouveau message)') : t('Demander à Kompaly')}
      className="pro-kbtn lg:hidden"
    >
      <KompalyMark size={22} alert={unread} />
      <span className="pro-kbtn-name" aria-hidden>
        {t('Kompaly')}
      </span>
    </button>
  );
}
