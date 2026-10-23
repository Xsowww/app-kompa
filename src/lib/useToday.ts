import { useEffect, useState } from 'react';
import { todayKey } from './dates';

/**
 * Today's date, kept current: a page left open overnight (or a tab coming back the next day)
 * re-renders, so « Aujourd'hui », overdue tasks and countdowns don't stay on yesterday.
 */
export function useToday() {
  const [today, setToday] = useState(todayKey);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => setToday(todayKey());
    const atMidnight = () => {
      const next = new Date();
      next.setHours(24, 0, 5, 0);
      timer = setTimeout(() => {
        check();
        atMidnight();
      }, next.getTime() - Date.now());
    };
    atMidnight();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  return today;
}

/** The time now, kept current to the minute (the clock and the day line of the Dashboard move on their own). */
export function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    const back = () => document.visibilityState === 'visible' && setNow(new Date());
    document.addEventListener('visibilitychange', back);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', back);
    };
  }, []);
  return now;
}
