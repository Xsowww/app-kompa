import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, BookOpenCheck, Check, ClipboardList, FileText, FolderOpen, Loader2, Mic, MonitorSpeaker, RotateCcw, Square, Star, Trash2 } from 'lucide-react';
import { Modal } from '../../components/Overlays';
import { useSettings } from '../../store/settings';
import { SelectField } from '../../components/Pickers';
import { useDrive, pathOf } from '../../store/drive';
import { confirmAction } from '../../store/ui';
import {
  askNotifications,
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
import { canShareComputer, canUseMic, onPhone, type SourceKind } from '../../lib/recorder/capture';
import { serverState } from '../../lib/recorder/api';
import { clock, courseMarkdown, duration } from '../../lib/recorder/course';
import { keywordsFor, normalize } from '../../lib/keywords';
import { cx } from '../../lib/utils';
import { Toggle } from '../profile/controls';
import MoveDialog from '../drive/MoveDialog';
import KeywordsEditor from './KeywordsEditor';
import Transcript, { Alerts } from './Transcript';
import { useRecWords } from './words';
import { t, tn, locale } from '../../i18n';

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
  return (
    <div className="h-full overflow-y-auto px-4 pb-12 md:px-8">
      <div className="mx-auto max-w-[1180px]">
        <h1 className="pb-6 pt-2 text-[24px] font-semibold tracking-[-0.02em]">{t('Enregistrer')}</h1>
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
  const keywords = keywordsFor(useSettings(s => s.courseKeywords), useSettings(s => s.usage));
  const w = useRecWords();
  const [title, setTitle] = useState('');
  const [source, setSource] = useState<SourceKind>(canUseMic() ? 'micro' : 'onglet');
  // null: a folder at the class's name in Mon Drive (or the one used last time for that name).
  const [picked, setPicked] = useState<{ id: string | null } | null>(null);
  const [picking, setPicking] = useState(false);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const error = useRecLive(st => st.startError);
  const setError = (startError: string) => useRecLive.setState({ startError });
  const [server, setServer] = useState<{ transcription: boolean } | null>(null);
  useEffect(() => {
    // No answer at all (no server, network): said like a server without transcription.
    serverState().then(setServer, () => setServer({ transcription: false }));
  }, []);

  const name = title.trim() || w.fallback;
  const known = remembered[normalize(title)];
  const target = picked ? { id: picked.id, own: false } : known !== undefined ? { id: known, own: false } : { id: null, own: true };
  const where = [...pathOf(items, target.id).map(i => i.name), ...(target.own ? [name] : [])].join(' / ') || t('Mon Drive');
  const titles = useMemo(() => [...new Set(history.map(h => h.title))].slice(0, 30), [history]);

  const start = async () => {
    setError('');
    setBusy(true);
    askNotifications();
    try {
      await startRecording({ title: name, source, folderId: target.id, ...(target.own && { newFolder: name }), make });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('L’enregistrement n’a pas pu démarrer.'));
    } finally {
      setBusy(false);
    }
  };

  const sources = [
    { key: 'micro', icon: Mic, label: t('Micro'), ok: canUseMic(), off: '' },
    { key: 'onglet', icon: MonitorSpeaker, label: t('Son de l’ordinateur'), ok: canShareComputer(), off: onPhone() ? t('Sur ordinateur') : t('Avec Chrome') },
  ] as const;

  return (
    <section className="card mx-auto max-w-[620px] space-y-5 p-5 sm:p-7" aria-label={t('Nouvel enregistrement')}>
      <input
        className="field h-12 w-full text-[16px] font-medium"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder={w.name}
        aria-label={w.name}
        list="cours-titres"
        maxLength={100}
        autoComplete="off"
      />
      <datalist id="cours-titres">{titles.map(x => <option key={x} value={x} />)}</datalist>

      <div>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('Source du son')}>
          {sources.map(o => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={source === o.key}
              disabled={!o.ok}
              onClick={() => setSource(o.key)}
              className={cx('flex h-14 items-center justify-center gap-2 rounded-2xl text-[14px] font-semibold ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-50', source === o.key ? 'bg-ink text-paper ring-ink' : 'bg-surface ring-stone-200 hover:ring-stone-300')}
            >
              <o.icon size={18} aria-hidden /> {o.label}
              {!o.ok && o.off && <span className="text-[11.5px] font-medium text-stone-500">· {o.off}</span>}
            </button>
          ))}
        </div>
        {source === 'onglet' && <p className="mt-2 text-[12.5px] text-stone-500">{t('Dans la fenêtre qui s’ouvre : « Écran entier », active le son, puis « Partager ».')}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
        <FolderOpen size={17} className="shrink-0 text-stone-500" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium" title={where}>{where}</span>
        <button type="button" className="btn-ghost h-8 text-[12.5px]" onClick={() => setPicking(true)}>{t('Changer')}</button>
      </div>
      {picking && (
        <MoveDialog
          ids={[]}
          title={w.where}
          confirm={t('Choisir ce dossier')}
          initial={target.id}
          onClose={() => setPicking(false)}
          onMove={id => {
            setPicked({ id });
            setPicking(false);
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
        <span className="mr-1 text-stone-500">{t('Créer aussi')}</span>
        {(['fiche', 'examen'] as Make[]).map(k => (
          <button
            key={k}
            type="button"
            aria-pressed={make[k]}
            onClick={() => useSettings.getState().set({ courseMake: { ...make, [k]: !make[k] } })}
            className={cx('flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ring-1 ring-inset transition-colors pointer-coarse:h-9', make[k] ? 'bg-ink text-paper ring-ink' : 'bg-surface text-stone-600 ring-stone-200 hover:text-ink')}
          >
            {make[k] ? <Check size={13} strokeWidth={3} aria-hidden /> : k === 'fiche' ? <ClipboardList size={14} aria-hidden /> : <BookOpenCheck size={14} aria-hidden />}
            {w.short[k]}
          </button>
        ))}
      </div>

      {server && !server.transcription && <p className="text-[13px] text-amber-800">{t('La transcription est indisponible pour le moment.')}</p>}
      {error && (
        <p role="alert" className="flex gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary h-12 flex-1 text-[15px]" disabled={busy} onClick={() => void start()}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden />} {t('Démarrer')}
        </button>
        <button type="button" className="btn-secondary h-12 px-3.5" onClick={() => setSettings(true)} title={t('Mots-clés et alertes')} aria-label={t('Mots-clés et alertes')}>
          <Bell size={16} /> <span className="tabular text-[13px]">{keywords.length}</span>
        </button>
      </div>
      {settings && <AlertSettings onClose={() => setSettings(false)} />}
    </section>
  );
}

/** Keywords and alerts, out of the way until wanted. */
function AlertSettings({ onClose }: { onClose: () => void }) {
  const phone = useSettings(s => s.coursePhone);
  const silence = useSettings(s => s.courseSilenceMinutes);
  return (
    <Modal open onClose={onClose} width={520}>
      <h3 className="text-[17px] font-semibold">{t('Mots-clés')}</h3>
      <p className="mb-3 mt-0.5 text-[12.5px] text-stone-500">{t('Surlignés quand ils sont prononcés ; la cloche envoie une notification.')}</p>
      <KeywordsEditor />
      <div className="mt-5 space-y-3 border-t border-stone-100 pt-4 text-[13.5px]">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 font-medium">{t('Alertes aussi sur mon téléphone')}</span>
          <Toggle checked={phone} onChange={v => useSettings.getState().set({ coursePhone: v })} label={t('Alertes aussi sur mon téléphone')} />
        </div>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 font-medium">{t('Prévenir si personne ne parle pendant')}</span>
          <SelectField<number>
            className="h-8 w-auto text-[13px]"
            label={t('Prévenir si personne ne parle pendant')}
            value={silence}
            options={[1, 2, 3, 5, 10].map(m => ({ value: m, label: t('{min} min', { min: m }) }))}
            onChange={m => useSettings.getState().set({ courseSilenceMinutes: m })}
          />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <button type="button" className="btn-primary" onClick={onClose}>OK</button>
      </div>
    </Modal>
  );
}

// ── During ──────────────────────────────────────────────────────────────────

function Running({ s }: { s: Session }) {
  const live = useRecLive();
  const finishing = s.phase === 'finishing';
  useTick(!finishing);
  const elsewhere = !live.hearing && recordingElsewhere();
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const w = useRecWords();
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
    if (!(await confirmAction(t('Terminer l’enregistrement ?'), w.finish, t('Terminer||l’enregistrement'), false))) return;
    void finishRecording().catch(() => undefined);
  };
  const resume = async () => {
    setBusy(true);
    try {
      await resumeListening();
    } catch (e) {
      useRecLive.setState({ problem: e instanceof Error ? e.message : t('L’écoute n’a pas pu reprendre.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
      <section className="card p-5 sm:p-6" aria-label={t('Transcription')}>
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-100 pb-4">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <span className={cx('h-2.5 w-2.5 rounded-full', live.hearing ? 'animate-pulse bg-red-500' : 'bg-stone-400')} aria-hidden />
            {finishing ? t('Terminé') : live.hearing ? t('Enregistrement') : t('En pause')}
            <span className="tabular text-[15px] font-semibold">{clock(elapsed(s))}</span>
          </span>
          {/* On a phone the title often goes to the next line: no « · » left alone in front of it. */}
          <span className="min-w-0 truncate text-[14px] font-semibold text-stone-700" title={s.title}><span className="max-sm:hidden">· </span>{s.title}</span>
          {live.hearing && <Level value={live.level} />}
          {!finishing && (
            <span className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
              <button type="button" className="btn-secondary h-9 px-2.5" onClick={() => setSettings(true)} title={t('Mots-clés')} aria-label={t('Mots-clés')}>
                <Bell size={15} /> <span className="tabular text-[12.5px]">{s.keywords.length}</span>
              </button>
              <button type="button" className="btn-secondary h-9 flex-1 sm:flex-none" onClick={star} disabled={!live.hearing} title={t('Marque ce qui vient d’être dit (touche M)')}>
                <Star size={15} className="fill-amber-400 text-amber-500" /> {t('Moment important')}
              </button>
              <button type="button" className="btn-primary h-9 flex-1 sm:flex-none" onClick={() => void finish()}>
                <Square size={13} className="fill-current" /> {t('Terminer||l’enregistrement')}
              </button>
            </span>
          )}
          {settings && <AlertSettings onClose={() => setSettings(false)} />}
        </div>

        {finishing && !live.step ? (
          <Banner tone="warn">
            <span className="min-w-48 flex-1">{t('La création des documents s’est interrompue. Rien n’est perdu.')}</span>
            <button type="button" className="btn-secondary h-8 bg-surface text-[12.5px]" onClick={() => void completeDocuments().catch(() => undefined)}>
              <RotateCcw size={13} /> {t('Reprendre')}
            </button>
          </Banner>
        ) : finishing ? (
          <Progress step={live.step} progress={live.progress} waiting={live.waiting} />
        ) : elsewhere ? (
          <Banner tone="info">{t('Enregistrement en cours dans un autre onglet.')}</Banner>
        ) : !live.hearing ? (
          <Banner tone="warn">
            <span className="min-w-48 flex-1">{live.problem ?? t('L’écoute s’est arrêtée.')} {t('Rien n’est perdu.')}</span>
            <button type="button" className="btn-secondary h-8 bg-surface text-[12.5px]" disabled={busy} onClick={() => void resume()}>
              <RotateCcw size={13} /> {t('Reprendre l’écoute')}
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
          writing={live.hearing && (live.speaking || live.queue > 0)}
          follow
          empty={live.hearing ? t('J’écoute…') : t('Rien d’écrit pour l’instant.')}
        />
      </section>
      <aside className="card p-5 sm:p-6 lg:sticky lg:top-2" aria-label={t('Moments signalés')}>
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
          {t('Alertes')} {s.alerts.length > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[11.5px] font-semibold text-amber-900">{s.alerts.length}</span>}
        </h2>
        <Alerts alerts={s.alerts} segments={s.segments} />
      </aside>
    </div>
  );
}

function Level({ value }: { value: number }) {
  const w = Math.min(100, Math.round(Math.sqrt(value) * 140));
  return (
    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-200" aria-hidden title={t('Niveau du son')}>
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
  const w = useRecWords();
  const bits: string[] = [];
  // « Written by the browser » only while it really writes something.
  const browserWrites = s.source === 'micro' && live.quickLane && s.segments.at(-1)?.origin !== 'manquant';
  if (s.transcriptionOff) bits.push(browserWrites ? `${s.transcriptionOff} ${t('La suite est écrite par le navigateur.')}` : s.transcriptionOff);
  else if (live.waiting) bits.push(t('Le serveur est occupé : reprise dans {s} s.', { s: live.waiting }));
  if (s.aiOff) bits.push(s.aiOff);
  else if (s.parts.length) bits.push(tn(s.parts.length, '{n} partie {ofDoc} déjà rédigée.', '{n} parties {ofDoc} déjà rédigées.', { ofDoc: w.ofDoc }));
  if (!bits.length) return null;
  return <p className="mb-3 text-[12.5px] text-stone-500" role="status">{bits.join(' ')}</p>;
}

function Progress({ step, progress, waiting }: { step: string | null; progress: [number, number] | null; waiting: number | null }) {
  return (
    <div className="mb-5 rounded-2xl bg-stone-50 p-4" role="status">
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <Loader2 size={16} className="animate-spin text-brand-600" aria-hidden /> {step ?? t('Préparation des documents…')}
      </p>
      {progress && progress[1] > 0 && (
        <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-stone-200">
          <span className="block h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${Math.round((progress[0] / progress[1]) * 100)}%` }} />
        </span>
      )}
      <p className="mt-2 text-[12.5px] text-stone-500">{waiting ? t('Reprise dans {s} s.', { s: waiting }) : t('Ne ferme pas Kompaly.')}</p>
    </div>
  );
}

// ── After ───────────────────────────────────────────────────────────────────

function Done({ s }: { s: Session }) {
  const making = useRecLive(st => st.making);
  const w = useRecWords();
  const passages = s.segments.filter(x => x.text).length;
  // What a summary or questions would be made from (none: their « Créer… » buttons would only fail).
  const canMake = !!useRecorder(st => st.history.find(h => h.id === s.id))?.points.length;
  const md = useMemo(
    () => courseMarkdown({ title: s.title, date: new Date(s.startedAt).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), seconds: elapsed(s), parts: s.parts, alerts: s.alerts, missing: s.segments.filter(x => x.origin === 'manquant').length }),
    [s],
  );
  const [html, setHtml] = useState('');
  useEffect(() => {
    void import('../../lib/docx').then(m => setHtml(m.markdownToHtml(md)));
  }, [md]);
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
      <section className="card p-5 sm:p-7" aria-label={w.docDone}>
        <div className="doc-preview max-w-none text-[14.5px] leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:border-stone-300 [&_blockquote]:pl-3 [&_blockquote]:text-stone-600 [&_h1]:text-[24px] [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:text-[15px] [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6" dangerouslySetInnerHTML={{ __html: html }} />
      </section>
      <aside className="card order-first space-y-4 p-5 sm:p-6 lg:sticky lg:top-2 lg:order-none" aria-label={t('Documents créés')}>
        <div>
          <p className="flex items-center gap-2 text-[16px] font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white"><Check size={14} strokeWidth={3} /></span>
            {t('C’est rangé dans ton Drive')}
          </p>
          <p className="mt-1 text-[12.5px] text-stone-500">
            {passages
              ? tn(passages, '{duration} d’enregistrement · {n} passage', '{duration} d’enregistrement · {n} passages', { duration: duration(elapsed(s)) })
              : t('{duration} d’enregistrement', { duration: duration(elapsed(s)) })}
          </p>
        </div>
        {!passages && <p className="text-[13px] text-amber-800">{t('Rien n’a pu être transcrit : pas de quoi faire d’autres documents.')}</p>}
        <Files files={s.files} pastId={s.id} making={making} canMake={canMake} />
        <button type="button" className="btn-primary h-10 w-full" onClick={() => useRecorder.getState().discard()}>
          <Mic size={15} /> {t('Nouvel enregistrement')}
        </button>
      </aside>
    </div>
  );
}

/** The course, its revision sheet and its exam: open them, or make the ones not made yet. */
function Files({ files, pastId, making, compact, canMake }: { files: Past['files']; pastId: string; making: { id: string; kind: Make } | null; compact?: boolean; canMake: boolean }) {
  const items = useDrive(st => st.items);
  const w = useRecWords();
  const there = (id?: string) => !!id && items.some(i => i.id === id);
  // Long names (« Créer les questions de compréhension ») wrap instead of leaving the card on a phone.
  const size = compact ? 'h-auto min-h-8 py-1.5 text-[12.5px] pointer-coarse:min-h-9' : 'h-auto min-h-10 py-2';
  const row = (label: string, icon: React.ReactNode, id: string | undefined, kind?: Make) => {
    const busy = making?.id === pastId && making.kind === kind;
    return there(id) ? (
      <button type="button" className={cx('btn-secondary w-full justify-start whitespace-normal text-left', size)} onClick={() => openInDrive(id!)}>
        {icon} {label}
      </button>
    ) : kind ? (
      canMake && <button type="button" className={cx('btn-ghost w-full justify-start whitespace-normal border border-dashed border-stone-300 text-left', size)} disabled={!!making} onClick={() => void makeLater(pastId, kind)}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : icon} {busy ? t('Création…') : (compact ? w.create : w.createLong)[kind]}
      </button>
    ) : (
      <p className="text-[12.5px] text-stone-500">{t('Le document n’est plus dans le Drive.')}</p>
    );
  };
  return (
    <div className={cx('grid gap-2', compact && 'sm:grid-cols-3')}>
      {row(w.doc, <FileText size={15} />, files.cours)}
      {row((compact ? w.short : w.long).fiche, <ClipboardList size={15} />, files.fiche, 'fiche')}
      {row((compact ? w.short : w.long).examen, <BookOpenCheck size={15} />, files.examen, 'examen')}
    </div>
  );
}

function History() {
  const history = useRecorder(s => s.history);
  const making = useRecLive(s => s.making);
  const w = useRecWords();
  if (!history.length) return null;
  return (
    <section className="mt-8" aria-labelledby="cours-passes">
      <h2 id="cours-passes" className="mb-3 text-[16px] font-semibold">{w.history}</h2>
      <ul className="space-y-2.5">
        {history.map(h => (
          <li key={h.id} className="card flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
            <div className="min-w-0 lg:w-[34%]">
              <p className="truncate text-[14.5px] font-semibold">{h.title}</p>
              <p className="text-[12.5px] text-stone-500">
                {new Date(h.date).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {duration(h.seconds)}
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <Files files={h.files} pastId={h.id} making={making} compact canMake={h.points.length > 0} />
            </div>
            <button
              type="button"
              className="icon-btn self-end hover:text-red-600 lg:self-center"
              title={t('Retirer de la liste')}
              aria-label={t('Retirer « {title} » de la liste', { title: h.title })}
              onClick={async () => {
                if (await confirmAction(t('Retirer « {title} » de la liste ?', { title: h.title }), t('Les documents restent dans ton Drive.'), t('Retirer')))
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
