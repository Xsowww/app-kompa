import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../store/settings';
import { useCopilot } from '../store/copilot';
import { trapTab, focusBeforeOverlay, focusables } from '../lib/a11y';
import { useTour, endTour } from '../store/tour';
import { usageWords, type Usage } from '../lib/usage';
import { t } from '../i18n';

interface Step {
  /** Element pointed at (the first visible match); none = a card in the middle of the screen. */
  target?: string;
  /** Prepares the page before measuring the target (Kompaly leans out for its step). */
  enter?: () => void;
  /** Or one per usage (« Le travail à plusieurs » is no word for the family). */
  title: string | ((usage: Usage) => string);
  /** `touch`: phone or tablet (no keyboard shortcut, no drag and drop, « touche » rather than « clique »). */
  text: (usage: Usage, touch: boolean) => string;
}

const NEXT: Record<Usage, string> = { etudes: t('ton prochain examen'), travail: t('ta prochaine échéance'), perso: t('ton prochain grand jour') };

// The same t() texts as the labels in AppShell, so the targets are found in every language.
const nav = (path: string) => `nav[aria-label="${t('Navigation principale')}"] a[href="${path}"]`;

const STEPS: Step[] = [
  {
    title: t('Bienvenue sur Kompaly'),
    text: () => t('Voici où trouver chaque chose, en une minute.'),
  },
  {
    target: nav('/'),
    title: t('L’accueil'),
    text: u => t('Ta journée, {next} et tes tâches, réunis sur une seule page.', { next: NEXT[u] }),
  },
  {
    target: nav('/calendrier'),
    title: t('Le calendrier'),
    text: u =>
      // The same example as the calendar's own field and the presentation page.
      t('Écris simplement «\u00a0{example}\u00a0»\u00a0: Kompaly le range tout seul.', { example: usageWords(u).quickExample }),
  },
  {
    target: nav('/taches'),
    title: t('Les tâches'),
    text: () => t('Ta liste de choses à faire. Coche-les quand c’est fait.'),
  },
  {
    target: nav('/notes'),
    title: t('Les notes'),
    text: () => t('Prends tes notes et range-les en dossiers.'),
  },
  {
    target: nav('/drive'),
    title: t('Le Drive'),
    text: (_, touch) =>
      touch ? t('Ajoute tes fichiers avec le bouton d’import. La recherche fouille même le texte de tes PDF.') : t('Glisse tes fichiers dans la page. La recherche fouille même le texte de tes PDF.'),
  },
  {
    // Phones: not in the tab bar, the microphone of the header instead.
    target: `${nav('/enregistrer')}, header a[href="/enregistrer"]`,
    title: t('Enregistrer'),
    text: (u, touch) => {
      const w = usageWords(u).recording;
      return touch
        ? t('Avec le micro en haut de l’écran, enregistre {a}\u00a0: Kompaly écrit tout, te prévient des mots-clés et range {doc} dans ton Drive.', { a: w.a, doc: w.doc })
        : t('Enregistre {a} au micro ou avec le son de l’ordinateur\u00a0: Kompaly écrit tout, te prévient des mots-clés et range {doc} dans ton Drive.', { a: w.a, doc: w.doc });
    },
  },
  {
    target: nav('/groupes'),
    title: u => (u === 'perso' ? t('À plusieurs') : t('Le travail à plusieurs')),
    text: u => (u === 'travail' ? t('Crée une équipe ou un agenda partagé, puis invite avec un code.') : t('Crée un groupe ou un agenda partagé, puis invite avec un code.')),
  },
  {
    target: `input[aria-label="${t('Rechercher dans tes fichiers, notes, événements et tâches')}"], button[aria-label="${t('Rechercher')}"]`,
    title: t('La recherche'),
    text: (_, touch) =>
      touch ? t('Retrouve n’importe quel fichier, note ou événement.') : t('Retrouve n’importe quel fichier, note ou événement. Raccourci\u00a0: {key} K.', { key: isMac ? '⌘' : t('Ctrl') }),
  },
  {
    // His head, not the whole box: hidden at the edge, it is mostly empty.
    target: '[aria-controls="copilot-panel"] svg rect',
    enter: () => useCopilot.getState().pose === 'hidden' && useCopilot.getState().setPose('peek'),
    title: t('Kompaly, ton ami'),
    text: (_, touch) => (touch ? t('Touche-le pour discuter\u00a0: il t’aide à t’organiser.') : t('Clique sur lui pour discuter\u00a0: il t’aide à t’organiser.')),
  },
  {
    target: 'a[href="/profil"]',
    title: t('Ton profil'),
    text: () => t('Thème, couleur, ton de Kompaly, notifications\u00a0: tout se règle ici.'),
  },
];

