import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CalendarDays, CornerDownLeft, Download, Flag, FolderClosed, ListChecks, Lock, NotebookText, Server, ShieldCheck, Users } from 'lucide-react';
import Logo from '../components/Logo';
import FileIcon from '../components/FileIcon';
import Character from '../copilot/Character';
import { USAGES, WORDS, type Usage } from '../lib/usage';
import { LEGAL_LINKS } from './legal/links';
import { cx } from '../lib/utils';

// The public home page (kompaly.com/ for someone not signed in): what Kompaly is, for search engines and newcomers.

const PHRASE = 'Présentation client jeudi 14h important';
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The one animated moment of the page: a sentence typed in the quick add becomes an event, then Kompaly speaks up. */
function HeroDemo() {
  // 0 → typing, 1 → added, 2 → Kompaly's bubble.
  const [typed, setTyped] = useState(() => (reducedMotion() ? PHRASE.length : 0));
  const [step, setStep] = useState(() => (reducedMotion() ? 2 : 0));

  useEffect(() => {
    if (step !== 0) return;
    if (typed < PHRASE.length) {
      const t = setTimeout(() => setTyped(n => n + 1), typed === 0 ? 900 : 55);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep(1), 650);
    return () => clearTimeout(t);
  }, [typed, step]);
  useEffect(() => {
    if (step !== 1) return;
    const t = setTimeout(() => setStep(2), 1100);
    return () => clearTimeout(t);
  }, [step]);

  const replay = () => {
    setTyped(0);
    setStep(0);
  };
  const days = [
    { d: 'Lun', n: 13 },
    { d: 'Mar', n: 14, today: true },
    { d: 'Mer', n: 15, dot: '#3b6fd8' },
    { d: 'Jeu', n: 16, dot: step >= 1 ? '#d9483b' : undefined },
    { d: 'Ven', n: 17, dot: '#d48a17' },
  ];

  return (
    <div className="relative" aria-label="Exemple : une phrase tapée devient un événement" role="img">
      <div className="card overflow-hidden p-0 shadow-pop" aria-hidden>
        {/* Quick add */}
        <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-3">
          <span className="text-stone-400">+</span>
          <span className="min-w-0 flex-1 truncate text-[14px]">
            {step === 0 ? (
              <>
                {PHRASE.slice(0, typed)}
                <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-ink" />
              </>
            ) : (
              <span className="text-stone-500">Ajouter un événement…</span>
            )}
          </span>
          <span className={cx('flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors', step === 0 && typed === PHRASE.length ? 'bg-ink text-paper' : 'text-stone-500')}>
            Ajouter <CornerDownLeft size={11} />
          </span>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-[1fr_150px]">
          <div>
            <div className="grid grid-cols-5 gap-1.5 text-center">
              {days.map(x => (
                <div key={x.n} className={x.today ? 'rounded-xl bg-tile-blue py-1.5 text-white' : 'py-1.5'}>
                  <p className={x.today ? 'text-[10px] text-white/90' : 'text-[10px] text-stone-500'}>{x.d}</p>
                  <p className="tabular text-[14px] font-semibold">{x.n}</p>
                  <span className="mx-auto mt-1 block h-1 w-1 rounded-full transition-colors" style={{ background: x.dot ?? 'transparent' }} />
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1.5 text-[12.5px]">
              <div className="flex items-center gap-2 rounded-md bg-stone-50 px-2.5 py-2">
                <span className="h-3.5 w-0.5 rounded-full bg-[#3b6fd8]" /> Point d’équipe <span className="ml-auto tabular text-stone-500">Mer. 09:30</span>
              </div>
              {step >= 1 && (
                <div className="pop flex items-center gap-2 rounded-md bg-stone-50 px-2.5 py-2 ring-1 ring-stone-200">
                  <span className="h-3.5 w-0.5 rounded-full bg-[#d9483b]" />
                  <Flag size={11} className="fill-amber-500 text-amber-500" />
                  Présentation client <span className="ml-auto tabular text-stone-500">Jeu. 14:00</span>
                </div>
              )}
              <div className="flex items-center gap-2 rounded-md bg-stone-50 px-2.5 py-2">
                <span className="h-3.5 w-0.5 rounded-full bg-[#d48a17]" /> Envoyer le devis <span className="ml-auto tabular text-stone-500">Ven. 18:00</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col rounded-2xl bg-tile-dark p-3.5 text-white">
            <p className="text-[11.5px] font-semibold text-white/65">Prochaine échéance</p>
            <p className="tabular mt-auto pt-4 text-[40px] font-extrabold leading-none tracking-[-0.05em] text-urgent">{step >= 1 ? 'J-2' : 'J-3'}</p>
            <p className="mt-1.5 truncate text-[12px] font-semibold">{step >= 1 ? 'Présentation client' : 'Envoyer le devis'}</p>
          </div>
        </div>
      </div>

      {/* Kompaly leans out from the edge, under the window (never over it); the room is kept so nothing jumps. */}
      <div className="mt-3 flex items-start justify-between gap-3">
        {step === 2 && !reducedMotion() ? (
          <button type="button" onClick={replay} className="mt-1 shrink-0 text-[12px] text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-ink">
            Revoir l’exemple
          </button>
        ) : (
          <span />
        )}
        <div className="-mr-5 flex items-end gap-1 sm:-mr-12" aria-hidden>
          <div className={cx('mb-7 w-48 rounded-2xl rounded-br-sm border border-stone-200 bg-surface px-3 py-2 text-[12.5px] leading-snug shadow-pop sm:w-56', step === 2 ? 'pop' : 'invisible')}>
            Présentation dans 2&nbsp;jours. On bloque une heure demain pour la préparer&nbsp;?
          </div>
          <Character pose={step === 2 ? 'peek' : 'hidden'} look={{ x: -0.9, y: -0.3 }} mood={step === 2 ? 'happy' : 'idle'} size={92} />
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: CalendarDays, title: 'Calendrier', text: 'Écris « Dentiste mardi 17h30 » : l’événement se range tout seul. Marque ce qui est important, filtre par catégorie, importe ton agenda existant (.ics).' },
  { icon: ListChecks, title: 'Tâches', text: 'La liste du jour, des sessions de concentration chronométrées et des badges pour garder le rythme.' },
  { icon: NotebookText, title: 'Notes', text: 'Des notes rangées en dossiers, des modèles prêts à remplir, l’export en PDF.' },
  { icon: FolderClosed, title: 'Drive', text: 'Tes fichiers au même endroit, une recherche qui lit jusque dans les PDF, un lien pour partager.' },
  { icon: Users, title: 'Groupes', text: 'Notes, fichiers et rendez-vous partagés avec un simple code d’invitation. Chacun indique s’il vient.' },
  { icon: Bot, title: 'Kompaly', text: 'Demande-lui d’ajouter un rendez-vous, de retrouver un fichier ou de préparer un planning. Il te prévient avant les grands jours.' },
] as const;

const USAGE_EXAMPLES: Record<Usage, { big: string; days: string; file: string; ext: 'pdf' | 'image' | 'doc' }> = {
  etudes: { big: 'Partiel de droit', days: 'J-5', file: 'Cours de droit civil — chapitre 3.pdf', ext: 'pdf' },
  travail: { big: 'Rendu de la maquette', days: 'J-3', file: 'Devis — Rénovation cuisine.pdf', ext: 'pdf' },
  perso: { big: 'Départ à Biarritz', days: 'J-12', file: 'Billets de train.pdf', ext: 'pdf' },
};

/** Studies, work or personal life: the same app, its words follow the person (lib/usage). */
function Usages() {
  const [usage, setUsage] = useState<Usage>('etudes');
  const w = WORDS[usage];
  const ex = USAGE_EXAMPLES[usage];
  return (
    <section id="usages" aria-labelledby="usages-title" className="mx-auto max-w-[1120px] px-5 py-20 md:px-8">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div>
          <h2 id="usages-title" className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.035em] md:text-[36px]">
            Pour tes études, ton travail ou ta vie perso.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-stone-600">
            Tu choisis à quoi te sert Kompaly en créant ton compte. L’appli adapte ses mots et ses exemples, et Kompaly ses conseils.
          </p>
          <div className="mt-6 inline-flex rounded-xl bg-stone-100 p-1" role="radiogroup" aria-label="Kompaly sert pour">
            {USAGES.map(u => (
              <button
                key={u.key}
                type="button"
                role="radio"
                aria-checked={usage === u.key}
                onClick={() => setUsage(u.key)}
                className={cx('h-9 rounded-lg px-3.5 text-[13.5px] font-semibold transition-colors', usage === u.key ? 'bg-surface text-ink shadow-card' : 'text-stone-500 hover:text-ink')}
              >
                {u.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-stone-500">{USAGES.find(u => u.key === usage)?.hint}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2" aria-live="polite">
          <div className="card p-4 sm:col-span-2">
            <p className="text-[12px] text-stone-500">Ajouter un événement</p>
            <p className="mt-2 flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2.5 text-[14px]">
              <span className="text-stone-400">+</span> {w.quickExample}
            </p>
          </div>
          <div className="card flex flex-col bg-tile-dark p-4 text-white">
            <p className="text-[12px] font-semibold text-white/65">{w.nextBig}</p>
            <p className="tabular mt-5 text-[44px] font-extrabold leading-none tracking-[-0.05em] text-urgent">{ex.days}</p>
            <p className="mt-1.5 text-[13px] font-semibold">{ex.big}</p>
          </div>
          <div className="card flex flex-col gap-3 p-4">
            <p className="text-[12px] text-stone-500">{w.groups}</p>
            <div className="flex items-center gap-2.5">
              <FileIcon category={ex.ext} size={30} />
              <p className="min-w-0 text-[13px] leading-snug">{ex.file}</p>
            </div>
            <p className="mt-auto text-[12px] text-stone-500">{w.sharedFiles}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

const TRUST = [
  { icon: ShieldCheck, text: 'Double authentification pour chaque compte : un code de ton téléphone en plus du mot de passe.' },
  { icon: Server, text: 'Tes données sont hébergées dans l’Union européenne, en Irlande et en Allemagne.' },
  { icon: Lock, text: 'Ni publicité, ni revente de données, ni pistage publicitaire.' },
  { icon: Download, text: 'Tu exportes tout ou tu supprimes ton compte quand tu veux, en un clic.' },
] as const;

const FAQ = [
  { q: 'C’est gratuit ?', a: 'Oui. Les limites actuelles : 50 Mo par fichier, 1 Go d’espace, et un nombre de questions par jour à Kompaly en mode intelligent.' },
  { q: 'Ça marche sur téléphone ?', a: 'Oui. Ouvre kompaly.com et installe l’appli sur ton écran d’accueil (iPhone : Partager, puis Sur l’écran d’accueil ; Android : Installer l’application). Tout se synchronise entre tes appareils, et l’essentiel marche même hors connexion.' },
  { q: 'Qui peut voir mes notes et mes fichiers ?', a: 'Toi seul. Dans un groupe, les membres voient seulement ce que tu y partages.' },
  { q: 'Que devient ce que je demande à Kompaly ?', a: 'En mode intelligent, ta question est envoyée à notre fournisseur d’IA, qui ne la conserve pas. Le mode simple fonctionne sans rien envoyer.' },
  { q: 'J’ai un compte perso et un compte travail.', a: 'Ajoute les deux sur ton appareil : tu passes de l’un à l’autre en un clic, sans retaper tes identifiants.' },
  { q: 'À partir de quel âge ?', a: 'Dès 15 ans. Avant, il faut l’accord d’un parent.' },
] as const;

export default function LandingPage() {
  return (
    // The page scrolls itself: the app keeps <body> fixed (overflow hidden), so the wheel and the finger did nothing here.
    <div className="h-full overflow-y-auto overflow-x-clip scroll-pt-16 bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-transparent bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-6 px-5 md:px-8">
          <Link to="/" aria-label="Kompaly, accueil" className="shrink-0">
            <Logo />
          </Link>
          <nav aria-label="Sur cette page" className="hidden items-center gap-5 text-[13.5px] text-stone-600 md:flex">
            <a href="#fonctions" className="inline-flex h-9 items-center hover:text-ink">Fonctions</a>
            <a href="#usages" className="inline-flex h-9 items-center hover:text-ink">Usages</a>
            <a href="#confiance" className="inline-flex h-9 items-center hover:text-ink">Vie privée</a>
            <a href="#questions" className="inline-flex h-9 items-center hover:text-ink">Questions</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/connexion" className="btn-secondary h-9">
              Se connecter
            </Link>
            <Link to="/inscription" className="btn-primary hidden h-9 sm:inline-flex">
              Créer un compte
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-[1120px] items-center gap-14 px-5 pb-24 pt-10 md:px-8 md:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
          <div>
            <h1 className="max-w-[13ch] text-[42px] font-extrabold leading-[1.0] tracking-[-0.045em] md:text-[60px]">Ton agenda, tes notes et tes fichiers, enfin au même endroit.</h1>
            <p className="mt-6 max-w-[46ch] text-[16.5px] leading-relaxed text-stone-600">
              Kompaly réunit calendrier, tâches, notes et fichiers dans une seule appli, pour les études, le travail ou la vie perso. Et Kompaly, ton ami, te rappelle ce qui compte.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/inscription" className="btn-primary h-11 px-5 text-[15px]">
                Créer mon compte
              </Link>
              <Link to="/connexion" className="btn-secondary h-11 px-5 text-[15px]">
                J’ai déjà un compte
              </Link>
            </div>
            <p className="mt-4 text-[13px] text-stone-500">Gratuit, sur ordinateur et sur téléphone.</p>
          </div>
          <HeroDemo />
        </section>

        {/* Features */}
        <section id="fonctions" aria-labelledby="fonctions-title" className="border-y border-stone-200 bg-surface">
          <div className="mx-auto grid max-w-[1120px] gap-12 px-5 py-20 md:px-8 lg:grid-cols-[minmax(0,360px)_1fr]">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <h2 id="fonctions-title" className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.035em] md:text-[36px]">
                Six outils qui se parlent.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-stone-600">Un rendez-vous ajouté dans le calendrier apparaît sur ton accueil, Kompaly le voit, et ton groupe aussi si tu le partages.</p>
            </div>
            <ul className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
              {FEATURES.map(f => (
                <li key={f.title}>
                  <f.icon size={20} strokeWidth={1.8} className="text-brand-600" aria-hidden />
                  <h3 className="mt-3 text-[16px] font-semibold tracking-[-0.01em]">{f.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-stone-600">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <Usages />

        {/* Privacy */}
        <section id="confiance" aria-labelledby="confiance-title" className="bg-ink text-paper">
          <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-20 md:px-8 lg:grid-cols-[minmax(0,420px)_1fr]">
            <div>
              <h2 id="confiance-title" className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.035em] md:text-[36px]">
                Tes affaires restent les tiennes.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-paper/70">
                Kompaly garde seulement ce qu’il faut pour faire marcher ton espace. Tout est expliqué, sans jargon, dans la{' '}
                <Link to="/confidentialite" className="underline decoration-paper/40 underline-offset-4 hover:decoration-paper">
                  politique de confidentialité
                </Link>
                .
              </p>
            </div>
            <ul className="grid gap-6 sm:grid-cols-2">
              {TRUST.map(t => (
                <li key={t.text} className="flex gap-3">
                  <t.icon size={19} strokeWidth={1.8} className="mt-0.5 shrink-0 text-paper/70" aria-hidden />
                  <p className="text-[14.5px] leading-relaxed">{t.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="questions" aria-labelledby="questions-title" className="mx-auto max-w-[760px] px-5 py-20 md:px-8">
          <h2 id="questions-title" className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.035em] md:text-[36px]">
            Questions fréquentes
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
          <div className="flex flex-col items-start gap-6 rounded-3xl border border-stone-200 bg-surface p-8 md:flex-row md:items-center md:p-12">
            <div className="flex-1">
              <h2 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em] md:text-[30px]">Range tout au même endroit, dès aujourd’hui.</h2>
              <p className="mt-2 text-[15px] text-stone-600">Une minute pour créer ton compte, et Kompaly te fait faire le tour.</p>
            </div>
            <Link to="/inscription" className="btn-primary h-11 shrink-0 px-5 text-[15px]">
              Créer mon compte
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8 text-[13px] text-stone-500 md:px-8">
          <Logo />
          <nav aria-label="Informations légales" className="flex flex-wrap gap-x-4 gap-y-2">
            {LEGAL_LINKS.map(l => (
              <Link key={l.to} to={l.to} className="hover:text-ink">
                {l.label}
              </Link>
            ))}
            <a href="mailto:contact@kompaly.com" className="hover:text-ink">
              contact@kompaly.com
            </a>
          </nav>
          <span className="sm:ml-auto">© 2026 Kompaly</span>
        </div>
      </footer>
    </div>
  );
}
