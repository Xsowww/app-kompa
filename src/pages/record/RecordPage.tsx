import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BookOpenCheck, Check, ClipboardList, FileText, FolderOpen, Loader2, Mic, MonitorSpeaker, RotateCcw, Square, Star, Trash2 } from 'lucide-react';
import { useSettings } from '../../store/settings';
import { useDrive, pathOf } from '../../store/drive';
import { confirmAction } from '../../store/ui';
import {
  completeDocuments,
  elapsed,
  finishRecording,
  makeLater,
  openInDrive,
  recordingElsewhere,
  resumeListening,
  star,
  startRecording,
  useRecLive,
  useRecorder,
  type Make,
  type Past,
  type Session,
} from '../../store/recorder';
import { canShareTab, canUseMic, type SourceKind } from '../../lib/recorder/capture';
import { canHearLive } from '../../lib/recorder/live';
import { serverState } from '../../lib/recorder/api';
import { clock, courseMarkdown, duration } from '../../lib/recorder/course';
import { normalize } from '../../lib/keywords';
import { canNotify } from '../../lib/notify';
import { cx } from '../../lib/utils';
import { Toggle } from '../profile/controls';
import MoveDialog from '../drive/MoveDialog';
import KeywordsEditor from './KeywordsEditor';
import Transcript, { Alerts } from './Transcript';

const MAKE_LABEL: Record<Make, string> = { fiche: 'Fiche de révision', examen: 'Examen d’entraînement' };

/** Ticks every second while `on`. */
function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

export default function RecordPage() {
  const session = useRecorder(s => s.session);
  const usage = useSettings(s => s.usage);
  const what = usage === 'travail' ? 'réunion' : 'cours';
  return (
    <div className="h-full overflow-y-auto px-4 pb-12 md:px-8">
      <div className="mx-auto max-w-[1180px]">
        <h1 className="pb-1 pt-2 text-[24px] font-semibold tracking-[-0.02em]">Enregistrer {what === 'cours' ? 'un cours' : 'une réunion'}</h1>
        <p className="pb-6 text-[13.5px] text-stone-500">
          Kompaly écoute, écrit tout en direct, te prévient quand un mot important est prononcé, puis range {what === 'cours' ? 'le cours rédigé' : 'le compte rendu'} dans ton Drive.
        </p>
        {!session ? <Setup /> : session.phase === 'done' ? <Done s={session} /> : <Running s={session} />}
        {(!session || session.phase === 'done') && <History />}
      </div>
    </div>
  );
}

// ── Before ──────────────────────────────────────────────────────────────────

