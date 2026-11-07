import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, Check, Share, ShieldAlert, SquarePlus } from 'lucide-react';
import { deviceState, enableDevice, pushActive, sendTestPush, type DeviceState } from '../lib/push';
import { devicePushChanged } from '../lib/reminderScheduler';
import { showSystemNotification } from '../lib/notify';
import { deviceInfo, deviceWord, freshReminder, offerKey, offerMomentOk, reminderDevice, unblockSteps } from '../lib/phoneReminders';
import { useCalendar } from '../store/calendar';
import { useTodos } from '../store/todos';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';
import { Modal } from './Overlays';
import { cx } from '../lib/utils';
import { t } from '../i18n';

/** Seconds before the test reminder rings: time to lock the phone and see it come. */
const TEST_DELAY = 5;

/** Numbered steps, each with its picture (the same as the home page's « En 3 gestes »). */
function Steps({ steps }: { steps: { icon?: typeof Bell; text: string }[] }) {
  return (
    <ol className="mt-3 space-y-2.5">
      {steps.map((s, i) => (
        <li key={s.text} className="flex items-start gap-3">
          <span className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-ink" aria-hidden>
            {s.icon ? <s.icon size={19} strokeWidth={1.9} /> : <span className="text-[15px] font-bold">{i + 1}</span>}
            {s.icon && <span className="tabular absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-tile-blue text-[12px] font-bold text-white">{i + 1}</span>}
          </span>
          <span className="min-w-0 pt-2 text-[14px] leading-snug">{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * « Recevoir les rappels sur ce téléphone »: what this device needs, said for it, with a button for each step that can
 * be one. An iPhone in Safari: the three gestures (notifications only work from the home screen icon there). Kompaly
 * from its icon, Android, a computer: « Activer », which asks the device. Refused once: where to allow them again.
 * Then « M'envoyer un rappel d'essai »: a real notification a few seconds later.
 * `heading`: the level of its title (a dialog's own title is above it).
 */
export default function PhoneReminders({ heading = 'h3', onState }: { heading?: 'h2' | 'h3'; onState?: (s: DeviceState) => void }) {
  const [info] = useState(deviceInfo);
  const device = reminderDevice(info);
  const where = deviceWord(device, info.userAgent, info.touchPoints);
  const [state, setState] = useState<DeviceState>(deviceState);
  const [push, setPush] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // The test reminder: seconds left before it rings (0: rung), or null (not sent).
  const [left, setLeft] = useState<number | null>(null);
  const [server, setServer] = useState(false);
  useEffect(() => onState?.(state), [state, onState]);
  useEffect(() => {
    let alive = true;
    void pushActive().then(p => alive && setPush(p));
    return () => {
      alive = false;
    };
  }, [state]);
  // Back from the phone's settings (allowed there): seen at once.
  useEffect(() => {
    const again = () => document.visibilityState === 'visible' && setState(deviceState());
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, []);
  useEffect(() => {
    if (!left) return;
    const id = setTimeout(() => setLeft(l => (l ? l - 1 : l)), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const activate = async () => {
    setBusy(true);
    try {
      const next = await enableDevice();
      setState(next);
      if (next === 'on') {
        await devicePushChanged();
        toast(t('Rappels activés sur {device}', { device: where }), 'success');
      }
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    clearTimeout(timer.current);
    // Through the server when it can (it rings even with Kompaly closed), else from here.
    const viaServer = !!push && (await sendTestPush(TEST_DELAY)) === 'ok';
    if (!viaServer)
      timer.current = setTimeout(
        () => void showSystemNotification(t('Rappel d’essai'), t('C’est bon : tes rappels Kompaly arriveront comme ça.'), 'kompaly-essai', '/profil?onglet=notifications'),
        TEST_DELAY * 1000,
      );
    setServer(viaServer);
    setLeft(TEST_DELAY);
    setBusy(false);
  };

  const H = heading;
  const iosBrowser = device === 'ios-browser' && state !== 'on';
  const on = state === 'on';
  // An iPhone in a browser tab: refused or not, the home screen comes first.
  const blocked = state === 'denied' && !iosBrowser;
  const status = on ? t('Activés') : blocked ? t('Bloqués') : t('Pas encore activés');

  return (
    <div className="px-5 py-4">
      <div className="flex items-start gap-3">
        <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', on ? 'bg-emerald-50 text-emerald-700' : blocked ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-600')} aria-hidden>
          {blocked ? <ShieldAlert size={19} /> : <BellRing size={19} />}
        </span>
        <div className="min-w-0 flex-1">
          <H className="text-[15px] font-semibold leading-snug">{t('Recevoir les rappels sur {device}', { device: where })}</H>
          <p className={cx('mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-medium', on ? 'text-emerald-700' : blocked ? 'text-red-700' : 'text-stone-500')}>
            <span className={cx('h-2 w-2 rounded-full', on ? 'bg-emerald-500' : blocked ? 'bg-red-500' : 'bg-stone-400')} aria-hidden />
            {status}
          </p>
        </div>
      </div>

      {iosBrowser ? (
        <>
          <p className="mt-3 text-[14px] leading-relaxed text-stone-600">
            {t('Sur iPhone et iPad, les rappels arrivent seulement si Kompaly est sur ton écran d’accueil. 3 gestes, une seule fois :')}
          </p>
          <Steps
            steps={[
              { icon: Share, text: t('Touche Partager (le carré avec une flèche vers le haut), en bas de Safari.') },
              { icon: SquarePlus, text: t('Choisis «\u00a0Sur l’écran d’accueil\u00a0», puis «\u00a0Ajouter\u00a0» : l’icône de Kompaly apparaît.') },
              { icon: Bell, text: t('Ouvre Kompaly depuis cette icône, reviens ici et touche «\u00a0Activer les rappels\u00a0».') },
            ]}
          />
        </>
      ) : state === 'denied' ? (
        <>
          <p className="mt-3 text-[14px] leading-relaxed text-stone-600">{t('Les notifications ont été refusées sur {device}. Pour les autoriser :', { device: where })}</p>
          <Steps steps={unblockSteps(device, info.userAgent).map(text => ({ text }))} />
          <button type="button" className="btn-secondary mt-4 w-full sm:w-auto" onClick={() => setState(deviceState())}>
            {t('C’est fait, vérifier')}
          </button>
        </>
      ) : state === 'unsupported' || state === 'install' ? (
        <p className="mt-3 text-[14px] leading-relaxed text-stone-600">
          {device === 'android'
            ? t('Ce navigateur ne peut pas afficher de notifications. Ouvre Kompaly dans Chrome pour recevoir tes rappels.')
            : t('Ce navigateur ne peut pas afficher de notifications : tes rappels s’affichent seulement dans Kompaly, quand il est ouvert.')}
        </p>
      ) : on ? (
        <>
          <p className="mt-3 flex items-start gap-2 text-[14px] leading-relaxed text-stone-600">
            <Check size={17} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
            <span>{push ? t('Tes rappels arriveront ici, même quand Kompaly est fermé.') : t('Tes rappels arriveront ici quand Kompaly est ouvert.')}</span>
          </p>
          <button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled={busy || !!left} onClick={() => void test()}>
            <Bell size={15} aria-hidden /> {left === null ? t('M’envoyer un rappel d’essai') : t('Renvoyer un rappel d’essai')}
          </button>
          <p className="mt-2 text-[13px] leading-snug text-stone-600 empty:mt-0" aria-live="polite">
            {left
              ? server
                ? t('Il arrive dans {n} s. Tu peux verrouiller ton téléphone ou fermer Kompaly.', { n: left })
                : t('Il arrive dans {n} s. Garde Kompaly ouvert.', { n: left })
              : left === 0
                ? t('Envoyé. Tu ne l’as pas vu ? Vérifie que le mode Ne pas déranger (ou Concentration) est coupé.')
                : ''}
          </p>
        </>
      ) : (
        <>
          <p className="mt-3 text-[14px] leading-relaxed text-stone-600">
            {device === 'computer'
              ? t('Un seul geste : clique sur «\u00a0Activer les rappels\u00a0», puis sur «\u00a0Autoriser\u00a0» quand ton navigateur te le demande.')
              : t('Un seul geste : touche «\u00a0Activer les rappels\u00a0», puis «\u00a0Autoriser\u00a0» quand ton téléphone te le demande.')}
          </p>
          <button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled={busy} onClick={() => void activate()}>
            <BellRing size={15} aria-hidden /> {t('Activer les rappels')}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Right after the first reminder made here (an event or a task with one): the same block, once per account on this
 * device, unless this device already rings. It waits for the form that made it to close.
 */
export function FirstReminderOffer() {
  const userId = useAuth(s => s.user?.id);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DeviceState>(deviceState);
  useEffect(() => {
    if (!userId) return;
    const key = offerKey(userId);
    const offered = () => {
      try {
        return localStorage.getItem(key) === '1';
      } catch {
        return true; // storage blocked: never again and again
      }
    };
    if (offered() || deviceState() === 'on') return;
    let wait: ReturnType<typeof setTimeout> | undefined;
    // What was already there when the app opened: only a reminder saved during this visit brings the offer.
    const withReminder = () => [...useCalendar.getState().events, ...useTodos.getState().todos].filter(x => x.reminders?.length);
    const before = new Set(withReminder().map(x => x.id));
    let lastInput = 0;
    const onInput = () => (lastInput = Date.now());
    window.addEventListener('keydown', onInput, true);
    window.addEventListener('input', onInput, true);
    // A tap too: someone already busy elsewhere (another view, another form) is not interrupted.
    window.addEventListener('pointerdown', onInput, true);
    // `first`: the demo's sentence, made just before the app opened: after its toast (« Ton premier événement est prêt »).
    const check = (first?: boolean) => {
      if (wait || offered() || deviceState() === 'on') return;
      const items = first ? withReminder() : withReminder().filter(x => !before.has(x.id));
      if (!freshReminder(items, Date.now())) return;
      // After the form's own closing, never over another window, a menu or Kompaly's panel, nor while typing: a
      // moment, then again for a few seconds (the demo's: until its windows are gone). Not calm by then: not now
      // (later it would come out of the blue), another time, with the next reminder.
      const show = (tries: number, delay = 900) => {
        wait = setTimeout(() => {
          const el = document.activeElement as HTMLElement | null;
          const calm = offerMomentOk(
            {
              newReminder: true,
              typing: !!el?.closest('input, textarea, select, [contenteditable="true"]'),
              overlay: !!document.querySelector('[aria-modal="true"], [role="menu"], [role="alertdialog"], [role="dialog"]:not([aria-hidden="true"])'),
              lastInput,
            },
            Date.now(),
          );
          if (!calm) {
            if (tries > 0) return show(tries - 1);
            wait = undefined;
            return;
          }
          try {
            localStorage.setItem(key, '1');
          } catch {
            /* shown once anyway for this visit */
          }
          setOpen(true);
        }, delay);
      };
      show(first ? 40 : 6, first ? 6500 : 900);
    };
    check(true);
    const offCal = useCalendar.subscribe(() => check());
    const offTodos = useTodos.subscribe(() => check());
    return () => {
      offCal();
      offTodos();
      clearTimeout(wait);
      window.removeEventListener('keydown', onInput, true);
      window.removeEventListener('input', onInput, true);
      window.removeEventListener('pointerdown', onInput, true);
    };
  }, [userId]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} width={460}>
      <h2 className="text-[20px] font-extrabold leading-tight tracking-[-0.02em]">{t('Ton rappel est enregistré')}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-stone-600">{t('Encore une petite étape, une seule fois, pour qu’il sonne au bon moment.')}</p>
      <div className="-mx-5 mt-2">
        <PhoneReminders heading="h3" onState={setState} />
      </div>
      <div className="modal-foot">
        <button type="button" className={state === 'on' ? 'btn-primary' : 'btn-secondary'} onClick={() => setOpen(false)}>
          {state === 'on' ? t('Terminé') : t('Plus tard')}
        </button>
      </div>
      <p className="mt-3 text-[12.5px] text-stone-500">{t('Tu retrouves ce réglage dans Profil › Notifications.')}</p>
    </Modal>
  );
}
