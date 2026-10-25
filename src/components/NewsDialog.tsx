import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, CalendarRange, ChevronLeft, ChevronRight, FolderDown, Link2, Repeat, ScanText, Sparkles } from 'lucide-react';
import { Modal } from './Overlays';
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
  if (!release) return null;
  const item = release.items[Math.min(page, release.items.length - 1)];
  const last = page >= release.items.length - 1;
  const close = () => {
    useNews.setState({ open: null });
    setPage(0);
    if (useSettings.getState().newsSeen < release.id) useSettings.getState().set({ newsSeen: release.id });
  };
  const Icon = item.icon === 'drone' ? null : ICONS[item.icon];

  return (
    <Modal open onClose={close} width={440} label={t('Nouveautés')}>
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-stone-500">
        <Sparkles size={13} aria-hidden /> {t('Nouveautés du {day}', { day: fmtDay(fromKey(release.id), 'd MMMM') })}
        <span className="tabular ml-auto">
          {page + 1} / {release.items.length}
        </span>
      </p>
      <div key={page} className={cx('enter mt-3 flex h-40 items-center justify-center rounded-2xl bg-gradient-to-br', TINTS[item.icon])}>
        {Icon ? <Icon size={56} strokeWidth={1.6} aria-hidden /> : <img src="/kompaly/drone.webp" alt="" width={180} height={112} className="h-28 w-auto drop-shadow-[0_6px_10px_rgba(0,0,0,0.25)]" />}
      </div>
      <h3 className="mt-4 text-[18px] font-semibold tracking-[-0.01em]">{item.title}</h3>
      <p className="mt-1.5 min-h-[3.75rem] text-[14px] leading-relaxed text-stone-600">{item.text}</p>

      <div className="mt-4 flex justify-center gap-1.5" aria-hidden>
        {release.items.map((_, i) => (
          <span key={i} className={cx('h-1.5 rounded-full transition-all', i === page ? 'w-5 bg-ink' : 'w-1.5 bg-stone-300')} />
        ))}
      </div>

      <div className="mt-5 flex items-center gap-2">
        {page > 0 ? (
          <button type="button" className="btn-ghost h-10 px-2.5" onClick={() => setPage(p => p - 1)} aria-label={t('Précédent')}>
            <ChevronLeft size={16} />
          </button>
        ) : (
          <button type="button" className="btn-ghost h-10 px-2.5 text-[13px]" onClick={close}>
            {t('Passer')}
          </button>
        )}
        {item.to && (
          <button
            type="button"
            className="btn-secondary ml-auto h-10"
            onClick={() => {
              close();
              navigate(item.to!);
            }}
          >
            {t('Essayer')}
          </button>
        )}
        <button type="button" className={cx('btn-primary h-10', !item.to && 'ml-auto')} onClick={() => (last ? close() : setPage(p => p + 1))} autoFocus>
          {last ? t('C’est parti') : t('Suivant')} {!last && <ChevronRight size={16} />}
        </button>
      </div>
    </Modal>
  );
}
