import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Check, Copy, Maximize2, Mic, Minimize2, RotateCcw, Square, X } from 'lucide-react';
import Character, { CopilotAvatar, type CopilotMood } from './Character';
import { useCopilot, type CopilotLink, type CopilotOffer } from '../store/copilot';
import { useAuth } from '../store/auth';
import { localReply, type BotReply } from './localBrain';
import { acceptOffer, runOffer } from './offers';
import * as claudeBrain from './claudeBrain';
import { normalize, cx } from '../lib/utils';
import { useSettings } from '../store/settings';
import Markdown from './Markdown';
import { frenchSpacing, stripMarkdown } from './markdown';
import { aiPausedUntil, aiPauseReason } from './aiPause';
import { useDictation } from './voice';

// The AI part (and the Anthropic types it uses) is loaded on first use.
// Already loaded with the app (proactive.ts uses it): the promise keeps the call sites unchanged.
const brain = async () => claudeBrain;

// Studies revise; work and personal life block time to prepare (localBrain understands both).
const suggestions = (studying: boolean) => ['Analyse ma semaine', studying ? 'Planifie mes révisions' : 'Bloque du temps pour préparer'];
const YES = /^(oui|ouais|ok|okay|vas[- ]y|go|carrement|d'accord|dac|yes|avec plaisir|je veux bien|volontiers)\b/;

function Extras({ links, offers, onGo, onOffer, disabled }: { links?: CopilotLink[]; offers?: CopilotOffer[]; onGo: (to: string) => void; onOffer: (o: CopilotOffer) => void; disabled?: boolean }) {
  if (!links?.length && !offers?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {offers?.map((o, i) => (
        <button
          key={o.label}
          disabled={disabled}
          onClick={() => onOffer(o)}
          className={cx(
            'h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40 pointer-coarse:h-9',
            i === 0 ? 'bg-ink text-paper hover:bg-stone-800' : 'border border-stone-200 bg-surface text-stone-700 hover:bg-stone-50',
          )}
        >
          {frenchSpacing(o.label)}
        </button>
      ))}
      {links?.map(l => (
        <button
          key={l.to + l.label}
          onClick={() => onGo(l.to)}
          className="h-7 max-w-full truncate rounded-md border border-stone-200 bg-surface px-2.5 text-[12px] font-medium text-stone-700 transition-colors hover:bg-stone-50 pointer-coarse:h-9"
        >
          {frenchSpacing(l.label)} →
        </button>
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      title={done ? 'Copié' : 'Copier'}
      aria-label="Copier la réponse"
      onClick={() => {
        void navigator.clipboard?.writeText(stripMarkdown(text)).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="hit-sm absolute -bottom-2.5 right-1 flex h-6 w-6 items-center justify-center rounded-md border border-stone-200 bg-surface text-stone-500 opacity-0 shadow-card touch-show transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export default function Copilot() {
  const navigate = useNavigate();
  const user = useAuth(s => s.user);
  const { messages, pose, bubble, thinking, aiEnabled, offsetY } = useCopilot();
  const visible = useSettings(s => s.copilotVisible);
  const [wide, setWide] = useState(false);
  const [providerInfo, setProviderInfo] = useState('');
  const [providerLabel, setProviderLabel] = useState('');
  const [pausedUntil, setPausedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const { push, setPose, clearBubble, setThinking, setOffsetY, clearHistory, greet } = useCopilot.getState();
  const studying = useSettings(s => s.usage ?? 'etudes') === 'etudes';
  const hello = () =>
    greet(`Salut ${user?.name ?? ''} ! Moi c’est Kompaly. Je peux retrouver tes fichiers, ${studying ? 'organiser tes révisions' : 'organiser ton agenda'}, créer des notes… ou juste discuter. Dis-moi.`);

  const [look, setLook] = useState({ x: -1, y: 0 });
  const [blink, setBlink] = useState(false);
  const [talking, setTalking] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const [input, setInput] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const charRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ startY: number; moved: boolean } | null>(null);

  // Is the AI brain plugged in on the server?
  useEffect(() => {
    void brain()
      .then(m => m.checkAiStatus())
      .then(st => {
        useCopilot.getState().setAiEnabled(st.enabled);
        setProviderInfo(st.enabled ? `IA : ${st.label ?? st.provider} · ${st.model}` : 'Mode simple, sans IA');
        setProviderLabel(st.label ?? st.provider ?? '');
      });
  }, []);

  // Simple mode after the AI quota was reached: countdown in the header while the chat is open.
  useEffect(() => {
    if (pose !== 'open') return;
    const tick = () => (setPausedUntil(aiPausedUntil()), setNow(Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pose, thinking]);

  // Eyes follow the mouse; long inactivity sends him to sleep.
  useEffect(() => {
    let frame = 0;
    let sleepTimer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setAsleep(false);
      clearTimeout(sleepTimer);
      sleepTimer = setTimeout(() => setAsleep(true), 4 * 60_000);
    };
    const onMove = (e: MouseEvent) => {
      wake();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = rootRef.current?.getBoundingClientRect();
        if (!r) return;
        const dx = e.clientX - (r.right - 60);
        const dy = e.clientY - (r.top + r.height / 2);
        const len = Math.max(1, Math.hypot(dx, dy));
        setLook({ x: dx / len, y: dy / len });
      });
    };
    wake();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', wake);
      cancelAnimationFrame(frame);
      clearTimeout(sleepTimer);
    };
  }, []);

  // Blinking.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 120);
        loop();
      }, 2400 + Math.random() * 3600);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  // Curious little peeks while hidden.
  useEffect(() => {
    if (pose !== 'hidden' || asleep) return;
    const t = setTimeout(() => {
      if (useCopilot.getState().pose !== 'hidden') return;
      setPose('peek');
      setTimeout(() => {
        const s = useCopilot.getState();
        if (s.pose === 'peek' && !s.bubble) setPose('hidden');
      }, 2200);
    }, 30_000 + Math.random() * 40_000);
    return () => clearTimeout(t);
  }, [pose, asleep, setPose]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, thinking, pose]);

  // The panel is centred on the character; slide it so that it always stays inside the window.
  useLayoutEffect(() => {
    const place = () => {
      const h = panelRef.current?.offsetHeight ?? 0;
      const centre = offsetY * window.innerHeight;
      const margin = 12;
      const bottom = window.innerWidth < 1024 ? 68 : margin; // above the bottom navigation on phones and tablets
      const wanted = Math.min(Math.max(centre, h / 2 + margin), window.innerHeight - h / 2 - bottom);
      setShift(Math.round(wanted - centre));
    };
    place();
    const ro = new ResizeObserver(place);
    if (panelRef.current) ro.observe(panelRef.current);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [offsetY, wide]);

  useEffect(() => {
    if (pose !== 'open') return;
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    // Échap closes Kompaly, unless what was opened over it took the key (the search, a dialog…).
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && setPose('hidden');
    window.addEventListener('keydown', onKey);
    const panel = panelRef.current;
    const character = charRef.current;
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      // Closing: give the focus back to the character rather than losing it.
      const now = document.activeElement;
      if (!now || now === document.body || panel?.contains(now)) character?.focus();
    };
  }, [pose, setPose]);

  const go = (to: string) => {
    navigate(to);
    clearBubble();
    // On a phone the panel covers the page the link opens: out of the way.
    if (matchMedia('(max-width: 639px)').matches) setPose('hidden');
  };

  const speak = (text: string) => {
    setTalking(true);
    setTimeout(() => setTalking(false), Math.min(2200, 300 + text.length * 16));
  };

  const open = () => {
    clearBubble();
    hello();
    setPose('open');
  };

  const onOffer = (o: CopilotOffer) => {
    const reply = acceptOffer(o);
    speak(reply.text);
  };

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || thinking) return;
    setInput('');
    const pending = useCopilot.getState().pendingOffer;
    push('user', clean);

    // "oui" to his last proposal → just do it
    if (pending && YES.test(normalize(clean))) {
      const r = runOffer(pending);
      push('bot', r.text, { links: r.links });
      speak(r.text);
      return;
    }

    setThinking(true);
    let reply: BotReply;
    if (aiEnabled && !(await brain()).aiPausedUntil()) {
      try {
        reply = await (await brain()).claudeReply(clean, user?.name ?? '');
      } catch (e) {
        const b = await brain();
        if (e instanceof b.PartlyDone) {
          // Something was already created: doing the question again in simple mode would make it twice.
          reply = { text: `${b.describeApiError(e.reason)} Ce que j’avais déjà fait est bien enregistré.`, links: e.links };
        } else {
          const local = localReply(clean);
          reply = { text: `${b.describeApiError(e)} ${local.text}`, links: local.links };
        }
      }
    } else {
      await new Promise(r => setTimeout(r, 350 + Math.random() * 350));
      reply = localReply(clean);
    }
    setThinking(false);
    push('bot', reply.text, { links: reply.links, offers: reply.offers });
    speak(reply.text);
  }

  // Talking instead of typing: words appear as they're recognised, sent at the end.
  const dictation = useDictation(setInput, t => void send(t));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (dictation.listening) dictation.stop();
    void send(input);
  };

  // Drag the character along the edge; a click without movement opens/closes him.
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { startY: e.clientY, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    if (Math.abs(e.clientY - drag.current.startY) > 5) drag.current.moved = true;
    if (drag.current.moved) setOffsetY(e.clientY / window.innerHeight);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      if (pose === 'open') setPose('hidden');
      else open();
    }
  };

  if (!visible) return null;

  const mood: CopilotMood = thinking ? 'think' : talking ? 'talk' : bubble ? (bubble.mood ?? 'happy') : asleep && pose === 'hidden' ? 'sleep' : 'idle';
  const isOpen = pose === 'open';
  const lastBot = [...messages].reverse().find(m => m.role === 'bot' && (!m.proactive || m.offers?.length));

  return (
    <div ref={rootRef} className="pointer-events-none fixed right-0 z-50" style={{ top: `${offsetY * 100}%`, transform: 'translateY(-50%)' }}>
      <div className="relative flex items-center justify-end">
        {/* Conversation */}
        <div
          ref={panelRef}
          id="copilot-panel"
          role="dialog"
          aria-label="Kompaly"
          aria-hidden={!isOpen}
          inert={!isOpen}
          style={{ marginTop: shift }}
          className={cx(
            // Phone: the whole width, over the character; larger screens: beside it.
            'absolute right-3 top-1/2 z-10 flex -translate-y-1/2 origin-right flex-col overflow-hidden rounded-2xl border border-stone-200 bg-surface shadow-pop transition-all duration-200 sm:right-[104px]',
            wide ? 'h-[min(720px,86vh)] w-[calc(100vw-24px)] sm:w-[min(600px,calc(100vw-120px))]' : 'max-h-[min(600px,72vh)] w-[calc(100vw-24px)] sm:max-h-[min(600px,80vh)] sm:w-[min(380px,calc(100vw-120px))]',
            isOpen ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
          )}
        >
          <header className="flex items-center gap-2.5 border-b border-stone-100 px-3.5 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100">
              <CopilotAvatar size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="w-fit text-[13px] font-semibold leading-tight" title={providerInfo}>
                Kompaly
              </p>
              <ModeLine ai={aiEnabled} label={providerLabel} until={pausedUntil} now={now} />
            </div>
            <button title={wide ? 'Réduire' : 'Agrandir'} aria-label={wide ? 'Réduire' : 'Agrandir'} onClick={() => setWide(w => !w)} className="icon-btn hidden sm:flex" tabIndex={isOpen ? 0 : -1}>
              {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button title="Nouvelle conversation" aria-label="Nouvelle conversation" onClick={() => { clearHistory(); hello(); void brain().then(m => m.resetClaudeHistory()); }} className="icon-btn pointer-coarse:h-9 pointer-coarse:w-9" tabIndex={isOpen ? 0 : -1}>
              <RotateCcw size={15} />
            </button>
            <button title="Fermer (Échap)" aria-label="Fermer (Échap)" onClick={() => setPose('hidden')} className="icon-btn pointer-coarse:h-9 pointer-coarse:w-9" tabIndex={isOpen ? 0 : -1}>
              <X size={16} />
            </button>
          </header>

          <div ref={listRef} role="log" aria-live="polite" aria-label="Conversation avec Kompaly" className="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3.5">
            {messages.map(m => (
              <div key={m.id} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cx(
                    'group relative min-w-0 max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-[1.55] [overflow-wrap:anywhere]',
                    m.role === 'user' ? 'whitespace-pre-line rounded-br-md bg-inverse text-on-inverse' : 'rounded-bl-md bg-stone-100 text-stone-800',
                  )}
                >
                  {m.role === 'user' ? m.text : <Markdown text={m.text} />}
                  {m.role === 'bot' && <Extras links={m.links} offers={m.offers} onGo={go} onOffer={onOffer} disabled={m !== lastBot} />}
                  {m.role === 'bot' && m.text.length > 160 && <CopyButton text={m.text} />}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex w-fit gap-1 rounded-2xl rounded-bl-md bg-stone-100 px-3 py-2.5" role="img" aria-label="Kompaly réfléchit…">
                {[0, 1, 2].map(i => (
                  <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400" style={{ animationDelay: `${i * 120}ms` }} />
                ))}
              </div>
            )}
          </div>

          {messages.length <= 2 && (
            <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5">
              {suggestions(studying).map(s => (
                <button key={s} onClick={() => void send(s)} tabIndex={isOpen ? 0 : -1} className="h-7 rounded-full border border-stone-200 px-2.5 text-[12px] text-stone-600 transition-colors hover:bg-stone-50 hover:text-ink pointer-coarse:h-9">
                  {s}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-stone-100 p-2.5">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={dictation.listening ? 'Je t’écoute…' : 'Écris à Kompaly…'}
              aria-label="Message pour Kompaly"
              className={cx(
                'h-9 min-w-0 flex-1 rounded-lg bg-stone-50 px-3 text-[13px] outline-none placeholder:text-stone-400 focus:bg-stone-100 focus-visible:ring-2 focus-visible:ring-focus',
                dictation.listening && 'bg-brand-50 placeholder:text-brand-600',
              )}
              tabIndex={isOpen ? 0 : -1}
            />
            {dictation.supported && (
              <button
                type="button"
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                disabled={thinking}
                className={cx(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-30',
                  dictation.listening ? 'bg-brand-solid text-on-brand' : 'text-stone-500 hover:bg-stone-100 hover:text-ink',
                )}
                title={dictation.listening ? 'Arrêter et envoyer' : 'Parler à Kompaly'}
                aria-label={dictation.listening ? 'Arrêter la dictée' : 'Dicter un message'}
                tabIndex={isOpen ? 0 : -1}
              >
                {dictation.listening ? <Square size={13} fill="currentColor" /> : <Mic size={16} />}
              </button>
            )}
            <button type="submit" disabled={!input.trim() || thinking} className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-paper transition-colors hover:bg-stone-800 disabled:opacity-30" title="Envoyer" aria-label="Envoyer" tabIndex={isOpen ? 0 : -1}>
              <ArrowUp size={16} />
            </button>
          </form>
          {dictation.error && <p className="px-3.5 pb-2 text-[11px] text-red-600">{dictation.error}</p>}
          {/* Required by the EU AI Act: the student knows they are talking to an AI (only true in smart mode). */}
          {aiEnabled && pausedUntil <= now && (
            <p className="px-3.5 pb-2 text-center text-[10.5px] text-stone-500">Kompaly est une IA&nbsp;: il peut se tromper, vérifie ce qui compte.</p>
          )}
        </div>

        {/* Spontaneous remarks are read out even though the bubble only appears visually. */}
        <div role="status" aria-live="polite" className="sr-only">
          {bubble && !isOpen ? bubble.text : ''}
        </div>

        {/* Spontaneous remark */}
        {bubble && !isOpen && (
          <div className="pop pointer-events-auto absolute right-[92px] top-1/2 z-10 w-[min(270px,calc(100vw-110px))] -translate-y-[85%] rounded-2xl rounded-br-sm border border-stone-200 bg-surface px-3.5 py-3 text-[13px] leading-[1.5] text-stone-800 shadow-pop">
            <button onClick={clearBubble} className="hit-sm absolute right-1.5 top-1.5 rounded p-1 text-stone-400 hover:text-stone-600" title="Fermer" aria-label="Fermer le message">
              <X size={12} />
            </button>
            <div className="pr-3">
              <Markdown text={bubble.text} />
            </div>
            <Extras links={bubble.links} offers={bubble.offers} onGo={go} onOffer={onOffer} />
          </div>
        )}

        {/* The character */}
        {/* Only the drawn shapes take clicks (Character): the empty corners of its
            box sit over page buttons near the right edge. */}
        {/* Phones: a bit smaller and, hidden, a little further out (only in the page margin, not over the cards);
            open, the panel takes his place (his hands stuck out over its edge). */}
        <div
          className={cx(
            'relative origin-right cursor-pointer touch-none transition-[translate] duration-300 max-sm:scale-[0.8]',
            pose === 'hidden' && 'max-sm:translate-x-1.5',
            isOpen && 'max-sm:invisible',
          )}
          style={{ clipPath: 'inset(-80px 0 -80px -80px)' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onMouseEnter={() => pose === 'hidden' && setPose('peek')}
          onMouseLeave={() => pose === 'peek' && !bubble && setPose('hidden')}
          title={isOpen ? 'Fermer' : 'Parler à Kompaly'}
          ref={charRef}
          role="button"
          tabIndex={0}
          aria-label={isOpen ? 'Fermer Kompaly' : 'Parler à Kompaly'}
          aria-expanded={isOpen}
          aria-controls="copilot-panel"
          onKeyDown={e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (isOpen) setPose('hidden');
            else open();
          }}
        >
          <Character pose={pose} look={look} blink={blink} mood={mood} size={104} />
          {/* Fingers: only his head shows at the edge, too small to tap; a wider invisible pad along the edge. */}
          {!isOpen && <span aria-hidden className="pointer-events-auto absolute inset-y-1 right-0 hidden w-14 pointer-coarse:block" />}
        </div>
      </div>
    </div>
  );
}

/** « Mode intelligent · Groq » or « Mode simple · IA de retour dans 0:42 ». */
function ModeLine({ ai, label, until, now }: { ai: boolean; label: string; until: number; now: number }) {
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  const paused = ai && left > 0;
  const clock = left >= 3600 ? `${Math.floor(left / 3600)} h ${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}` : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const text = !ai ? 'Mode simple' : paused ? `Mode simple · IA dans ${clock}` : `Mode intelligent${label ? ` · ${label}` : ''}`;
  // The pause follows a quota (« limite ») or a technical problem: say which.
  const why = paused && aiPauseReason() === 'error' ? `L’IA ne répond pas pour le moment : elle revient dans ${clock}.` : `L’IA gratuite a atteint sa limite : elle revient dans ${clock}.`;
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight text-stone-500" title={paused ? why : text}>
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', !ai ? 'bg-stone-400' : paused ? 'bg-amber-500' : 'bg-emerald-500')} aria-hidden="true" />
      <span className="tabular truncate">{text}</span>
    </p>
  );
}
