import { addDays } from 'date-fns';
import { CalendarClock, CalendarPlus } from 'lucide-react';
import type { MenuItem } from '../../components/Overlays';
import { useTodos, type Todo } from '../../store/todos';
import { toast } from '../../store/ui';
import { toKey, todayKey } from '../../lib/dates';
import { t, tn } from '../../i18n';

export const tomorrowKey = () => toKey(addDays(new Date(), 1));

/** « Reporter »: late tasks to today or tomorrow; « Annuler » gives them their days back. */
export function postponeTodos(list: Todo[], day: string) {
  if (!list.length) return;
  const { update } = useTodos.getState();
  const before = list.map(x => [x.id, x.due] as const);
  list.forEach(x => update(x.id, { due: day }));
  postponedToast(list, day, () => before.forEach(([id, due]) => useTodos.getState().update(id, { due })));
}

/** « « Poster Instagram » reportée à demain », with « Annuler ». */
export function postponedToast(list: Pick<Todo, 'title'>[], day: string, undo: () => void) {
  const today = day === todayKey();
  const text =
    list.length === 1
      ? today
        ? t('« {title} » reportée à aujourd’hui', { title: list[0].title })
        : t('« {title} » reportée à demain', { title: list[0].title })
      : today
        ? tn(list.length, '{n} tâche reportée à aujourd’hui', '{n} tâches reportées à aujourd’hui')
        : tn(list.length, '{n} tâche reportée à demain', '{n} tâches reportées à demain');
  toast(text, 'success', { label: t('Annuler||l’action'), run: undo });
}

/** The two days a late task can be put off to, in a menu (a row's « Reporter », « Tout reporter »). */
export const postponeItems = (list: Todo[], all?: boolean): MenuItem[] => [
  { label: all ? t('Tout reporter à aujourd’hui') : t('Reporter à aujourd’hui'), icon: <CalendarClock />, onClick: () => postponeTodos(list, todayKey()) },
  { label: all ? t('Tout reporter à demain') : t('Reporter à demain'), icon: <CalendarPlus />, onClick: () => postponeTodos(list, tomorrowKey()) },
];

