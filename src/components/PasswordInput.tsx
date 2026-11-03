import { useState, type InputHTMLAttributes, type Ref } from 'react';
import { ArrowBigUp, Eye, EyeOff } from 'lucide-react';
import { t } from '../i18n';

/**
 * A password field with its eye (show / hide) and, under it, a warning while Caps Lock is on (read on each key:
 * the only moment a browser tells). The other props (id, value, aria-*…) go to the field itself, so that
 * Field (components/Field) labels it like any input.
 */
export default function PasswordInput({ className, onKeyDown, onKeyUp, onBlur, ref, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { ref?: Ref<HTMLInputElement> }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <>
      <span className="relative block">
        <input
          ref={ref}
          {...props}
          type={show ? 'text' : 'password'}
          className={`${className ?? ''} pr-10`}
          onKeyDown={e => (setCaps(e.getModifierState('CapsLock')), onKeyDown?.(e))}
          onKeyUp={e => (setCaps(e.getModifierState('CapsLock')), onKeyUp?.(e))}
          onBlur={e => (setCaps(false), onBlur?.(e))}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="hit absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-1.5 text-stone-500 hover:text-stone-700 pointer-coarse:h-9 pointer-coarse:w-9"
          title={show ? t('Masquer le mot de passe') : t('Afficher le mot de passe')}
          aria-label={show ? t('Masquer le mot de passe') : t('Afficher le mot de passe')}
          aria-pressed={show}
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </span>
      {/* Always in the page (empty when off), so that it is read out when it appears. */}
      <p role="status" className={caps ? 'mt-1.5 flex items-center gap-1 text-[12px] text-amber-700 dark:text-amber-300' : 'sr-only'}>
        {caps && (
          <>
            <ArrowBigUp size={14} aria-hidden /> {t('Verrouillage majuscules activé')}
          </>
        )}
      </p>
    </>
  );
}
