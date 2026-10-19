import { Globe } from 'lucide-react';
import { LANGS, lang, setLang, t, type Lang } from '../i18n';
import { cx } from '../lib/utils';

/** The site's language (saved on this device, the page reloads in it). */
export default function LanguagePicker({ className }: { className?: string }) {
  return (
    <label className={cx('relative inline-flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-ink', className)}>
      <Globe size={13} aria-hidden />
      <select
        className="cursor-pointer appearance-none bg-transparent pr-1 font-medium outline-none focus-visible:underline"
        value={lang}
        aria-label={t('Langue du site')}
        onChange={e => setLang(e.target.value as Lang)}
      >
        {LANGS.map(l => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
