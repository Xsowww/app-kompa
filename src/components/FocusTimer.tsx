import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Square, Timer, X } from 'lucide-react';
import { useFocus, focusLeft, mmss } from '../store/focus';
import { useSettings } from '../store/settings';
import { useFocusLog } from '../store/focusLog';
import { useCalendar } from '../store/calendar';
import { startBadgeWatcher } from '../lib/badges';
import { subjectSuggestions } from '../pages/tasks/focusStats';
import { cx } from '../lib/utils';

/** Asks what the session is about before starting (optional, free text + quick chips). */
function SubjectPicker({ onStart, onCancel }: { onStart: (subject: string) => void; onCancel: () => void }) {
  const { focusMinutes, usage } = useSettings();
  const sessions = useFocusLog(s => s.sessions);
  const events = useCalendar(s => s.events);
  const [subject, setSubject] = useState('');
  const suggestions = subjectSuggestions(sessions, events, 5);
  const ref = useRef<HTMLDivElement>(null);

  // Clicking elsewhere closes the picker.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onCancel]);

  return (
    <div ref={ref} className="enter mb-2 rounded-lg border border-stone-200 bg-surface p-2.5 shadow-card">
      <div className="flex items-center">
        <label htmlFor="focus-subject" className="text-[11px] font-medium text-stone-500">
          Sur quoi tu travailles&nbsp;?
        </label>
        <button onClick={onCancel} className="hit ml-auto -mr-1 flex h-5 w-5 items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-ink" title="Annuler" aria-label="Annuler">
          <X size={12} />
        </button>
      </div>
      <input
        id="focus-subject"
        autoFocus
        value={subject}
        onChange={e => setSubject(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onStart(subject);
          if (e.key === 'Escape') onCancel();
        }}
        // « Matière » is a school word: a subject for the other uses of the account.
        placeholder={usage === 'travail' || usage === 'perso' ? 'Sujet (facultatif)' : 'Matière (facultatif)'}
        maxLength={40}
        className="field mt-1.5 h-8 w-full px-2.5 text-[12px]"
      />
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => onStart(s)}
              className="max-w-full truncate rounded-md border border-stone-200 px-1.5 py-0.5 text-[11px] pointer-coarse:min-h-9 pointer-coarse:px-2.5 text-stone-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
              title={`Démarrer sur « ${s} »`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <button onClick={() => onStart(subject)} className="btn-primary mt-2.5 h-8 w-full text-[12px]">
        <Play size={12} /> Démarrer · {focusMinutes} min
      </button>
    </div>
  );
}

/** Compact Pomodoro timer shown in the sidebar. */
/** The button that replaces the one just used (the panel changes): the keyboard focus goes to it, not to the page. */
const focusLater = (selector: string) =>
  setTimeout(() => [...document.querySelectorAll<HTMLElement>(selector)].find(el => el.offsetParent !== null)?.focus(), 0);

export default function FocusTimer() {
  const focus = useFocus();
  const { focusMinutes, breakMinutes } = useSettings();
  const [, setNow] = useState(0);
  const [picking, setPicking] = useState(false);

  // The timer lives in the app shell for the whole session: a good place to watch for new badges.
  useEffect(() => startBadgeWatcher(), []);

  useEffect(() => {
    if (!focus.phase) return;
    const t = setInterval(() => {
      useFocus.getState().tick();
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, [focus.phase]);

  if (!focus.phase) {
    if (picking)
      return (
        <SubjectPicker
          onCancel={() => {
            setPicking(false);
            focusLater('[data-focus-start]');
          }}
          onStart={subject => {
            setPicking(false);
            focus.start(subject.trim());
            focusLater('[data-focus-pause]');
          }}
        />
      );
    return (
      <button
        data-focus-start
        onClick={() => setPicking(true)}
        className="mb-2 flex h-9 w-full items-center gap-2.5 rounded-lg border border-dashed border-stone-300 px-2.5 text-[13px] text-stone-600 transition-colors hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
        title={`${focusMinutes} min de travail, ${breakMinutes} min de pause`}
      >
        <Timer size={15} />
        Session focus
        <span className="tabular ml-auto text-[11px] text-stone-500">{focusMinutes} min</span>
      </button>
    );
  }

  const left = focusLeft(focus);
  // Planned length kept with the session: changing the setting meanwhile doesn't break the bar.
  const total = (focus.minutes || (focus.phase === 'focus' ? focusMinutes : breakMinutes)) * 60_000;
  const done = Math.min(100, Math.max(0, 100 - (left / total) * 100));
  const paused = focus.pausedLeft !== null;
  return (
    <div className={cx('mb-2 rounded-lg border p-2.5', focus.phase === 'focus' ? 'border-brand-200 bg-brand-50' : 'border-emerald-200 bg-emerald-50')}>
      <div className="flex items-center gap-2">
        <span className={cx('min-w-0 truncate text-[11px] font-medium', focus.phase === 'focus' ? 'text-brand-700' : 'text-emerald-700')}>
          {/* A paused break is « suspended »: « Temps de pause · en pause » said the same word twice. */}
          {focus.phase === 'focus' ? (paused ? 'Concentration · en pause' : 'Concentration') : paused ? 'Pause suspendue' : 'Temps de pause'}
        </span>
        <span role="timer" aria-label={`Temps restant : ${mmss(left)}`} className="tabular ml-auto font-mono text-[15px] font-medium">{mmss(left)}</span>
      </div>
      {focus.phase === 'focus' && focus.label && <p className="mt-0.5 truncate text-[12px] font-medium text-ink">{focus.label}</p>}
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface" role="progressbar" aria-label="Progression de la session" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done)}>
        <div className={cx('h-full rounded-full', focus.phase === 'focus' ? 'bg-brand-500' : 'bg-emerald-500')} style={{ width: `${done}%` }} />
      </div>
      <div className="mt-2 flex gap-1">
        <button data-focus-pause onClick={paused ? focus.resume : focus.pause} className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-surface pointer-coarse:h-9 text-[12px] font-medium text-stone-700 shadow-card hover:text-ink">
          {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? 'Reprendre' : focus.phase === 'break' ? 'Suspendre' : 'Pause'}
        </button>
        <button
          onClick={() => {
            focus.stop();
            focusLater('[data-focus-start]');
          }}
          className="flex h-7 w-8 items-center justify-center rounded-md bg-surface pointer-coarse:h-9 pointer-coarse:w-10 text-stone-500 shadow-card hover:text-red-600" title="Arrêter" aria-label="Arrêter">
          <Square size={11} />
        </button>
      </div>
    </div>
  );
}
