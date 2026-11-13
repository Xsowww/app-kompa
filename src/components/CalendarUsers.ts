import { createLucideIcon } from 'lucide-react';

/**
 * « Agendas partagés »: a calendar with a small group in its corner (as « Groupes »' people), so it isn't taken for the
 * Calendrier's own (CalendarDays) at a glance. Drawn like Lucide's icons (24 grid, 2 px stroke, round ends).
 */
const CalendarUsers = createLucideIcon('calendar-users', [
  ['path', { d: 'M8 2v4', key: 'p1' }],
  ['path', { d: 'M16 2v4', key: 'p2' }],
  ['path', { d: 'M21 9.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5', key: 'frame' }],
  ['path', { d: 'M3 10h7', key: 'head' }],
  ['circle', { cx: '14.5', cy: '15', r: '2', key: 'face' }],
  ['path', { d: 'M11 22a3.5 3.5 0 0 1 7 0', key: 'body' }],
  ['path', { d: 'M19.5 13.2a2 2 0 0 1 0 3.6', key: 'face2' }],
  ['path', { d: 'M20.5 22a3.5 3.5 0 0 0-1.6-2.9', key: 'body2' }],
]);

export default CalendarUsers;
