import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, Briefcase, CalendarDays, CornerDownLeft, Download, EllipsisVertical, FileSearch, FileText, Flame, GraduationCap, HeartPulse, House, Lock, Menu, Mic, Plus, Server, Share, ShieldCheck, Sparkles, Square, SquarePlus, Sunrise, Timer, UserRound, Users, X } from 'lucide-react';
import { DAILY_QUESTIONS, DAILY_RECORDING_HOURS } from '../lib/limits';
import Logo from '../components/Logo';
import LanguagePicker from '../components/LanguagePicker';
import FileIcon from '../components/FileIcon';
import Character, { DroneStill } from '../copilot/Character';
import { USAGES, WORDS, type Usage } from '../lib/usage';
import { LEGAL_LINKS } from './legal/links';
import { DEMO_KEY, dateOf, dayAfter, demoKept, demoMonday, demoPlace, exampleBase, keyOf, mondayOf, rowsFor, splitSentence, weekOf, weeksAhead, type DemoItem } from './landingDemo';
import { cx } from '../lib/utils';
import { t, tn } from '../i18n';

// Kompaly's own accounts; also listed in index.html (sameAs) for Google.
const SOCIAL_LINKS = [
  { label: 'Instagram', href: 'https://www.instagram.com/kompaly_app/' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/kompaly/' },
];

const CONTACT = 'contact@kompaly.com';

// The public home page (kompaly.com/ for someone not signed in): what Kompaly is, for search engines and newcomers.
// The pictures in public/landing/ are real captures of the app (light Classique look, a local test account).

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The demo week (landingDemo › demoMonday): the one source of the dates drawn on this page (the hero, Kompaly's answers). */
const DEMO_MONDAY = demoMonday(new Date());
const DEMO_DAYS = weekOf(DEMO_MONDAY);
const WEEK = { day: (i: number) => dateOf(DEMO_DAYS[i]).getDate() };

// The sentence is read by the app's own quick add (lib/dates), loaded when the visitor is about to try: not before.
let datesModule: Promise<typeof import('../lib/dates')> | undefined;
const loadDates = () => (datesModule ??= import('../lib/dates'));

/** One example per life, under the title: a tap writes it in the demo and adds it. */
const TRIES: { key: string; audience: Usage; icon: typeof Mic; label: string; text: string; color: string }[] = [
  { key: 'etudes', audience: 'etudes', icon: GraduationCap, label: t('Lycée, fac'), text: t('Réviser le partiel jeudi 18h'), color: '#3d6fd8' },
  { key: 'travail', audience: 'travail', icon: Briefcase, label: t('Travail'), text: t('Relancer M. Dupont vendredi 10h'), color: '#d48a17' },
  { key: 'famille', audience: 'perso', icon: House, label: t('Famille'), text: t('Judo de Léo mercredi 14h'), color: '#7a5ad6' },
  { key: 'sante', audience: 'perso', icon: HeartPulse, label: t('Santé'), text: t('Cardiologue jeudi 9h30'), color: '#d6457a' },
];
type Try = (typeof TRIES)[number];
const TYPED_COLOR = '#2f9e6b';

/**
 * The demo week's own examples, one per life (none of them a chip's, so a tap never doubles one). A night of work
 * on the ground, not only office hours: it shows on both days.
 */
const EXAMPLES: DemoItem[] = [
  { id: 1, kind: 'event', title: t('Garde de nuit'), date: DEMO_DAYS[0], start: '21:00', end: '07:00', nextDay: true, color: '#1f8a8a', example: true },
  { id: 2, kind: 'event', title: t('Cours d’anglais'), date: DEMO_DAYS[3], start: '08:30', color: '#3d6fd8', example: true },
  { id: 3, kind: 'event', title: t('Repas chez mamie'), date: DEMO_DAYS[6], start: '12:30', color: '#7a5ad6', example: true },
];

/** The big day of the dark tile: always the same (it never changes by itself while the visitor tries). */
const BIG_DAY = { title: t('Anniversaire de maman'), days: 12 };

/** Kept for the visitor's new account (store/welcome recreates it as their first event); nothing if storage is off. */
function keepForAccount(sentence: string) {
  try {
    localStorage.setItem(DEMO_KEY, demoKept(sentence, new Date()));
  } catch {
    /* private mode: nothing kept */
  }
}

interface Said {
  text: string;
  /** Something was added: the invitation to keep it. */
  added: boolean;
}

/** The demo's state, shared by the examples under the title and the demo itself. */
function useDemo() {
  const [text, setText] = useState('');
  const [items, setItems] = useState<DemoItem[]>(EXAMPLES);
  const [monday, setMonday] = useState(DEMO_MONDAY);
  const [weekName, setWeekName] = useState<string | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [audience, setAudience] = useState<Usage | null>(null);
  const next = useRef(10);

  const add = async (sentence: string, tried?: Try) => {
    if (!sentence.trim()) {
      setSaid({ text: t('Écris ce que tu veux noter, par exemple « Dentiste mardi 17h30 ».'), added: false });
      return;
    }
    const { parseQuickAdd, fmt, fromKey } = await loadDates();
    const now = new Date();
    const base = tried ? exampleBase(now) : now;
    // « Conduite 9h, repos 11h »: one item per hour, the day said once counting for all of them.
    const parts = splitSentence(sentence).map(s => ({ s, p: parseQuickAdd(s, base) }));
    const day = parts.find(x => x.p.date)?.p.date ?? null;
    const placed = parts.map(({ s, p }) => demoPlace({ ...p, date: p.date ?? (p.start ? day : null) }, keyOf(now), s));
    const ok = placed.flatMap(x => ('error' in x ? [] : [x]));
    if (!ok.length) {
      const why = placed.flatMap(x => ('error' in x ? [x.error] : []))[0];
      setSaid({
        text:
          why === 'impossible'
            ? t('Cette date n’existe pas : vérifie le jour.')
            : why === 'empty'
              ? t('Il me manque ce qu’il faut noter : par exemple « Dentiste mardi 17h30 ».')
              : t('Je range les rendez-vous et ce qui a un jour ou une heure. Essaie par exemple « Dentiste mardi 17h30 ».'),
        added: false,
      });
      return;
    }
    const added: DemoItem[] = ok.map(x => ({ ...x, id: next.current++, color: tried?.color ?? TYPED_COLOR }));
    setItems(list => [...list, ...added]);
    setText('');
    if (tried) setAudience(tried.audience);
    // Only what the visitor wrote themself goes to their account (not an example tapped).
    else keepForAccount(sentence);
    const first = added[0];
    if (first.date) {
      const m = mondayOf(first.date);
      const ahead = weeksAhead(m, now);
      setMonday(m);
      setWeekName(ahead === 0 || ahead === 1 ? null : t('Semaine du {day}', { day: fmt(fromKey(m), 'd MMMM') }));
    }
    const long = (key: string) => fmt(fromKey(key), 'EEEE d MMMM');
    const say = (item: DemoItem) =>
      item.kind === 'event'
        ? item.nextDay
          ? t('C’est noté : {title}, {day} de {start} au lendemain {end}.', { title: item.title, day: long(item.date!), start: item.start!, end: item.end! })
          : item.end
            ? t('C’est noté : {title}, {day} de {start} à {end}.', { title: item.title, day: long(item.date!), start: item.start!, end: item.end })
            : t('C’est noté : {title}, {day} à {time}.', { title: item.title, day: long(item.date!), time: item.start ?? '' })
        : item.date
          ? t('Ajouté à tes tâches : {title}, pour {day}.', { title: item.title, day: long(item.date) })
          : t('Ajouté à tes tâches : {title}.', { title: item.title });
    setSaid({
      text: added.length > 1 ? t('C’est noté, {n} rendez-vous : {list}.', { n: added.length, list: added.map(i => `${i.title} ${i.start ?? ''}`.trim()).join(', ') }) : say(first),
      added: true,
    });
  };

  const ahead = weeksAhead(monday, new Date());
  const weekLabel = weekName ?? (ahead <= 0 ? t('Cette semaine') : t('Semaine prochaine'));
  return { text, setText, items, monday, weekLabel, said, audience, add };
}
type Demo = ReturnType<typeof useDemo>;

/** Under the title: the three lives, one example each; a tap tries it in the demo (brought into view on phones). */
function TryChips({ demo }: { demo: Demo }) {
  const [busy, setBusy] = useState(false);
  const tryIt = (tried: Try) => {
    demo.setText(tried.text);
    setBusy(true);
    const box = document.getElementById('essai');
    const r = box?.getBoundingClientRect();
    if (box && r && (r.top < 64 || r.bottom > innerHeight)) box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: r.height > innerHeight - 80 ? 'start' : 'center' });
    // The sentence is seen in the field a moment, then it lands in the week.
    setTimeout(() => void demo.add(tried.text, tried).finally(() => setBusy(false)), reducedMotion() ? 0 : 450);
  };
  return (
    <div className="mt-6" onPointerEnter={() => void loadDates()} onFocus={() => void loadDates()} onTouchStart={() => void loadDates()}>
      <p className="text-[14px] font-medium text-stone-600">{t('Essaie avec un exemple :')}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {TRIES.map(x => (
          <li key={x.key} className="max-w-full">
            <button
              type="button"
              aria-disabled={busy}
              onClick={() => !busy && tryIt(x)}
              aria-label={t('Essayer : « {text} » ({who})', { text: x.text, who: x.label })}
              className="flex min-h-11 max-w-full items-center gap-2 rounded-[14px] border border-stone-200 bg-surface py-1.5 pl-1.5 pr-3 text-left text-[14px] leading-snug shadow-card transition-colors hover:border-stone-300 hover:bg-stone-50"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-white" style={{ background: x.color }} aria-hidden>
                <x.icon size={16} strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="font-semibold">{x.label}</span> <span className="text-stone-600">{x.text}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The hero's demo, for real: a sentence typed (or an example tapped) is read by the app's quick add and lands in a
 * little week, as an event (it has an hour) or a task; then Kompaly invites to keep it. Nothing is saved nor sent.
 * Its week mixes work, family and studies: nobody should read it as « not for me ».
 */
function HeroDemo({ demo }: { demo: Demo }) {
  const keys = weekOf(demo.monday);
  const today = keyOf(new Date());
  const rows = rowsFor(demo.items, demo.monday);
  const names = [t('Lun'), t('Mar'), t('Mer'), t('Jeu'), t('Ven'), t('Sam'), t('Dim')];
  const big = BIG_DAY;
  const short = (key: string) => `${names[(dateOf(key).getDay() + 6) % 7]} ${dateOf(key).getDate()}`;

  return (
    <div id="essai" className="relative min-w-0 scroll-mt-20">
      <div className="card overflow-hidden p-0 shadow-pop">
        {/* The app's quick add, for real */}
        <form
          className="flex items-center gap-2 border-b border-stone-200 p-3 max-[359px]:gap-1.5 max-[359px]:p-2.5"
          onSubmit={e => {
            e.preventDefault();
            void demo.add(demo.text);
          }}
        >
          <input
            value={demo.text}
            onChange={e => demo.setText(e.target.value)}
            onFocus={() => void loadDates()}
            onPointerEnter={() => void loadDates()}
            enterKeyHint="done"
            autoComplete="off"
            maxLength={120}
            aria-label={t('Écris une phrase pour essayer, par exemple « Dentiste mardi 17h30 »')}
            placeholder={t('Dentiste mardi 17h30')}
            className="h-11 min-w-0 flex-1 rounded-xl border border-stone-300 bg-surface px-3 text-[16px] max-[359px]:px-2.5 placeholder:text-stone-400 focus-visible:border-brand-500 focus-visible:outline-offset-0"
          />
          <button type="submit" className={cx('h-11 shrink-0 px-3.5 text-[14px] max-[359px]:px-3', demo.text.trim() ? 'btn-primary' : 'btn-secondary')}>
            {t('Ajouter')} <CornerDownLeft size={14} className="max-[359px]:hidden" aria-hidden />
          </button>
        </form>

        <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_150px]">
          <div className="min-w-0">
            <p className="mb-2 text-[12.5px] font-semibold text-stone-500" aria-hidden>
              {demo.weekLabel}
            </p>
            <div className="grid grid-cols-7 gap-1 text-center" aria-hidden>
              {keys.map((k, i) => {
                const now = k === today;
                // A night shows on its two days.
                const dots = demo.items.filter(x => x.date === k || (x.nextDay && x.date && dayAfter(x.date) === k)).slice(0, 3);
                return (
                  <div key={k} className={cx('min-w-0 rounded-xl py-1.5', now && 'bg-tile-blue text-white')}>
                    <p className={cx('text-[12px] leading-tight', now ? 'text-white/90' : 'text-stone-500')}>{names[i]}</p>
                    <p className="tabular text-[15px] font-semibold leading-snug">{dateOf(k).getDate()}</p>
                    <span className="mt-0.5 flex h-1.5 justify-center gap-0.5">
                      {dots.map(d => (
                        <span key={d.id} className="h-1.5 w-1.5 rounded-full" style={{ background: now ? '#fff' : d.color }} />
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
            <ul className="mt-3 space-y-1.5 text-[13.5px]" aria-label={demo.weekLabel}>
              {rows.map(x => (
                <li key={x.id} className={cx('flex min-h-9 items-center gap-2 rounded-lg bg-stone-50 px-2.5 py-1.5', !x.example && 'pop ring-1 ring-stone-200')}>
                  {x.kind === 'task' ? (
                    <Square size={14} strokeWidth={2.2} className="shrink-0" style={{ color: x.color }} aria-hidden />
                  ) : (
                    <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: x.color }} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">{x.title}</span>
                  <span className="shrink-0 text-right text-[12.5px] leading-tight text-stone-500">
                    {x.kind === 'task' ? (
                      <>
                        <span className="block font-semibold text-stone-600">{t('Tâche')}</span>
                        {x.date ? short(x.date) : t('sans date')}
                      </>
                    ) : (
                      <span className="tabular">
                        {short(x.date ?? today)} · {x.start}
                        {x.end && !x.nextDay && `\u2013${x.end}`}
                        {x.nextDay && x.end && (
                          <span className="block">
                            → {short(dayAfter(x.date ?? today))} · {x.end}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </li>
              ))}
              {rows.every(x => x.example) && (
                <li className="flex min-h-9 items-center gap-2 rounded-lg border border-dashed border-stone-300 px-2.5 py-1.5 text-[13px] text-stone-500" aria-hidden>
                  <Plus size={14} className="shrink-0" /> {t('Ta phrase arrive ici')}
                </li>
              )}
            </ul>
          </div>
          <div className="flex flex-col rounded-2xl bg-tile-dark p-3.5 text-white max-sm:flex-row max-sm:items-center max-sm:gap-3" role="img" aria-label={t('Prochain grand jour : {title}, dans {n} jours', { title: big.title, n: big.days })}>
            <p className="text-[12.5px] font-semibold text-white/70 max-sm:order-2 max-sm:min-w-0 max-sm:flex-1" aria-hidden>
              {t('Prochain grand jour')}
              <span className="mt-0.5 block text-[13px] text-white sm:hidden">{big.title}</span>
            </p>
            <p className="tabular mt-auto pt-4 text-[40px] font-extrabold leading-none tracking-[-0.05em] text-urgent max-sm:order-1 max-sm:pt-0 max-sm:text-[30px]" aria-hidden>
              {/* In words (« J-13 » wasn't understood): the number big, « jours » beside it. */}
              {big.days}
              <span className="ml-1 text-[0.45em] font-bold tracking-normal">{tn(big.days, 'jour', 'jours')}</span>
            </p>
            <p className="mt-1 text-[13px] font-semibold leading-snug max-sm:hidden" aria-hidden>
              {big.title}
            </p>
          </div>
        </div>
      </div>

      {/* Kompaly under the window (never over it): what he did, then the invitation to keep it. */}
      <div className="mt-3 flex items-end justify-end gap-3.5">
        <div key={demo.said?.text ?? 'hello'} className="pop mb-6 min-w-0 max-w-[19rem] rounded-2xl rounded-br-sm border border-stone-200 bg-surface px-3.5 py-2.5 text-[15px] leading-snug shadow-pop" role="status">
          {demo.said ? demo.said.text : t('Écris une phrase ou touche un exemple : je la range dans ta semaine.')}
          {demo.said?.added && (
            <span className="mt-2 block">
              {t('Crée ton compte pour le garder.')}
              <Link to="/inscription" className="btn-primary mt-2 flex h-11 w-fit px-4 text-[15px]">
                {t('Créer mon compte gratuit')} <ArrowRight size={15} aria-hidden />
              </Link>
            </span>
          )}
          <span className="mt-2 block text-[15px] text-stone-600">{t('Démo : rien n’est enregistré ni envoyé.')}</span>
        </div>
        <div className="shrink-0" aria-hidden>
          <Character pose="open" look={{ x: -0.9, y: -0.3 }} mood={demo.said?.added ? 'happy' : 'idle'} size={76} />
        </div>
      </div>
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

/**
 * « Partage un agenda » : the three steps, as they happen. Opening a shared calendar needs an account (its link is
 * kept through sign-up: App › RequireAuth), and a member sees that calendar only, never the others of the person.
 */
function ShareSteps() {
  const steps = [
    { n: 1, title: t('Crée l’agenda'), text: t('« Famille », « Coloc », « Asso du quartier »…') },
    { n: 2, title: t('Envoie le lien'), text: t('Par SMS, WhatsApp ou e-mail.') },
    { n: 3, title: t('L’autre ouvre le lien et crée son compte gratuit'), text: t('En une minute. Chacun ajoute ses événements, les autres sont prévenus.') },
  ];
  return (
    <div className="card space-y-4 p-5 sm:p-6">
      <ol className="space-y-4">
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
      </ol>
      <p className="flex gap-3 rounded-2xl bg-brand-50 p-3.5 text-[14px] leading-snug">
        <Lock size={17} strokeWidth={1.9} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
        <span className="min-w-0">
          <strong className="font-semibold">{t('L’autre voit seulement cet agenda, jamais ton agenda perso.')}</strong> {t('Ni tes notes, ni tes fichiers.')}
        </span>
      </p>
      <p className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4 text-[13px]">
        {[
          { c: '#7a5ad6', l: t('Judo de Léo · mer. 14h') },
          { c: '#2f9e6b', l: t('Repas chez mamie · dim. 12h30') },
          { c: '#d48a17', l: t('Réunion de l’asso · jeu. 20h') },
        ].map(e => (
          <span key={e.l} className="flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-700">
            <span className="h-2 w-2 rounded-full" style={{ background: e.c }} aria-hidden /> {e.l}
          </span>
        ))}
      </p>
    </div>
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
    <div className="card space-y-4 p-5 sm:p-6" role="img" aria-label={t('Exemple : le minuteur de concentration (25 minutes) en cours, et trois récompenses gagnées : Première session, Semaine pleine, Lève-tôt.')}>
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

/**
 * « Sans appli à installer » : how the reminders reach a phone, step by step (the app says the same: Profil ›
 * Notifications, ReminderPicker). Android first on an Android phone.
 */
function InstallSteps() {
  const [os, setOs] = useState<'iphone' | 'android'>(() => (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent) ? 'android' : 'iphone'));
  const steps =
    os === 'iphone'
      ? [
          { icon: Share, text: t('Dans Safari, touche Partager (le carré avec une flèche).') },
          { icon: SquarePlus, text: t('Choisis « Sur l’écran d’accueil » : l’icône de Kompaly apparaît.') },
          { icon: Bell, text: t('Ouvre Kompaly depuis cette icône, puis autorise les notifications.') },
        ]
      : [
          { icon: EllipsisVertical, text: t('Dans Chrome, touche ⋮ en haut à droite.') },
          { icon: SquarePlus, text: t('Choisis « Installer l’application » : ça ajoute seulement une icône, rien à télécharger sur un store.') },
          { icon: Bell, text: t('Ouvre Kompaly depuis cette icône, puis autorise les notifications.') },
        ];
  return (
    <div className="mt-6 max-w-[30rem] rounded-2xl border border-stone-200 bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-[14px] font-semibold">{t('En 3 gestes, une seule fois')}</p>
        <div className="seg text-[13px]" role="group" aria-label={t('Ton téléphone')}>
          <button type="button" className="seg-item h-8 px-3 font-semibold" aria-pressed={os === 'iphone'} onClick={() => setOs('iphone')}>
            iPhone
          </button>
          <button type="button" className="seg-item h-8 px-3 font-semibold" aria-pressed={os === 'android'} onClick={() => setOs('android')}>
            Android
          </button>
        </div>
      </div>
      <ol className="mt-4 space-y-3" aria-live="polite">
        {steps.map((s, i) => (
          <li key={s.text} className="flex items-start gap-3">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-ink" aria-hidden>
              <s.icon size={19} strokeWidth={1.9} />
              <span className="tabular absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-tile-blue text-[12px] font-bold text-white">{i + 1}</span>
            </span>
            <span className="min-w-0 pt-2 text-[14px] leading-snug">{s.text}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 border-t border-stone-200 pt-3 text-[13px] leading-snug text-stone-500">{t('Sur ordinateur, rien à installer : autorise les notifications dans Profil › Notifications.')}</p>
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
          {/* The two modes, said plainly. Nothing to choose: Kompaly goes simple by itself (copilot/claudeBrain). */}
          <ul className="mt-6 space-y-3 text-[14.5px] leading-relaxed">
            <li className="flex gap-3">
              <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden />
              <span>
                <strong className="font-semibold">{t('Mode intelligent :')}</strong>{' '}
                {t('il comprend tout ce que tu écris, par exemple « résume mon cours de droit en 5 points », et lit tes documents quand tu le lui demandes. Il passe par une IA (détails dans Vie privée) : {n} questions par jour.', { n: DAILY_QUESTIONS })}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-stone-400" aria-hidden />
              <span>
                <strong className="font-semibold">{t('Mode simple :')}</strong>{' '}
                {t('sans IA, rien ne sort de Kompaly. Il comprend les phrases courantes : « dentiste mardi 17h30 », « qu’est-ce que j’ai demain ? ».')}
              </span>
            </li>
          </ul>
          <p className="mt-4 max-w-[60ch] rounded-2xl bg-stone-100 px-4 py-3 text-[14px] leading-relaxed text-stone-600">
            {t('Tu n’as rien à choisir : Kompaly est en mode intelligent tant que l’IA répond et qu’il te reste des questions du jour, sinon il passe tout seul en mode simple. L’enregistrement de cours est à part : son texte est toujours écrit par une IA, avec une limite de {hours} h par jour.', { hours: DAILY_RECORDING_HOURS })}
          </p>
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

/** The members drawn on the « Groupes » / « Équipes » card (initials on their colour). */
const MEMBERS = [
  { l: 'L', c: '#3d6fd8' },
  { l: 'S', c: '#d48a17' },
  { l: 'K', c: '#2f9e6b' },
];

/** Words of the « Usages » cards on this page (the app's own words are in lib/usage: no « devis » here). */
const USAGE_EXAMPLES: Record<Usage, { hint: string; quick: string; big: string; days: number; group: string; meet: string; note: string; file: string; rec: string; docs: string[] }> = {
  etudes: {
    hint: t('Lycée ou fac : cours, bac, partiels, révisions en groupe'),
    quick: t('Réviser le partiel jeudi 18h'),
    big: t('Partiel de droit civil'),
    days: 12,
    group: t('Groupe de TD'),
    file: t('Cours de droit civil — chapitre 3.pdf'),
    meet: t('Révisions en groupe · mar. 18h'),
    note: t('Fiche du chapitre 3, partagée'),
    rec: t('Droit civil, amphi B'),
    docs: [t('Cours rédigé'), t('Fiche de révision'), t('Examen d’entraînement')],
  },
  travail: {
    hint: t('Réunions, échéances, comptes rendus, projets d’équipe'),
    quick: t('Réunion client jeudi 10h'),
    big: t('Rendu de la maquette'),
    days: 3,
    group: t('Équipe du projet'),
    file: t('Planning du projet.pdf'),
    meet: t('Réunion d’équipe · jeu. 10h'),
    note: t('Compte rendu du lundi, partagé'),
    rec: t('Point projet du lundi'),
    docs: [t('Compte rendu'), t('Résumé')],
  },
  perso: {
    hint: t('Activités des enfants, agenda de famille, papiers, asso'),
    quick: t('Judo de Léo mercredi 14h'),
    big: t('Renouveler les passeports'),
    days: 9,
    group: t('Asso du quartier'),
    file: t('Assurance scolaire de Léo.pdf'),
    meet: t('Réunion de l’asso · jeu. 20h'),
    note: t('Liste des bénévoles, partagée'),
    rec: t('Réunion de l’asso du quartier'),
    docs: [t('Texte rédigé'), t('Résumé')],
  },
};

/**
 * Studies, work or family: the same app, its words follow the person (lib/usage). The three go round on their own
 * (none looks like the only one) until the visitor picks one, or tries one of the hero's examples (`chosen`: shown
 * from the start then, the page gives it a new key).
 */
function Usages({ chosen }: { chosen: Usage | null }) {
  const [usage, setUsage] = useState<Usage>(chosen ?? 'etudes');
  const [picked, setPicked] = useState(!!chosen);
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
    <section ref={ref} id="usages" aria-labelledby="usages-title" className="cv-auto mx-auto max-w-[1120px] px-5 py-20 md:px-8" onPointerDown={() => setPicked(true)} onFocus={() => setPicked(true)}>
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
            <p className="tabular mt-5 text-[44px] font-extrabold leading-none tracking-[-0.05em] text-urgent">
              {ex.days}
              <span className="ml-1 text-[0.45em] font-bold tracking-normal">{tn(ex.days, 'jour', 'jours')}</span>
            </p>
            <p className="mt-1.5 text-[13.5px] font-semibold">{ex.big}</p>
          </div>
          {/* The shared space as it looks in the app: « Équipes » for work (lib/usage), « Groupes » otherwise. */}
          <div className="card flex flex-col gap-2.5 p-4">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-stone-500">
              <Users size={13} aria-hidden /> {WORDS[usage].groups}
            </p>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex shrink-0" aria-hidden>
                {MEMBERS.map((m, i) => (
                  <span key={m.l} className={cx('flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold text-white ring-2 ring-surface', i > 0 && '-ml-2')} style={{ background: m.c }}>
                    {m.l}
                  </span>
                ))}
              </span>
              <p className="min-w-0 text-[14px] font-semibold leading-snug [overflow-wrap:anywhere]">{ex.group}</p>
            </div>
            <p className="flex items-center gap-2 text-[13px] leading-snug">
              <CalendarDays size={14} className="shrink-0 text-stone-500" aria-hidden /> <span className="min-w-0">{ex.meet}</span>
            </p>
            <p className="flex items-center gap-2 text-[13px] leading-snug">
              <FileText size={14} className="shrink-0 text-stone-500" aria-hidden /> <span className="min-w-0">{ex.note}</span>
            </p>
            <div className="mt-auto flex items-center gap-2.5 border-t border-stone-100 pt-2.5">
              <FileIcon category="pdf" size={26} />
              <p className="min-w-0 text-[13px] leading-snug [overflow-wrap:anywhere]">{ex.file}</p>
            </div>
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
  { icon: Server, text: t('Tes données sont hébergées dans l’Union européenne (Irlande, Allemagne). Seul ce que tu demandes à une IA en sort, vers les États-Unis : ta question en mode intelligent (jamais utilisée pour entraîner l’IA), le son d’un enregistrement pour l’écrire en texte, puis effacé, et la photo d’une fiche pour la lire. Le nom de chaque service est dans la politique de confidentialité.') },
  { icon: Lock, text: t('Tes fichiers sont protégés : transferts chiffrés (HTTPS), disques chiffrés sur les serveurs. Ils ne sont ouverts que par ton compte, et par les membres d’un groupe pour ce que tu y partages. Kompaly ne lit un fichier que pour répondre à une de tes demandes.') },
  { icon: ShieldCheck, text: t('Une sécurité en plus, si tu veux : à la connexion, un code affiché par ton téléphone en plus du mot de passe (la « double authentification »).') },
  { icon: Download, text: t('Ni publicité, ni revente de données. Exporte tout ou supprime ton compte en un clic.') },
] as const;

// One wording for the age everywhere (sign-up box, Google button, here): « 15 ans ou plus, ou l’accord d’un parent ».
const FAQ = [
  { q: t('C’est pour qui ?'), a: t('Pour tes études, ton travail ou ta famille : lycée, fac, salariés, indépendants, parents, assos. Groupes et équipes inclus, gratuitement. Kompaly ne fait pas de devis ni de factures, ni de prise de rendez-vous par des clients.') },
  {
    q: t('Faut-il télécharger une appli ?'),
    a: t('Non, rien à télécharger sur l’App Store ou le Play Store : Kompaly marche dans le navigateur, sur ordinateur et sur téléphone. Pour l’avoir comme une appli, ajoute-le à ton écran d’accueil. Sur iPhone : dans Safari, Partager › « Sur l’écran d’accueil ». Sur Android : dans Chrome, ⋮ › « Installer l’application » (ça ajoute seulement une icône). Il s’ouvre alors en plein écran, et l’essentiel marche hors connexion.'),
  },
  { q: t('Combien d’espace j’ai ?'), a: t('1 Go pour tes fichiers, et jusqu’à 50 Mo par fichier. La jauge est en haut de tes fichiers.') },
  { q: t('C’est gratuit ?'), a: t('Oui, sans publicité ni carte bancaire. Limites par jour : {questions} questions à Kompaly en mode intelligent et {hours} h d’enregistrement de cours ; 1 Go pour tes fichiers. Tout est sur la page Tarifs.', { questions: DAILY_QUESTIONS, hours: DAILY_RECORDING_HOURS }) },
  {
    q: t('Ça marche avec Google Agenda ou mon emploi du temps ?'),
    a: t('Oui, dans un sens. Colle le lien d’abonnement de ton agenda (Google Agenda, Outlook, ton ENT, Pronote… c’est un lien en .ics) : ses événements s’affichent dans Kompaly et se mettent à jour tout seuls, toutes les 3 heures environ. Change-les dans l’agenda d’origine ; dans Kompaly, tu peux y ajouter tes rappels. Dans l’autre sens, Kompaly exporte ton calendrier dans un fichier, à importer dans Google Agenda ou Outlook : c’est une copie, elle ne se met pas à jour.'),
  },
  {
    q: t('Je viens de Notion ou d’une autre appli : je peux importer ?'),
    a: t('Oui, en partie. Ton agenda : importe un fichier .ics ou colle son lien d’abonnement (Google Agenda, Outlook, Pronote, ton ENT…). Tes notes : exporte-les en Markdown (.md, comme le fait Notion), Word (.docx) ou texte (.txt), dépose-les dans Fichiers puis « Ouvrir comme note » ; ou colle simplement leur texte dans une note. Tes fichiers : glisse-les dans Fichiers. Pas encore d’import direct depuis un compte Notion.'),
  },
  {
    q: t('Les PDF scannés sont-ils lus ?'),
    a: t('Pas encore. La recherche et Kompaly lisent le texte des PDF créés sur ordinateur, des Word et des PowerPoint. Un PDF scanné n’est qu’une image : il est bien rangé et s’ouvre, mais les mots qu’il contient ne sont pas trouvés. Pour une page papier, utilise « Une fiche depuis une photo » : Kompaly la lit et en fait une fiche PDF où tout se retrouve.'),
  },
  { q: t('Je peux répéter un événement ou une tâche ?'), a: t('Oui : chaque jour, chaque semaine, chaque mois ou chaque année.') },
  {
    q: t('Comment je suis prévenu ?'),
    a: t('Par une notification sur ton téléphone et ton ordinateur, sans passer par l’App Store. Sur iPhone : dans Safari, Partager › « Sur l’écran d’accueil », ouvre Kompaly depuis sa nouvelle icône, puis autorise les notifications. Sur Android et sur ordinateur : autorise simplement les notifications dans Profil › Notifications (sur Android, tu peux aussi ajouter son icône : Chrome › ⋮ › « Installer l’application »). Tu choisis quand : 1 h avant, la veille…'),
  },
  { q: t('Qui peut voir mes notes et mes fichiers ?'), a: t('Toi seul. Dans un groupe ou un agenda partagé, les membres voient seulement ce que tu y partages.') },
  {
    q: t('Je peux y ranger mes papiers d’identité ?'),
    a: t('Oui, tu peux ranger tes documents dans Fichiers : ils sont chiffrés pendant l’envoi et sur les serveurs, et toi seul y as accès. La fonction « fiche depuis une photo » n’est pas faite pour eux : elle sert à tes cours et à tes notes, et envoie la photo à une IA pour la lire.'),
  },
  { q: t('Que devient ce que je demande à Kompaly ?'), a: t('En mode intelligent, ta question est envoyée à une IA, qui ne s’en sert pas pour entraîner ses modèles. Le son d’un enregistrement est envoyé à une IA pour être écrit en texte, puis effacé ; la photo d’une fiche, pour être lue. Le mode simple fonctionne sans rien envoyer. Le nom de chaque service est dans la politique de confidentialité.') },
  { q: t('Le son de mes enregistrements est-il gardé ?'), a: t('Non. Le son est envoyé par petits morceaux pour être écrit en texte, puis effacé : seuls le texte et les documents restent. Demande l’accord des personnes que tu enregistres.') },
  { q: t('J’ai un compte perso et un compte travail.'), a: t('Ajoute les deux sur ton appareil et passe de l’un à l’autre en un clic.') },
  {
    q: t('Moins de 15 ans, usage scolaire : comment ça marche ?'),
    a: t('Kompaly est ouvert dès 15 ans. Avant, il faut l’accord d’un parent : créez le compte ensemble, c’est le parent qui coche « J’ai 15 ans ou plus, ou l’accord d’un parent ». Pas de publicité, pas de revente de données ; un groupe ou un agenda partagé ne se rejoint qu’avec son lien ou son code. Pour une classe, chaque élève a son compte et l’enseignant partage le code d’un groupe. Pour supprimer le compte : Profil › Compte › « Supprimer définitivement mon compte » (tout est effacé aussitôt), ou un e-mail à {email}.', { email: CONTACT }),
  },
];

const SECTIONS = [
  { href: '#assistant', label: t('Assistant IA') },
  { href: '#fonctions', label: t('Fonctions') },
  { href: '#usages', label: t('Usages') },
  { href: '#confiance', label: t('Vie privée') },
  { href: '#questions', label: t('Questions') },
];

/** Under 1280 px, where the bar has no room for the links: a ☰ button and a panel with them, the prices and sign-up. */
function LandingMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      box.current?.querySelector('button')?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  const row = 'flex h-12 items-center rounded-xl px-3 text-[15px] font-medium hover:bg-stone-100';
  return (
    <div ref={box} className="xl:hidden">
      <button type="button" className="icon-btn h-10 w-10" aria-expanded={open} aria-controls="menu-accueil" aria-label={open ? t('Fermer le menu') : t('Menu')} onClick={() => setOpen(o => !o)}>
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      {open && (
        <nav id="menu-accueil" aria-label={t('Menu')} className="enter absolute inset-x-3 top-[60px] z-40 rounded-[22px] border border-stone-200 bg-surface p-2 shadow-pop sm:left-auto sm:right-5 sm:w-[300px]">
          {SECTIONS.map(s => (
            <a key={s.href} href={s.href} onClick={close} className={row}>
              {s.label}
            </a>
          ))}
          <Link to="/tarifs" onClick={close} className={row}>
            {t('Tarifs')}
          </Link>
          <Link to="/a-propos" onClick={close} className={row}>
            {t('À propos')}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-stone-100 px-1 pt-3 pb-1">
            <Link to="/inscription" onClick={close} className="btn-primary h-11 flex-1 px-4 text-[15px]">
              {t('Créer mon compte gratuit')}
            </Link>
            <LanguagePicker className="h-11 sm:hidden" />
          </div>
        </nav>
      )}
    </div>
  );
}

export default function LandingPage() {
  const demo = useDemo();
  return (
    // The page scrolls itself: the app keeps <body> fixed (overflow hidden), so the wheel and the finger did nothing here.
    <div className="h-full overflow-y-auto overflow-x-clip scroll-pt-16 bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-transparent bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/90">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-3 px-5 sm:gap-6 md:px-8">
          <Link to="/" aria-label={t('Kompaly, accueil')} className="flex h-11 shrink-0 items-center rounded-xl">
            <Logo />
          </Link>
          <nav aria-label={t('Sur cette page')} className="hidden items-center gap-5 text-[13.5px] text-stone-600 xl:flex">
            {SECTIONS.map(s => (
              <a key={s.href} href={s.href} className="inline-flex h-9 items-center hover:text-ink">
                {s.label}
              </a>
            ))}
            <Link to="/tarifs" className="inline-flex h-9 items-center hover:text-ink">
              {t('Tarifs')}
            </Link>
            <Link to="/a-propos" className="inline-flex h-9 items-center hover:text-ink">
              {t('À propos')}
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {/* Phones: the language goes in the menu, « Se connecter » stays in the bar. */}
            <LanguagePicker className="h-9 max-sm:hidden sm:mr-1" />
            <Link to="/connexion" className="btn-secondary h-9 max-sm:px-3">
              {t('Se connecter')}
            </Link>
            <Link to="/inscription" className="btn-primary hidden h-9 sm:inline-flex">
              {t('Créer un compte')}
            </Link>
            <LandingMenu />
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-[1120px] grid-cols-[minmax(0,1fr)] items-center gap-10 px-5 pb-12 pt-6 md:px-8 md:pb-16 md:pt-14 short:pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-14">
          {/* The buttons right under the promise, the examples after them: « Créer mon compte gratuit » is whole in the first screen (iPhone 13, laptop). */}
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
            <h1 className="max-w-[20ch] text-balance text-[27px] font-extrabold leading-[1.06] tracking-[-0.03em] min-[375px]:text-[29px] sm:text-[44px] short:text-[32px] lg:text-[42px] xl:text-[50px]">
              {t('Ton agenda, tes notes et tes fichiers au même endroit, avec une IA qui range pour toi.')}
            </h1>
            <div className="mt-4 flex items-start gap-3 sm:mt-5">
              {/* Phones: Kompaly in the first screen (his demo comes lower there); wider screens have him beside, in the demo. */}
              <div className="-mt-1 shrink-0 sm:hidden" aria-hidden>
                <Character pose="open" look={{ x: 0.8, y: 0.2 }} mood="happy" size={56} />
              </div>
              <p className="min-w-0 max-w-[50ch] text-[16px] leading-relaxed text-stone-600 max-sm:text-[15px] max-sm:leading-snug sm:text-[16.5px]">
                {t('Écris-le en une phrase ou enregistre un cours, une réunion : Kompaly le range et te prévient sur ton téléphone.')}
                {/* Test n°3: a retiree, a night nurse, a school head didn't see themselves in « études ». */}
                <span className="mt-1.5 block text-stone-700">{t('Pour les cours, les gardes de nuit, les rendez-vous médicaux ou l’agenda des enfants.')}</span>
              </p>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 sm:mt-7">
              <Link to="/inscription" className="btn-primary h-12 px-5 text-[16px]">
                {t('Créer mon compte gratuit')}
              </Link>
              <Link to="/connexion" className="btn-secondary h-12 px-5 text-[15px]">
                {t('J’ai déjà un compte')}
              </Link>
            </div>
            {/* What reassures, readable by everyone (15 px, dark enough): free for good, what it is for, what it is not. */}
            <p className="mt-4 text-[15px] leading-snug text-stone-700">{t('1 minute · sans appli à installer · sans pub')}</p>
            <p className="mt-1.5 text-[15px] leading-snug text-stone-700">
              {t('Gratuit, rien ne te sera facturé · usage perso, groupes et équipes inclus · pas de devis ni de factures, ni prise de rendez-vous par des clients, ni gestion RH.')}{' '}
              <Link to="/tarifs" className="whitespace-nowrap font-semibold text-ink underline decoration-stone-400 underline-offset-2 hover:decoration-ink pointer-coarse:py-3">
                {t('Voir les limites')}
              </Link>
            </p>
            <TryChips demo={demo} />
          </div>
          <HeroDemo demo={demo} />
        </section>

        {/* The real app, right after the promise. */}
        <section aria-label={t('Kompaly en vrai')} className="mx-auto max-w-[1120px] px-5 pb-20 md:px-8">
          <figure>
            <picture>
              <source media="(max-width: 639px)" srcSet="/landing/accueil-telephone.webp" width={600} height={1290} />
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

        {/* cv-auto (index.css): the sections below the first screen are laid out and drawn only when they come near. */}
        <div className="cv-auto border-y border-stone-200 bg-surface">
          <Assistant />
        </div>

        {/* What it does */}
        <section id="fonctions" aria-labelledby="fonctions-title" className="cv-auto mx-auto max-w-[1120px] px-5 py-20 md:px-8">
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
            <Feature
              icon={Bell}
              title={t('Les rappels arrivent sur ton téléphone, sans appli à installer')}
              text={t('1 h avant, la veille ou quand tu veux. Sans passer par l’App Store : ajoute Kompaly à ton écran d’accueil, c’est lui qui te prévient.')}
              extra={<InstallSteps />}
            >
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
              title={t('Un minuteur de concentration, et des récompenses')}
              text={t('Lance le minuteur : 25 minutes de travail, 5 de pause, sur une matière ou un dossier. Chaque séance terminée, chaque tâche cochée, chaque jour où tu reviens te fait gagner des badges, de petites récompenses à collectionner.')}
            >
              <FocusBadges />
            </Feature>
          </ul>
        </section>

        <div className="border-t border-stone-200">
          <Usages key={demo.audience ?? 'auto'} chosen={demo.audience} />
        </div>

        {/* Privacy */}
        <section id="confiance" aria-labelledby="confiance-title" className="cv-auto bg-ink text-paper">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-20 md:px-8 lg:grid-cols-[minmax(0,420px)_1fr]">
            <div className="min-w-0">
              <h2 id="confiance-title" className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.025em] md:text-[36px]">
                {t('Tes affaires restent les tiennes.')}
              </h2>
              {/* The privacy policy is in the footer (« Confidentialité »). */}
              <p className="mt-4 text-[15px] leading-relaxed text-paper/70">{t('Kompaly garde seulement le nécessaire.')}</p>
              <div className="mt-8 rounded-2xl border border-paper/15 p-5">
                <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                  <UserRound size={17} strokeWidth={1.8} className="text-paper/70" aria-hidden /> {t('Qui fait Kompaly ?')}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-paper/80">
                  {t('Kompaly est créé par Léo Boucher, un particulier en France. Pas d’investisseurs, pas de publicité : le service est gratuit. Une question ? Écris à {email}.', { email: CONTACT })}
                </p>
                <Link to="/a-propos" className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-[14px] font-semibold text-paper underline decoration-paper/40 underline-offset-4 hover:decoration-paper">
                  {t('Lire son histoire')} <ArrowRight size={15} aria-hidden />
                </Link>
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
        <section id="questions" aria-labelledby="questions-title" className="cv-auto mx-auto max-w-[760px] px-5 py-20 md:px-8">
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
        <section className="cv-auto mx-auto max-w-[1120px] px-5 pb-24 md:px-8">
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

      <footer className="cv-auto border-t border-stone-200">
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
