import { useRef, useState } from 'react';
import { Bell, BellOff, BellRing, Plus, SlidersHorizontal, X } from 'lucide-react';
import { DateField, Popover, SelectField, TimeField } from './Pickers';
import { anchorOf, MAX_MINUTES, minutesBefore, reminderLabel as baseLabel, reminderMoment, TASK_MORNING } from '../lib/reminders';
import { deviceState, enableDevice } from '../lib/push';
import { deviceInfo, deviceWord, reminderDevice } from '../lib/phoneReminders';
import { devicePushChanged } from '../lib/reminderScheduler';
import { toast } from '../store/ui';
import { cx } from '../lib/utils';
import { t } from '../i18n';

interface Props {
  value: number[];
  onChange: (v: number[]) => void;
  /** The item has a time (else the reminders count from 9:00 that day). */
  timed: boolean;
  /** The item's day and time (YYYY-MM-DD, HH:mm): custom reminders at a chosen date and time. */
  date?: string;
  time?: string;
  /** No date yet: reminders need one. */
  disabled?: string;
  /** What is reminded (its title, an end time): « Envoyer un rappel test » shows its very notification. */
  item?: { kind: 'event' | 'task'; id?: string; title: string; end?: string };
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const UNITS = { min: 1, h: 60, j: 1440 } as const;
type Unit = keyof typeof UNITS;

interface Custom {
  mode: 'moment' | 'duree';
  day: string;
  at: string;
  amount: string;
  unit: Unit;
}

/** The custom reminder being typed: its minutes before the item, or why it can't be added. */
function customMinutes(c: Custom, date: string | undefined, time: string | undefined, taken: number[]): { minutes?: number; error?: string } {
  let minutes: number;
  if (c.mode === 'duree') {
    const n = Number(c.amount.replace(',', '.'));
    if (!c.amount.trim() || !Number.isFinite(n) || n < 0) return { error: t('Indique une durée.') };
    minutes = Math.round(n * UNITS[c.unit]);
  } else {
    if (!date || !c.day || !/^\d{2}:\d{2}$/.test(c.at)) return { error: t('Indique un jour et une heure.') };
    minutes = minutesBefore(date, time, c.day, c.at);
    if (minutes < 0) return { error: time ? t('C’est après le début\u00a0: choisis un moment avant.') : t('C’est après 09:00 le jour même\u00a0: choisis un moment avant.') };
  }
  if (minutes > MAX_MINUTES) return { error: t('4 semaines avant au plus.') };
  if (taken.includes(minutes)) return { error: t('Ce rappel est déjà dans la liste.') };
  if (date && reminderMoment(date, time, minutes).getTime() < Date.now()) return { minutes, error: t('Ce moment est déjà passé.') };
  return { minutes };
}

/** « Rappels » : one or several moments before an event or a task (lib/reminders). */
export default function ReminderPicker({ value, onChange, timed, date, time, disabled, item }: Props) {
  // A task's reminder that very morning: as Réglages › Notifications says it (9:00, or the 8:00 summary that replaces it).
  const reminderLabel = (m: number, isTimed: boolean, d?: string, h?: string) => (item?.kind === 'task' && !isTimed && m === 0 ? TASK_MORNING : baseLabel(m, isTimed, d, h));
  const [state, setState] = useState(deviceState);
  // An iPhone in a browser tab: only Kompaly on the home screen can ring (whatever the browser says).
  const [info] = useState(deviceInfo);
  const device = reminderDevice(info);
  const where = deviceWord(device, info.userAgent, info.touchPoints);
  const [custom, setCustom] = useState<Custom | null>(null);
  const [openedAt] = useState(Date.now); // « now » for the menu (a moment already past isn't offered)
  const check = custom ? customMinutes(custom, date, time, value) : null;
  const customRef = useRef<HTMLDivElement>(null);
  const openCustom = () => {
    // Starts one hour before (or at 8:00 the same day for an item without a time), else another moment not in
    // the list yet and still to come: never an error before anything is typed (« déjà dans la liste », « passé »).
    const free = date ? [60, 120, 30, 1440, 15, 5].find(k => !value.includes(k) && reminderMoment(date, time, k).getTime() > Date.now()) : undefined;
    const start = date ? reminderMoment(date, time, free ?? 60) : null;
    const unit: Unit = free === undefined || free % 60 ? 'min' : free % 1440 ? 'h' : 'j';
    setCustom({ mode: date && free !== undefined ? 'moment' : 'duree', day: start ? dayKey(start) : '', at: start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '', amount: String((free ?? 15) / UNITS[unit]), unit });
    // The menu that opened it goes away: the keyboard focus goes into the new panel.
    requestAnimationFrame(() => customRef.current?.querySelector<HTMLElement>('button, input, select')?.focus());
  };
  const addCustom = () => {
    if (check?.minutes === undefined || check.error) return;
    onChange([...value, check.minutes]);
    setCustom(null);
  };
  // Ready-made: the day before at 9:00 and one hour before (8:00 the same day for an item without a time), those still
  // to come and not chosen yet. Then « Personnaliser… ».
  const usable = (minutes: number) => !!date && !value.includes(minutes) && reminderMoment(date, time, minutes).getTime() > openedAt;
  const eve = date ? minutesBefore(date, time, date, '09:00') + 1440 : -1;
  // The item's own moment is past (an all-day event today after 9:00, a time gone by): no reminder can ring any more.
  const over = !!date && anchorOf(date, time).getTime() <= openedAt;
  // Today without an hour: the day isn't over, only its 9:00 is — an hour lets a reminder ring later today.
  const needsTime = over && !time && date === dayKey(new Date(openedAt));
  const left = [usable(eve) && { minutes: eve, label: t('La veille à 09:00') }, usable(60) && { minutes: 60, label: timed ? t('1 h avant') : t('Le jour même à 08:00') }].filter(
    (o): o is { minutes: number; label: string } => !!o,
  );
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const sorted = [...value].sort((a, b) => a - b);

  const [testing, setTesting] = useState(false);
  const sendTest = async () => {
    if (!item || !date || !value.length) return;
    setTesting(true);
    try {
      const { sendReminderTest } = await import('../lib/reminderTest');
      const way = await sendReminderTest({ kind: item.kind, id: item.id ?? 'nouveau', title: item.title, date, time, end: item.end }, value);
      toast(
        way === 'push'
          ? t('Rappel test envoyé : il arrive sur {device} comme le vrai, même Kompaly fermé.', { device: where })
          : way === 'system'
            ? t('Rappel test affiché. Pour le recevoir Kompaly fermé, active les rappels dans Réglages › Notifications.')
            : t('Rappel test affiché dans Kompaly. Sans notifications activées sur {device}, le vrai ne s’affichera que si Kompaly est ouvert.', { device: where }),
        way === 'app' ? 'info' : 'success',
      );
    } finally {
      setTesting(false);
    }
  };

  const turnOn = async () => {
    const next = await enableDevice();
    setState(next);
    if (next === 'on') {
      void devicePushChanged();
      toast(t('Notifications activées sur cet appareil'), 'success');
    } else if (next === 'denied') toast(t('Notifications refusées : les étapes pour les autoriser sont dans Réglages › Notifications.'), 'error');
  };

  return (
    <div className="mt-4">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-stone-600">
        <Bell size={13} aria-hidden /> {t('Rappels')}
      </p>
      {disabled ? (
        <p className="text-[12.5px] text-stone-500">{disabled}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {sorted.map(m => (
            <span key={m} className="flex h-8 items-center gap-1 rounded-full bg-brand-50 pl-3 pr-1 text-[13px] font-semibold text-brand-700 pointer-coarse:h-9">
              {reminderLabel(m, timed, date, time)}
              <button
                type="button"
                onClick={() => onChange(value.filter(x => x !== m))}
                className="hit flex h-6 w-6 items-center justify-center rounded-full text-brand-600 transition-colors hover:bg-brand-100"
                aria-label={t('Retirer le rappel « {reminder} »', { reminder: reminderLabel(m, timed, date, time) })}
              >
                <X size={13} />
              </button>
            </span>
          ))}
          {!value.length && !over && <span className="mr-1 text-[13px] text-stone-500">{t('Aucun')}</span>}
          {over && !custom && (
            <span className="text-[12.5px] text-stone-500">
              {needsTime ? t('Pour un rappel aujourd’hui, indique une heure.') : value.length ? t('Ce moment est passé.') : t('Ce moment est déjà passé\u00a0: plus de rappel possible.')}
            </span>
          )}
          {value.length < 10 && !custom && !over && (
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={!!menu}
              onClick={e => setMenu(menu ? null : e.currentTarget)}
              className="hit flex h-8 items-center gap-1 rounded-full border border-dashed border-stone-300 px-3 text-[13px] font-semibold text-stone-600 transition-colors hover:border-stone-400 hover:text-ink pointer-coarse:h-9"
            >
              <Plus size={14} aria-hidden /> {t('Ajouter un rappel')}
            </button>
          )}
          {menu && (
            <Popover anchor={menu} onClose={() => setMenu(null)} label={t('Ajouter un rappel')} className="p-1">
              <div role="menu" aria-label={t('Ajouter un rappel')} className="min-w-52">
                {left.map((o, i) => (
                  <button
                    key={o.minutes}
                    type="button"
                    role="menuitem"
                    autoFocus={i === 0}
                    onClick={() => {
                      onChange([...value, o.minutes]);
                      setMenu(null);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-stone-100 focus-visible:bg-stone-100 pointer-coarse:py-3"
                  >
                    <Bell size={15} className="text-stone-400" aria-hidden /> {o.label}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  autoFocus={!left.length}
                  onClick={() => {
                    setMenu(null);
                    openCustom();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-stone-100 focus-visible:bg-stone-100 pointer-coarse:py-3"
                >
                  <SlidersHorizontal size={15} className="text-stone-400" aria-hidden /> {t('Personnaliser…')}
                </button>
              </div>
            </Popover>
          )}
        </div>
      )}
      {!disabled && item && value.length > 0 && !over && !custom && (
        <button type="button" onClick={() => void sendTest()} disabled={testing} className="hit mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand-600 underline-offset-2 hover:underline disabled:opacity-60">
          <BellRing size={13} aria-hidden /> {t('Envoyer un rappel test')}
        </button>
      )}
      {!disabled && custom && (
        <div
          ref={customRef}
          className="mt-2 rounded-2xl bg-stone-50 p-3"
          role="group"
          aria-label={t('Rappel personnalisé')}
          // Enter in its fields adds the reminder (and doesn't send the event's form).
          onKeyDown={e => {
            if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
            e.preventDefault();
            addCustom();
          }}
        >
          {date && (
            <div className="mb-2.5 flex gap-1 rounded-lg bg-stone-100 p-0.5 text-[12.5px] font-medium">
              {(
                [
                  ['moment', t('Jour et heure')],
                  ['duree', t('Durée avant')],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={custom.mode === mode}
                  onClick={() => setCustom({ ...custom, mode })}
                  className={cx('hit h-7 flex-1 rounded-md px-2 transition-colors', custom.mode === mode ? 'bg-surface text-ink shadow-card' : 'text-stone-600 hover:text-ink')}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {custom.mode === 'moment' ? (
            <div className="flex flex-wrap gap-2">
              <DateField value={custom.day} max={date} onChange={day => setCustom({ ...custom, day })} label={t('Jour du rappel')} className="h-9 min-w-0 flex-1" />
              <TimeField value={custom.at} onChange={at => setCustom({ ...custom, at })} label={t('Heure du rappel')} className="h-9 w-[128px]" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                // Text, not number: « 3,5 » with a comma is refused by some browsers' number fields.
                type="text"
                inputMode="decimal"
                value={custom.amount}
                onChange={e => setCustom({ ...custom, amount: e.target.value })}
                aria-label={t('Durée')}
                className="field h-9 w-20"
              />
              <SelectField<Unit>
                value={custom.unit}
                onChange={unit => setCustom({ ...custom, unit })}
                label={t('Unité')}
                className="h-9 w-32"
                options={[
                  { value: 'min', label: t('minutes') },
                  { value: 'h', label: t('heures') },
                  { value: 'j', label: t('jours') },
                ]}
              />
              <span className="text-[13px] text-stone-600">{t('avant')}</span>
            </div>
          )}
          <p className={cx('mt-2 text-[12px]', check?.error ? 'text-red-600' : 'text-stone-600')} aria-live="polite">
            {check?.error ?? (check?.minutes !== undefined && date ? t('Rappel\u00a0: {when}', { when: reminderLabel(check.minutes, timed, date, time).replace(/^./, c => c.toLowerCase()) }) : '')}
          </p>
          <div className="mt-2.5 flex justify-end gap-2">
            <button type="button" className="btn-secondary h-8 px-3 text-[13px]" onClick={() => setCustom(null)}>
              {t('Annuler')}
            </button>
            <button type="button" className="btn-primary h-8 px-3 text-[13px]" disabled={check?.minutes === undefined || !!check.error} onClick={addCustom}>
              {t('Ajouter')}
            </button>
          </div>
        </div>
      )}
      {!disabled && value.length > 0 && state !== 'on' && (
        // Said for this device (the full steps: Réglages › Notifications, and the window after the first reminder).
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-stone-50 px-2.5 py-2 text-[12px] text-stone-600">
          {device === 'ios-browser' ? (
            <span>{t('Pour qu’il sonne sur ton iPhone : ajoute Kompaly à l’écran d’accueil (Partager › Sur l’écran d’accueil), puis ouvre-le depuis son icône.')}</span>
          ) : state === 'off' ? (
            <>
              <span className="flex items-start gap-2">
                <BellOff size={13} className="mt-px shrink-0 text-stone-400" aria-hidden />
                {t('Sur {device}, tu ne seras prévenu que si Kompaly est ouvert.', { device: where })}
              </span>
              <button type="button" onClick={() => void turnOn()} className="hit font-medium text-brand-600 underline-offset-2 hover:underline">
                {t('Activer les notifications')}
              </button>
            </>
          ) : state === 'denied' ? (
            <span>{t('Notifications bloquées sur {device} : les étapes pour les autoriser sont dans Réglages › Notifications.', { device: where })}</span>
          ) : (
            <span>{t('Ce navigateur n’affiche pas de notifications\u00a0: le rappel s’affichera seulement dans Kompaly.')}</span>
          )}
        </p>
      )}
    </div>
  );
}
