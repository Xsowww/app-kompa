import { Bell, BellOff } from 'lucide-react';
import { useSettings } from '../store/settings';
import { useGroups } from '../store/groups';
import { toast } from '../store/ui';
import { cx } from '../lib/utils';
import { t } from '../i18n';

type MutedGroup = { id: string; name: string; kind: string };

/** A group's or shared calendar's news as notifications, or not (server/push.mjs reads the same list): the bell's
 *  state, its name and what it does (also a line of the « … » menu of a group on a phone). */
// eslint-disable-next-line react-refresh/only-export-components -- the bell and its logic go together
export function useGroupMute(group: MutedGroup) {
  const agenda = group.kind === 'agenda';
  const muted = useSettings(s => s.mutedGroups.includes(group.id));
  const allOff = useSettings(s => !(agenda ? (s.calendarNews ?? s.groupNews) : s.groupNews));
  const quiet = muted || allOff;
  const toggle = () => {
    const s = useSettings.getState();
    if (allOff) {
      // All of this kind were off (Réglages › Notifications): on for this one only.
      const others = useGroups.getState().groups.filter(g => g.kind === group.kind && g.id !== group.id).map(g => g.id);
      s.set({ ...(agenda ? { calendarNews: true } : { groupNews: true }), mutedGroups: [...new Set([...s.mutedGroups.filter(id => id !== group.id), ...others])] });
    } else s.set({ mutedGroups: muted ? s.mutedGroups.filter(id => id !== group.id) : [...s.mutedGroups, group.id] });
    toast(quiet ? t('Notifications activées pour « {name} »', { name: group.name }) : t('Notifications coupées pour « {name} »', { name: group.name }), 'success');
  };
  const label = quiet ? t('Activer les notifications de « {name} »', { name: group.name }) : t('Couper les notifications de « {name} »', { name: group.name });
  return { quiet, toggle, label };
}

/** The bell of a group or shared calendar. */
export default function GroupMuteButton({ group, className }: { group: MutedGroup; className?: string }) {
  const { quiet, toggle, label } = useGroupMute(group);
  return (
    <button className={cx('icon-btn', className)} onClick={toggle} title={label} aria-label={label} aria-pressed={!quiet}>
      {quiet ? <BellOff size={16} /> : <Bell size={16} />}
    </button>
  );
}
