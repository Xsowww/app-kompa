import { useRef, useState } from 'react';
import { Bell, BellOff, Plus, SlidersHorizontal, X } from 'lucide-react';
import { DateField, Popover, SelectField, TimeField } from './Pickers';
import { anchorOf, MAX_MINUTES, minutesBefore, reminderLabel, reminderMoment } from '../lib/reminders';
import { deviceState, enableDevice } from '../lib/push';
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
    if (minutes < 0) return { error: time ? t('C’est après le début : choisis un moment avant.') : t('C’est après 9h le jour même : choisis un moment avant.') };
  }
  if (minutes > MAX_MINUTES) return { error: t('4 semaines avant au plus.') };
  if (taken.includes(minutes)) return { error: t('Ce rappel est déjà dans la liste.') };
  if (date && reminderMoment(date, time, minutes).getTime() < Date.now()) return { minutes, error: t('Ce moment est déjà passé.') };
  return { minutes };
}

/** « Rappels » : one or several moments before an event or a task (lib/reminders). */
export default function ReminderPicker({ value, onChange, timed, date, time, disabled }: Props) {
  const [state, setState] = useState(deviceState);
  const [custom, setCustom] = useState<Custom | null>(null);
  const [openedAt] = useState(Date.now); // « now » for the menu (a moment already past isn't offered)
  const check = custom ? customMinutes(custom, date, time, value) : null;
  const customRef = useRef<HTMLDivElement>(null);
  const openCustom = () => {
    // Starts one hour before (or at 8:00 the same day for an item without a time); when that moment is
    // already past (an item in less than an hour), « Durée avant » rather than an error before anything is typed.
    const start = date ? new Date(anchorOf(date, time).getTime() - 60 * 60_000) : null;
    const past = !!start && start.getTime() <= Date.now();
    setCustom({ mode: date && !past ? 'moment' : 'duree', day: start ? dayKey(start) : '', at: start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '', amount: past ? '15' : '1', unit: past ? 'min' : 'h' });
    // The menu that opened it goes away: the keyboard focus goes into the new panel.
    requestAnimationFrame(() => customRef.current?.querySelector<HTMLElement>('button, input, select')?.focus());
  };
  const addCustom = () => {
    if (check?.minutes === undefined || check.error) return;
    onChange([...value, check.minutes]);
    setCustom(null);
  };
  // Ready-made: the day before at 9:00; when that is already past (an event today or tomorrow morning), one hour
  // before (or 8:00 the same day without a time). Then « Personnaliser… ».
  const usable = (minutes: number) => !!date && !value.includes(minutes) && reminderMoment(date, time, minutes).getTime() > openedAt;
  const eve = date ? minutesBefore(date, time, date, '09:00') + 1440 : -1;
  // The item's own moment is past (an all-day event today after 9:00, a time gone by): no reminder can ring any more.
  const over = !!date && anchorOf(date, time).getTime() <= openedAt;
  const left = [
    usable(eve) ? { minutes: eve, label: t('La veille à 9h') } : usable(60) ? { minutes: 60, label: timed ? t('1 h avant') : t('Le jour même à 8h') } : null,
  ].filter((o): o is { minutes: number; label: string } => !!o);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const sorted = [...value].sort((a, b) => a - b);

  const turnOn = async () => {
    const next = await enableDevice();
    setState(next);
    if (next === 'on') {
      void devicePushChanged();
      toast(t('Notifications activées sur cet appareil'), 'success');
    } else if (next === 'denied') toast(t('Notifications bloquées : autorise-les dans les réglages de ton navigateur.'), 'error');
  };

  return (
    <div className="mt-3">
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
                className="hit-sm flex h-6 w-6 items-center justify-center rounded text-brand-600 transition-colors hover:bg-brand-100"
                aria-label={t('Retirer le rappel « {reminder} »', { reminder: reminderLabel(m, timed, date, time) })}
              >
                <X size={13} />
              </button>
            </span>
          ))}
          {!value.length && !over && <span className="mr-1 text-[13px] text-stone-500">{t('Aucun')}</span>}
          {over && !custom && <span className="text-[12.5px] text-stone-500">{value.length ? t('Ce moment est passé.') : t('Ce moment est déjà passé : plus de rappel possible.')}</span>}
          {value.length < 10 && !custom && !over && (
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={!!menu}
              onClick={e => setMenu(menu ? null : e.currentTarget)}
              className="flex h-8 items-center gap-1 rounded-full border border-dashed border-stone-300 px-3 text-[13px] font-semibold text-stone-600 transition-colors hover:border-stone-400 hover:text-ink pointer-coarse:h-9"
            >
              <Plus size={14} aria-hidden /> {t('Ajouter un rappel')}
            </button>
          )}
          {menu && (
            <Popover anchor={menu} onClose={() => setMenu(null)} label={t('Ajouter un rappel')} className="p-1">
              <div role="menu" aria-label={t('Ajouter un rappel')} className="min-w-52">
                {left.map(o => (
                  <button
                    key={o.minutes}
                    type="button"
                    role="menuitem"
                    autoFocus
                    onClick={() => {
                      onChange([...value, o.minutes]);
                      setMenu(null);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-stone-100 focus-visible:bg-stone-100"
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
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-stone-100 focus-visible:bg-stone-100"
                >
                  <SlidersHorizontal size={15} className="text-stone-400" aria-hidden /> {t('Personnaliser…')}
                </button>
              </div>
            </Popover>
          )}
        </div>
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
                  className={cx('h-7 flex-1 rounded-md px-2 transition-colors', custom.mode === mode ? 'bg-surface text-ink shadow-card' : 'text-stone-600 hover:text-ink')}
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
            {check?.error ?? (check?.minutes !== undefined && date ? t('Rappel : {when}', { when: reminderLabel(check.minutes, timed, date, time).replace(/^./, c => c.toLowerCase()) }) : '')}
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
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-stone-50 px-2.5 py-2 text-[12px] text-stone-600">
          {state === 'off' ? (
            <>
              <span className="flex items-start gap-2">
                <BellOff size={13} className="mt-px shrink-0 text-stone-400" aria-hidden />
                {t('Sur cet appareil, tu ne seras prévenu que si Kompaly est ouvert.')}
              </span>
              <button type="button" onClick={() => void turnOn()} className="hit-sm font-medium text-brand-600 underline-offset-2 hover:underline">
                {t('Activer les notifications')}
              </button>
            </>
          ) : state === 'install' ? (
            <span>{t('Sur iPhone, ajoute Kompaly à l’écran d’accueil (Partager › Sur l’écran d’accueil) pour recevoir les notifications.')}</span>
          ) : state === 'denied' ? (
            <span>{t('Notifications bloquées : autorise-les dans les réglages de ton navigateur.')}</span>
          ) : (
            <span>{t('Ce navigateur n’affiche pas de notifications : le rappel s’affichera seulement dans Kompaly.')}</span>
          )}
        </p>
      )}
    </div>
  );
}
