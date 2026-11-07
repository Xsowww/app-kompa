import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useSettings } from '../../store/settings';
import { groupWords } from '../../lib/usage';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';

/**
 * Groupes and Agendas partagés side by side were mixed up: one line saying what this one is for, and the other one a
 * tap away. `here`: the page it is shown on.
 */
export default function SpaceHint({ here, className }: { here: 'groupes' | 'agendas'; className?: string }) {
  const usage = useSettings(s => s.usage);
  const w = groupWords(usage);
  const link = 'inline-flex items-center gap-1 whitespace-nowrap font-semibold text-ink underline-offset-2 hover:underline hit';
  return here === 'agendas' ? (
    <p className={cx('text-[13px] leading-relaxed text-stone-500', className)}>
      {t('Un agenda partagé = un calendrier commun (famille, coloc, couple). Pour les notes, fichiers et {meet} d’un projet :', { meet: w.meet.many })}{' '}
      <Link to="/groupes" className={link}>
        {w.Groups} <ArrowRight size={13} aria-hidden />
      </Link>
    </p>
  ) : (
    <p className={cx('text-[13px] leading-relaxed text-stone-500', className)}>
      {t('{a} = les notes, fichiers et {meet} d’un projet, à plusieurs. Pour un simple calendrier commun (famille, coloc) :', {
        a: w.a.charAt(0).toUpperCase() + w.a.slice(1),
        meet: w.meet.many,
      })}{' '}
      <Link to="/agendas" className={link}>
        {t('Agendas partagés')} <ArrowRight size={13} aria-hidden />
      </Link>
    </p>
  );
}
