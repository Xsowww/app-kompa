import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronUp, Copy, Maximize2, Mic, Minimize2, RefreshCw, RotateCcw, Square, X } from 'lucide-react';
import Character, { CopilotAvatar, type CopilotMood } from './Character';
import KompalyMark from '../components/KompalyMark';
import { sober } from '../lib/sober';
import { useCopilot, type Bubble, type CopilotLink, type CopilotOffer } from '../store/copilot';
import { useAuth } from '../store/auth';
import { startTour } from '../store/tour';
import { toast } from '../store/ui';
import { isTourRequest, isYes, localReply, type BotReply } from './localBrain';
import { isSimpleRequest } from './simpleIntent';
import { acceptOffer, runOffer } from './offers';
import * as claudeBrain from './claudeBrain';
import { normalize, cx } from '../lib/utils';
import { useSettings } from '../store/settings';
import Markdown from './Markdown';
import { frenchSpacing, stripMarkdown } from './markdown';
import { aiPausedUntil, aiPauseReason, resumeAfterError } from './aiPause';
import { useDictation } from './voice';
import { homeVisited } from './proactive';
import { scrollMotion, trapTab } from '../lib/a11y';
import { fmt, toKey, todayKey } from '../lib/dates';
import { dayLabel, leastCovering, type Box } from './panel';
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
/** The same hello as the home page's title (« Bonjour » until 18 h, then « Bonsoir »): one greeting, the right one. */
const dayHello = (h = new Date().getHours()) => (h >= 5 && h < 18 ? t('Bonjour') : t('Bonsoir'));
/** From this width the page leaves room for him at the right of its content (sidebar 268 px + content 1244 px + margins). */
const ROOMY = 1590;
/** The bubble moved off the cards (Tailwind's -translate-y-[85%] is the same `translate` property: kept in it). */
const shifted = (x: number, y: number) => (x || y ? `${x}px calc(-85% + ${y}px)` : undefined);
/** The home page's place for his remarks (pages/Dashboard), above its cards: there they push the page down, never cover it. */
const NOTE_SLOT = 'kompaly-note';
/** The input grows with the text up to about five lines, then scrolls. */
const INPUT_MAX = 116;

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

