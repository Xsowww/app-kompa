import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { useSettings } from '../../store/settings';
import { isCustomNavOrder, moveSpace, PHONE_TABS, type SpaceKey } from '../../lib/navOrder';
import { HOME, SPACES, useNavOrder, useSpaceLabel } from '../../layout/spaces';
import { Section } from './controls';
import { t } from '../../i18n';

/**
 * Réglages › Apparence: the order of the spaces in the navigation (the phone's bar: the first ones, the others under
 * « Plus »; the computer's sidebar: all of them). Up and down buttons (keyboard and screen readers alike), and back to
 * the order the questionnaire gives.
 */
export default function NavOrderSection() {
  const order = useNavOrder();
  // The questionnaire's own order, saved as it is, is not « choisi par toi ».
  const custom = useSettings(s => isCustomNavOrder(s.navOrder, s.usages?.length ? s.usages : s.usage, s.needs));
  const label = useSpaceLabel();
  const [said, setSaid] = useState('');
  // The moved row's button keeps the focus (its row moved in the list).
  const focus = useRef<string | null>(null);
  useEffect(() => {
    if (!focus.current) return;
    document.getElementById(focus.current)?.focus();
    focus.current = null;
  }, [order]);

  const move = (key: SpaceKey, by: -1 | 1) => {
    const next = moveSpace(order, key, by);
    if (next.join() === order.join()) return;
    useSettings.getState().set({ navOrder: next });
    const at = next.indexOf(key);
    focus.current = `nav-${key}-${by < 0 ? 'up' : 'down'}`;
    setSaid(
      `${t('{space} : {n} sur {total}', { space: label(SPACES[key]), n: at + 1, total: next.length })}${at < PHONE_TABS ? '' : ` · ${t('sous « Plus » sur téléphone')}`}`,
    );
  };

  const btn = 'icon-btn h-8 w-8 aria-disabled:pointer-events-none aria-disabled:opacity-30 pointer-coarse:h-10 pointer-coarse:w-10';
  return (
    <Section title={t('Barre de navigation')} description={t('« {home} » reste en premier. Sur téléphone, les {n} premiers sont dans la barre, les autres sous « Plus ».', { home: HOME.label, n: PHONE_TABS })}>
      <ol className="px-3 py-2" aria-label={t('Ordre des espaces')}>
        {order.map((key, i) => {
          const s = SPACES[key];
          const name = label(s);
          return (
            <li key={key}>
              {i === PHONE_TABS && <p className="mx-2 mb-1 mt-3 border-t border-stone-100 pt-3 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-stone-500">{t('Sous « Plus » sur téléphone')}</p>}
              <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                <span className="tabular w-4 shrink-0 text-right text-[12px] text-stone-500" aria-hidden>
                  {i + 1}
                </span>
                <s.icon size={18} strokeWidth={1.9} style={{ color: s.color }} aria-hidden className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{name}</span>
                {/* aria-disabled, not disabled: the focus stays on the button at the end of the list. */}
                <button id={`nav-${key}-up`} type="button" className={btn} aria-disabled={i === 0} onClick={() => move(key, -1)} title={t('Monter')} aria-label={t('Monter « {space} »', { space: name })}>
                  <ArrowUp size={15} />
                </button>
                <button id={`nav-${key}-down`} type="button" className={btn} aria-disabled={i === order.length - 1} onClick={() => move(key, 1)} title={t('Descendre')} aria-label={t('Descendre « {space} »', { space: name })}>
                  <ArrowDown size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
        <button
          type="button"
          className="btn-secondary h-9"
          disabled={!custom}
          onClick={() => {
            useSettings.getState().set({ navOrder: null });
            setSaid(t('Ordre conseillé rétabli'));
          }}
        >
          <RotateCcw size={14} aria-hidden /> {t('Revenir à l’ordre conseillé')}
        </button>
        <p className="text-[12px] text-stone-500">{custom ? t('Ordre choisi par toi.') : t('Ordre conseillé d’après tes réponses au questionnaire.')}</p>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {said}
      </p>
    </Section>
  );
}
