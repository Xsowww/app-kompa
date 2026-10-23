import { useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, Pause, Play, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { cancelImports, cardItems, dismissUploads, notOver, pauseAll, pauseUpload, resumeAll, resumeUpload, uploadSummary, useUploads, type Upload } from '../store/uploads';
import { keepFocus } from '../lib/a11y';
import { useCreate } from '../store/create';
import { cx } from '../lib/utils';
import { t, tn } from '../i18n';

/**
 * Files being imported, on every page, level with the « + » button (components/CreateButton): just left of it
 * (from the left margin on phones, 320 px on computers), or in its place when the page has none.
 */
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

function headline({ total, failed, active, paused }: ReturnType<typeof uploadSummary>) {
  if (active) return tn(total, 'Import de {n} fichier…', 'Import de {n} fichiers…');
  if (paused) return tn(paused, '{n} fichier en pause', '{n} fichiers en pause');
  return failed ? tn(failed, '{n} fichier non importé', '{n} fichiers non importés') : tn(total, '{n} fichier importé', '{n} fichiers importés');
}

/** Grey while paused (the file starts over when resumed). */
function Bar({ value, label, paused, className }: { value: number; label: string; paused?: boolean; className?: string }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={paused ? t('En pause') : undefined} aria-label={label} className={cx('overflow-hidden rounded-full bg-stone-100', className)}>
      <div className={cx('h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none', paused ? 'bg-stone-400' : 'bg-brand-500')} style={{ width: `${paused ? 100 : value}%` }} />
    </div>
  );
}

