import { useState } from 'react';
import { addDays } from 'date-fns';
import { CalendarClock, CalendarPlus, Check } from 'lucide-react';
import { ContextMenu, type MenuItem } from '../../components/Overlays';
import { catOf, type CalendarEvent } from '../../store/calendar';
import { fmtDay, fromKey, toKey, todayKey } from '../../lib/dates';
import { lateDaysOf } from '../../lib/late';
import { isSpan } from '../../lib/repeat';
import { menuPoint } from '../../lib/a11y';
import { toast } from '../../store/ui';
import type { CalendarSource } from './source';
import { t, tn } from '../../i18n';

/** Rows shown before « et N autres » (a button that shows them all). */
const SHOWN = 6;

/**
 * « En retard » of the calendar (lib/late › listLate): tick or put off (« Reporter ») one event or all of them, with
 * « Annuler » in the message. An event over several days is one row: it is ticked or moved whole.
 */
export default function LateEvents({ late, source, onShow }: { late: CalendarEvent[]; source: CalendarSource; onShow: (e: CalendarEvent) => void }) {
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; list: CalendarEvent[]; label: string } | null>(null);

  const markDone = (list: CalendarEvent[]) => {
    const days = list.flatMap(e => lateDaysOf(e, source.events)).filter(e => !e.done);
    days.forEach(e => source.toggleDone(e.id));
    const text = list.length === 1 ? t('« {title} » marqué comme fait', { title: list[0].title }) : tn(list.length, '{n} événement marqué comme fait', '{n} événements marqués comme faits');
    toast(text, 'success', { label: t('Annuler||l’action'), run: () => days.forEach(e => source.toggleDone(e.id)) });
  };

  // Today or tomorrow, at the same time. An event over several days moves whole, from its first day (its length kept);
  // an occurrence of a repeat moves alone.
  const postpone = (list: CalendarEvent[], day: string) => {
    const moves = list.map(e => {
      const first = isSpan(e.series) ? source.events.filter(x => x.series === e.series).sort((a, b) => a.date.localeCompare(b.date))[0] ?? e : e;
      return { first, from: first.date, span: isSpan(e.series) };
    });
    const move = (m: (typeof moves)[number], date: string) => (m.span ? source.updateSeries(m.first.id, { date }) : source.update(m.first.id, { date }));
    moves.forEach(m => move(m, day));
    const today = day === todayKey();
    const text =
      list.length === 1
        ? today
          ? t('« {title} » reporté à aujourd’hui', { title: list[0].title })
          : t('« {title} » reporté à demain', { title: list[0].title })
        : today
          ? tn(list.length, '{n} événement reporté à aujourd’hui', '{n} événements reportés à aujourd’hui')
          : tn(list.length, '{n} événement reporté à demain', '{n} événements reportés à demain');
    toast(text, 'success', { label: t('Annuler||l’action'), run: () => moves.forEach(m => move(m, m.from)) });
  };

  const items = (list: CalendarEvent[], whole: boolean): MenuItem[] => [
    { label: whole ? t('Tout reporter à aujourd’hui') : t('Reporter à aujourd’hui'), icon: <CalendarClock />, onClick: () => postpone(list, todayKey()) },
    { label: whole ? t('Tout reporter à demain') : t('Reporter à demain'), icon: <CalendarPlus />, onClick: () => postpone(list, toKey(addDays(new Date(), 1))) },
  ];

  const shown = all ? late : late.slice(0, SHOWN);
  const small = 'rounded-md px-1.5 py-0.5 text-[12px] font-medium text-stone-500 transition-colors hover:bg-stone-50 hover:text-ink pointer-coarse:py-2';
  return (
    <section id="en-retard" aria-labelledby="en-retard-titre" className="mb-4 scroll-mt-20 border-b border-stone-200 pb-3">
      <h2 id="en-retard-titre" className="text-[13px] font-semibold text-urgent-text">
        {t('En retard')} · {late.length}
      </h2>
      <div className="-mx-1.5 mb-1.5 mt-0.5 flex flex-wrap items-center gap-1">
        <button type="button" aria-haspopup="menu" onClick={e => setMenu({ ...menuPoint(e), list: late, label: t('Tout reporter') })} className={small}>
          {t('Tout reporter')}
        </button>
        <button type="button" onClick={() => markDone(late)} className={small}>
          {t('Tout marquer comme fait')}
        </button>
      </div>
      <ul className="-mx-1.5">
        {shown.map(e => (
          <li key={e.id} className="flex items-center">
            <button onClick={() => onShow(e)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-stone-50">
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: catOf(e.category).color }} />
                  <span className="truncate">{e.title}</span>
                </span>
                <span className="block text-[12px] first-letter:uppercase text-stone-500">
                  {fmtDay(fromKey(e.date), 'EEE d MMM')}
                  {e.start && ` · ${e.start}`}
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-haspopup="menu"
              onClick={ev => setMenu({ ...menuPoint(ev), list: [e], label: t('Reporter « {title} »', { title: e.title }) })}
              className="icon-btn ml-1 h-6 w-6 shrink-0 pointer-coarse:h-9 pointer-coarse:w-9"
              title={t('Reporter')}
              aria-label={t('Reporter « {title} »', { title: e.title })}
            >
              <CalendarClock size={14} />
            </button>
            <button
              onClick={() => markDone([e])}
              className="hit ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-300 text-transparent transition-colors hover:border-emerald-500 hover:text-emerald-500"
              title={t('Marquer comme fait')}
              aria-label={t('Marquer « {title} » comme fait', { title: e.title })}
            >
              <Check size={13} strokeWidth={3} />
            </button>
          </li>
        ))}
        {late.length > shown.length && (
          <li className="px-1.5 pt-1">
            <button type="button" onClick={() => setAll(true)} className="rounded text-[12px] font-medium text-stone-500 hover:text-ink hover:underline pointer-coarse:min-h-9">
              {tn(late.length - shown.length, 'et {n} autre', 'et {n} autres')}
            </button>
          </li>
        )}
      </ul>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu.list, menu.list.length > 1)} onClose={() => setMenu(null)} label={menu.label} />}
    </section>
  );
}
