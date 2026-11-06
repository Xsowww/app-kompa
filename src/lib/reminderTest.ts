// « Envoyer un rappel test » next to the reminders of an event or a task: the notification its first reminder will
// be, word for word (lib/reminders reminderBody), sent now by the same road as the real one — the server's push when
// this device has it (it rings even with Kompaly closed), else this browser's notification, else a card in the app.
// Says which way it went, and what to do when nothing can ring on this device.

import { reminderBody, reminderMoment, reminderUrl, type ReminderSource } from './reminders';
import { canNotify, showSystemNotification } from './notify';
import { pushActive, sendTestPush } from './push';
import { useUi } from '../store/ui';
import { t } from '../i18n';

export type TestWay = 'push' | 'system' | 'app';

/** The test notification of an item: the words of its first reminder to ring (the one furthest before it). */
export function testMessage(src: Pick<ReminderSource, 'kind' | 'id' | 'title' | 'date' | 'time' | 'end'>, reminders: number[]): { title: string; body: string; url: string } {
  const first = Math.max(...reminders);
  const fireAt = reminderMoment(src.date!, src.time, first);
  const title = src.title.trim().slice(0, 200) || (src.kind === 'task' ? t('Tâche') : t('Événement'));
  return { title: t('Essai : {title}', { title }), body: reminderBody({ ...src, title } as ReminderSource, fireAt), url: reminderUrl(src) };
}

export async function sendReminderTest(src: Pick<ReminderSource, 'kind' | 'id' | 'title' | 'date' | 'time' | 'end'>, reminders: number[]): Promise<TestWay> {
  const msg = testMessage(src, reminders);
  if ((await pushActive().catch(() => false)) && (await sendTestPush(0, msg)) === 'ok') return 'push';
  if (canNotify() && (await showSystemNotification(msg.title, msg.body, `essai-${src.id}`, msg.url))) return 'system';
  useUi.getState().showAlert({ key: `essai-${src.kind}-${src.id}-${Date.now()}`, title: msg.title, body: msg.body, url: msg.url, at: Date.now() });
  return 'app';
}