/** One file's ⏸ / ▶ and ✕ (the Drive folder's greyed rows). */
export function FileButtons({ u, onCancel }: { u: Upload; onCancel?: (button: HTMLButtonElement) => void }) {
  const paused = u.status === 'paused';
  const toggle = paused ? t('Reprendre l’import de « {name} »', { name: u.name }) : t('Mettre en pause l’import de « {name} »', { name: u.name });
  const cancel = t('Annuler l’import de « {name} »', { name: u.name });
  return (
    <>
      <button type="button" className="icon-btn hit h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11" aria-label={toggle} title={toggle} onClick={() => (paused ? resumeUpload : pauseUpload)(u.id)}>
        {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
      </button>
      <button
        type="button"
        className="icon-btn hit h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11"
        aria-label={cancel}
        title={cancel}
        onClick={e => {
          onCancel?.(e.currentTarget);
          cancelImports([u.id]);
        }}
      >
        <X size={16} aria-hidden />
      </button>
    </>
  );
}

function Card({ items }: { items: Upload[] }) {
  const summary = uploadSummary(items);
  const { failed, active, paused, percent } = summary;
  const going = items.filter(notOver);
  const ids = going.map(u => u.id);
  // The « + » button shows when the page declares what it creates (store/create).
  const plus = useCreate(s => s.entries.length > 0);
  // null: folded, unfolded by itself when a file failed (its name shows).
  const [shut, setShut] = useState<boolean | null>(null);
  const open = shut === null ? failed > 0 : !shut;
  const ref = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Toasts go up above the card instead of covering it: --uploads-room is from the bottom of the screen to 8 px above it.
  useLayoutEffect(() => {
    const el = ref.current!;
    const root = document.documentElement.style;
    // Kompaly's panel listens too (it stays above the card).
    const tell = () => dispatchEvent(new Event('uploads-room'));
    const place = () => {
      root.setProperty('--uploads-room', `${parseFloat(getComputedStyle(el).bottom) + el.offsetHeight + 8}px`);
      tell();
    };
    const ro = new ResizeObserver(place);
    ro.observe(el);
    addEventListener('resize', place);
    return () => {
      ro.disconnect();
      removeEventListener('resize', place);
      root.removeProperty('--uploads-room');
      tell();
    };
  }, []);

  const allPaused = !active && paused > 0;
  const pauseLabel = allPaused ? tn(paused, 'Reprendre l’import', 'Reprendre les {n} imports') : tn(going.length, 'Mettre en pause l’import', 'Mettre en pause les {n} imports');
  const cancelLabel = tn(going.length, 'Annuler l’import', 'Annuler les {n} imports');
  // Once it is over: ✓ or ⚠ before the words. While it goes, the bar says it (no room for more on the button's line).
  const status = failed ? (
    <AlertCircle size={18} className="mr-2 shrink-0 text-red-600" aria-hidden />
  ) : (
    <span className="mr-2 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white" aria-hidden>
      <Check size={12} strokeWidth={3} />
    </span>
  );

  // z-[55]: above Kompaly's handle (z-50), whose touch strip on the right edge took the taps; under menus and dialogs.
  // Same bottom as the « + » button (one line higher while the REC pill shows, --rec-room); the list opens upwards.
  // Hidden while the tab bar's « Plus » panel is open on phones (it would sit on its last row).
  return (
    <div
      ref={ref}
      className={cx(
        'enter card fixed bottom-[calc(5rem+var(--rec-room,0px)+env(safe-area-inset-bottom))] left-[max(16px,env(safe-area-inset-left))] z-[55] flex flex-col-reverse border border-stone-200 p-2 pl-3.5 shadow-pop',
        'lg:bottom-[calc(1.5rem+var(--rec-room,0px))] lg:left-auto lg:w-80 [body:has(#nav-more-panel)_&]:max-lg:invisible',
        plus ? 'right-[calc(max(16px,env(safe-area-inset-right))+68px)] lg:right-[92px]' : 'right-[max(16px,env(safe-area-inset-right))] lg:right-6',
        open ? 'rounded-[22px]' : 'rounded-[28px]',
      )}
    >
      {/* First in the reading order, shown at the bottom (level with the « + » button). */}
      <div className="flex h-10 items-center gap-1">
        {!going.length && status}
        <div className="mr-1 min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold leading-tight" title={headline(summary)}>
            <span className="lg:hidden">{active ? t('Import…') : allPaused ? t('En pause') : headline(summary)}</span>
            <span className="hidden lg:inline">{headline(summary)}</span>
          </p>
          {going.length > 0 && (
            <div className="mt-1 flex items-center gap-2">
              <Bar value={percent} paused={allPaused} label={t('Progression de l’import')} className="h-1 min-w-0 flex-1" />
              {active > 0 && <span className="tabular shrink-0 text-[11.5px] font-medium leading-none text-stone-500">{percent}&nbsp;%</span>}
            </div>
          )}
        </div>
        {going.length > 0 && (
          <>
            <button type="button" className="icon-btn hit h-10 w-10" aria-label={pauseLabel} title={pauseLabel} onClick={() => (allPaused ? resumeAll : pauseAll)(ids)}>
              {allPaused ? <Play size={17} aria-hidden /> : <Pause size={17} aria-hidden />}
            </button>
            <button type="button" className="icon-btn hit h-10 w-10" aria-label={cancelLabel} title={cancelLabel} onClick={() => cancelImports(ids)}>
              <X size={18} aria-hidden />
            </button>
          </>
        )}
        <button ref={toggleRef} type="button" className="icon-btn hit h-10 w-10" aria-expanded={open} aria-label={open ? t('Réduire') : t('Voir le détail')} title={open ? t('Réduire') : t('Voir le détail')} onClick={() => setShut(open)}>
          {open ? <ChevronDown size={18} aria-hidden /> : <ChevronUp size={18} aria-hidden />}
        </button>
        {/* Only once it is all over, in the place of Pause / Annuler. */}
        {!going.length && (
          <button type="button" className="icon-btn hit h-10 w-10" aria-label={t('Fermer')} title={t('Fermer')} onClick={dismissUploads}>
            <X size={18} aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <ul className="mb-1 max-h-48 overflow-y-auto border-b border-stone-100 pb-1 pr-1">
          {items.map(u => (
            <li key={u.id} className="flex min-h-9 items-center gap-2.5 text-[12.5px] pointer-coarse:min-h-11">
              <span className={cx('min-w-0 flex-1 truncate', u.status === 'error' ? 'text-red-600' : 'text-ink')} title={u.name}>
                {u.name}
              </span>
              {u.status === 'active' ? (
                <Bar value={u.size ? Math.floor((u.loaded / u.size) * 100) : 0} label={u.name} className="h-1 w-14 shrink-0" />
              ) : u.status === 'paused' ? (
                <span className="shrink-0 font-medium text-stone-500">{t('En pause')}</span>
              ) : u.status === 'done' ? (
                <Check size={15} className="shrink-0 text-emerald-600" aria-label={t('Terminé')} />
              ) : (
                <span className="shrink-0 font-medium text-red-600">{t('Échec')}</span>
              )}
              {notOver(u) && (
                <button
                  type="button"
                  className="icon-btn hit -my-1 h-8 w-8 pointer-coarse:my-0 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:-mr-1"
                  aria-label={t('Annuler l’import de « {name} »', { name: u.name })}
                  title={t('Annuler l’import de « {name} »', { name: u.name })}
                  onClick={e => {
                    keepFocus(e.currentTarget.closest('li'), toggleRef.current);
                    cancelImports([u.id]);
                  }}
                >
                  <X size={15} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
