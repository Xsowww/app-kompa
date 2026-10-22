import { passwordStrength } from '../lib/passwordStrength';
import { cx } from '../lib/utils';
import { t } from '../i18n';

const LEVELS = [
  { label: t('Faible'), bar: 'bg-red-500' },
  { label: t('Moyen'), bar: 'bg-amber-500' },
  { label: t('Bon'), bar: 'bg-emerald-500' },
  { label: t('Fort'), bar: 'bg-emerald-600' },
];

/** The bar under a new password: fills up as it gets stronger. `avoid`: the name or e-mail, weak inside a password. */
export default function PasswordStrength({ password, avoid = [], id }: { password: string; avoid?: string[]; id?: string }) {
  const level = passwordStrength(password, avoid);
  const now = LEVELS[level - 1];
  // The rule that blocks (AuthPage, Profile), not the strength.
  const meetsRule = password.length >= 8 && /\p{L}/u.test(password) && /\d/.test(password);
  return (
    <div className="mt-2">
      <div className="flex gap-1" aria-hidden>
        {LEVELS.map((l, i) => (
          <span key={l.label} className={cx('h-1 flex-1 rounded-full transition-colors duration-200', i < level ? now.bar : 'bg-stone-200')} />
        ))}
      </div>
      <p id={id} className="mt-1 text-[11.5px] text-stone-500" aria-live="polite">
        {now && t('Sécurité : {level}', { level: now.label })}
        {/* The rule stays in sight until it is met (the bar alone said « Faible » without saying why). */}
        {now && !meetsRule && ' · '}
        {!meetsRule && t('8 caractères minimum, lettres et chiffres')}
      </p>
    </div>
  );
}