function Extras({ links, offers, onGo, onOffer, disabled }: { links?: CopilotLink[]; offers?: CopilotOffer[]; onGo: (to: string) => void; onOffer: (o: CopilotOffer, rest: CopilotOffer[]) => void; disabled?: boolean }) {
  if (!links?.length && !offers?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {offers?.map((o, i) => (
        <button
          key={o.label}
          disabled={disabled}
          onClick={() => onOffer(o, offers.filter(x => x !== o && x.kind === 'confirm_change'))}
          className={cx(
            'min-h-7 rounded-md px-2.5 py-1 text-left text-[12px] font-medium transition-colors disabled:opacity-40 pointer-coarse:min-h-9',
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
          // A filled button with an arrow « go there »: it reads as an action, not as a mention.
          className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg bg-brand-solid px-3 text-[12.5px] font-semibold text-on-brand transition-colors hover:bg-brand-solid-hover pointer-coarse:h-10"
        >
          <span className="truncate">{frenchSpacing(l.label)}</span>
          <ArrowUpRight size={14} strokeWidth={2.4} className="shrink-0" aria-hidden />
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

/**
 * A remark of his laid in the page instead of floating over it: on the home page, above the cards (they move down,
 * nothing is hidden), and on phones and tablets elsewhere, a card over the tab bar, left of the « + ». He is drawn whole
 * in it (never cut by the edge of the screen). « Réduire » keeps one line; ✕ puts it away (it stays in the conversation).
 */
function Note({ bubble, docked, folded, mood, blink, onFold, onClose, onAnswer, onGo, onOffer, onUse, noteRef }: {
  bubble: Bubble;
  /** Over the page, at the bottom (phones and tablets), rather than in the home page's flow. */
  docked: boolean;
  folded: boolean;
  mood: CopilotMood;
  blink: boolean;
  onFold: () => void;
  onClose: () => void;
  onAnswer: () => void;
  onGo: (to: string) => void;
  onOffer: (o: CopilotOffer, rest: CopilotOffer[]) => void;
  onUse: () => void;
  noteRef: React.Ref<HTMLElement>;
}) {
  return (
    <section
      ref={noteRef}
      aria-label={t('Message de Kompaly')}
      onClickCapture={e => (e.target as Element).closest('button') && onUse()}
      className={cx(
        'kompaly-note flex items-start gap-2.5 rounded-[22px] border border-stone-200 bg-surface text-stone-800',
        docked ? 'pointer-events-auto shadow-pop' : 'shadow-card',
        folded ? 'py-2 pl-3 pr-1.5' : 'py-3 pl-2.5 pr-1.5 sm:pl-3',
      )}
    >
      {/* Him, whole: a tap opens the conversation (the same as « Répondre »). */}
      <button type="button" onClick={onAnswer} className="hit -my-1 shrink-0 rounded-2xl" aria-label={t('Répondre à Kompaly')} title={t('Répondre à Kompaly')}>
        {folded ? <CopilotAvatar size={30} /> : <Character pose="open" mood={mood} blink={blink} size={54} />}
      </button>
      <div className={cx('min-w-0 flex-1', folded ? 'self-center' : 'pt-0.5')}>
        {!folded && <p className="text-[12px] font-semibold text-stone-500">Kompaly</p>}
        <div className={cx('text-[14px] leading-[1.5] [overflow-wrap:anywhere]', folded && 'line-clamp-1')}>
          <Markdown text={bubble.text} />
        </div>
        {!folded && (
          <>
            <Extras links={bubble.links} offers={bubble.offers} onGo={onGo} onOffer={onOffer} />
            {!bubble.offers?.length && !bubble.links?.length && (
              <button type="button" onClick={onAnswer} className="hit mt-1.5 text-[13px] font-semibold text-brand-600 underline-offset-2 hover:underline">
                {t('Répondre')}
              </button>
            )}
          </>
        )}
      </div>
      <div className={cx('flex shrink-0', folded ? 'flex-row items-center' : 'flex-col')}>
        <button type="button" onClick={onFold} className="icon-btn h-8 w-8 text-stone-500" aria-expanded={!folded} aria-label={folded ? t('Afficher tout le message') : t('Réduire le message')} title={folded ? t('Afficher tout') : t('Réduire')}>
          {folded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <button type="button" onClick={onClose} className="icon-btn h-8 w-8 text-stone-500" aria-label={t('Fermer le message')} title={t('Fermer')}>
          <X size={15} />
        </button>
      </div>
    </section>
  );
}

export default function Copilot() {
  const navigate = useNavigate();
  const user = useAuth(s => s.user);
  const { messages, pose, bubble, thinking, aiEnabled, offsetY: savedY, unread } = useCopilot();
  // Never down over the « + » button, bottom right (components/CreateButton): his lowest place stays above it.
  const [screen, setScreen] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const offsetY = Math.min(savedY, 1 - (screen.w >= 1024 ? 150 : 200) / screen.h);
  // Affichage Pro: no character and no bubble; what he says comes in the island at the top (components/Island), his
  // panel opens from the menu and Ctrl+J.
  const pro = useSettings(s => s.pro);
  const visible = useSettings(s => s.copilotVisible) && !pro;
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
        ? t('{hello} {name} ! Je peux retrouver tes fichiers, organiser tes révisions, créer des notes… Dis-moi.', { hello: dayHello(), name: user?.name ?? '' })
        : t('{hello} {name} ! Je peux retrouver tes fichiers, organiser ton agenda, créer des notes… Dis-moi.', { hello: dayHello(), name: user?.name ?? '' }),
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ startY: number; moved: boolean } | null>(null);
  // « Arrêter »: drops the AI's answer being waited for.
  const stopRef = useRef<AbortController | null>(null);
  // Who opened the panel (the menu's « Kompaly », Ctrl+J…): the focus goes back there when it closes.
  const opener = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bubbleShift, setBubbleShift] = useState({ x: 0, y: 0 });
  // A remark laid in the page (Note): `slot` is the home page's place for it, null when it is docked at the bottom.
  const [note, setNote] = useState<{ bubble: Bubble; slot: HTMLElement | null } | null>(null);
  const [folded, setFolded] = useState(false);
  const noteRef = useRef<HTMLElement>(null);

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
    if (!bubble || pose === 'open' || !visible || !matchMedia(NARROW).matches) return;
    // A little longer with a button to tap (« Ouvrir le calendrier »).
    const gone = setTimeout(clearBubble, bubble.offers?.length ? 8000 : 6000);
    const onGesture = (e: Event) => {
      if (!(e.target instanceof Node && (rootRef.current?.contains(e.target) || noteRef.current?.contains(e.target)))) clearBubble();
    };
    const events = ['pointerdown', 'scroll', 'keydown'] as const;
    // A moment first: the tap or the scroll that made it appear does not hide it at once.
    const listen = setTimeout(() => events.forEach(type => window.addEventListener(type, onGesture, { capture: true, passive: true })), 400);
    return () => {
      clearTimeout(gone);
      clearTimeout(listen);
      events.forEach(type => window.removeEventListener(type, onGesture, { capture: true }));
    };
  }, [bubble, pose, visible, clearBubble]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: scrollMotion() });
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
      // Phones: room for his head above the panel, under the top bar (he covered its avatar); hidden, just under the bar.
      const top = (phone ? (visible ? 104 : 64) : margin) + (vv?.offsetTop ?? 0);
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
    // `pose`: without the character (hidden, or Affichage Pro) the panel only exists once opened: measured then.
  }, [offsetY, wide, visible, pose]);

  useEffect(() => {
    if (pose !== 'open') return;
    opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
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
      // Closing: give the focus back to what opened it (the character, the menu's « Kompaly »…) rather than losing it.
      const now = document.activeElement;
      const back = opener.current?.isConnected && !panel?.contains(opener.current) ? opener.current : character;
      if (!now || now === document.body || panel?.contains(now)) back?.focus();
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

  const open = () => setPose('open');
  // However it opens (the character, the menu's « Kompaly », Ctrl+J): the remark goes, the greeting comes.
  const isOpen = pose === 'open';
  useEffect(() => {
    if (!isOpen) return;
    clearBubble();
    hello();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hello reads the latest state itself
  }, [isOpen]);

  // Where a new remark goes. The home page, read from its top: in its place above the cards (it stays there until
  // closed: going by itself would make the page jump back up). Phones and tablets elsewhere: docked at the bottom, and
  // gone with the remark (a few seconds, or the first touch). Computers elsewhere: the bubble beside him, as before.
  const laid = useRef<{ bubble: Bubble; path: string } | null>(null);
  // Before the paint: never a frame of the floating bubble first.
  useLayoutEffect(() => {
    if (!visible || isOpen) {
      laid.current = null;
      return setNote(null);
    }
    if (!bubble) return setNote(n => (n?.slot && pathname === '/' && n.slot.isConnected ? n : null));
    // Laid on another page, then that page was left: it goes (it is still in the conversation).
    if (laid.current?.bubble === bubble) {
      if (laid.current.path === pathname) return;
      laid.current = null;
      setNote(null);
      return clearBubble();
    }
    const slot = pathname === '/' ? document.getElementById(NOTE_SLOT) : null;
    const scroller = slot?.closest<HTMLElement>('.overflow-y-auto');
    if (slot && (scroller?.scrollTop ?? 0) < 120) setNote({ bubble, slot });
    else if (narrow) setNote({ bubble, slot: null });
    else return setNote(null);
    laid.current = { bubble, path: pathname };
    setFolded(false);
  }, [bubble, visible, isOpen, narrow, pathname, clearBubble]);
  const closeNote = () => {
    setNote(null);
    clearBubble();
    useCopilot.setState({ unread: false });
  };

  // The other changes of the same answer stay clickable (they come back under the reply).
  const onOffer = (o: CopilotOffer, rest: CopilotOffer[]) => {
    const reply = acceptOffer(o, rest);
    speak(reply.text);
  };

  /** `again`: « Réessayer » — the question is already in the conversation, its failed answer goes. */
  async function send(text: string, again = false) {
    const clean = text.trim();
    if (!clean || thinking) return;
    if (!again) setInput('');
    const pending = useCopilot.getState().pendingOffer;
    if (!again) push('user', clean);

    // « Fais-moi visiter »: the guided tour, panel closed so that it shows (with or without the AI).
    if (isTourRequest(clean)) {
      push('bot', t('C’est parti pour la visite\u00a0!'));
      setPose('hidden');
      setTimeout(startTour, 250);
      return;
    }

    // "oui" to his last proposal → just do it (a question for the AI: asked right after)
    if (pending?.kind === 'ask' && pending.payload?.prompt && aiEnabled && (isYes(normalize(clean)) || /^(avec plaisir|je veux bien|volontiers)$/.test(normalize(clean)))) {
      useCopilot.setState({ pendingOffer: null });
      setTimeout(() => void send(pending.payload!.prompt), 0);
      return;
    }
    if (pending && (isYes(normalize(clean)) || /^(avec plaisir|je veux bien|volontiers)$/.test(normalize(clean)))) {
      const r = runOffer(pending);
      push('bot', r.text, { links: r.links });
      speak(r.text);
      return;
    }

    setThinking(true);
    const stop = new AbortController();
    stopRef.current = stop;
    let reply: BotReply & { retry?: string };
    // What the simple mode understands for sure (« dentiste mardi 17h30 », « qu'est-ce que j'ai demain ? ») stays on the device.
    if (aiEnabled && !(await brain()).aiPausedUntil() && !isSimpleRequest(clean)) {
      try {
        reply = await (await brain()).claudeReply(clean, user?.name ?? '', stop.signal);
      } catch (e) {
        const b = await brain();
        if (b.wasStopped(e)) {
          // « Arrêter »: no apology and no simple-mode answer, only what was already done.
          reply = e instanceof b.PartlyDone ? { text: `${t('J’arrête là.')} ${t('Ce que j’avais déjà fait est enregistré.')}`, links: e.links } : { text: t('J’arrête là.') };
        } else if (e instanceof b.PartlyDone) {
          // Something was already created: doing the question again in simple mode would make it twice.
          reply = { text: `${b.describeApiError(e.reason)} ${t('Ce que j’avais déjà fait est enregistré.')}`, links: e.links };
        } else {
          const local = localReply(clean);
          // Not understood without the AI: the error alone, not the whole list of simple requests after it.
          reply = local.unknown ? { text: `${b.describeApiError(e)} ${t('Repose ta question un peu plus tard (« aide » pour ce que je sais faire sans IA).')}` } : { text: `${b.describeApiError(e)} ${local.text}`, links: local.links };
          // A hiccup (network, server), not a limit: « Réessayer » asks the AI again.
          if (b.canRetry(e)) reply.retry = clean;
        }
      }
    } else {
      await new Promise(r => setTimeout(r, 350 + Math.random() * 350));
      reply = stop.signal.aborted ? { text: t('J’arrête là.') } : localReply(clean);
    }
    stopRef.current = null;
    setThinking(false);
    push('bot', reply.text, { links: reply.links, offers: reply.offers, retry: reply.retry });
    speak(reply.text);
    // Affichage Pro: his panel was closed meanwhile, the answer comes in the island.
    if (useSettings.getState().pro && useCopilot.getState().pose !== 'open') useCopilot.getState().show({ text: reply.text, links: reply.links, offers: reply.offers });
  }

  const retry = (id: string, question: string) => {
    resumeAfterError();
    useCopilot.setState(s => ({ messages: s.messages.filter(m => m.id !== id) }));
    void send(question, true);
  };

  // « Nouvelle conversation »: the old one can come back with « Annuler » (no confirmation to answer first).
  const restart = () => {
    const before = useCopilot.getState();
    const kept = { messages: before.messages, pendingOffer: before.pendingOffer };
    clearHistory();
    hello();
    void brain().then(m => m.resetClaudeHistory());
    if (kept.messages.some(m => m.role === 'user')) toast(t('Nouvelle conversation'), 'info', { label: t('Annuler'), run: () => useCopilot.setState(kept) });
  };

  // A button of a remark asked Kompaly something (« Fais une fiche de… »): the chat opens and sends it.
  const asked = useCopilot(s => s.ask);
  useEffect(() => {
    if (!asked || thinking) return;
    const quiet = !!useCopilot.getState().askQuiet;
    useCopilot.getState().askKompaly(null);
    clearBubble();
    // From the island's hub (Affichage Pro): the answer shows there, the panel stays closed.
    if (!quiet) setPose('open');
    void send(asked);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send reads the latest state itself
  }, [asked, thinking]);

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

  // The field grows with what is typed (pasted lines included), up to about five lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX)}px`;
  }, [input, wide, isOpen]);

  // Computers: a remark's bubble goes where it hides the least of the page — beside him, else above the « + »,
  // a little higher or lower, or left of the card under it (the calendar's « À venir », a column of the home page).
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    const keep = (x: number, y: number) => {
      if (el) el.style.translate = shifted(x, y) ?? '';
      setBubbleShift(s => (s.x === x && s.y === y ? s : { x, y }));
    };
    if (!el || window.innerWidth < 1024) return keep(0, 0);
    el.style.translate = '';
    // Its size without the entrance animation's scale (the same centre).
    const r = el.getBoundingClientRect();
    const usual: Box = { left: r.left + (r.width - el.offsetWidth) / 2, top: r.top + (r.height - el.offsetHeight) / 2, width: el.offsetWidth, height: el.offsetHeight };
    const cardAt = (x: number, y: number) =>
      document
        .elementsFromPoint(x, y)
        .find(e => !rootRef.current?.contains(e))
        ?.closest('.card, aside, nav, #create-button') ?? null;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const plus = document.getElementById('create-button')?.getBoundingClientRect();
    const fit = (b: Box): Box => ({ ...b, left: Math.max(12, Math.min(b.left, W - b.width - 12)), top: Math.max(12, Math.min(b.top, H - b.height - 12)) });
    const places = [
      usual,
      { ...usual, left: W - 24 - usual.width, top: (plus?.top ?? H - 24) - 12 - usual.height },
      { ...usual, top: usual.top - usual.height - 16 },
      { ...usual, top: usual.top + usual.height + 16 },
    ];
    const under = cardAt(usual.left + usual.width / 2, usual.top + usual.height / 2)?.getBoundingClientRect();
    if (under) places.push({ ...usual, left: under.left - 12 - usual.width });
    const spots = places.map(fit);
    const best = spots[leastCovering(spots, (x, y) => !!cardAt(x, y))];
    keep(Math.round(best.left - usual.left), Math.round(best.top - usual.top));
  }, [bubble, isOpen, offsetY]);

  // Hidden in the settings: no character, but the conversation still opens from the menu (« Kompaly ») and Ctrl+J.
  if (!visible && !isOpen) return null;

  const mood: CopilotMood = thinking ? 'think' : talking ? 'talk' : bubble ? (bubble.mood ?? 'happy') : asleep && pose === 'hidden' ? 'sleep' : 'idle';
  const lastBot = [...messages].reverse().find(m => m.role === 'bot' && (!m.proactive || m.offers?.length));
  const last = messages.at(-1);
  // A remark of the bubble used (a button, a link) or closed: read.
  const read = () => useCopilot.setState({ unread: false });
  const recall = () => [...messages].reverse().find(m => m.role === 'user')?.text ?? '';
  // Computers: a remark not read yet brings the corner of his screen out of the edge, the red dot on it (it floated
  // apart from him, hidden but for an arm). Phones keep his head at the edge, the dot beside it.
  const badge = unread && !isOpen && screen.w >= 640;
  // At rest, he is whole or not there, never cut by the edge of the screen: whole on wide screens, where the page
  // leaves him room beside its content (leaning out, or out entirely); elsewhere he comes out to say something, and
  // « Kompaly » opens him (phones and tablets: in the top bar; computers: the sidebar's « Demander à Kompaly », Ctrl+J).
  // Something unread still shows the corner of his screen with its dot (computers and tablets).
  const shownPose = pose === 'hidden' && screen.w >= ROOMY && !asleep ? (screen.w >= ROOMY + 90 ? 'open' : 'peek') : pose;
  // A remark laid in the page (Note) has him whole beside it: not a second one at the edge meanwhile.
  const laidNote = !!note && !isOpen;
  const away = (pose === 'hidden' && !badge && screen.w < ROOMY) || laidNote;

  const noteCard = note && (
    <Note
      bubble={note.bubble}
      docked={!note.slot}
      folded={folded}
      mood={mood}
      blink={blink}
      onFold={() => setFolded(f => !f)}
      onClose={closeNote}
      onAnswer={open}
      onGo={go}
      onOffer={onOffer}
      onUse={read}
      noteRef={noteRef}
    />
  );

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
            // Phone: the whole width, over the character; larger screens: beside it (at the edge when he is hidden).
            'absolute right-3 top-1/2 z-10 flex -translate-y-1/2 origin-right flex-col overflow-hidden rounded-2xl border border-stone-200 bg-surface shadow-pop transition-all duration-200',
            visible ? 'sm:right-[104px]' : 'sm:right-6',
            wide ? 'h-[min(720px,86vh)] w-[calc(100vw-24px)] sm:w-[min(600px,calc(100vw-120px))]' : 'max-h-[min(600px,72vh)] w-[calc(100vw-24px)] sm:max-h-[min(600px,80vh)] sm:w-[min(380px,calc(100vw-120px))]',
            isOpen ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
          )}
        >
          {/* Not a <header>: a banner landmark inside a dialog confuses the page's landmarks. */}
          <div className="flex items-center gap-2.5 border-b border-stone-100 px-3.5 py-2.5">
            {pro ? (
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#1c1c1f] text-white ring-1 ring-white/10">
                <KompalyMark size={20} />
              </span>
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100">
                <CopilotAvatar size={24} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="w-fit text-[13px] font-semibold leading-tight" title={providerInfo}>
                Kompaly
              </p>
              <ModeLine ai={aiEnabled} label={providerLabel} until={pausedUntil} now={now} />
              {aiEnabled && <QuotaBar />}
            </div>
            <button title={wide ? t('Réduire') : t('Agrandir')} aria-label={wide ? t('Réduire') : t('Agrandir')} onClick={() => setWide(w => !w)} className="icon-btn hidden sm:flex" tabIndex={isOpen ? 0 : -1}>
              {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button title={t('Nouvelle conversation')} aria-label={t('Nouvelle conversation')} onClick={restart} disabled={thinking} className="icon-btn pointer-coarse:h-9 pointer-coarse:w-9 disabled:opacity-40" tabIndex={isOpen ? 0 : -1}>
              <RotateCcw size={15} />
            </button>
            <button title={t('Fermer (Échap)')} aria-label={t('Fermer (Échap)')} onClick={() => setPose('hidden')} className="icon-btn pointer-coarse:h-9 pointer-coarse:w-9" tabIndex={isOpen ? 0 : -1}>
              <X size={16} />
            </button>
          </div>

          <div ref={listRef} role="log" aria-live="polite" aria-label={t('Conversation avec Kompaly')} className="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3.5">
            {messages.map((m, i) => {
              const newDay = i === 0 || toKey(new Date(messages[i - 1].at)) !== toKey(new Date(m.at));
              return (
                <Fragment key={m.id}>
                  {/* « Aujourd’hui », « Hier » or the date, above the first message of the day. */}
                  {newDay && <p className="pt-1 text-center text-[11px] font-medium text-stone-500 first-letter:uppercase">{dayLabel(m.at)}</p>}
                  <div className={cx('group/msg flex items-end gap-1.5', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                    <div
                      className={cx(
                        'group relative min-w-0 max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-[1.55] [overflow-wrap:anywhere]',
                        m.role === 'user' ? 'whitespace-pre-line rounded-br-md bg-inverse text-on-inverse' : 'rounded-bl-md bg-stone-100 text-stone-800',
                      )}
                    >
                      {m.role === 'user' ? m.text : <Markdown text={pro ? sober(m.text) : m.text} />}
                      {m.role === 'bot' && <Extras links={m.links} offers={m.offers} onGo={go} onOffer={onOffer} disabled={m !== lastBot} />}
                      {m.role === 'bot' && m.retry && m === last && !thinking && (
                        <button type="button" onClick={() => retry(m.id, m.retry!)} className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-stone-200 bg-surface px-2.5 text-[12px] font-medium text-stone-700 hover:bg-stone-50 pointer-coarse:h-9" tabIndex={isOpen ? 0 : -1}>
                          <RefreshCw size={12} aria-hidden /> {t('Réessayer')}
                        </button>
                      )}
                      {m.role === 'bot' && m.text.length > 160 && <CopyButton text={m.text} />}
                    </div>
                    {/* The time, on hover (read out with each message, it would only be noise). */}
                    <time dateTime={m.at} aria-hidden className="tabular mb-1 shrink-0 text-[10.5px] text-stone-400 opacity-0 transition-opacity group-hover/msg:opacity-100">
                      {fmt(new Date(m.at), 'HH:mm')}
                    </time>
                  </div>
                </Fragment>
              );
            })}
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

          <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-stone-100 p-2.5">
            {/* Entrée sends, Maj+Entrée goes to the line; ↑ in the empty field brings the last message back. */}
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                } else if (e.key === 'ArrowUp' && !input && recall()) {
                  e.preventDefault();
                  const text = recall();
                  setInput(text);
                  const el = e.currentTarget;
                  requestAnimationFrame(() => el.setSelectionRange(text.length, text.length));
                }
              }}
              enterKeyHint="send"
              placeholder={dictation.listening ? t('Je t’écoute… ■ pour finir') : dictation.busy ? t('J’écris ce que tu as dit…') : t('Écris à Kompaly…')}
              aria-label={t('Message pour Kompaly')}
              className={cx(
                'block min-h-9 min-w-0 flex-1 resize-none overflow-y-auto rounded-lg bg-stone-50 px-3 py-[7px] text-[13px] leading-[1.55] outline-none placeholder:text-stone-500 focus:bg-stone-100 focus-visible:ring-2 focus-visible:ring-focus',
                dictation.listening && 'bg-brand-50 placeholder:text-brand-600',
              )}
              tabIndex={isOpen ? 0 : -1}
            />
            {dictation.supported && (
              <button
                type="button"
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                disabled={thinking || dictation.busy}
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
            {/* While he answers, this button stops him (the question stays: ↑ brings it back). */}
            {thinking ? (
              <button type="button" onClick={() => stopRef.current?.abort()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink text-paper transition-colors hover:bg-stone-800" title={t('Arrêter')} aria-label={t('Arrêter la réponse')} tabIndex={isOpen ? 0 : -1}>
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink text-paper transition-colors hover:bg-stone-800 disabled:opacity-30" title={t('Envoyer (Entrée)')} aria-label={t('Envoyer')} tabIndex={isOpen ? 0 : -1}>
                <ArrowUp size={16} />
              </button>
            )}
          </form>
          {dictation.error && <p className="px-3.5 pb-2 text-[11px] text-red-600">{dictation.error}</p>}
          {/* Required by the EU AI Act: the student knows they are talking to an AI (only true in smart mode). */}
          {aiEnabled && pausedUntil <= now && (
            <p className="px-3.5 pb-2 text-center text-[10.5px] text-stone-500">
              {t('Kompaly est une IA : il peut se tromper, vérifie ce qui compte.')}{' '}
              <a href="/confidentialite" onClick={e => (e.preventDefault(), go('/confidentialite'))} className="underline decoration-stone-300 underline-offset-2 hover:text-ink" tabIndex={isOpen ? 0 : -1}>
                {t('Confidentialité')}
              </a>
            </p>
          )}
        </div>

        {/* Spontaneous remarks are read out even though the bubble only appears visually. */}
        <div role="status" aria-live="polite" className="sr-only">
          {bubble && !isOpen && visible ? bubble.text : ''}
        </div>

        {/* Spontaneous remark (on computers, moved off the cards it would hide: see above). */}
        {bubble && !isOpen && visible && !note && (
          <div
            ref={bubbleRef}
            style={{ translate: shifted(bubbleShift.x, bubbleShift.y) }}
            className="pop pointer-events-auto absolute right-[92px] top-1/2 z-10 w-[min(270px,calc(100vw-110px))] -translate-y-[85%] rounded-2xl rounded-br-sm border border-stone-200 bg-surface px-3.5 py-3 text-[13px] leading-[1.5] text-stone-800 shadow-pop"
            onClickCapture={e => (e.target as Element).closest('button') && read()}
          >
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
        {/* Phones: a bit smaller and, hidden, only his head at the edge (the drone's arm alone looked like a bug).
            Computers: hidden, a little further out, within the page margin and off the cards.
            Open, he stays in sight but is only a picture (the panel's ✕ closes it; the focus comes back to him then):
            beside the panel on large screens, over its top edge on phones (the panel takes the whole width). */}
        {visible && (
          <div
            className={cx(
              'relative origin-right cursor-pointer touch-none transition-[translate] duration-300 max-sm:scale-[0.8] short:scale-[0.8]',
              pose === 'hidden' && 'sm:translate-x-2',
              isOpen && 'pointer-events-none',
              // At rest where there is no room for him: not there (see away).
              away && 'pointer-events-none',
            )}
            style={{ clipPath: 'inset(-80px 0 -80px -80px)', translate: isOpen && screen.w < 640 ? `0 ${perch}px` : undefined }}
            aria-hidden={isOpen || away || undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onMouseEnter={() => pose === 'hidden' && setPose('peek')}
            onMouseLeave={() => pose === 'peek' && !bubble && setPose('hidden')}
            title={t('Parler à Kompaly')}
            ref={charRef}
            role="button"
            tabIndex={isOpen || away ? -1 : 0}
            aria-label={unread ? t('Parler à Kompaly (nouveau message)') : t('Parler à Kompaly')}
            aria-expanded={isOpen}
            aria-controls="copilot-panel"
            onKeyDown={e => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              open();
            }}
          >
            <div className={cx('transition-opacity duration-300', away && 'opacity-0')}>
              <WatchingCharacter offsetY={offsetY} pose={shownPose} blink={blink} mood={mood} size={104} badge={badge} />
            </div>
            {/* Tablets (fingers): hidden at the edge, too small to tap; a wider invisible pad along the edge. */}
            {!isOpen && !away && <span aria-hidden className="pointer-events-auto absolute inset-y-1 right-0 hidden w-8 pointer-coarse:block" />}
          </div>
        )}
        {laidNote &&
          createPortal(
            note.slot ? (
              // It opens the room it takes (the cards slide down), its shadow and focus rings inside the clipped edge.
              <div className="kompaly-note-in -mx-1.5 -mt-1.5 overflow-hidden px-1.5 pb-4 pt-1.5">{noteCard}</div>
            ) : (
              // Over the tab bar and the « + » (phones and tablets), at his side of the screen.
              <div className="pop pointer-events-none fixed bottom-[calc(9.25rem+env(safe-area-inset-bottom))] right-[max(12px,env(safe-area-inset-right))] z-40 w-[min(26rem,calc(100vw-24px))] short:bottom-[calc(4.25rem+env(safe-area-inset-bottom))] short:right-[calc(max(16px,env(safe-area-inset-right))+3.75rem)] short:w-[min(26rem,calc(100vw-100px))]">{noteCard}</div>
            ),
            note.slot ?? document.body,
          )}
      </div>
    </div>
  );
}

// « Demander à Kompaly » (menu and top bar): in components/KompalyEntry, so the shell draws it without loading the
// conversation's code (loaded just after, layout/AppShell).
export { KompalyEntry } from '../components/KompalyEntry';

/** How many of today's questions to the AI are used: fills up, turns amber near the end, red when none are left. */
function QuotaBar() {
  const quota = claudeBrain.useAiQuota(s => s.quota);
  if (!quota || quota.day !== todayKey()) return null;
  const share = Math.min(1, quota.used / quota.max);
  const left = quota.max - quota.used;
  return (
    <div className="mt-1 flex items-center gap-2" title={t('Questions à l’IA aujourd’hui : {used} sur {max}. Le compteur repart à zéro à minuit.', { used: quota.used, max: quota.max })}>
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={quota.max}
        aria-valuenow={quota.used}
        aria-label={t('Questions à l’IA aujourd’hui')}
      >
        <div className={cx('h-full rounded-full transition-[width] duration-300', left <= 0 ? 'bg-red-500' : share >= 0.8 ? 'bg-amber-500' : 'bg-brand-500')} style={{ width: `${share * 100}%` }} />
      </div>
      <span className="tabular text-[11px] leading-tight text-stone-500">{t('{used}/{max} questions', { used: quota.used, max: quota.max })}</span>
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
  const reason = paused ? aiPauseReason() : 'limit';
  const why = reason === 'error' ? t('L’IA ne répond pas pour le moment : elle revient dans {clock}.', { clock }) : reason === 'mine' ? t('Tu as utilisé tes questions du jour : l’IA revient dans {clock}.', { clock }) : t('L’IA gratuite a atteint sa limite : elle revient dans {clock}.', { clock });
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight text-stone-500" title={paused ? why : text}>
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', !ai ? 'bg-stone-400' : paused ? 'bg-amber-500' : 'bg-emerald-500')} aria-hidden="true" />
      <span className="tabular truncate">{text}</span>
    </p>
  );
}
