// « Plus tard » and « Fait » on a reminder: the card in the app (components/Overlays › ReminderAlerts) and the buttons
// of a system notification (public/sw.js → lib/reminderScheduler). What « Plus tard » puts off is kept in the settings
// (reminderSnoozes, on every device), so the scheduler plans it again with the rest — the server's push included.

import { reminderItems, SNOOZE_MINUTES } from './reminders';
import { useTodos } from '../store/todos';
import { useSettings } from '../store/settings';
import { toast } from '../store/ui';
import { t } from '../i18n';

// « Plus tard »: lib/reminders (the card shows it before this file is loaded).
export { SNOOZE_MINUTES };

/**
 * « Plus tard » or « Fait » on a reminder (its keys): « Plus tard » on the tasks and events it is about, « Fait » on
 * its tasks only (events aren't ticked). The same tap can arrive
 * twice (two tabs, the service worker's message and the address): « Fait » ticks only what isn't, a second
 * « Plus tard » replaces the first.
 */
export function reminderAction(action: 'later' | 'done', keys: string[]) {
  const items = reminderItems(keys);
  if (!items.length) return;
  if (action === 'later') {
    const at = new Date(Date.now() + SNOOZE_MINUTES * 60_000).toISOString();
    const names = new Set(items.map(x => `${x.kind}:${x.id}`));
    const { reminderSnoozes, set } = useSettings.getState();
    // One per item; those of more than a day ago go.
    const kept = (reminderSnoozes ?? []).filter(z => !names.has(z.item) && Date.parse(z.at) > Date.now() - 86_400_000);
    set({ reminderSnoozes: [...kept, ...[...names].map(item => ({ item, at }))] });
    toast(t('Rappel dans {n} min', { n: SNOOZE_MINUTES }), 'success');
    return;
  }
  const todos = useTodos.getState();
  const tasks = items.flatMap(x => (x.kind === 'task' ? todos.todos.filter(y => y.id === x.id && !y.done) : []));
  // (a repeating task ticked here makes its next one, as in Tâches: store/todos › toggle)
  tasks.forEach(x => todos.toggle(x.id));
  const titles = tasks.map(x => x.title);
  if (!titles.length) return;
  toast(titles.length === 1 ? t('« {title} » est fait', { title: titles[0] }) : t('{n} éléments faits', { n: titles.length }), 'success', {
    label: t('Annuler||l’action'),
    run: () => {
      tasks.forEach(x => useTodos.getState().todos.find(y => y.id === x.id)?.done && useTodos.getState().toggle(x.id));
    },
  });
}
