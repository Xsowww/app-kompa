import { memo, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { homeVisited } from './proactive';
import { trapTab } from '../lib/a11y';
import { toKey, todayKey } from '../lib/dates';
import { t } from '../i18n';

// The AI part (and the Anthropic types it uses) is loaded on first use.
// Already loaded with the app (proactive.ts uses it): the promise keeps the call sites unchanged.
const brain = async () => claudeBrain;

// Studies revise; work and personal life block time to prepare (localBrain understands both).
const RECORD_QUESTION = { etudes: t('Comment enregistrer un cours ?'), travail: t('Comment enregistrer une réunion ?'), perso: t('Comment enregistrer une conférence ?') };
// `planOffered`: his last message already has a « Planifier mes révisions » button, no second one.
const suggestions = (usage: keyof typeof RECORD_QUESTION, planOffered = false) =>
  [t('Analyse ma semaine'), ...(planOffered ? [] : [usage === 'etudes' ? t('Planifie mes révisions') : t('Bloque du temps pour préparer')]), RECORD_QUESTION[usage]];
const NARROW = '(max-width: 1023px)';
const YES = /^(oui|ouais|ok|okay|vas[- ]y|go|carrement|d'accord|dac|yes|yeah|yep|sure|si|vale|claro|dale|ja|klar|gerne|certo|va bene|avec plaisir|je veux bien|volontiers)\b/;

/**
 * The character, his eyes following the mouse. Only this small part re-renders while the mouse moves
 * (before, the whole chat did, on every frame: hovering the page lagged), and his place is computed,
 * not measured, so the page is never asked for its layout in the middle of a hover.
 */
const WatchingCharacter = memo(function WatchingCharacter({ offsetY, ...props }: Omit<ComponentProps<typeof Character>, 'look'> & { offsetY: number }) {
  const [look, setLook] = useState({ x: -1, y: 0 });
  useEffect(() => {
    let frame = 0;
    let last: MouseEvent | null = null;
    const onMove = (e: MouseEvent) => {
      last = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!last) return;
        // He sits at the right edge, centred on offsetY (fixed position).
        const dx = last.clientX - (window.innerWidth - 60);
        const dy = last.clientY - offsetY * window.innerHeight;
        const len = Math.max(1, Math.hypot(dx, dy));
        const x = Math.round((dx / len) * 10) / 10;
        const y = Math.round((dy / len) * 10) / 10;
        setLook(l => (l.x === x && l.y === y ? l : { x, y }));
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(frame);
    };
  }, [offsetY]);
  return <Character {...props} look={look} />;
});

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
      title={done ? t('Copié') : t('Copier')}
      aria-label={t('Copier la réponse')}
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
  const { messages, pose, bubble, thinking, aiEnabled, offsetY: savedY } = useCopilot();
  // Never down over the « + » button, bottom right (components/CreateButton): his lowest place stays above it.
  const [screen, setScreen] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const offsetY = Math.min(savedY, 1 - (screen.w >= 1024 ? 150 : 200) / screen.h);
  const visible = useSettings(s => s.copilotVisible);
  const [wide, setWide] = useState(false);
  const [providerInfo, setProviderInfo] = useState('');
  const [providerLabel, setProviderLabel] = useState('');
  const [pausedUntil, setPausedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const { push, setPose, clearBubble, setThinking, setOffsetY, clearHistory, greet } = useCopilot.getState();
  const usage = useSettings(s => s.usage ?? 'etudes');
  const studying = usage === 'etudes';
  const hello = () =>
    // Today's morning brief already says hello (« Salut Léa ! Ta journée en 3 lignes »): not a second one above it.
    !useCopilot.getState().messages.some(m => m.brief && toKey(new Date(m.at)) === todayKey()) &&
    greet(
      studying
        ? t('Salut {name} ! Je peux retrouver tes fichiers, organiser tes révisions, créer des notes… Dis-moi.', { name: user?.name ?? '' })
        : t('Salut {name} ! Je peux retrouver tes fichiers, organiser ton agenda, créer des notes… Dis-moi.', { name: user?.name ?? '' }),
    );

  const [blink, setBlink] = useState(false);
  const [talking, setTalking] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const [input, setInput] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const charRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  // Phones: his place over the top edge of the open panel (px from his usual place), so he stays in sight.
  const [perch, setPerch] = useState(0);
  const [cap, setCap] = useState<number>();
  // Phones and tablets: the open panel covers the page, so it is a modal dialog there (Tab stays inside).
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  const { pathname } = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ startY: number; moved: boolean } | null>(null);

  // Is the AI brain plugged in on the server?
  useEffect(() => {
    void brain()
      .then(m => m.checkAiStatus())
      .then(st => {
        useCopilot.getState().setAiEnabled(st.enabled);
        setProviderInfo(st.enabled ? t('IA : {provider} · {model}', { provider: st.label ?? st.provider ?? '', model: st.model ?? '' }) : t('Mode simple, sans IA'));
        setProviderLabel(st.label ?? st.provider ?? '');
      });
  }, []);

  // Simple mode after the AI quota was reached: countdown in the header while the chat is open.
  useEffect(() => {
    if (pose !== 'open') return;
    const tick = () => (setPausedUntil(aiPausedUntil()), setNow(Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [pose, thinking]);

  useEffect(() => {
    const mq = matchMedia(NARROW);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // The morning brief kept back on a phone (it would cover the page) comes on the home page, once it has
  // settled (like the greeting, 1.5 s after the app opens).
  useEffect(() => {
    if (pathname !== '/') return;
    const timer = setTimeout(homeVisited, 1500);
    return () => clearTimeout(timer);
  }, [pathname]);

  // Long inactivity sends him to sleep (his eyes follow the mouse in WatchingCharacter).
  useEffect(() => {
    let sleepTimer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setAsleep(false);
      clearTimeout(sleepTimer);
      sleepTimer = setTimeout(() => setAsleep(true), 4 * 60_000);
    };
    wake();
    window.addEventListener('mousemove', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
      clearTimeout(sleepTimer);
    };
  }, []);

  // Blinking.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 120);
        loop();
      }, 2400 + Math.random() * 3600);
    };
    loop();
    return () => clearTimeout(timer);
  }, []);

  // Curious little peeks while hidden.
  useEffect(() => {
    if (pose !== 'hidden' || asleep) return;
    const timer = setTimeout(() => {
      if (useCopilot.getState().pose !== 'hidden') return;
      setPose('peek');
      setTimeout(() => {
        const s = useCopilot.getState();
        if (s.pose === 'peek' && !s.bubble) setPose('hidden');
      }, 2200);
    }, 30_000 + Math.random() * 40_000);
    return () => clearTimeout(timer);
  }, [pose, asleep, setPose]);

  // Phones and tablets: a remark covers the page (Drive files, the month, « À venir »). It goes after a few
  // seconds, or at the first touch, scroll or key in the page (not on the bubble or on Kompaly himself).
  useEffect(() => {
    if (!bubble || pose === 'open' || !matchMedia(NARROW).matches) return;
    // A little longer with a button to tap (« Ouvrir le calendrier »).
    const gone = setTimeout(clearBubble, bubble.offers?.length ? 8000 : 6000);
    const onGesture = (e: Event) => {
      if (!(e.target instanceof Node && rootRef.current?.contains(e.target))) clearBubble();
    };
    const events = ['pointerdown', 'scroll', 'keydown'] as const;
    // A moment first: the tap or the scroll that made it appear does not hide it at once.
    const listen = setTimeout(() => events.forEach(type => window.addEventListener(type, onGesture, { capture: true, passive: true })), 400);
    return () => {
      clearTimeout(gone);
      clearTimeout(listen);
      events.forEach(type => window.removeEventListener(type, onGesture, { capture: true }));
    };
  }, [bubble, pose, clearBubble]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, thinking, pose]);

  // The panel is centred on the character; slide it so that it always stays inside the window.
  useLayoutEffect(() => {
    const place = () => {
      const H = window.innerHeight;
      const phone = window.innerWidth < 640;
      const margin = 12;
      // The phone's keyboard shrinks only the visual viewport (iOS, Chrome Android): the panel goes above it.
      const vv = window.visualViewport;
      const keyboard = vv ? Math.max(0, H - vv.height - vv.offsetTop) : 0;
      const top = (phone ? 76 : margin) + (vv?.offsetTop ?? 0); // room for his head above the panel
      // Above the bottom navigation on phones and tablets, and above the imports card (components/UploadCard).
      const room = parseFloat(document.documentElement.style.getPropertyValue('--uploads-room')) || 0;
      const bottom = keyboard > 80 ? keyboard + margin : Math.max(window.innerWidth < 1024 ? 68 : margin, room);
      const most = Math.max(160, H - top - bottom);
      setCap(c => (c === most ? c : most));
      const h = Math.min(panelRef.current?.offsetHeight ?? 0, most);
      const centre = offsetY * H;
      const wanted = Math.min(Math.max(centre, h / 2 + top), H - h / 2 - bottom);
      setShift(Math.round(wanted - centre));
      setPerch(Math.round(wanted - h / 2 - centre - 22));
    };
    place();
    const ro = new ResizeObserver(place);
    if (panelRef.current) ro.observe(panelRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('uploads-room', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      ro.disconnect();
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
      window.removeEventListener('uploads-room', place);
    };
  }, [offsetY, wide]);

  useEffect(() => {
    if (pose !== 'open') return;
    const timer = setTimeout(() => inputRef.current?.focus(), 200);
    // Échap closes Kompaly, unless what was opened over it took the key (the search, a dialog…).
    const panel = panelRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setPose('hidden');
      // Modal on phones and tablets: Tab goes round inside (unless a dialog opened over it has it).
      else if (panel && !e.defaultPrevented && matchMedia(NARROW).matches) {
        const dialogs = document.querySelectorAll('[aria-modal="true"]');
        if (dialogs[dialogs.length - 1] === panel) trapTab(e, panel);
      }
    };
    window.addEventListener('keydown', onKey);
    const character = charRef.current;
    // A click anywhere else closes Kompaly (not in a dialog or menu opened over it, e.g. a confirmation).
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest || panel?.contains(el) || character?.contains(el) || el.closest('[role="dialog"], [role="menu"], [role="alertdialog"]')) return;
      setPose('hidden');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
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
          reply = { text: `${b.describeApiError(e.reason)} ${t('Ce que j’avais déjà fait est enregistré.')}`, links: e.links };
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
  const dictation = useDictation(setInput, said => void send(said));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (dictation.listening) dictation.stop();
    void send(input);
  };

  // Drag the character along the edge; a click without movement opens the chat (he is hidden while it is open: its ✕ closes).
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
    if (d && !d.moved) open();
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
          aria-modal={isOpen && narrow ? true : undefined}
          aria-hidden={!isOpen}
          inert={!isOpen}
          style={{ marginTop: shift, maxHeight: cap }}
          className={cx(
            // Phone: the whole width, over the character; larger screens: beside it.
            'absolute right-3 top-1/2 z-10 flex -translate-y-1/2 origin-right flex-col overflow-hidden rounded-2xl border border-stone-200 bg-surface shadow-pop transition-all duration-200 sm:right-[104px]',
            wide ? 'h-[min(720px,86vh)] w-[calc(100vw-24px)] sm:w-[min(600px,calc(100vw-120px))]' : 'max-h-[min(600px,72vh)] w-[calc(100vw-24px)] sm:max-h-[min(600px,80vh)] sm:w-[min(380px,calc(100vw-120px))]',
            isOpen ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
          )}
        >
          {/* Not a <header>: a banner landmark inside a dialog confuses the page's landmarks. */}
          <div className="flex items-center gap-2.5 border-b border-stone-100 px-3.5 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100">
              <CopilotAvatar size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="w-fit text-[13px] font-semibold leading-tight" title={providerInfo}>
                Kompaly
              </p>
              <ModeLine ai={aiEnabled} label={providerLabel} until={pausedUntil} now={now} />
            </div>
            <button title={wide ? t('Réduire') : t('Agrandir')} aria-label={wide ? t('Réduire') : t('Agrandir')} onClick={() => setWide(w => !w)} className="icon-btn hidden sm:flex" tabIndex={isOpen ? 0 : -1}>
              {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button title={t('Nouvelle conversation')} aria-label={t('Nouvelle conversation')} onClick={() => { clearHistory(); hello(); void brain().then(m => m.resetClaudeHistory()); }} className="icon-btn pointer-coarse:h-9 pointer-coarse:w-9" tabIndex={isOpen ? 0 : -1}>
              <RotateCcw size={15} />
            </button>
            <button title={t('Fermer (Échap)')} aria-label={t('Fermer (Échap)')} onClick={() => setPose('hidden')} className="icon-btn pointer-coarse:h-9 pointer-coarse:w-9" tabIndex={isOpen ? 0 : -1}>
              <X size={16} />
            </button>
          </div>

          <div ref={listRef} role="log" aria-live="polite" aria-label={t('Conversation avec Kompaly')} className="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3.5">
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
              <div className="flex w-fit gap-1 rounded-2xl rounded-bl-md bg-stone-100 px-3 py-2.5" role="img" aria-label={t('Kompaly réfléchit…')}>
                {[0, 1, 2].map(i => (
                  <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400" style={{ animationDelay: `${i * 120}ms` }} />
                ))}
              </div>
            )}
          </div>

          {messages.length <= 2 && (
            <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5">
              {suggestions(usage, !!lastBot?.offers?.some(o => o.kind === 'plan_revisions')).map(s => (
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
              placeholder={dictation.listening ? t('Je t’écoute…') : t('Écris à Kompaly…')}
              aria-label={t('Message pour Kompaly')}
              className={cx(
                'h-9 min-w-0 flex-1 rounded-lg bg-stone-50 px-3 text-[13px] outline-none placeholder:text-stone-500 focus:bg-stone-100 focus-visible:ring-2 focus-visible:ring-focus',
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
                title={dictation.listening ? t('Arrêter et envoyer') : t('Parler à Kompaly')}
                aria-label={dictation.listening ? t('Arrêter la dictée') : t('Dicter un message')}
                tabIndex={isOpen ? 0 : -1}
              >
                {dictation.listening ? <Square size={13} fill="currentColor" /> : <Mic size={16} />}
              </button>
            )}
            <button type="submit" disabled={!input.trim() || thinking} className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-paper transition-colors hover:bg-stone-800 disabled:opacity-30" title={t('Envoyer')} aria-label={t('Envoyer')} tabIndex={isOpen ? 0 : -1}>
              <ArrowUp size={16} />
            </button>
          </form>
          {dictation.error && <p className="px-3.5 pb-2 text-[11px] text-red-600">{dictation.error}</p>}
          {/* Required by the EU AI Act: the student knows they are talking to an AI (only true in smart mode). */}
          {aiEnabled && pausedUntil <= now && (
            <p className="px-3.5 pb-2 text-center text-[10.5px] text-stone-500">{t('Kompaly est une IA\u00a0: il peut se tromper, vérifie ce qui compte.')}</p>
          )}
        </div>

        {/* Spontaneous remarks are read out even though the bubble only appears visually. */}
        <div role="status" aria-live="polite" className="sr-only">
          {bubble && !isOpen ? bubble.text : ''}
        </div>

        {/* Spontaneous remark */}
        {bubble && !isOpen && (
          <div className="pop pointer-events-auto absolute right-[92px] top-1/2 z-10 w-[min(270px,calc(100vw-110px))] -translate-y-[85%] rounded-2xl rounded-br-sm border border-stone-200 bg-surface px-3.5 py-3 text-[13px] leading-[1.5] text-stone-800 shadow-pop">
            <button onClick={clearBubble} className="hit-sm absolute right-1.5 top-1.5 rounded p-1 text-stone-400 hover:text-stone-600" title={t('Fermer')} aria-label={t('Fermer le message')}>
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
        {/* Phones: a bit smaller and, hidden, a little further out (only in the page margin, not over the cards).
            Open, he stays in sight but is only a picture (the panel's ✕ closes it; the focus comes back to him then):
            beside the panel on large screens, over its top edge on phones (the panel takes the whole width). */}
        <div
          className={cx(
            'relative origin-right cursor-pointer touch-none transition-[translate] duration-300 max-sm:scale-[0.8]',
            pose === 'hidden' && 'max-sm:translate-x-1.5',
            isOpen && 'pointer-events-none',
          )}
          style={{ clipPath: 'inset(-80px 0 -80px -80px)', translate: isOpen && screen.w < 640 ? `0 ${perch}px` : undefined }}
          aria-hidden={isOpen || undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onMouseEnter={() => pose === 'hidden' && setPose('peek')}
          onMouseLeave={() => pose === 'peek' && !bubble && setPose('hidden')}
          title={t('Parler à Kompaly')}
          ref={charRef}
          role="button"
          tabIndex={isOpen ? -1 : 0}
          aria-label={t('Parler à Kompaly')}
          aria-expanded={isOpen}
          aria-controls="copilot-panel"
          onKeyDown={e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            open();
          }}
        >
          <WatchingCharacter offsetY={offsetY} pose={pose} blink={blink} mood={mood} size={104} />
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
  const clock = left >= 3600 ? t('{h} h {min}', { h: Math.floor(left / 3600), min: String(Math.floor((left % 3600) / 60)).padStart(2, '0') }) : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const text = !ai ? t('Mode simple, sans IA') : paused ? t('Mode simple · IA dans {clock}', { clock }) : label ? t('Mode intelligent · {label}', { label }) : t('Mode intelligent');
  // The pause follows a quota (« limite ») or a technical problem: say which.
  const why = paused && aiPauseReason() === 'error' ? t('L’IA ne répond pas pour le moment : elle revient dans {clock}.', { clock }) : t('L’IA gratuite a atteint sa limite : elle revient dans {clock}.', { clock });
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight text-stone-500" title={paused ? why : text}>
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', !ai ? 'bg-stone-400' : paused ? 'bg-amber-500' : 'bg-emerald-500')} aria-hidden="true" />
      <span className="tabular truncate">{text}</span>
    </p>
  );
}
