// The number on the installed app's icon (home screen, dock, taskbar): what is late, and the news of the shared
// spaces. Browsers without it (Firefox, Safari in a tab…): nothing.

import { useTodos } from '../store/todos';
import { totalUnread, useGroupActivity } from '../store/groupActivity';
import { totalAgendaNews, useAgendaNews } from '../store/agendaNews';
import { todayKey } from './dates';

type LateTodo = { done: boolean; due?: string; deletedAt?: string };

/** Late tasks (events are not ticked, so never late), plus the unread news. */
export function badgeCount(todos: LateTodo[], today: string, news: number) {
  const lateTodos = todos.filter(x => !x.done && !x.deletedAt && !!x.due && x.due < today).length;
  return lateTodos + news;
}

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/** Keeps the icon's number up to date for the signed-in account; returns what stops it (and clears the number). */
export function watchAppBadge(): () => void {
  const nav = navigator as BadgeNavigator;
  if (!nav.setAppBadge) return () => {};
  let shown = -1;
  const update = () => {
    const news = Object.values(useGroupActivity.getState().unread).reduce((n, c) => n + totalUnread(c), 0) + totalAgendaNews(useAgendaNews.getState().news);
    const n = badgeCount(useTodos.getState().todos, todayKey(), news);
    if (n === shown) return;
    shown = n;
    void (n > 0 ? nav.setAppBadge!(n) : nav.clearAppBadge?.())?.catch(() => {});
  };
  update();
  const stops = [useTodos.subscribe(update), useGroupActivity.subscribe(update), useAgendaNews.subscribe(update)];
  // Each minute: past midnight, yesterday's tasks are late.
  const timer = setInterval(update, 60_000);
  return () => {
    stops.forEach(f => f());
    clearInterval(timer);
    void nav.clearAppBadge?.().catch(() => {});
  };
}
