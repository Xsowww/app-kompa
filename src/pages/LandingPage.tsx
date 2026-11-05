import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Briefcase, CornerDownLeft, Download, FileSearch, Flame, GraduationCap, House, Lock, Mic, Server, ShieldCheck, Sparkles, Sunrise, Timer, UserRound, Users } from 'lucide-react';
import Logo from '../components/Logo';
import LanguagePicker from '../components/LanguagePicker';
import FileIcon from '../components/FileIcon';
import Character, { DroneStill } from '../copilot/Character';
import { USAGES, WORDS, type Usage } from '../lib/usage';
import { LEGAL_LINKS } from './legal/links';
import { cx } from '../lib/utils';
import { t } from '../i18n';

// Kompaly's own accounts; also listed in index.html (sameAs) for Google.
const SOCIAL_LINKS = [
  { label: 'Instagram', href: 'https://www.instagram.com/kompaly_app/' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/kompaly/' },
];

const CONTACT = 'contact@kompaly.com';

// The public home page (kompaly.com/ for someone not signed in): what Kompaly is, for search engines and newcomers.
// The pictures in public/landing/ are real captures of the app (light Classique look, a local test account).

const PHRASE = t('Dentiste mardi 17h30');
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The one source of every date drawn on this page (the hero's week, Kompaly's answers): Monday to Friday of this
 * week while its Tuesday (the dentist) is still ahead, else of the next one. `today`: its index (0 = Monday), or -1.
 */
function demoWeek(now = new Date()) {
  const dow = (now.getDay() + 6) % 7;
  const next = dow > 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + (next ? 7 : 0));
  return { day: (i: number) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i).getDate(), today: next ? -1 : dow };
}
const WEEK = demoWeek();

/**
 * The one animated moment of the page: a sentence typed in the quick add becomes an event, then Kompaly speaks up.
 * Kompaly and his bubble are there from the start (with a first line), so no empty room waits under the window.
 * A demo, not a field: no caret, nothing to type into; once added, the bar says what happened.
 * Its week mixes work, family and studies: nobody should read it as « not for me ».
 */
