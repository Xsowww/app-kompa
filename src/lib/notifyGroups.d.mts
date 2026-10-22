export interface Notice {
  key: string;
  title: string;
  body: string;
  url: string;
}
export function familyOf(key: string): string;
export function isGroupNews(key: string): boolean;
export function groupByMoment<T extends Notice & { fireAt: Date }>(list: T[], windowMs?: number): T[][];
export function mergeNotifications<T extends Notice>(list: T[]): T & { keys: string[] };
