import { Globe } from 'lucide-react';
import { LANGS, lang, setLang, t, type Lang } from '../i18n';
import { SelectField } from './SelectField';

/** The site's language (saved on this device, the page reloads in it). */
export default function LanguagePicker({ className }: { className?: string }) {
  return (
    <SelectField<Lang>
      bare
      icon={<Globe size={13} aria-hidden />}
      className={className ?? 'h-8'}
      value={lang}
      label={t('Langue du site')}
      options={LANGS.map(l => ({ value: l.code, label: l.name }))}
      onChange={l => l !== lang && setLang(l)}
    />
  );
}