function HeroDemo() {
  // 0 → typing, 1 → added, 2 → Kompaly's question.
  const [typed, setTyped] = useState(() => (reducedMotion() ? PHRASE.length : 0));
  const [step, setStep] = useState(() => (reducedMotion() ? 2 : 0));

  useEffect(() => {
    if (step !== 0) return;
    if (typed < PHRASE.length) {
      const t = setTimeout(() => setTyped(n => n + 1), typed === 0 ? 900 : 60);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep(1), 650);
    return () => clearTimeout(t);
  }, [typed, step]);
  useEffect(() => {
    if (step !== 1) return;
    const t = setTimeout(() => setStep(2), 900);
    return () => clearTimeout(t);
  }, [step]);

  const replay = () => {
    setTyped(0);
    setStep(0);
  };
  const names = [t('Lun'), t('Mar'), t('Mer'), t('Jeu'), t('Ven')];
  const dots = ['#3d6fd8', step >= 1 ? '#2f9e6b' : undefined, '#7a5ad6', undefined, '#d48a17'];
  const row = 'flex items-center gap-2 rounded-md bg-stone-50 px-2.5 py-2';
  const event = (color: string, title: string, when: string) => (
    <>
      <span className="h-3.5 w-0.5 shrink-0 rounded-full" style={{ background: color }} /> <span className="min-w-0 leading-snug">{title}</span>{' '}
      <span className="ml-auto shrink-0 tabular text-stone-500">{when}</span>
    </>
  );

  return (
    <div className="relative min-w-0" aria-label={t('Exemple : une phrase tapée devient un rendez-vous, et Kompaly propose de te prévenir')} role="img">
      <div className="card select-none overflow-hidden p-0 shadow-pop" aria-hidden>
        {/* The quick add, playing by itself */}
        <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-3">
          {step === 0 && <span className="text-stone-400">+</span>}
          <span className="min-w-0 flex-1 text-[14px] leading-snug">
            {step === 0 ? PHRASE.slice(0, typed) : <span className="font-medium text-emerald-700">{t('✓ Ajouté : mardi {day}, 17:30', { day: WEEK.day(1) })}</span>}
          </span>
          {step === 0 ? (
            <span className={cx('flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors', typed === PHRASE.length ? 'bg-ink text-paper' : 'text-stone-500')}>
              {t('Ajouter')} <CornerDownLeft size={11} />
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10.5px] font-semibold text-stone-500">{t('Exemple')}</span>
          )}
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_150px]">
          <div className="min-w-0">
            <div className="grid grid-cols-5 gap-1.5 text-center">
              {names.map((d, i) => (
                <div key={d} className={i === WEEK.today ? 'rounded-xl bg-tile-blue py-1.5 text-white' : 'py-1.5'}>
                  <p className={i === WEEK.today ? 'text-[10px] text-white/90' : 'text-[10px] text-stone-500'}>{d}</p>
                  <p className="tabular text-[14px] font-semibold">{WEEK.day(i)}</p>
                  <span className="mx-auto mt-1 block h-1 w-1 rounded-full transition-colors" style={{ background: dots[i] ?? 'transparent' }} />
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1.5 text-[12.5px]">
              <div className={row}>{event('#3d6fd8', t('Réunion d’équipe'), `${t('Lun.')} 9:00`)}</div>
              {step >= 1 && <div className={cx(row, 'pop ring-1 ring-stone-200')}>{event('#2f9e6b', t('Dentiste'), `${t('Mar.')} 17:30`)}</div>}
              <div className={row}>{event('#7a5ad6', t('Judo de Léo'), `${t('Mer.')} 14:00`)}</div>
              <div className={row}>{event('#d48a17', t('Relancer M. Dupont'), `${t('Ven.')} 10:00`)}</div>
            </div>
          </div>
          <div className="flex flex-col rounded-2xl bg-tile-dark p-3.5 text-white max-sm:flex-row max-sm:items-center max-sm:gap-3">
            <p className="text-[11.5px] font-semibold text-white/65 max-sm:order-2 max-sm:flex-1">
              {t('Prochain grand jour')}
              <span className="mt-0.5 block truncate text-[12.5px] text-white sm:hidden">{t('Bac de français')}</span>
            </p>
            <p className="tabular mt-auto pt-4 text-[40px] font-extrabold leading-none tracking-[-0.05em] text-urgent max-sm:order-1 max-sm:pt-0 max-sm:text-[30px]">{t('J-{n}', { n: 12 })}</p>
            <p className="mt-1.5 truncate text-[12px] font-semibold max-sm:hidden">{t('Bac de français')}</p>
          </div>
        </div>
      </div>

      {/* Kompaly under the window (never over it), there from the first moment: his line changes once the event is in. */}
      <div className="mt-3 flex items-end justify-end gap-3.5">
        <div key={step === 2 ? 'asked' : 'hello'} className="pop mb-6 min-w-0 max-w-[15rem] rounded-2xl rounded-br-sm border border-stone-200 bg-surface px-3 py-2 text-[12.5px] leading-snug shadow-pop" aria-hidden>
          {step === 2 ? (
            <>
              {t('C’est noté, mardi {day} à 17:30. Je te préviens 1\u00a0h avant\u00a0?', { day: WEEK.day(1) })}
              <span className="mt-1.5 flex gap-1.5">
                <span className="rounded-full bg-ink px-2.5 py-0.5 text-[11.5px] font-semibold text-paper">{t('Oui')}</span>
                <span className="rounded-full border border-stone-200 px-2.5 py-0.5 text-[11.5px] font-semibold">{t('La veille')}</span>
              </span>
            </>
          ) : (
            t('Écris une phrase, je la range dans ton agenda.')
          )}
        </div>
        <div className="shrink-0" aria-hidden>
          <Character pose="open" look={{ x: -0.9, y: -0.3 }} mood={step === 2 ? 'happy' : 'idle'} size={76} />
        </div>
      </div>
      {/* On its own line (beside Kompaly it squeezed his bubble on phones); its room is kept so nothing moves. */}
      {!reducedMotion() && (
        <button type="button" onClick={replay} tabIndex={step === 2 ? 0 : -1} className={cx('-mt-2 text-[12px] text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-ink pointer-coarse:py-2', step !== 2 && 'invisible')}>
          {t('Revoir l’exemple')}
        </button>
      )}
    </div>
  );
}

/** A real capture of the app, in a frame; `mobile`: a phone capture shown instead on narrow screens (else unreadable). */
function Shot({ src, width, height, alt, phone, mobile, className }: { src: string; width: number; height: number; alt: string; phone?: boolean; mobile?: [string, number, number]; className?: string }) {
  return (
    <picture>
      {mobile && <source media="(max-width: 639px)" srcSet={mobile[0]} width={mobile[1]} height={mobile[2]} />}
      <img
        src={src}
        width={width}
        height={height}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cx('mx-auto block h-auto w-full border border-stone-200 bg-surface shadow-pop', phone ? 'max-w-[300px] rounded-[26px]' : 'rounded-2xl', mobile && 'max-sm:max-w-[300px] max-sm:rounded-[26px]', className)}
      />
    </picture>
  );
}