function Setup() {
  const items = useDrive(s => s.items);
  const history = useRecorder(s => s.history);
  const remembered = useRecorder(s => s.folders);
  const make = useSettings(s => s.courseMake);
  const phone = useSettings(s => s.coursePhone);
  const silence = useSettings(s => s.courseSilenceMinutes);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState<SourceKind>(canUseMic() ? 'micro' : 'onglet');
  // Where the documents go: a folder chosen, or one at the class's name (made at the end) inside it.
  const [folder, setFolder] = useState<{ id: string | null; own: boolean; chosen: boolean }>({ id: null, own: true, chosen: false });
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const error = useRecLive(st => st.startError);
  const setError = (startError: string) => useRecLive.setState({ startError });
  const [server, setServer] = useState<{ transcription: boolean; redaction: boolean } | null>(null);
  useEffect(() => {
    serverState().then(setServer, () => setServer(null));
  }, []);

  // A class recorded before under that name: its folder again (unless one was picked here).
  const known = remembered[normalize(title)];
  const target = folder.chosen || known === undefined ? folder : { id: known, own: false, chosen: false };
  const folderPath = (id: string | null) => ['Mon Drive', ...pathOf(items, id).map(i => i.name)].join(' / ');
  const titles = useMemo(() => [...new Set(history.map(h => h.title))].slice(0, 30), [history]);
  const noLive = source === 'micro' && !canHearLive();

  const start = async () => {
    setError('');
    setBusy(true);
    try {
      const name = title.trim() || 'Cours';
      await startRecording({ title: name, source, folderId: target.id, ...(target.own && { newFolder: name }), make });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'L’enregistrement n’a pas pu démarrer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <section className="card space-y-6 p-5 sm:p-6" aria-label="Nouvel enregistrement">
        <div>
          <label htmlFor="cours-titre" className="eyebrow">Nom du cours</label>
          <input id="cours-titre" className="field mt-1.5 h-11 w-full text-[15px]" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex. Droit des contrats" list="cours-titres" maxLength={100} autoComplete="off" />
          <datalist id="cours-titres">{titles.map(t => <option key={t} value={t} />)}</datalist>
        </div>

        <div>
          <p className="eyebrow">Écouter</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Source du son">
            {([
              { key: 'micro', icon: Mic, label: 'Le micro', hint: 'Un cours en salle, ou tout ce que ton appareil entend.', ok: canUseMic() },
              { key: 'onglet', icon: MonitorSpeaker, label: 'Le son de l’ordinateur', hint: MAC ? 'Un onglet de ce navigateur : Teams, Zoom, Meet, YouTube… en version web. Même avec des écouteurs.' : 'Un onglet de ce navigateur (Teams, Zoom, Meet web…), ou tout l’ordinateur pour une appli. Même avec des écouteurs.', ok: canShareTab() },
            ] as const).map(o => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={source === o.key}
                disabled={!o.ok}
                onClick={() => setSource(o.key)}
                className={cx('flex gap-3 rounded-2xl p-3.5 text-left ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-50', source === o.key ? 'bg-ink text-paper ring-ink' : 'bg-surface ring-stone-200 hover:ring-stone-300')}
              >
                <o.icon size={20} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  <span className="block text-[14px] font-semibold">{o.label}</span>
                  <span className={cx('mt-0.5 block text-[12.5px] leading-snug', source === o.key ? 'text-paper/75' : 'text-stone-500')}>{o.ok ? o.hint : o.key === 'onglet' ? 'Seulement sur ordinateur, dans Chrome ou Edge.' : 'Pas de micro accessible ici.'}</span>
                </span>
              </button>
            ))}
          </div>
          {source === 'onglet' && <ShareHelp />}
          {noLive && <p className="mt-2 text-[12.5px] leading-relaxed text-stone-500">Ce navigateur n’affiche pas les mots à l’instant où ils sont dits : le texte arrive par blocs, environ 20 secondes après.</p>}
        </div>

        <div>
          <p className="eyebrow">Ranger dans le Drive</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl bg-stone-50 px-3.5 py-3">
            <FolderOpen size={18} className="shrink-0" style={{ color: "#3b6fd8" }} aria-hidden />
            <span className="min-w-0 flex-1 text-[13.5px]">
              <span className="font-medium">{folderPath(target.id)}{target.own && ` / ${title.trim() || 'Cours'}`}</span>
              {target.own && <span className="text-stone-500"> (dossier créé s’il n’existe pas)</span>}
            </span>
            <button type="button" className="btn-secondary h-8 text-[12.5px]" onClick={() => setPicking(true)}>Changer</button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-[13px] text-stone-600">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-ink)]" checked={target.own} onChange={e => setFolder({ id: target.id, own: e.target.checked, chosen: true })} />
            Dans un dossier au nom du cours
          </label>
          {picking && (
            <MoveDialog
              ids={[]}
              title="Où ranger le cours ?"
              confirm="Choisir ce dossier"
              initial={target.id}
              onClose={() => setPicking(false)}
              onMove={id => {
                setFolder({ id, own: target.own, chosen: true });
                setPicking(false);
              }}
            />
          )}
        </div>

        <div>
          <p className="eyebrow">À la fin, créer</p>
          <ul className="mt-2 space-y-2">
            <li className="flex items-center gap-2.5 text-[14px]">
              <input type="checkbox" checked disabled className="h-4 w-4 accent-[var(--color-ink)]" aria-label="Le cours rédigé (toujours)" />
              <FileText size={16} className="text-stone-500" aria-hidden /> Le cours rédigé <span className="text-[12.5px] text-stone-500">· titre, parties, l’essentiel à retenir</span>
            </li>
            {(['fiche', 'examen'] as Make[]).map(k => (
              <li key={k}>
                <label className="flex items-center gap-2.5 text-[14px]">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--color-ink)]" checked={make[k]} onChange={e => useSettings.getState().set({ courseMake: { ...make, [k]: e.target.checked } })} />
                  {k === 'fiche' ? <ClipboardList size={16} className="text-stone-500" aria-hidden /> : <BookOpenCheck size={16} className="text-stone-500" aria-hidden />}
                  {k === 'fiche' ? 'Une fiche de révision' : 'Un examen d’entraînement'} <span className="text-[12.5px] text-stone-500">{k === 'examen' ? '· avec corrigé' : '· une à deux pages'}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-stone-500">Oublié de cocher ? Tu pourras les créer plus tard, depuis la liste ci-dessous ou le Drive.</p>
        </div>

        {server && !server.transcription && (
          <p className="flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            La transcription n’est pas activée sur le serveur : {source === 'micro' && canHearLive() ? 'seul le navigateur écrira le texte (moins précis).' : 'le texte ne pourra pas être écrit.'}
          </p>
        )}
        {error && (
          <p role="alert" className="flex gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary h-11 px-5 text-[15px]" disabled={busy} onClick={() => void start()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden />} Démarrer l’enregistrement
          </button>
          <p className="text-[12px] leading-relaxed text-stone-500">Demande l’accord de la personne enregistrée. Le son sert seulement à écrire le texte : Kompaly ne le garde pas.</p>
        </div>
      </section>

      <aside className="card space-y-6 p-5 sm:p-6" aria-label="Mots-clés et alertes">
        <div>
          <h2 className="text-[15px] font-semibold">Mots-clés à surveiller</h2>
          <p className="mb-3 mt-0.5 text-[12.5px] text-stone-500">Surlignés dans le texte, et une notification s’ils sont prononcés.</p>
          <KeywordsEditor />
        </div>
        <div className="space-y-3 border-t border-stone-100 pt-5">
          <div className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">Aussi sur mon téléphone</span>
              <span className="block text-[12px] text-stone-500">
                Si les notifications Kompaly y sont activées (
                <Link to="/profil?onglet=notifications" className="underline underline-offset-2">Profil › Notifications</Link>).
              </span>
            </span>
            <Toggle checked={phone} onChange={v => useSettings.getState().set({ coursePhone: v })} label="Alertes aussi sur mon téléphone" />
          </div>
          {!canNotify() && <p className="text-[12px] text-stone-500">Sur cet appareil, les alertes s’affichent dans la page. Pour les recevoir même onglet caché, active les notifications dans Profil › Notifications.</p>}
          <label className="flex items-center gap-3 text-[13.5px]">
            <span className="min-w-0 flex-1 font-medium">Me prévenir si personne ne parle pendant</span>
            <select className="field h-8 w-auto py-0 text-[13px]" value={silence} onChange={e => useSettings.getState().set({ courseSilenceMinutes: Number(e.target.value) })}>
              {[1, 2, 3, 5, 10].map(m => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
        </div>
      </aside>
    </div>
  );
}

const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent) && !/iPhone|iPad/.test(navigator.userAgent);

/** What to pick in the browser's share window: a site can't see the other browsers or apps, the browser shows its own list. */
function ShareHelp() {
  const step = (n: number, title: string, text: string) => (
    <li className="flex gap-2.5">
      <span className="tabular mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-paper">{n}</span>
      <span>
        <span className="font-semibold text-ink">{title}</span> {text}
      </span>
    </li>
  );
  return (
    <div className="mt-3 rounded-2xl bg-stone-50 p-3.5 text-[12.5px] leading-relaxed text-stone-600">
      <p className="mb-2">Au démarrage, ton navigateur ouvre sa fenêtre de partage. Elle ne montre que ses propres onglets : un site ne peut pas voir les autres navigateurs ni les applis, c’est une protection du navigateur.</p>
      <ol className="space-y-1.5">
        {step(1, 'Cours dans un onglet', '(Teams, Zoom ou Meet web, YouTube…) : onglet « Onglet Chrome », choisis-le et laisse cochée « Partager aussi l’audio de l’onglet ».')}
        {MAC
          ? step(2, 'Cours dans une appli ou un autre navigateur :', 'sur Mac, son son ne peut pas être capté par un site. Ouvre plutôt la version web dans Chrome ou Edge, ou choisis « Le micro ».')
          : step(2, 'Cours dans une appli ou un autre navigateur :', 'onglet « Écran entier », choisis l’écran et coche « Partager aussi l’audio du système ». Kompaly entend alors tout l’ordinateur (coupe la musique à côté).')}
      </ol>
      <p className="mt-2">Une « Fenêtre » seule ne transmet pas son son.</p>
    </div>
  );
}

// ── During ──────────────────────────────────────────────────────────────────

function Running({ s }: { s: Session }) {
  const live = useRecLive();
  const finishing = s.phase === 'finishing';
  useTick(!finishing);
  const elsewhere = !live.hearing && recordingElsewhere();
  const [busy, setBusy] = useState(false);
  // What the browser heard after the last passage written by the server, then what it is hearing now.
  const lastEnd = s.segments.at(-1)?.end ?? 0;
  const liveText = finishing ? '' : [...s.live.filter(l => l.time > lastEnd + 1).map(l => l.text), live.interim].filter(Boolean).join(' ');

  // « M » marks a moment (outside text fields), as ⌘E did in the Mac app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'm' || e.ctrlKey || e.metaKey || e.altKey || el.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      star();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const finish = async () => {
    if (!(await confirmAction('Terminer l’enregistrement ?', 'Kompaly finit d’écrire les dernières phrases, rédige le cours et le range dans ton Drive.', 'Terminer', false))) return;
    void finishRecording().catch(() => undefined);
  };
  const resume = async () => {
    setBusy(true);
    try {
      await resumeListening();
    } catch (e) {
      useRecLive.setState({ problem: e instanceof Error ? e.message : 'L’écoute n’a pas pu reprendre.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
      <section className="card p-5 sm:p-6" aria-label="Transcription">
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-100 pb-4">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <span className={cx('h-2.5 w-2.5 rounded-full', live.hearing ? 'animate-pulse bg-red-500' : 'bg-stone-400')} aria-hidden />
            {finishing ? 'Terminé' : live.hearing ? 'Enregistrement' : 'En pause'}
            <span className="tabular text-[15px] font-semibold">{clock(elapsed(s))}</span>
          </span>
          <span className="min-w-0 truncate text-[14px] font-semibold text-stone-700" title={s.title}>· {s.title}</span>
          {live.hearing && <Level value={live.level} />}
          {!finishing && (
            <span className="ml-auto flex gap-2">
              <button type="button" className="btn-secondary h-9" onClick={star} disabled={!live.hearing} title="Marque ce qui vient d’être dit (touche M)">
                <Star size={15} className="fill-amber-400 text-amber-500" /> Moment important
              </button>
              <button type="button" className="btn-primary h-9" onClick={() => void finish()}>
                <Square size={13} className="fill-current" /> Terminer
              </button>
            </span>
          )}
        </div>

        {finishing && !live.step ? (
          <Banner tone="warn">
            <span className="min-w-0 flex-1">La création des documents s’est interrompue (page fermée ou rechargée). Rien n’est perdu.</span>
            <button type="button" className="btn-secondary h-8 bg-surface text-[12.5px]" onClick={() => void completeDocuments().catch(() => undefined)}>
              <RotateCcw size={13} /> Reprendre
            </button>
          </Banner>
        ) : finishing ? (
          <Progress step={live.step} progress={live.progress} waiting={live.waiting} />
        ) : elsewhere ? (
          <Banner tone="info">Cet enregistrement tourne dans un autre onglet de ce navigateur.</Banner>
        ) : !live.hearing ? (
          <Banner tone="warn">
            <span className="min-w-0 flex-1">{live.problem ?? 'L’écoute s’est arrêtée (page fermée ou rechargée).'} Ce qui a été écrit est gardé.</span>
            <button type="button" className="btn-secondary h-8 bg-surface text-[12.5px]" disabled={busy} onClick={() => void resume()}>
              <RotateCcw size={13} /> Reprendre l’écoute
            </button>
          </Banner>
        ) : live.problem ? (
          <Banner tone="warn">{live.problem}</Banner>
        ) : null}

        <Status s={s} />
        <Transcript
          segments={s.segments}
          keywords={s.keywords}
          liveText={liveText}
          follow
          empty={live.hearing ? (live.quickLane ? 'J’écoute… le texte apparaît dès que quelqu’un parle.' : 'J’écoute… le texte arrive par blocs, environ 20 secondes après.') : 'Rien d’écrit pour l’instant.'}
        />
      </section>
      <aside className="card p-5 sm:p-6 lg:sticky lg:top-2" aria-label="Moments signalés">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
          Alertes {s.alerts.length > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[11.5px] font-semibold text-amber-900">{s.alerts.length}</span>}
        </h2>
        <Alerts alerts={s.alerts} segments={s.segments} />
        {!finishing && <p className="mt-4 border-t border-stone-100 pt-3 text-[12px] leading-relaxed text-stone-500">Le bouton « Moment important » (ou la touche M) marque ce que le prof vient de dire : il sera mis en valeur dans le cours rédigé.</p>}
      </aside>
    </div>
  );
}

function Level({ value }: { value: number }) {
  const w = Math.min(100, Math.round(Math.sqrt(value) * 140));
  return (
    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-200" aria-hidden title="Niveau du son">
      <span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-100" style={{ width: `${w}%` }} />
    </span>
  );
}

function Banner({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  return (
    <div role="status" className={cx('mb-4 flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px]', tone === 'warn' ? 'bg-amber-50 text-amber-900' : 'bg-stone-100 text-stone-700')}>
      {tone === 'warn' && <AlertTriangle size={16} className="shrink-0" aria-hidden />}
      {children}
    </div>
  );
}

/** One line on what happens behind: pieces waiting, parts already written, what's not available. */
function Status({ s }: { s: Session }) {
  const live = useRecLive();
  const bits: string[] = [];
  if (s.transcriptionOff) bits.push(s.transcriptionOff + (s.source === 'micro' && live.quickLane ? ' La suite est écrite par le navigateur.' : ''));
  else if (live.waiting) bits.push(`Le serveur est occupé : reprise dans ${live.waiting} s.`);
  else if (live.queue > 1) bits.push(`${live.queue} morceaux en cours d’écriture.`);
  if (s.aiOff) bits.push(s.aiOff);
  else if (s.parts.length) bits.push(`${s.parts.length} partie${s.parts.length > 1 ? 's' : ''} du cours déjà rédigée${s.parts.length > 1 ? 's' : ''}.`);
  if (!bits.length) return null;
  return <p className="mb-3 text-[12.5px] text-stone-500" role="status">{bits.join(' ')}</p>;
}

function Progress({ step, progress, waiting }: { step: string | null; progress: [number, number] | null; waiting: number | null }) {
  return (
    <div className="mb-5 rounded-2xl bg-stone-50 p-4" role="status">
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <Loader2 size={16} className="animate-spin text-brand-600" aria-hidden /> {step ?? 'Préparation des documents…'}
      </p>
      {progress && progress[1] > 0 && (
        <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-stone-200">
          <span className="block h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${Math.round((progress[0] / progress[1]) * 100)}%` }} />
        </span>
      )}
      <p className="mt-2 text-[12.5px] text-stone-500">{waiting ? `L’IA est très demandée : reprise dans ${waiting} s.` : 'Tu peux aller sur une autre page de Kompaly, mais ne ferme pas cet onglet.'}</p>
    </div>
  );
}

// ── After ───────────────────────────────────────────────────────────────────

function Done({ s }: { s: Session }) {
  const making = useRecLive(st => st.making);
  const md = useMemo(
    () => courseMarkdown({ title: s.title, date: new Date(s.startedAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), seconds: elapsed(s), parts: s.parts, alerts: s.alerts, missing: s.segments.filter(x => x.origin === 'manquant').length }),
    [s],
  );
  const [html, setHtml] = useState('');
  useEffect(() => {
    void import('../../lib/docx').then(m => setHtml(m.markdownToHtml(md)));
  }, [md]);
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
      <section className="card p-5 sm:p-7" aria-label="Le cours rédigé">
        <div className="doc-preview max-w-none text-[14.5px] leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:border-stone-300 [&_blockquote]:pl-3 [&_blockquote]:text-stone-600 [&_h1]:text-[24px] [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:text-[15px] [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6" dangerouslySetInnerHTML={{ __html: html }} />
      </section>
      <aside className="card space-y-4 p-5 sm:p-6 lg:sticky lg:top-2" aria-label="Documents créés">
        <div>
          <p className="flex items-center gap-2 text-[16px] font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white"><Check size={14} strokeWidth={3} /></span>
            C’est rangé dans ton Drive
          </p>
          <p className="mt-1 text-[12.5px] text-stone-500">{duration(elapsed(s))} d’enregistrement · {s.segments.filter(x => x.text).length} passages</p>
        </div>
        <Files files={s.files} pastId={s.id} making={making} />
        <button type="button" className="btn-primary h-10 w-full" onClick={() => useRecorder.getState().discard()}>
          <Mic size={15} /> Nouvel enregistrement
        </button>
      </aside>
    </div>
  );
}

/** The course, its revision sheet and its exam: open them, or make the ones not made yet. */
function Files({ files, pastId, making, compact }: { files: Past['files']; pastId: string; making: { id: string; kind: Make } | null; compact?: boolean }) {
  const items = useDrive(st => st.items);
  const there = (id?: string) => !!id && items.some(i => i.id === id);
  const row = (label: string, icon: React.ReactNode, id: string | undefined, kind?: Make) => {
    const busy = making?.id === pastId && making.kind === kind;
    return there(id) ? (
      <button type="button" className={cx('btn-secondary w-full justify-start', compact ? 'h-8 text-[12.5px]' : 'h-10')} onClick={() => openInDrive(id!)}>
        {icon} {label}
      </button>
    ) : kind ? (
      <button type="button" className={cx('btn-ghost w-full justify-start border border-dashed border-stone-300', compact ? 'h-8 text-[12.5px]' : 'h-10')} disabled={!!making} onClick={() => void makeLater(pastId, kind)}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : icon} {busy ? 'Création…' : kind === 'fiche' ? 'Créer la fiche' : compact ? 'Créer l’examen' : 'Créer l’examen d’entraînement'}
      </button>
    ) : (
      <p className="text-[12.5px] text-stone-500">Le document n’est plus dans le Drive.</p>
    );
  };
  return (
    <div className={cx('grid gap-2', compact && 'sm:grid-cols-3')}>
      {row('Le cours', <FileText size={15} />, files.cours)}
      {row(MAKE_LABEL.fiche, <ClipboardList size={15} />, files.fiche, 'fiche')}
      {row(MAKE_LABEL.examen, <BookOpenCheck size={15} />, files.examen, 'examen')}
    </div>
  );
}

function History() {
  const history = useRecorder(s => s.history);
  const making = useRecLive(s => s.making);
  if (!history.length) return null;
  return (
    <section className="mt-8" aria-labelledby="cours-passes">
      <h2 id="cours-passes" className="mb-3 text-[16px] font-semibold">Cours enregistrés</h2>
      <ul className="space-y-2.5">
        {history.map(h => (
          <li key={h.id} className="card flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
            <div className="min-w-0 lg:w-[34%]">
              <p className="truncate text-[14.5px] font-semibold">{h.title}</p>
              <p className="text-[12.5px] text-stone-500">
                {new Date(h.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {duration(h.seconds)}
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <Files files={h.files} pastId={h.id} making={making} compact />
            </div>
            <button
              type="button"
              className="icon-btn self-end hover:text-red-600 lg:self-center"
              title="Retirer de la liste"
              aria-label={`Retirer « ${h.title} » de la liste`}
              onClick={async () => {
                if (await confirmAction(`Retirer « ${h.title} » de la liste ?`, 'Les documents restent dans ton Drive.', 'Retirer'))
                  useRecorder.setState(st => ({ history: st.history.filter(x => x.id !== h.id) }));
              }}
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
