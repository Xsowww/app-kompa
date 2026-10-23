import { useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { cardItems, dismissUploads, uploadSummary, useUploads, type Upload } from '../store/uploads';
import { cx } from '../lib/utils';
import { t, tn } from '../i18n';

/** Files being imported, on every page: bottom right on computers, above « Avis ou bug » on phones. */
export default function UploadCard() {
  // The files of the Drive folder open show there, each with its percent: the card is for the others (and once you leave).
  const items = useUploads(useShallow(s => cardItems(s.items, s.shownAt)));
  return (
    <>
      {/* Always there, so that it is read out when the import starts and when it ends (not at every percent). */}
      <span role="status" aria-live="polite" className="sr-only">
        {items.length ? headline(uploadSummary(items)) : ''}
      </span>
      {/* A new import starts with a fresh card (list folded again). */}
      {items.length > 0 && <Card key={items[0].id} items={items} />}
    </>
  );
}

function headline({ total, failed, active }: ReturnType<typeof uploadSummary>) {
  if (active) return tn(total, 'Import de {n} fichier…', 'Import de {n} fichiers…');
  return failed ? tn(failed, '{n} fichier non importé', '{n} fichiers non importés') : tn(total, '{n} fichier importé', '{n} fichiers importés');
}

function Bar({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label} className={cx('overflow-hidden rounded-full bg-stone-100', className)}>
      <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${value}%` }} />
    </div>
  );
}

function Card({ items }: { items: Upload[] }) {
  const summary = uploadSummary(items);
  const { failed, active, percent } = summary;
  // null: folded, unfolded by itself when a file failed (its name shows).
  const [shut, setShut] = useState<boolean | null>(null);
  const open = shut === null ? failed > 0 : !shut;
  const ref = useRef<HTMLDivElement>(null);

  // Toasts go up above the card instead of covering it.
  useLayoutEffect(() => {
    const el = ref.current!;
    const root = document.documentElement.style;
    const ro = new ResizeObserver(() => root.setProperty('--uploads-room', `${el.offsetHeight + 44}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeProperty('--uploads-room');
    };
  }, []);

  // z-[55]: above Kompaly's handle (z-50), whose touch strip on the right edge took the taps on « Fermer »; under dialogs.
  return (
    <div
      ref={ref}
      className="enter card fixed inset-x-3 bottom-[calc(8.75rem+env(safe-area-inset-bottom))] z-[55] border border-stone-200 p-3 shadow-pop lg:inset-x-auto lg:bottom-14 lg:right-5 lg:w-80"
    >
      <div className="flex items-center gap-2.5">
        {active ? (
          <Loader2 size={18} className="shrink-0 text-brand-500 motion-safe:animate-spin" aria-hidden />
        ) : failed ? (
          <AlertCircle size={18} className="shrink-0 text-red-600" aria-hidden />
        ) : (
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white" aria-hidden>
            <Check size={12} strokeWidth={3} />
          </span>
        )}
        <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{headline(summary)}</p>
        {active > 0 && <span className="tabular text-[12.5px] font-medium text-stone-500">{percent}&nbsp;%</span>}
        <button type="button" className="icon-btn h-7 w-7" aria-expanded={open} aria-label={open ? t('Réduire') : t('Voir le détail')} title={open ? t('Réduire') : t('Voir le détail')} onClick={() => setShut(open)}>
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {!active && (
          <button type="button" className="icon-btn h-7 w-7" aria-label={t('Fermer')} title={t('Fermer')} onClick={dismissUploads}>
            <X size={16} />
          </button>
        )}
      </div>
      {active > 0 && <Bar value={percent} label={t('Progression de l’import')} className="mt-2.5 h-1.5" />}
      {open && (
        <ul className="-mx-1 mt-2 max-h-48 overflow-y-auto px-1">
          {items.map(u => (
            <li key={u.id} className="flex items-center gap-3 py-1.5 text-[12.5px]">
              <span className={cx('min-w-0 flex-1 truncate', u.status === 'error' ? 'text-red-600' : 'text-ink')} title={u.name}>
                {u.name}
              </span>
              {u.status === 'active' ? (
                <Bar value={u.size ? Math.floor((u.loaded / u.size) * 100) : 0} label={u.name} className="h-1 w-14 shrink-0" />
              ) : u.status === 'done' ? (
                <Check size={15} className="shrink-0 text-emerald-600" aria-label={t('Terminé')} />
              ) : (
                <span className="shrink-0 font-medium text-red-600">{t('Échec')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
