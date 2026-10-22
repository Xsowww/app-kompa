import { useEffect, useRef } from 'react';
import { Bell, Star } from 'lucide-react';
import { keywordRanges, type Keyword } from '../../lib/keywords';
import { clock, type Alert, type Segment } from '../../lib/recorder/course';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';

/** A passage with its keywords highlighted. */
function Marked({ text, keywords }: { text: string; keywords: readonly Keyword[] }) {
  const ranges = keywordRanges(text, keywords);
  if (!ranges.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(
      <mark key={i} className="rounded bg-amber-200/80 px-0.5 text-ink">
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

/**
 * What has been said, passage by passage (the precise lane), then what the browser is hearing right now (grey).
 * Follows the end of the text, unless the student scrolled up to read.
 */
export default function Transcript({ segments, keywords, liveText, follow, empty, writing = false }: { segments: readonly Segment[]; keywords: readonly Keyword[]; liveText: string; follow: boolean; empty: string; writing?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && follow && stuck.current) el.scrollTop = el.scrollHeight;
  }, [segments.length, liveText, follow, writing]);
  // Gaps in a row (transcription off, network down…) on one line instead of one every few seconds.
  const shown = segments.reduce<{ seg: Segment; until?: number }[]>((out, seg) => {
    const prev = out.at(-1);
    if (prev && seg.origin === 'manquant' && prev.seg.origin === 'manquant' && !seg.starred && !prev.seg.starred) prev.until = seg.end;
    else out.push({ seg });
    return out;
  }, []);

  return (
    <div
      ref={box}
      onScroll={e => {
        const el = e.currentTarget;
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
      className="max-h-[min(62vh,640px)] min-h-[220px] overflow-y-auto pr-1"
      aria-live="off"
    >
      {!segments.length && !liveText && !writing && <p className="py-10 text-center text-[13.5px] text-stone-500">{empty}</p>}
      <ol className="space-y-2.5">
        {shown.map(({ seg: s, until }) => {
          const flagged = s.starred || s.hits.length > 0;
          return (
            <li key={s.id} id={`passage-${s.id}`} className={cx('flex gap-3 rounded-xl px-2 py-1.5 text-[14.5px] leading-relaxed', flagged && 'bg-amber-50')}>
              <span className="tabular w-[62px] shrink-0 pt-0.5 text-[11.5px] font-medium text-stone-500">{clock(s.start)}</span>
              <span className="min-w-0 flex-1">
                {s.starred && <Star size={13} className="mr-1 inline -translate-y-px fill-amber-400 text-amber-500" aria-label={t('Moment marqué')} />}
                {s.origin === 'manquant' ? (
                  <span className="italic text-stone-500">{until ? t('(non transcrit jusqu’à {time})', { time: clock(until) }) : t('(passage non transcrit)')}</span>
                ) : (
                  <span className={cx(s.origin === 'navigateur' && 'text-stone-600')} title={s.origin === 'navigateur' ? t('Écrit par le navigateur (moins précis)') : undefined}>
                    <Marked text={s.text} keywords={keywords} />
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {/* Someone is speaking, its text is on its way (a few seconds). */}
      {writing && !liveText && (
        <p className="mt-2.5 flex items-center gap-3 px-2 text-[14px] text-stone-500" role="status">
          <span className="w-[62px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-red-500">{t('en direct')}</span>
          <span className="flex gap-1" aria-label={t('Texte en cours d’écriture')}>
            {[0, 1, 2].map(i => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-stone-400" style={{ animationDelay: `${i * 0.2}s` }} />)}
          </span>
        </p>
      )}
      {liveText && (
        <p className="mt-2.5 flex gap-3 px-2 text-[14.5px] italic leading-relaxed text-stone-500">
          <span className="w-[62px] shrink-0 pt-0.5 text-[11px] font-semibold not-italic uppercase tracking-wide text-red-500">{t('en direct')}</span>
          <span className="min-w-0 flex-1">
            <Marked text={liveText} keywords={keywords} />
          </span>
        </p>
      )}
    </div>
  );
}

/** The moments: keywords heard, and the ones marked by hand. A click shows the passage. */
export function Alerts({ alerts, segments }: { alerts: readonly Alert[]; segments: readonly Segment[] }) {
  if (!alerts.length) return <p className="text-[13px] leading-relaxed text-stone-500">{t('Aucune alerte pour l’instant.')}</p>;
  const show = (time: number) => {
    // The passage of that time, or the line its gap was merged into.
    const before = segments.filter(s => s.start <= time + 1).reverse();
    const el = [...before, ...segments].map(s => document.getElementById(`passage-${s.id}`)).find(Boolean);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  return (
    <ul className="space-y-1.5">
      {alerts.map(a => (
        <li key={a.id}>
          <button type="button" onClick={() => show(a.time)} className="w-full rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-stone-100">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
              {a.keyword ? <Bell size={13} className="text-amber-600" aria-hidden /> : <Star size={13} className="fill-amber-400 text-amber-500" aria-hidden />}
              {a.keyword ? t('« {keyword} »', { keyword: a.keyword }) : t('Moment marqué')}
              <span className="tabular ml-auto text-[11px] font-medium text-stone-500">{clock(a.time)}</span>
            </span>
            {a.excerpt && <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-stone-600">{a.excerpt}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
