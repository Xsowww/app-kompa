import { Bell, BellOff } from 'lucide-react';
import { useSettings } from '../store/settings';
import { useGroups } from '../store/groups';
import { toast } from '../store/ui';
import { cx } from '../lib/utils';
import { t } from '../i18n';

/** The bell of a group or shared calendar: its news as notifications, or not (server/push.mjs reads the same list). */
export default function GroupMuteButton({ group, className }: { group: { id: string; name: string }; className?: string }) {
  const muted = useSettings(s => s.mutedGroups.includes(group.id));
  const allOff = useSettings(s => !s.groupNews);
  const quiet = muted || allOff;
  const toggle = () => {
    const s = useSettings.getState();
    if (allOff) {
      // Everything was off (Profil › Notifications): on for this one only.
      s.set({ groupNews: true, mutedGroups: useGroups.getState().groups.map(g => g.id).filter(id => id !== group.id) });
    } else s.set({ mutedGroups: muted ? s.mutedGroups.filter(id => id !== group.id) : [...s.mutedGroups, group.id] });
    toast(quiet ? t('Notifications activées pour « {name} »', { name: group.name }) : t('Notifications coupées pour « {name} »', { name: group.name }), 'success');
  };
  const label = quiet ? t('Activer les notifications de « {name} »', { name: group.name }) : t('Couper les notifications de « {name} »', { name: group.name });
  return (
    <button className={cx('icon-btn', className)} onClick={toggle} title={label} aria-label={label} aria-pressed={!quiet}>
      {quiet ? <BellOff size={16} /> : <Bell size={16} />}
    </button>
  );
}