/** One thing Kompaly does: a title, two lines, and what it looks like in the app. */
function Feature({ icon: Icon, title, text, children, flip, extra }: { icon: typeof Mic; title: string; text: string; children: ReactNode; flip?: boolean; extra?: ReactNode }) {
  return (
    <li className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <div className={cx('min-w-0', flip && 'lg:order-2')}>
        <Icon size={20} strokeWidth={1.8} className="text-brand-600" aria-hidden />
        <h3 className="mt-3 text-[22px] font-extrabold leading-tight tracking-[-0.02em] md:text-[26px]">{title}</h3>
        <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-stone-600">{text}</p>
        {extra}
      </div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

/** « Partage un agenda » : the three steps, as they happen (a shared calendar needs an account, no capture here). */
function ShareSteps() {
  const steps = [
    { n: 1, title: t('Crée l’agenda'), text: t('« Famille », « Coloc », « Asso du quartier »…') },
    { n: 2, title: t('Envoie le lien'), text: t('Par SMS, WhatsApp ou e-mail.') },
    { n: 3, title: t('L’autre crée son compte gratuit et voit tout'), text: t('Chacun ajoute ses événements, les autres sont prévenus.') },
  ];
  return (
    <ol className="card space-y-4 p-5 sm:p-6">
      {steps.map(s => (
        <li key={s.n} className="flex gap-3.5">
          <span className="tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tile-blue text-[14px] font-bold text-white" aria-hidden>
            {s.n}
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">{s.title}</span>
            <span className="block text-[13.5px] text-stone-500">{s.text}</span>
          </span>
        </li>
      ))}
      <li className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4 text-[12.5px]">
        {[
          { c: '#7a5ad6', l: t('Judo de Léo · mer. 14h') },
          { c: '#2f9e6b', l: t('Repas chez mamie · dim. 12h30') },
          { c: '#d48a17', l: t('Réunion de l’asso · jeu. 20h') },
        ].map(e => (
          <span key={e.l} className="flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-700">
            <span className="h-2 w-2 rounded-full" style={{ background: e.c }} aria-hidden /> {e.l}
          </span>
        ))}
      </li>
    </ol>
  );
}

/** « Concentre-toi » : the focus timer as it looks in the app, and three badges it earns (drawn, no account needed). */
function FocusBadges() {
  const badges = [
    { icon: Timer, title: t('Première session'), color: 'bg-tile-blue' },
    { icon: Flame, title: t('Semaine pleine'), color: 'bg-[#d4622a]' },
    { icon: Sunrise, title: t('Lève-tôt'), color: 'bg-[#d48a17]' },
  ];
  return (
    <div className="card space-y-4 p-5 sm:p-6" role="img" aria-label={t('Exemple : une session focus de 25 minutes en cours, et trois badges gagnés : Première session, Semaine pleine, Lève-tôt.')}>
      <div className="rounded-2xl bg-stone-100 p-4" aria-hidden>
        <p className="flex items-center gap-2 text-[13px] font-semibold">
          <Timer size={15} className="text-brand-600" /> {t('Concentration')}
          <span className="ml-auto rounded-full bg-surface px-2.5 py-0.5 text-[12px] font-medium text-stone-600">{t('Dossier Dupont')}</span>
        </p>
        <p className="tabular mt-3 font-mono text-[40px] font-medium leading-none tracking-[-0.02em]">18:42</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface">
          <div className="h-full w-[25%] rounded-full bg-brand-500" />
        </div>
        <p className="mt-2 text-[12px] text-stone-500">{t('{focus} min de travail, {pause} min de pause', { focus: 25, pause: 5 })}</p>
      </div>
      <ul className="grid grid-cols-3 gap-2" aria-hidden>
        {badges.map(b => (
          <li key={b.title} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
            <span className={cx('flex h-11 w-11 items-center justify-center rounded-full text-white shadow-card', b.color)}>
              <b.icon size={20} strokeWidth={2} />
            </span>
            <span className="text-[12px] font-medium leading-tight [overflow-wrap:anywhere]">{b.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Kompaly is an AI assistant: said plainly, with the mascot and a short exchange. */
function Assistant() {
  return (
    <section id="assistant" aria-labelledby="assistant-title" className="mx-auto max-w-[1120px] px-5 py-20 md:px-8">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-14">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1.5">
            <Sparkles size={13} aria-hidden /> {t('Intelligence artificielle')}
          </p>
          <h2 id="assistant-title" className="mt-2 text-[30px] font-extrabold leading-[1.05] tracking-[-0.025em] md:text-[36px]">
            {t('Kompaly, ton assistant IA.')}
          </h2>
          <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-stone-600">
            {t('Écris-lui comme à quelqu’un : il ajoute tes rendez-vous, planifie tes révisions, retrouve un fichier et te prévient avant les grands jours.')}
          </p>
          <ul className="mt-6 space-y-3 text-[14.5px] leading-relaxed">
            <li className="flex gap-3">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden />
              <span>
                <strong className="font-semibold">{t('Mode intelligent :')}</strong> {t('il comprend les phrases libres et lit tes documents (IA Claude, d’Anthropic).')}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-stone-400" aria-hidden />
              <span>
                <strong className="font-semibold">{t('Mode simple :')}</strong> {t('il comprend les commandes courantes, sans rien envoyer à une IA.')}
              </span>
            </li>
          </ul>
        </div>

        {/* An example exchange (drawn, so it reads in every language). */}
        <div className="card min-w-0 border border-stone-200 bg-paper p-4 shadow-pop sm:p-5" role="img" aria-label={t('Exemple : « Ajoute dentiste mardi 17h30 », Kompaly répond qu’il l’a noté et propose de te prévenir 1 h avant.')}>
          <div className="flex items-center gap-3 border-b border-stone-200 pb-3" aria-hidden>
            <DroneStill mood="happy" className="h-11" />
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold">Kompaly</span>
              <span className="block text-[12px] text-stone-500">{t('Ton assistant IA')}</span>
            </span>
          </div>
          <div className="space-y-2.5 pt-4 text-[13.5px] leading-snug" aria-hidden>
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-paper">{t('Ajoute dentiste mardi 17h30')}</p>
            <div className="w-fit max-w-[88%] rounded-2xl rounded-bl-sm bg-stone-100 px-3.5 py-2.5">
              {t('C’est noté, mardi {day} à 17:30. Je te préviens 1 h avant ?', { day: WEEK.day(1) })}
              <span className="mt-2.5 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-tile-blue px-3 py-1 text-[12.5px] font-semibold text-white">{t('Oui, 1 h avant')}</span>
                <span className="rounded-full border border-stone-300 bg-surface px-3 py-1 text-[12.5px] font-semibold">{t('Voir le jour')}</span>
              </span>
            </div>
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-paper">{t('Et planifie mes révisions pour le partiel')}</p>
            <p className="w-fit max-w-[88%] rounded-2xl rounded-bl-sm bg-stone-100 px-3.5 py-2.5">{t('Je te propose 4 séances d’ici vendredi {day}, l’après-midi. Je les ajoute ?', { day: WEEK.day(4) })}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Words of the « Usages » cards on this page (the app's own words are in lib/usage: no « devis » here). */
const USAGE_EXAMPLES: Record<Usage, { hint: string; quick: string; big: string; days: number; group: string; file: string; files: string; rec: string; docs: string[] }> = {
  etudes: {
    hint: t('Lycée ou fac : cours, bac, partiels, révisions en groupe'),
    quick: t('Partiel de droit vendredi 14h'),
    big: t('Bac de français'),
    days: 12,
    group: t('Groupe de TD'),
    file: t('Cours de droit civil — chapitre 3.pdf'),
    files: t('Cours, sujets, corrigés…'),
    rec: t('Droit civil, amphi B'),
    docs: [t('Cours rédigé'), t('Fiche de révision'), t('Examen d’entraînement')],
  },
  travail: {
    hint: t('Réunions, échéances, comptes rendus, projets d’équipe'),
    quick: t('Réunion client jeudi 10h'),
    big: t('Rendu de la maquette'),
    days: 3,
    group: t('Équipe'),
    file: t('Planning du projet.pdf'),
    files: t('Présentations, plannings, comptes rendus…'),
    rec: t('Point projet du lundi'),
    docs: [t('Compte rendu'), t('Résumé')],
  },
  perso: {
    hint: t('Activités des enfants, agenda de famille, papiers, asso'),
    quick: t('Judo de Léo mercredi 14h'),
    big: t('Renouveler les passeports'),
    days: 9,
    group: t('Agenda de la famille'),
    file: t('Assurance scolaire de Léo.pdf'),
    files: t('Papiers, photos, plannings…'),
    rec: t('Réunion de l’asso du quartier'),
    docs: [t('Texte rédigé'), t('Résumé')],
  },
};

/**
 * Studies, work or family: the same app, its words follow the person (lib/usage). The three go round on their own
 * (none looks like the only one) until the visitor picks one.
 */
function Usages() {
  const [usage, setUsage] = useState<Usage>('etudes');
  const [picked, setPicked] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const ex = USAGE_EXAMPLES[usage];

  useEffect(() => {
    if (picked || !ref.current || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let turns = 0;
    const io = new IntersectionObserver(([e]) => {
      clearInterval(timer);
      if (!e.isIntersecting) return;
      timer = setInterval(() => {
        // Two rounds, then it stays.
        if (++turns > USAGES.length * 2 - 1) return clearInterval(timer);
        setUsage(u => USAGES[(USAGES.findIndex(x => x.key === u) + 1) % USAGES.length].key);
      }, 3500);
    }, { threshold: 0.5 });
    io.observe(ref.current);
    return () => {
      io.disconnect();
      clearInterval(timer);
    };
  }, [picked]);

  return (
    <section ref={ref} id="usages" aria-labelledby="usages-title" className="mx-auto max-w-[1120px] px-5 py-20 md:px-8" onPointerDown={() => setPicked(true)} onFocus={() => setPicked(true)}>
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="min-w-0">
          <h2 id="usages-title" className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.025em] md:text-[36px]">
            {t('Pour tes études, ton travail ou ta famille.')}
          </h2>
          <div className="seg mt-6 text-[13.5px] max-sm:flex max-sm:text-[12.5px]" role="group" aria-label={t('Kompaly sert pour')}>
            {USAGES.map(u => (
              <button
                key={u.key}
                type="button"
                aria-pressed={usage === u.key}
                onClick={() => (setPicked(true), setUsage(u.key))}
                className="seg-item h-9 px-3.5 font-semibold max-sm:min-w-0 max-sm:flex-auto max-sm:shrink max-sm:px-1.5"
              >
                {u.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-stone-500">{ex.hint}</p>
        </div>

        {/* Read out only once chosen: the automatic round would talk every few seconds. */}
        <div className="grid min-w-0 gap-3 sm:grid-cols-2" aria-live={picked ? 'polite' : 'off'}>
          <div className="card p-4 sm:col-span-2">
            <p className="text-[12px] text-stone-500">{t('Ajouter un événement')}</p>
            <p className="mt-2 flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2.5 text-[14px]">
              <span className="text-stone-400">+</span> {ex.quick}
            </p>
          </div>
          <div className="card flex flex-col bg-tile-dark p-4 text-white">
            <p className="text-[12px] font-semibold text-white/65">{WORDS[usage].nextBig}</p>
            <p className="tabular mt-5 text-[44px] font-extrabold leading-none tracking-[-0.05em] text-urgent">{t('J-{n}', { n: ex.days })}</p>
            <p className="mt-1.5 text-[13px] font-semibold">{ex.big}</p>
          </div>
          <div className="card flex flex-col gap-3 p-4">
            <p className="flex items-center gap-1.5 text-[12px] text-stone-500">
              <Users size={13} aria-hidden /> {ex.group}
            </p>
            <div className="flex items-center gap-2.5">
              <FileIcon category="pdf" size={30} />
              <p className="min-w-0 text-[13px] leading-snug [overflow-wrap:anywhere]">{ex.file}</p>
            </div>
            <p className="mt-auto text-[12px] text-stone-500">{ex.files}</p>
          </div>
          <div className="card p-4 sm:col-span-2">
            <p className="flex items-center gap-1.5 text-[12px] text-stone-500">
              <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden /> {t('Enregistrer · {name}', { name: ex.rec })}
            </p>
            <p className="mt-2.5 flex flex-wrap gap-1.5 text-[12.5px]">
              {ex.docs.map(d => (
                <span key={d} className="rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-700">{d}</span>
              ))}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const TRUST = [
  { icon: Server, text: t('Tes données sont hébergées dans l’Union européenne (Irlande, Allemagne). Quand tu utilises le mode intelligent, ta question part chez Anthropic (Claude, États-Unis), qui ne s’en sert pas pour entraîner ses modèles.') },
  { icon: Lock, text: t('Tes fichiers sont protégés : transferts chiffrés (HTTPS), disques chiffrés sur les serveurs. Personne d’autre que toi ne peut les ouvrir, sauf les membres d’un groupe pour ce que tu y partages.') },
  { icon: ShieldCheck, text: t('Double authentification au choix : un code de ton téléphone en plus du mot de passe.') },
  { icon: Download, text: t('Ni publicité, ni revente de données. Exporte tout ou supprime ton compte en un clic.') },
] as const;

// One wording for the age everywhere (sign-up box, Google button, here): « 15 ans ou plus, ou l’accord d’un parent ».
const FAQ = [
  { q: t('C’est pour qui ?'), a: t('Pour tes études, ton travail ou ta famille : lycée, fac, salariés, indépendants, parents, assos. Pas de facturation, ni de prise de rendez-vous clients, ni d’offre équipe pour l’instant.') },
  { q: t('Faut-il télécharger une appli ?'), a: t('Non. Kompaly marche dans le navigateur, sur ordinateur et sur téléphone. Tu peux l’ajouter à ton écran d’accueil (iPhone : Partager › Sur l’écran d’accueil ; Android : Installer l’application) : il s’ouvre alors comme une appli, et l’essentiel marche hors connexion.') },
  { q: t('Combien d’espace j’ai ?'), a: t('1 Go pour tes fichiers, et jusqu’à 50 Mo par fichier. La jauge est en haut de tes fichiers.') },
  { q: t('C’est gratuit ?'), a: t('Oui, et sans publicité. Limites : un nombre de questions par jour à Kompaly en mode intelligent et quelques heures d’enregistrement par jour.') },
  { q: t('Ça marche avec Google Agenda ou mon emploi du temps ?'), a: t('Oui. Colle le lien .ics de ton école ou de ton agenda (Google Agenda, Outlook…) : il se met à jour tout seul. Tu peux aussi importer un fichier .ics, et exporter ton calendrier en .ics.') },
  {
    q: t('Je viens de Notion ou d’une autre appli : je peux importer ?'),
    a: t('Oui, en partie. Ton agenda : importe un fichier .ics ou colle son lien (Google Agenda, Outlook, Pronote, ton ENT…). Tes notes : exporte-les en Markdown (.md, comme le fait Notion), Word (.docx) ou texte (.txt), dépose-les dans Fichiers puis « Ouvrir comme note » ; ou colle simplement leur texte dans une note. Tes fichiers : glisse-les dans Fichiers. Pas encore d’import direct depuis un compte Notion.'),
  },
  {
    q: t('Les PDF scannés sont-ils lus ?'),
    a: t('Pas encore. La recherche et Kompaly lisent le texte des PDF créés sur ordinateur, des Word et des PowerPoint. Un PDF scanné n’est qu’une image : il est bien rangé et s’ouvre, mais les mots qu’il contient ne sont pas trouvés. Pour une page papier, utilise « Une fiche depuis une photo » : Kompaly la lit et en fait une fiche PDF où tout se retrouve.'),
  },
  { q: t('Je peux répéter un événement ou une tâche ?'), a: t('Oui : chaque jour, chaque semaine, chaque mois ou chaque année.') },
  { q: t('Comment je suis prévenu ?'), a: t('Par une notification sur ton téléphone et ton ordinateur, sans appli à installer. Sur iPhone, ajoute d’abord Kompaly à l’écran d’accueil.') },
  { q: t('Qui peut voir mes notes et mes fichiers ?'), a: t('Toi seul. Dans un groupe ou un agenda partagé, les membres voient seulement ce que tu y partages.') },
  {
    q: t('Je peux y ranger mes papiers d’identité ?'),
    a: t('Oui, tu peux ranger tes documents dans Fichiers : ils sont chiffrés pendant l’envoi et sur les serveurs, et toi seul y as accès. La fonction « fiche depuis une photo » n’est pas faite pour eux : elle sert à tes cours et à tes notes, et envoie la photo à une IA pour la lire.'),
  },
  { q: t('Que devient ce que je demande à Kompaly ?'), a: t('En mode intelligent, ta question est envoyée à Anthropic (Claude), qui ne s’en sert pas pour entraîner ses modèles. Le mode simple fonctionne sans rien envoyer.') },
  { q: t('Le son de mes enregistrements est-il gardé ?'), a: t('Non. Le son est envoyé par petits morceaux pour être écrit en texte, puis effacé : seuls le texte et les documents restent. Demande l’accord des personnes que tu enregistres.') },
  { q: t('J’ai un compte perso et un compte travail.'), a: t('Ajoute les deux sur ton appareil et passe de l’un à l’autre en un clic.') },
  {
    q: t('Moins de 15 ans, usage scolaire : comment ça marche ?'),
    a: t('Kompaly est ouvert dès 15 ans. Avant, il faut l’accord d’un parent : créez le compte ensemble, c’est le parent qui coche « J’ai 15 ans ou plus, ou l’accord d’un parent ». Pas de publicité, pas de revente de données ; un groupe ou un agenda partagé ne se rejoint qu’avec son lien ou son code. Pour une classe, chaque élève a son compte et l’enseignant partage le code d’un groupe. Pour supprimer le compte : Profil › Compte › « Supprimer définitivement mon compte » (tout est effacé aussitôt), ou un e-mail à {email}.', { email: CONTACT }),
  },
];

export default function LandingPage() {
  return (
    // The page scrolls itself: the app keeps <body> fixed (overflow hidden), so the wheel and the finger did nothing here.
    <div className="h-full overflow-y-auto overflow-x-clip scroll-pt-16 bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-transparent bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-3 px-5 sm:gap-6 md:px-8">
          <Link to="/" aria-label={t('Kompaly, accueil')} className="shrink-0">
            <Logo />
          </Link>
          <nav aria-label={t('Sur cette page')} className="hidden items-center gap-5 text-[13.5px] text-stone-600 xl:flex">
            <a href="#assistant" className="inline-flex h-9 items-center hover:text-ink">{t('Assistant IA')}</a>
            <a href="#fonctions" className="inline-flex h-9 items-center hover:text-ink">{t('Fonctions')}</a>
            <a href="#usages" className="inline-flex h-9 items-center hover:text-ink">{t('Usages')}</a>
            <a href="#confiance" className="inline-flex h-9 items-center hover:text-ink">{t('Vie privée')}</a>
            <a href="#questions" className="inline-flex h-9 items-center hover:text-ink">{t('Questions')}</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {/* Phones: the globe alone (its name is read out), « Se connecter » kept in the bar. */}
            <LanguagePicker className="h-9 sm:mr-1 max-sm:[&>span]:sr-only" />
            <Link to="/connexion" className="btn-secondary h-9 max-sm:px-3">
              {t('Se connecter')}
            </Link>
            <Link to="/inscription" className="btn-primary hidden h-9 sm:inline-flex">
              {t('Créer un compte')}
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-[1120px] grid-cols-[minmax(0,1fr)] items-center gap-10 px-5 pb-12 pt-8 md:px-8 md:pb-16 md:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-14">
          <div className="min-w-0">
            {/* The three lives first: nobody should think « this isn't for me ». */}
            <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-brand-600 max-[359px]:text-[12.5px]">
              <span className="flex shrink-0 max-[359px]:hidden" aria-hidden>
                {[GraduationCap, Briefcase, House].map((Icon, i) => (
                  <span key={i} className="-ml-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 ring-2 ring-paper first:ml-0">
                    <Icon size={13} strokeWidth={2} />
                  </span>
                ))}
              </span>
              {t('Pour tes études, ton travail ou ta famille')}
            </p>
            <h1 className="max-w-[20ch] text-balance text-[31px] font-extrabold leading-[1.04] tracking-[-0.03em] min-[375px]:text-[34px] sm:text-[44px] lg:text-[42px] xl:text-[50px]">
              {t('Ton agenda, tes notes et tes fichiers au même endroit, avec une IA qui range pour toi.')}
            </h1>
            <div className="mt-5 flex items-start gap-3">
              {/* Phones: Kompaly in the first screen (his demo comes lower there); wider screens have him beside, in the demo. */}
              <div className="-mt-1 shrink-0 sm:hidden" aria-hidden>
                <Character pose="open" look={{ x: 0.8, y: 0.2 }} mood="happy" size={64} />
              </div>
              <p className="min-w-0 max-w-[50ch] text-[16px] leading-relaxed text-stone-600 max-sm:text-[15px] sm:text-[16.5px]">
                {t('Écris «\u00a0Dentiste mardi 17h30\u00a0» ou enregistre un cours, une réunion\u00a0: Kompaly le range et te prévient sur ton téléphone.')}
              </p>
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/inscription" className="btn-primary h-11 px-5 text-[15px]">
                {t('Créer mon compte gratuit')}
              </Link>
              <Link to="/connexion" className="btn-secondary h-11 px-5 text-[15px]">
                {t('J’ai déjà un compte')}
              </Link>
            </div>
            <p className="mt-4 text-[13px] text-stone-500">{t('1 minute · sans appli à installer · sans pub')}</p>
          </div>
          <HeroDemo />
        </section>

        {/* The real app, right after the promise. */}
        <section aria-label={t('Kompaly en vrai')} className="mx-auto max-w-[1120px] px-5 pb-20 md:px-8">
          <figure>
            <picture>
              <source media="(max-width: 639px)" srcSet="/landing/accueil-telephone.webp" width={600} height={1298} />
              <img
                src="/landing/agenda-kompaly.webp"
                width={1600}
                height={1000}
                alt={t('Kompaly en vrai : l’agenda de la semaine (cours, judo, dîner, job) et Kompaly qui ajoute « Dentiste mardi 17h30 » ; sur téléphone, l’accueil avec le prochain rendez-vous et le partiel dans 12 jours.')}
                loading="lazy"
                decoding="async"
                className="mx-auto block h-auto w-full rounded-2xl border border-stone-200 bg-surface shadow-pop max-sm:max-w-[300px] max-sm:rounded-[26px]"
              />
            </picture>
            <figcaption className="mt-4 text-center text-[13px] text-stone-500">{t('Le vrai Kompaly, sur ordinateur et sur téléphone.')}</figcaption>
          </figure>
        </section>

        <div className="border-y border-stone-200 bg-surface">
          <Assistant />
        </div>

        {/* What it does */}
        <section id="fonctions" aria-labelledby="fonctions-title" className="mx-auto max-w-[1120px] px-5 py-20 md:px-8">
          <h2 id="fonctions-title" className="max-w-[22ch] text-[30px] font-extrabold leading-[1.05] tracking-[-0.025em] md:text-[36px]">
            {t('Ce que Kompaly fait pour toi.')}
          </h2>
          <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-stone-600">{t('Un rendez-vous ajouté apparaît sur ton accueil, chez Kompaly et dans ton groupe si tu le partages.')}</p>
          <ul className="mt-14 space-y-20">
            <Feature icon={Mic} title={t('Enregistre un cours ou une réunion, il devient une fiche')} text={t('Le texte s’écrit pendant que tu écoutes. À la fin : le cours rédigé, une fiche de révision et un examen d’entraînement ; pour une réunion, son compte rendu.')}>
              <Shot src="/landing/enregistrer.webp" width={1200} height={909} mobile={['/landing/enregistrer-telephone.webp', 600, 1185]} alt={t('L’enregistrement d’un cours de droit civil dans Kompaly : le texte écrit en direct, les mots-clés surlignés et les moments importants à droite.')} />
            </Feature>
            <Feature
              flip
              icon={Users}
              title={t('Partage un agenda avec ta famille, ton groupe ou ton asso')}
              text={t('Un lien pour un agenda partagé ; un code ou un lien pour un groupe, avec ses notes et ses fichiers.')}
            >
              <ShareSteps />
            </Feature>
            <Feature icon={Bell} title={t('Les rappels arrivent sur ton téléphone, sans appli à installer')} text={t('1 h avant, la veille ou quand tu veux. Ajoute Kompaly à ton écran d’accueil, et c’est lui qui te prévient.')}>
              <Shot phone src="/landing/rappels.webp" width={600} height={1054} alt={t('Un rendez-vous chez le dentiste dans Kompaly sur téléphone, avec deux rappels : 1 h avant et 1 jour avant.')} />
            </Feature>
            <Feature
              flip
              icon={FileSearch}
              title={t('Retrouve tout, même dans tes PDF')}
              text={t('La recherche lit l’intérieur de tes PDF, Word et PowerPoint. Tape trois mots, le bon fichier sort.')}
              extra={
                <p className="mt-5 text-[13.5px] leading-relaxed text-stone-500">
                  <strong className="font-semibold text-stone-700">{t('Et aussi :')}</strong>{' '}
                  {t('notes en dossiers avec export PDF, tâches du jour, tous tes fichiers rangés au même endroit, import de ton emploi du temps, mode sombre.')}
                </p>
              }
            >
              <Shot src="/landing/recherche.webp" width={1200} height={576} mobile={['/landing/recherche-telephone.webp', 600, 769]} alt={t('La recherche de Kompaly : « réticence dolosive » trouve le PDF du cours de droit civil qui en parle.')} />
            </Feature>
            <Feature
              icon={Timer}
              title={t('Un minuteur de concentration, et des badges')}
              text={t('Lance une session focus : 25 minutes de travail, 5 de pause, sur une matière ou un dossier. Tes sessions, tes tâches cochées et tes séries de jours te font gagner des badges.')}
            >
              <FocusBadges />
            </Feature>
          </ul>
        </section>

        <div className="border-t border-stone-200">
          <Usages />
        </div>

        {/* Privacy */}
        <section id="confiance" aria-labelledby="confiance-title" className="bg-ink text-paper">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-20 md:px-8 lg:grid-cols-[minmax(0,420px)_1fr]">
            <div className="min-w-0">
              <h2 id="confiance-title" className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.025em] md:text-[36px]">
                {t('Tes affaires restent les tiennes.')}
              </h2>
              {/* The privacy policy is in the footer (« Confidentialité »). */}
              <p className="mt-4 text-[15px] leading-relaxed text-paper/70">{t('Kompaly garde seulement le nécessaire.')}</p>
              {/* TODO(owner): personalise this short presentation (a sentence about you, why Kompaly) — keep it factual. */}
              <div className="mt-8 rounded-2xl border border-paper/15 p-5">
                <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                  <UserRound size={17} strokeWidth={1.8} className="text-paper/70" aria-hidden /> {t('Qui fait Kompaly ?')}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-paper/80">
                  {t('Kompaly est créé par Léo Boucher, un particulier en France. Pas d’investisseurs, pas de publicité : le service est gratuit. Une question ? Écris à {email}.', { email: CONTACT })}
                </p>
              </div>
            </div>
            <ul className="grid content-start gap-6 sm:grid-cols-2">
              {TRUST.map(item => (
                <li key={item.text} className="flex gap-3">
                  <item.icon size={19} strokeWidth={1.8} className="mt-0.5 shrink-0 text-paper/70" aria-hidden />
                  <p className="text-[14.5px] leading-relaxed">{item.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="questions" aria-labelledby="questions-title" className="mx-auto max-w-[760px] px-5 py-20 md:px-8">
          <h2 id="questions-title" className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.025em] md:text-[36px]">
            {t('Questions fréquentes')}
          </h2>
          <div className="mt-8 divide-y divide-stone-200 border-y border-stone-200">
            {FAQ.map(f => (
              <details key={f.q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center gap-4 py-4 text-[15.5px] font-medium [&::-webkit-details-marker]:hidden">
                  <span className="flex-1">{f.q}</span>
                  <span className="text-[20px] leading-none text-stone-400 transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="pb-5 pr-8 text-[14.5px] leading-relaxed text-stone-600">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Last call */}
        <section className="mx-auto max-w-[1120px] px-5 pb-24 md:px-8">
          <div className="flex flex-col items-start gap-6 rounded-3xl border border-stone-200 bg-surface p-7 sm:p-8 md:flex-row md:items-center md:p-12">
            <div className="min-w-0 flex-1">
              <h2 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em] md:text-[30px]">{t('Range tout au même endroit, dès aujourd’hui.')}</h2>
              <p className="mt-2 text-[15px] text-stone-600">{t('1 minute · sans appli à installer · sans pub')}</p>
            </div>
            <Link to="/inscription" className="btn-primary h-11 shrink-0 px-5 text-[15px]">
              {t('Créer mon compte gratuit')}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8 text-[13px] text-stone-500 md:px-8">
          <Logo />
          <nav aria-label={t('Informations légales')} className="flex flex-wrap gap-x-4 gap-y-2 pointer-coarse:gap-y-0">
            {LEGAL_LINKS.map(l => (
              <Link key={l.to} to={l.to} className="hover:text-ink pointer-coarse:py-2">
                {l.label}
              </Link>
            ))}
            <a href={`mailto:${CONTACT}`} className="hover:text-ink pointer-coarse:py-2">
              {CONTACT}
            </a>
            {SOCIAL_LINKS.map(l => (
              <a key={l.href} href={l.href} target="_blank" rel="me noopener noreferrer" className="hover:text-ink pointer-coarse:py-2">
                {l.label}
              </a>
            ))}
          </nav>
          <span className="sm:ml-auto">© 2026 Kompaly</span>
        </div>
      </footer>
    </div>
  );
}
