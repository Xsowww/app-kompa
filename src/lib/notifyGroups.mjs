// Several notifications due together for one person become one (tested in tests/notifyGroups.test.ts).
// Used by the app (lib/reminderScheduler) and by the server (server/push.mjs): no translation here, the server
// doesn't know the person's language. « Réunion +2 » and the others named under it; « Léo a ajouté un
// événement ×5 » and the five underneath.

/** Same kind of notification: one's own reminders together, a shared calendar's news apart, the admins' apart. */
export const familyOf = key => {
  const prefix = String(key).split(':')[0];
  return prefix === 'event' || prefix === 'task' || prefix === 'rappel-agenda' ? 'rappel' : prefix;
};

/** The news of groups and shared calendars (Profil › Notifications can turn them off). */
export const isGroupNews = key => ['agenda', 'agenda-membre', 'periode', 'fichiers', 'note', 'revision', 'membre'].includes(String(key).split(':')[0]);

/** Due within `windowMs` of the first of their group (list sorted by `fireAt`), and of the same kind. */
export function groupByMoment(list, windowMs = 60_000) {
  const groups = [];
  for (const n of list) {
    const g = groups.find(x => familyOf(x[0].key) === familyOf(n.key) && n.fireAt.getTime() - x[0].fireAt.getTime() <= windowMs);
    if (g) g.push(n);
    else groups.push([n]);
  }
  return groups;
}

const lines = n => String(n.body || '').split('\n');
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** One notification for the group (`keys`: all those it stands for, each never shown again). */
export function mergeNotifications(list) {
  const [first, ...rest] = list;
  if (!rest.length) return { ...first, keys: [first.key] };
  const sameTitle = rest.every(n => n.title === first.title);
  const firstLines = list.map(n => lines(n)[0]).filter(Boolean);
  const sameWhen = firstLines.length === list.length && firstLines.every(l => l === firstLines[0]);
  const where = [...new Set(list.map(n => lines(n)[1]).filter(Boolean))];
  const what = sameTitle ? firstLines.join(', ') : `${sameWhen ? `${firstLines[0]} · ` : ''}${rest.map(n => n.title).join(', ')}`;
  return {
    ...first,
    title: cut(sameTitle ? `${first.title} ×${list.length}` : `${first.title} +${rest.length}`, 200),
    body: [cut(what, 160), where.length === 1 ? where[0] : ''].filter(Boolean).join('\n'),
    keys: list.map(n => n.key),
  };
}
