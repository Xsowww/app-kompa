// The number on the installed app's icon (home screen, dock, taskbar): what is late, and the news of the shared
// spaces. Browsers without it (Firefox, Safari in a tab…): nothing.

import { useCalendar, type CalendarEvent } from '../store/calendar';
import { useTodos } from '../store/todos';
import { totalUnread, useGroupActivity } from '../store/groupActivity';
import { totalAgendaNews, useAgendaNews } from '../store/agendaNews';
import { isLateEvent } from './late';
import { firstOfSpans } from './repeat';
import { todayKey } from './dates';

type LateTodo = { done: boolean; due?: string; deletedAt?: string };

/** Late events (a trip over several days counts once) and tasks, plus the unread news. */
export function badgeCount(events: CalendarEvent[], todos: LateTodo[], today: string, news: number) {
  const lateEvents = firstOfSpans(events.filter(e => isLateEvent(e))).length;
  const lateTodos = todos.filter(x => !x.done && !x.deletedAt && !!x.due && x.due < today).length;
  return lateEvents + lateTodos + news;
}

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/** Keeps the icon's number up to date for the signed-in account; returns what stops it (and clears the number). */
export function watchAppBadge(): () => void {
  const nav = navigator as BadgeNavigator;
  if (!nav.setAppBadge) return () => {};
  let shown = -1;
  const update = () => {
    const news = Object.values(useGroupActivity.getState().unread).reduce((n, c) => n + totalUnread(c), 0) + totalAgendaNews(useAgendaNews.getState().news);
    const n = badgeCount(useCalendar.getState().events, useTodos.getState().todos, todayKey(), news);
    if (n === shown) return;
    shown = n;
    void (n > 0 ? nav.setAppBadge!(n) : nav.clearAppBadge?.())?.catch(() => {});
  };
  update();
  const stops = [useCalendar.subscribe(update), useTodos.subscribe(update), useGroupActivity.subscribe(update), useAgendaNews.subscribe(update)];
  // Each minute: past midnight, yesterday's tasks are late; an event becomes late once over.
  const timer = setInterval(update, 60_000);
  return () => {
    stops.forEach(f => f());
    clearInterval(timer);
    void nav.clearAppBadge?.().catch(() => {});
  };
}
