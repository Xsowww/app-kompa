import { Link } from 'react-router-dom';
import { Award, CalendarArrowDown, CalendarRange, FolderClosed, Mic, Timer, Users } from 'lucide-react';
import { useSettings } from '../store/settings';
import { useFocus } from '../store/focus';
import { useBadges } from '../lib/badges';
import { startFocus } from '../copilot/actions';
import { toast } from '../store/ui';
import { groupWords, usageWords } from '../lib/usage';
import { shortcutKeys, type ShortcutKey as Key } from '../lib/homeShortcuts';
import { t } from '../i18n';

const chip =
  'hit-sm inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-stone-200 bg-surface px-3.5 text-[13px] font-semibold text-ink shadow-card transition-colors hover:bg-stone-50 pointer-coarse:h-10';

/**
 * Home page: one row of shortcuts to what the questionnaire says the person came for (Enregistrer un cours, Session
 * focus, Agenda partagé, Importer mon emploi du temps…), and their badges.
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
                label: t('Session focus'),
                node: <Timer {...icon} className="text-[#2f9e6b]" />,
                run: () => {
                  const res = startFocus('');
                  toast(t('Session focus de {n} min lancée.', { n: res.minutes }), 'success');
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
    // Phones: one line that scrolls sideways (never the page); wider screens: wraps.
    <nav aria-label={t('Raccourcis')} className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:overflow-visible md:px-0">
      <ul className="flex gap-2 md:flex-wrap">
        {items.map(i => (
          <li key={i.key} className="shrink-0">
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
        <li className="shrink-0">
          <Link to="/profil#badges" className={chip} aria-label={t('Mes badges : {n} sur {total}', { n: earned, total: badges.length })}>
            <Award {...icon} className="text-[#d48a17]" />
            {t('Mes badges')}
            <span className="tabular font-medium text-stone-500">
              {earned}/{badges.length}
            </span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