const visible = (sel: string) =>
  [...document.querySelectorAll<HTMLElement>(sel)].find(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? null;

const CARD_W = 300;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/** The guided tour: one small card at a time, pointing at a part of the screen. */
export default function Tour() {
  const step = useTour(s => s.step);
  const usage = useSettings(s => s.usage);
  const navigate = useNavigate();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const current = step === null ? null : STEPS[step];

  // The tour starts on the home page, where every target is on screen.
  useEffect(() => {
    if (step === 0) navigate('/');
  }, [step, navigate]);

  useLayoutEffect(() => {
    if (!current) return;
    const place = () => setRect(current.target ? (visible(current.target)?.getBoundingClientRect() ?? null) : null);
    current.enter?.();
    place();
    const settled = current.enter ? setTimeout(place, 520) : undefined; // after the lean-out animation
    window.addEventListener('resize', place);
    return () => {
      clearTimeout(settled);
      window.removeEventListener('resize', place);
      // Kompaly leaned out for his step only: back to his hiding place (unless he is saying something).
      const c = useCopilot.getState();
      if (current.enter && c.pose === 'peek' && !c.bubble) c.setPose('hidden');
    };
  }, [current]);

  // When the tour ends, the focus goes back where it was (« Lancer »), or, as that button goes
  // away with the task ticked off, to the starter task or the first control of its block (« À faire »).
  const opener = useRef<{ el: HTMLElement; block: HTMLElement | null } | null>(null);
  useEffect(() => {
    if (step !== null) {
      if (!opener.current) {
        const el = focusBeforeOverlay() ?? document.body;
        opener.current = { el, block: el.closest<HTMLElement>('section') };
      }
      return;
    }
    if (!opener.current) return;
    const { el, block } = opener.current;
    opener.current = null;
    const target =
      (el.isConnected && el.offsetParent ? el : null) ??
      visible('[data-tour-todo]') ??
      (block?.isConnected ? focusables(block)[0] : null) ??
      // Started from another page (Tâches): the tour ends on the home page, first block there.
      focusables(document.querySelector<HTMLElement>('#contenu section') ?? document.body)[0] ??
      document.getElementById('contenu');
    target?.focus();
  }, [step]);

  // Keyboard: focus on « Suivant », Tab stays in the card (the page behind is only shown).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step === null) return;
    nextBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
      else if (rootRef.current) trapTab(e, rootRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  if (step === null || !current) return null;
  const last = step === STEPS.length - 1;
  const next = () => (last ? endTour() : useTour.setState({ step: step + 1 }));

  // Card beside the target when there is room (right, then left), else under or above it.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let pos: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const w = Math.min(CARD_W, vw - 32);
    if (rect.right + 16 + w <= vw - 16) pos = { left: rect.right + 16, top: Math.min(Math.max(16, rect.top + rect.height / 2 - 70), vh - 200) };
    else if (rect.left - 16 - w >= 16) pos = { left: rect.left - 16 - w, top: Math.min(Math.max(16, rect.top + rect.height / 2 - 70), vh - 200) };
    else if (rect.bottom + 200 <= vh) pos = { left: Math.min(Math.max(16, rect.left), vw - w - 16), top: rect.bottom + 12 };
    else pos = { left: Math.min(Math.max(16, rect.left), vw - w - 16), bottom: vh - rect.top + 12 };
  }

  return (
    <div ref={rootRef} className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-lg transition-all duration-300"
          style={ring(rect, vw, vh)}
        />
      ) : (
        <div className="absolute inset-0" style={{ background: 'rgba(22, 24, 29, 0.45)' }} />
      )}
      {/* Placed by this outer box: the entrance animation's transform would undo the centring. */}
      <div className="absolute w-[min(300px,calc(100vw-32px))]" style={pos}>
        <div className="enter rounded-xl bg-surface p-4 shadow-pop ring-1 ring-stone-200">
          <p className="tabular text-[11px] font-medium text-stone-500">
            {step + 1} / {STEPS.length}
          </p>
          {/* Read out at each step: the focus stays on « Suivant », so nothing else would announce it. */}
          <div aria-live="polite" aria-atomic="true">
            <h2 id="tour-title" className="mt-1 text-[15px] font-semibold">
              {typeof current.title === 'function' ? current.title(usage) : current.title}
            </h2>
            <p id="tour-text" className="mt-1 text-[13px] leading-relaxed text-stone-600">{current.text(usage, isTouch())}</p>
          </div>
          <div className="mt-4 flex items-center gap-2">
            {!last && (
              <button type="button" onClick={endTour} className="hit text-[12px] text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-ink">
                {t('Passer l’intro')}
              </button>
            )}
            <button ref={nextBtn} type="button" onClick={next} className="btn-primary ml-auto h-8">
              {last ? t('C’est parti') : t('Suivant')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Highlight 6 px around the target, kept inside the screen (its 2 px ring included). */
function ring(rect: DOMRect, vw: number, vh: number): React.CSSProperties {
  const left = Math.max(2, rect.left - 6);
  const top = Math.max(2, rect.top - 6);
  const right = Math.min(vw - 2, rect.right + 6);
  const bottom = Math.min(vh - 2, rect.bottom + 6);
  return { left, top, width: right - left, height: bottom - top, boxShadow: '0 0 0 2px var(--color-brand-500), 0 0 0 9999px rgba(22, 24, 29, 0.45)' }; // ring and veil in one shadow
}
