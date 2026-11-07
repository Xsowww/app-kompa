import { Link } from 'react-router-dom';
import { Award, CalendarArrowDown, CalendarRange, FolderClosed, Mic, Timer, Users } from 'lucide-react';
import { useSettings } from '../store/settings';
import { useFocus } from '../store/focus';
import { useBadges } from '../lib/badges';
import { startFocus } from '../copilot/actions';
import { toast } from '../store/ui';
import { groupWords, usageWords } from '../lib/usage';
import { shortcutKeys, type ShortcutKey as Key } from '../lib/homeShortcuts';
import { cx } from '../lib/utils';
import { t } from '../i18n';

const chip =
  // Phones: two columns of small tiles (a long name on two lines); larger screens: pills on one line.
  'hit-sm flex min-h-11 w-full items-center gap-2 rounded-2xl border border-stone-200 bg-surface px-3 py-1.5 text-left text-[12.5px] font-semibold leading-tight text-ink shadow-card transition-colors hover:bg-stone-50 [&_svg]:shrink-0 sm:inline-flex sm:min-h-9 sm:w-auto sm:whitespace-nowrap sm:rounded-full sm:px-3.5 sm:py-0 sm:text-[13px] sm:leading-normal pointer-coarse:sm:min-h-10';

/**
 * Home page: one row of shortcuts to what the questionnaire says the person came for (Enregistrer un cours, Concentration,
 * Agenda partagé, Importer mon emploi du temps…), and their rewards (« récompenses »).
 */
export default function HomeShortcuts() {
  const usage = useSettings(s => s.usage);
  const needs = useSettings(s => s.needs);
  const focusing = useFocus(s => !!s.phase);
  const badges = useBadges();
  const earned = badges.filter(b => b.earned).length;
  const words = usageWords(usage);
  const icon = { size: 15, strokeWidth: 2, 'aria-hidden': true } as const;

  type Item = { key: Key; label: string; node: React.ReactNode; to?: string; run?: () => void };
  const items = shortcutKeys(usage, needs).flatMap((k): Item[] => {
    switch (k) {
      case 'import':
        return [{ key: k, to: '/calendrier?importer=1', label: t('Importer mon {timetable}', { timetable: words.timetable }), node: <CalendarArrowDown {...icon} className="text-[#d9483b]" /> }];
      case 'record':
        return [{ key: k, to: '/enregistrer', label: usage === 'perso' ? t('Enregistrer et résumer') : t('Enregistrer {a}', { a: words.recording.a }), node: <Mic {...icon} className="text-[#e5484d]" /> }];
      case 'focus':
        return focusing
          ? []
          : [
              {
                key: k,
                label: t('Concentration'),
                node: <Timer {...icon} className="text-[#2f9e6b]" />,
                run: () => {
                  const res = startFocus('');
                  toast(t('Concentration lancée : {n} min.', { n: res.minutes }), 'success');
                },
              },
            ];
      case 'agenda':
        return [{ key: k, to: '/agendas', label: t('Agenda partagé'), node: <CalendarRange {...icon} className="text-[#7a5ad6]" /> }];
      case 'group':
        return [{ key: k, to: '/groupes', label: groupWords(usage).Groups, node: <Users {...icon} className="text-[#1f8a8a]" /> }];
      case 'files':
        return [{ key: k, to: '/drive', label: t('Mes fichiers'), node: <FolderClosed {...icon} className="text-[#3b6fd8]" /> }];
    }
  });

  return (
    // None cut at the edge. Phones: three shortcuts and the badges, in two columns; larger screens: one row of pills.
    <nav aria-label={t('Raccourcis')} className="mb-5">
      {/* A bigger text on a narrow phone: one shortcut a row (two would cut « Concentration »). */}
      <ul className="grid grid-cols-2 gap-2 big-text:max-[389px]:grid-cols-1 sm:flex sm:flex-wrap">
        {items.map((i, n) => (
          <li key={i.key} className={cx('min-w-0 max-w-full', n === 3 && 'max-sm:hidden')}>
            {i.run ? (
              <button type="button" className={chip} onClick={i.run}>
                {i.node}
                {i.label}
              </button>
            ) : (
              <Link to={i.to!} className={chip}>
                {i.node}
                {i.label}
              </Link>
            )}
          </li>
        ))}
        <li className="min-w-0 max-w-full">
          <Link to="/profil#badges" className={chip} aria-label={t('Mes récompenses : {n} sur {total}', { n: earned, total: badges.length })}>
            <Award {...icon} className="text-[#d48a17]" />
            {/* Phones: the count under the name (beside it, it went past the tile at 320 px). */}
            <span className="min-w-0">
              <span className="sm:hidden">{t('Récompenses')}</span>
              <span className="max-sm:hidden">{t('Mes récompenses')}</span>{' '}
              <span className="tabular font-medium text-stone-500 max-sm:block">
                {earned}/{badges.length}
              </span>
            </span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
