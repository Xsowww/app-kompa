import { CopilotAvatar } from '../copilot/Character';
import KompalyMark from './KompalyMark';
import { toggleKompaly, useCopilot } from '../store/copilot';
import { useSettings } from '../store/settings';
import { cx } from '../lib/utils';
import { t } from '../i18n';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * « Kompaly » in the menu: the conversation from anywhere, even with the character hidden (Profil › Kompaly).
 * `phone`: phones and tablets, his head and his name in the top bar (the way to open him there; the dot when he said
 * something while closed).
 */
export function KompalyEntry({ phone, compact }: { phone?: boolean; compact?: boolean }) {
  const open = useCopilot(s => s.pose === 'open');
  const unread = useCopilot(s => s.unread);
  // Affichage Pro: the sober mark (two dots), no drone's face.
  const pro = useSettings(s => s.pro);
  const avatar = pro ? <KompalyMark size={24} className="shrink-0" /> : <CopilotAvatar size={26} />;
  const label = unread ? t('Demander à Kompaly (nouveau message)') : t('Demander à Kompaly');
  if (phone)
    return (
      <button
        type="button"
        onClick={() => toggleKompaly()}
        aria-expanded={open}
        aria-controls="copilot-panel"
        className={cx('hit relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-stone-200 bg-surface pl-1 pr-1 text-[13px] font-semibold text-ink shadow-card transition-colors hover:bg-stone-50 lg:hidden', compact ? 'min-[400px]:pr-3' : 'min-[360px]:pr-3')}
        title={t('Demander à Kompaly')}
        aria-label={label}
      >
        {avatar}
        <span className={compact ? 'max-[399px]:hidden' : 'max-[359px]:hidden'} aria-hidden>
          {t('Kompaly')}
        </span>
        {unread && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-paper" />}
      </button>
    );
  return (
    <button
      type="button"
      onClick={() => toggleKompaly()}
      aria-expanded={open}
      aria-controls="copilot-panel"
      aria-label={label}
      aria-keyshortcuts={isMac ? 'Meta+J' : 'Control+J'}
      title={`${t('Demander à Kompaly')} (${isMac ? '⌘' : t('Ctrl')} J)`}
      // The way to talk to him on a computer: a tinted row, his head whole, above « Nouveautés ».
      className="mb-2 flex h-11 items-center gap-2.5 rounded-lg bg-brand-50 px-2 text-left text-[14px] font-semibold text-ink transition-colors hover:bg-brand-100"
    >
      <span className="relative flex w-[22px] justify-center">
        {avatar}
        {unread && <span aria-hidden className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-surface" />}
      </span>
      <span className="min-w-0 truncate">{t('Demander à Kompaly')}</span>
    </button>
  );
}
