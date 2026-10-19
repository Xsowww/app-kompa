import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { addDays } from 'date-fns';
import { ChevronRight, Table2, ChartNoAxesColumn } from 'lucide-react';
import { useFocusLog } from '../../store/focusLog';
import { toKey, fmt, fromKey } from '../../lib/dates';
import { cx } from '../../lib/utils';
import FocusTimer from '../../components/FocusTimer';
import TodoList from './TodoList';
import { flashWhenReady } from '../../lib/flash';
import { SubjectBars, DailyFocus, DataTable } from './FocusCharts';
import { dailyMinutes, formatMinutes, minutesBySubject, noSubjectLabel, weekMinutes } from './focusStats';
import { useSettings } from '../../store/settings';
import { usageWords } from '../../lib/usage';
import { t } from '../../i18n';

type Range = '7' | '30' | 'all';
const RANGES: { key: Range; label: string }[] = [
  { key: '7', label: t('7 jours') },
  { key: '30', label: t('30 jours') },
  { key: 'all', label: t('Tout') },
];

/** Focus time: a quiet summary (this week, 7 days per subject), the charts behind « Voir le détail ». */
function WorkTime() {
  const sessions = useFocusLog(s => s.sessions);
  const location = useLocation();
  const [open, setOpen] = useState(location.hash === '#travail');
  const [range, setRange] = useState<Range>('30');
  const [asTable, setAsTable] = useState(false);

  const usage = useSettings(s => s.usage);
  const subject = usageWords(usage).subject; // « matière », « sujet »
  const none = noSubjectLabel(usage);
  const week = weekMinutes(sessions);
  const last7 = useMemo(() => minutesBySubject(sessions, toKey(addDays(new Date(), -6)), none), [sessions, none]);
  const bySubject = useMemo(() => minutesBySubject(sessions, range === 'all' ? null : toKey(addDays(new Date(), 1 - Number(range))), none), [sessions, range, none]);
  const daily = useMemo(() => dailyMinutes(sessions, 30), [sessions]);
  const month = daily.reduce((a, d) => a + d.minutes, 0);

  return (
    <section id="travail" aria-labelledby="travail-titre" className="scroll-mt-4">
      {/* Below lg the sidebar (and its timer) is hidden: phones and tablets start a session here. */}
      <div className="mb-3 lg:hidden">
        <FocusTimer />
      </div>
      <div className="card p-5">
        <div className="flex items-baseline gap-2">
          <h2 id="travail-titre" className="mr-auto text-[13px] font-medium text-stone-600">
            {t('Temps de travail')}
          </h2>
          <p className="text-[12px] text-stone-500">
            <span className="tabular text-[15px] font-semibold text-ink">{formatMinutes(week)}</span> {t('cette semaine')}
          </p>
        </div>

        {sessions.length === 0 ? (
          <p className="mt-3 text-[13px] text-stone-500">{t('Lance une session focus pour suivre ton temps par {subject}.', { subject })}</p>
        ) : (
          <div className="mt-3">
            <p className="eyebrow mb-1">{t('7 derniers jours')}</p>
            <SubjectBars rows={last7} />
          </div>
        )}

        {sessions.length > 0 && (
          <div className="mt-4 border-t border-stone-100 pt-3">
            <button onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls="travail-detail" className="flex items-center gap-1 rounded px-0.5 text-[12px] text-stone-500 hover:text-ink pointer-coarse:min-h-9">
              <ChevronRight size={13} className={cx('transition-transform', open && 'rotate-90')} />
              {t('Voir le détail')}
            </button>
            {open && (
              <div id="travail-detail" className="mt-4 space-y-6">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="mr-auto text-[13px] font-medium text-stone-600">{t('Par {subject}', { subject })}</h3>
                    <div className="flex rounded-lg bg-stone-100 p-0.5" role="group" aria-label={t('Période')}>
                      {RANGES.map(r => (
                        <button
                          key={r.key}
                          onClick={() => setRange(r.key)}
                          aria-pressed={range === r.key}
                          className={cx('h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors pointer-coarse:h-9', range === r.key ? 'bg-surface text-ink shadow-card' : 'text-stone-500 hover:text-ink')}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3">
                    {asTable ? <DataTable head={[subject.charAt(0).toUpperCase() + subject.slice(1), t('Temps'), t('Sessions')]} rows={bySubject.map(r => [r.subject, formatMinutes(r.minutes), r.sessions])} /> : <SubjectBars rows={bySubject} />}
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <h3 className="mr-auto text-[13px] font-medium text-stone-600">{t('Par jour')}</h3>
                    <p className="tabular text-[12px] text-stone-500">{t('{time} sur 30 jours', { time: formatMinutes(month) })}</p>
                  </div>
                  <div className="mt-3">
                    {asTable ? (
                      <DataTable head={[t('Jour'), t('Temps')]} rows={[...daily].reverse().map(d => [fmt(fromKey(d.day), 'EEE d MMM'), d.minutes ? formatMinutes(d.minutes) : '–'])} />
                    ) : (
                      <DailyFocus data={daily} />
                    )}
                  </div>
                </div>
                <button onClick={() => setAsTable(v => !v)} className="btn-ghost h-8 px-2 text-[12px]" aria-pressed={asTable}>
                  {asTable ? <ChartNoAxesColumn size={14} /> : <Table2 size={14} />}
                  {asTable ? t('Voir en graphique') : t('Voir en tableau')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default function TasksPage() {
  const location = useLocation();

  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash]);

  // /taches?ajout=1 (« Ajouter une tâche » on the home page): the field to type it, ready.
  const adding = new URLSearchParams(location.search).has('ajout');
  useEffect(() => {
    if (adding) setTimeout(() => document.querySelector<HTMLElement>('[data-quickadd]')?.focus(), 50);
  }, [adding]);

  // /taches?tache=… (from « Ma semaine »): that task lights up once on screen.
  const wanted = new URLSearchParams(location.search).get('tache');
  useEffect(() => {
    if (!wanted) return;
    flashWhenReady(() => document.querySelector(`[data-todo="${CSS.escape(wanted)}"]`)?.closest('li'));
  }, [wanted]);

  return (
    <div className="h-full overflow-y-auto px-4 pb-12 md:px-8">
      <div className="mx-auto max-w-[1180px]">
        <h1 className="pb-7 pt-2 text-[24px] font-semibold tracking-[-0.02em]">{t('Tâches')}</h1>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section id="taches" aria-label={t('Liste des tâches')} className="card flex min-h-[240px] flex-col p-5">
            <TodoList grouped />
          </section>
          <WorkTime />
        </div>
      </div>
    </div>
  );
}
