import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, CalendarRange, ChevronLeft, ChevronRight, FolderDown, Link2, Repeat, ScanText, Sparkles } from 'lucide-react';
import { Modal } from './Overlays';
import { DroneStill } from '../copilot/Character';
import { RELEASES, useNews, type NewsIcon } from '../lib/news';
import { useSettings } from '../store/settings';
import { fmtDay, fromKey } from '../lib/dates';
import { cx } from '../lib/utils';
import { t } from '../i18n';

const ICONS = { repeat: Repeat, span: CalendarRange, link: Link2, bell: BellRing, photo: ScanText, zip: FolderDown } as const;
// One colour per page, from the folder colours (light and dark).
const TINTS: Record<NewsIcon, string> = {
  link: 'from-sky-500/25 to-sky-500/5 text-sky-600 dark:text-sky-300',
  repeat: 'from-violet-500/25 to-violet-500/5 text-violet-600 dark:text-violet-300',
  span: 'from-emerald-500/25 to-emerald-500/5 text-emerald-600 dark:text-emerald-300',
  bell: 'from-amber-500/30 to-amber-500/5 text-amber-600 dark:text-amber-300',
  photo: 'from-rose-500/25 to-rose-500/5 text-rose-600 dark:text-rose-300',
  zip: 'from-teal-500/25 to-teal-500/5 text-teal-600 dark:text-teal-300',
  drone: 'from-stone-500/25 to-stone-500/5 text-stone-600 dark:text-stone-300',
};

/** « Nouveautés » : one page per novelty, read in order; closing marks the release as seen on every device. */
export default function NewsDialog() {
  const open = useNews(s => s.open);
  const release = RELEASES.find(r => r.id === open);
  const [page, setPage] = useState(0);
  const navigate = useNavigate();
  const swipe = useRef<{ x: number; y: number } | null>(null);
  if (!release) return null;
  const item = release.items[Math.min(page, release.items.length - 1)];
  const last = page >= release.items.length - 1;
  const go = (to: number) => setPage(Math.max(0, Math.min(release.items.length - 1, to)));
  const close = () => {
    useNews.setState({ open: null });
    setPage(0);
    if (useSettings.getState().newsSeen < release.id) useSettings.getState().set({ newsSeen: release.id });
  };
  const Icon = item.icon === 'drone' ? null : ICONS[item.icon];

  return (
    <Modal open onClose={close} width={440} label={t('Nouveautés')}>
      {/* ← → turn the pages, and so does a finger swiping across the window. */}
      <div
        onKeyDown={e => {
          if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
          e.preventDefault();
          go(page + (e.key === 'ArrowRight' ? 1 : -1));
        }}
        onPointerDown={e => (swipe.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={e => {
          const from = swipe.current;
          swipe.current = null;
          if (!from || e.pointerType === 'mouse') return;
          const dx = e.clientX - from.x;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - from.y) * 1.5) go(page + (dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => (swipe.current = null)}
        className="touch-pan-y"
      >
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-stone-500">
          <Sparkles size={13} aria-hidden /> {t('Nouveautés du {day}', { day: fmtDay(fromKey(release.id), 'd MMMM') })}
          <span className="tabular ml-auto">
            {page + 1} / {release.items.length}
          </span>
        </p>
        {/* A phone held sideways: a smaller picture, the whole page fits without scrolling. */}
        <div key={page} className={cx('enter mt-3 flex h-40 items-center justify-center rounded-2xl bg-gradient-to-br short:h-20', TINTS[item.icon])}>
          {Icon ? <Icon size={56} strokeWidth={1.6} aria-hidden className="short:size-9" /> : <DroneStill className="h-28 drop-shadow-[0_6px_10px_rgba(0,0,0,0.25)] short:h-16" />}
        </div>
        <h3 className="mt-4 text-[18px] font-semibold tracking-[-0.01em] short:mt-3">{item.title}</h3>
        <p className="mt-1.5 min-h-[3.75rem] text-[14px] leading-relaxed text-stone-600 short:min-h-0">{item.text}</p>

        {/* Each dot opens its page (a 24 px tap zone around the small dot). */}
        <div className="mt-3 flex justify-center short:mt-1">
          {release.items.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={t('Page {n} sur {total} : {title}', { n: i + 1, total: release.items.length, title: it.title })}
              aria-current={i === page ? 'step' : undefined}
              className="group flex h-6 items-center px-[3px] pointer-coarse:h-9"
            >
              <span className={cx('h-1.5 rounded-full transition-all', i === page ? 'w-5 bg-ink' : 'w-1.5 bg-stone-300 group-hover:bg-stone-400')} />
            </button>
          ))}
        </div>

        {/* 320 px: the three buttons on one line (no arrow on « Suivant »), and never wider than the window. */}
        <div className="modal-foot mt-5 short:mt-2">
          {page > 0 ? (
            <button type="button" className="btn-ghost mr-auto h-10 px-2.5" onClick={() => setPage(p => p - 1)} aria-label={t('Précédent')}>
              <ChevronLeft size={16} />
            </button>
          ) : (
            <button type="button" className="btn-ghost mr-auto h-10 px-2 text-[13px]" onClick={close}>
              {t('Passer')}
            </button>
          )}
          {item.to && (
            <button
              type="button"
              className="btn-secondary h-10 max-[359px]:px-3"
              onClick={() => {
                close();
                navigate(item.to!);
              }}
            >
              {t('Essayer')}
            </button>
          )}
          <button type="button" className="btn-primary h-10 max-[359px]:px-3" onClick={() => (last ? close() : setPage(p => p + 1))} autoFocus>
            {last ? t('C’est parti') : t('Suivant')} {!last && <ChevronRight size={16} className="max-[359px]:hidden" />}
          </button>
        </div>
      </div>
    </Modal>
  );
}
