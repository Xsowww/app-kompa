// « Enregistrer un cours » : one recording at a time. The session (transcript, alerts, parts already written)
// is saved in this browser as it goes, so a closed tab or a reload loses nothing written so far.
// Two lanes, as in Copilote Cours (the Mac app it comes from): with the microphone, the browser shows the words
// at once and spots the keywords; the server (Whisper) writes the precise text that is kept, about 20 s later.
// Every ~4 min of speech, the AI rewrites that part of the class, so little is left to do at the end.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { blobKey, getStorageUser, userStorage } from '../lib/userStorage';
import { blobStore } from '../lib/blobStore';
import { uid } from '../lib/utils';
import { useSettings } from './settings';
import { useDrive, type DriveItem } from './drive';
import { toast } from './ui';
import { chime, notify } from '../lib/notify';
import { serviceWorker } from '../lib/push';
import { normalize, type Keyword } from '../lib/keywords';
import { encodeWav, isSilent } from '../lib/recorder/audio';
import { startCapture, CaptureError, type Capture, type Piece, type SourceKind } from '../lib/recorder/capture';
import { startLive, type LiveLane } from '../lib/recorder/live';
import { CoursError, alertOtherDevices, isFinal, listPoints, transcribe, withRetry, writeDoc, writePart } from '../lib/recorder/api';
import { baseName, chunkText, courseMarkdown, essentialsOf, excerpt, makeSegment, momentLines, nextPart, rawPart, type Alert, type Part, type Segment } from '../lib/recorder/course';

export type Make = 'fiche' | 'examen';

export interface Session {
  id: string;
  title: string;
  source: SourceKind;
  /** Where the documents go; `newFolder`: a folder of that name is made there at the end. */
  folderId: string | null;
  newFolder?: string;
  keywords: Keyword[];
  make: Record<Make, boolean>;
  startedAt: number;
  endedAt?: number;
  phase: 'running' | 'finishing' | 'done';
  segments: Segment[];
  /** What the browser heard (quick lane), kept to fill a passage the server couldn't write. */
  live: { time: number; text: string }[];
  alerts: Alert[];
  stars: number[];
  parts: Part[];
  /** Seconds of the class already rewritten. */
  partsUpTo: number;
  /** Why the server doesn't write the sound any more (today's allowance used…). */
  transcriptionOff?: string;
  aiOff?: string;
  files: Partial<Record<'cours' | Make, string>>;
  /** Documents that couldn't be made at the end (to make later from the list). */
  failed?: Make[];
}

/** A class recorded before: what's needed to make its revision sheet or exam later. */
export interface Past {
  id: string;
  title: string;
  date: number;
  seconds: number;
  folderId: string | null;
  files: Partial<Record<'cours' | Make, string>>;
  points: string[];
  parts: string[];
  moments: string[];
}

interface RecorderState {
  session: Session | null;
  history: Past[];
  /** Last folder used for a class of that name (« droit des contrats » → folder id). */
  folders: Record<string, string | null>;
  discard: () => void;
}

export const useRecorder = create<RecorderState>()(
  persist(
    set => ({
      session: null,
      history: [],
      folders: {},
      discard: () => set({ session: null }),
    }),
    { name: 'cours', storage: userStorage, skipHydration: true, partialize: s => ({ session: s.session, history: s.history, folders: s.folders }) },
  ),
);

/** What changes many times a second, or only means something while this page is open: not saved. */
interface LiveState {
  /** True when this tab is the one recording (false: a session saved but its sound stopped, e.g. after a reload). */
  hearing: boolean;
  interim: string;
  level: number;
  problem: string | null;
  /** Pieces of sound waiting to be written down. */
  queue: number;
  /** Seconds before the server accepts again (it asked to wait). */
  waiting: number | null;
  quickLane: boolean;
  label: string;
  /** At the end: what is being done, and how far. */
  step: string | null;
  progress: [number, number] | null;
  /** A revision sheet or an exam being made from the list or the Drive: its file (or past class) id. */
  making: { id: string; kind: Make } | null;
  /** Why the last start failed (shown on the form, which is shown again after the failed start). */
  startError: string;
}

export const useRecLive = create<LiveState>()(() => ({
  hearing: false,
  interim: '',
  level: 0,
  problem: null,
  queue: 0,
  waiting: null,
  quickLane: false,
  label: '',
  step: null,
  progress: null,
  making: null,
  startError: '',
}));

const patch = (fn: (s: Session) => Partial<Session>) =>
  useRecorder.setState(st => (st.session ? { session: { ...st.session, ...fn(st.session) } } : {}));
const session = () => useRecorder.getState().session;
const live = (p: Partial<LiveState>) => useRecLive.setState(p);

// ── Running engine (one per tab) ────────────────────────────────────────────

let capture: Capture | null = null;
let quick: LiveLane | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let wakeLock: { release: () => Promise<void> } | null = null;
const pieces: Piece[] = [];
let pumpRun: Promise<void> | null = null;
let partsRun: Promise<void> | null = null;
let lastAudible = 0;
let lastText = 0;
let warned = { sound: false, silence: false };
const lastAlert = new Map<string, number>();

/** Seconds since the start of the class. */
export const elapsed = (s: Session | null = session()) => (s ? ((s.endedAt ?? Date.now()) - s.startedAt) / 1000 : 0);

const PIECE_SECONDS: Record<SourceKind, number> = { micro: 22, onglet: 18 };
const MAX_WAITING = 45;

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (useRecLive.getState().hearing || session()?.phase === 'finishing') e.preventDefault();
}

async function keepAwake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (nav.wakeLock && document.visibilityState === 'visible') wakeLock = await nav.wakeLock.request('screen');
  } catch {
    /* not allowed: the screen may sleep (on a phone, the recording then stops) */
  }
}
const onVisible = () => {
  if (document.visibilityState === 'visible' && useRecLive.getState().hearing) void keepAwake();
};

/** A notification: in the page, on this device's system tray when the tab is hidden, and on the phone if wanted. */
async function alertUser(title: string, body: string, urgent = false) {
  toast(`${title} — ${body}`, urgent ? 'error' : 'info');
  chime();
  notify(title, body, urgent);
  if (!useSettings.getState().coursePhone) return;
  let except = '';
  try {
    except = (await (await serviceWorker())?.pushManager?.getSubscription())?.endpoint ?? '';
  } catch {
    /* no service worker */
  }
  void alertOtherDevices({ title: `${title} — ${session()?.title ?? ''}`, body, except });
}

/** Keywords in what was just heard (quick lane or precise lane): marked, and announced once per 30 s each. */
function spot(text: string, time: number) {
  const s = session();
  if (!s) return;
  const hay = ` ${normalize(text)}`;
  const heard: Keyword[] = [];
  for (const k of s.keywords) {
    const n = normalize(k.word);
    if (!n || !hay.includes(` ${n}`)) continue;
    const last = lastAlert.get(n);
    if (last !== undefined && Math.abs(time - last) < 30) continue;
    lastAlert.set(n, time);
    heard.push(k);
  }
  if (!heard.length) return;
  const said = excerpt(text);
  patch(x => ({ alerts: [...heard.map(k => ({ id: uid(), time, keyword: k.word, excerpt: said })).reverse(), ...x.alerts] }));
  // Two keywords in one sentence (« ça tombera à l'examen »): one notification.
  const loud = heard.filter(k => k.notify);
  if (loud.length) void alertUser(`🔔 ${loud.map(k => `« ${k.word} »`).join(', ')}`, said);
}

function heardSomething() {
  lastText = Date.now();
  if (warned.silence) {
    warned.silence = false;
    if (useRecLive.getState().problem?.startsWith('Personne')) live({ problem: null });
  }
}

/** The precise lane: pieces of sound sent one by one, in order. Resolves when none is left. */
function pump(): Promise<void> {
  return (pumpRun ??= runPump().finally(() => (pumpRun = null)));
}

async function runPump() {
  try {
    while (pieces.length) {
      const piece = pieces[0];
      live({ queue: pieces.length });
      const s = session();
      if (!s) break;
      let heard: { start: number; end: number; text: string }[] | null = null;
      if (!s.transcriptionOff) {
        const before = s.segments.slice(-3).map(x => x.text).join(' ').slice(-200);
        const hint = `${s.title}. ${s.keywords.slice(0, 20).map(k => k.word).join(', ')}. ${before}`;
        try {
          heard = await withRetry(() => transcribe(encodeWav(piece.samples), hint), {
            tries: useRecLive.getState().hearing ? 50 : 5,
            onWait: w => live({ waiting: w }),
          });
        } catch (e) {
          if (isFinal(e)) patch(() => ({ transcriptionOff: offReason(e as CoursError) }));
        } finally {
          live({ waiting: null });
        }
      }
      pieces.shift();
      addHeard(piece, heard);
    }
  } finally {
    live({ queue: pieces.length });
  }
}

function offReason(e: CoursError) {
  if (e.code === 'disabled') return 'La transcription n’est pas activée sur le serveur de Kompaly.';
  if (e.code === 'site_limit') return 'Kompaly a atteint sa limite de transcription pour aujourd’hui.';
  if (e.code === 'daily_limit') return 'Tu as atteint ta limite de transcription pour aujourd’hui.';
  return 'La transcription ne répond plus.';
}

/** A piece written down (or not: then what the browser heard, or a gap). */
function addHeard(piece: Piece, heard: { start: number; end: number; text: string }[] | null) {
  const s = session();
  if (!s) return;
  let segs: Segment[];
  if (heard) {
    segs = heard.map((h, i) => makeSegment(`${piece.start.toFixed(1)}-${i}`, piece.start + h.start, piece.start + Math.max(h.end, h.start + 0.5), h.text, s.keywords, s.stars));
    // Keywords only the precise lane caught (a shared tab has no quick lane).
    segs.forEach(seg => spot(seg.text, seg.start));
  } else {
    const said = s.live.filter(l => l.time >= piece.start && l.time < piece.end + 2);
    segs = said.length
      ? said.map((l, i) => makeSegment(`${piece.start.toFixed(1)}-n${i}`, Math.max(piece.start, l.time - 3), l.time, l.text, s.keywords, s.stars, 'navigateur'))
      : [makeSegment(`${piece.start.toFixed(1)}-x`, piece.start, piece.end, '', s.keywords, s.stars, 'manquant')];
  }
  if (segs.some(x => x.text)) heardSomething();
  if (!segs.length) return;
  patch(x => ({ segments: [...x.segments, ...segs].sort((a, b) => a.start - b.start) }));
  void writeParts(false);
}

/** Rewrites the next parts of the class with the AI (all that's left when `all`), after the one being written. */
async function writeParts(all: boolean): Promise<void> {
  while (partsRun) await partsRun;
  partsRun = runParts(all).finally(() => (partsRun = null));
  return partsRun;
}

async function runParts(all: boolean) {
  for (;;) {
    const s = session();
    if (!s) return;
    const next = nextPart(s.segments, s.partsUpTo, all);
    if (!next) return;
    let part: Part;
    if (s.aiOff) part = rawPart(s.segments, s.partsUpTo, next.until, `Partie ${s.parts.length + 1}`);
    else {
      try {
        const before = s.parts.at(-1)?.text.slice(-300);
        const w = await withRetry(() => writePart({ title: s.title, text: next.text, keywords: s.keywords.map(k => k.word), before }), { tries: 6, onWait: x => live({ waiting: x }) });
        part = { title: w.title, text: w.text, points: w.points, until: next.until };
      } catch (e) {
        // Kept as heard; the next parts too if the AI is out for today.
        if (isFinal(e)) patch(() => ({ aiOff: 'L’IA de Kompaly n’est pas disponible pour le moment.' }));
        part = rawPart(s.segments, s.partsUpTo, next.until, `Partie ${s.parts.length + 1}`);
      } finally {
        live({ waiting: null });
      }
    }
    patch(x => ({ parts: [...x.parts, part], partsUpTo: part.until }));
    if (all) live({ progress: [session()?.parts.length ?? 0, (session()?.parts.length ?? 0) + (nextPart(session()?.segments ?? [], part.until, true) ? 1 : 0)] });
  }
}

/** Every 5 s: the sound stopped, nobody speaks. */
function check() {
  const s = session();
  if (!s || !capture) return;
  beat();
  const now = Date.now();
  if (s.source === 'onglet' && now - lastAudible > 60_000) {
    if (!warned.sound) {
      warned.sound = true;
      live({ problem: 'Plus aucun son depuis 1 min' });
      void alertUser('⚠️ Plus aucun son', 'Le son partagé est silencieux depuis 1 minute : la visio est peut-être finie ou en pause.', true);
    }
  } else if (warned.sound) {
    warned.sound = false;
    live({ problem: null });
  }
  const limit = useSettings.getState().courseSilenceMinutes * 60_000;
  if (!warned.sound && !warned.silence && now - lastText > limit) {
    warned.silence = true;
    live({ problem: `Personne ne parle depuis ${Math.round(limit / 60_000)} min` });
    void alertUser('Kompaly n’entend personne', `Personne n’a parlé depuis ${Math.round(limit / 60_000)} min. Vérifie la source du son.`);
  }
}

/** `offset`: seconds of the class already recorded (0 at the start, before the session is saved). */
async function listen(kind: SourceKind, offset: number) {
  capture = await startCapture(kind, {
    offset,
    target: PIECE_SECONDS[kind],
    onPiece: p => {
      // Nobody speaking: nothing to send (it also saves the day's allowance).
      if (isSilent(p.samples)) return;
      pieces.push(p);
      // The server out of reach for a long time: past ~15 min of sound waiting, the oldest pieces (not the one
      // being sent) keep only what the browser heard, so the memory doesn't fill up.
      while (pieces.length > MAX_WAITING) addHeard(pieces.splice(1, 1)[0], null);
      live({ queue: pieces.length });
      void pump();
    },
    onLevel: p => {
      if (p > 0.0003) lastAudible = Date.now();
      live({ level: p });
    },
    onEnded: () => {
      capture = null;
      stopQuick();
      live({ hearing: false, problem: kind === 'onglet' ? 'Le partage du son s’est arrêté' : 'Le micro s’est coupé', interim: '' });
      void alertUser('⚠️ Écoute arrêtée', kind === 'onglet' ? 'Le partage du son s’est arrêté. Clique sur « Reprendre l’écoute » pour continuer.' : 'Le micro s’est coupé. Clique sur « Reprendre l’écoute ».', true);
    },
  });
  lastAudible = lastText = Date.now();
  warned = { sound: false, silence: false };
  live({ hearing: true, problem: null, label: capture.label });
  if (kind === 'micro') {
    quick = startLive(
      (text, final) => {
        if (!text) return live({ interim: '' });
        heardSomething();
        const t = elapsed();
        spot(text, t);
        if (final) {
          // An alert raised on the start of this sentence gets the whole sentence.
          patch(x => ({
            live: [...x.live, { time: t, text }].slice(-3000),
            alerts: x.alerts.map(a => (a.keyword && t - a.time < 20 && text.startsWith(a.excerpt) && text.length > a.excerpt.length ? { ...a, excerpt: excerpt(text) } : a)),
          }));
          live({ interim: '' });
        } else live({ interim: text });
      },
      () => {
        quick = null;
        live({ quickLane: false, interim: '' });
      },
    );
    live({ quickLane: !!quick });
  }
  beat();
  if (!watchdog) watchdog = setInterval(check, 5000);
  addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisible);
  void keepAwake();
}

function stopQuick() {
  quick?.stop();
  quick = null;
  live({ quickLane: false });
}

function release() {
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
  stopQuick();
  removeEventListener('beforeunload', onBeforeUnload);
  document.removeEventListener('visibilitychange', onVisible);
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  try {
    localStorage.removeItem(beatKey());
  } catch {
    /* blocked */
  }
}

/** Logging out or switching account: the sound stops here (what's written stays saved for that account). */
export function stopHearing() {
  if (!capture && !useRecLive.getState().hearing) return;
  capture?.stop(false);
  capture = null;
  pieces.length = 0;
  release();
  live({ hearing: false, interim: '', problem: null, queue: 0 });
}

// Another tab of this account may be the one recording: it says so every few seconds.
const beatKey = () => `cop:${getStorageUser()}:cours-ecoute`;
const TAB = uid();
function beat() {
  try {
    localStorage.setItem(beatKey(), `${TAB} ${Date.now()}`);
  } catch {
    /* storage full or blocked */
  }
}
// Closing or reloading this tab: it no longer records (the page after a reload must not think another tab does).
if (typeof window !== 'undefined')
  addEventListener('pagehide', () => {
    try {
      if ((localStorage.getItem(beatKey()) ?? '').startsWith(`${TAB} `)) localStorage.removeItem(beatKey());
    } catch {
      /* blocked */
    }
  });

/** True when another tab of this browser is recording right now. */
export function recordingElsewhere() {
  if (useRecLive.getState().hearing) return false;
  try {
    const [tab, time] = (localStorage.getItem(beatKey()) ?? '').split(' ');
    return tab !== TAB && Date.now() - Number(time) < 15_000;
  } catch {
    return false;
  }
}

// ── What the page calls ─────────────────────────────────────────────────────

export interface StartOptions {
  title: string;
  source: SourceKind;
  folderId: string | null;
  newFolder?: string;
  make: Record<Make, boolean>;
}

/** Starts a recording. Throws a CaptureError with a sentence for the student when the sound can't be heard. */
export async function startRecording(o: StartOptions) {
  if (session() && session()!.phase !== 'done') throw new CaptureError('Un enregistrement est déjà en cours.');
  const title = o.title.trim() || 'Cours';
  const s: Session = {
    id: uid(),
    title,
    source: o.source,
    folderId: o.folderId,
    ...(o.newFolder && { newFolder: o.newFolder }),
    keywords: useSettings.getState().courseKeywords,
    make: o.make,
    startedAt: Date.now(),
    phase: 'running',
    segments: [],
    live: [],
    alerts: [],
    stars: [],
    parts: [],
    partsUpTo: 0,
    files: {},
  };
  lastAlert.clear();
  // The session is saved once the sound is heard: a refused share leaves the form as it was.
  try {
    await listen(o.source, 0);
  } catch (e) {
    release();
    live({ hearing: false });
    throw e;
  }
  useRecorder.setState({ session: { ...s, startedAt: Date.now() } });
}

/** After the share stopped or a reload: listens again, the class goes on where it was. */
export async function resumeListening() {
  const s = session();
  if (!s || s.phase !== 'running' || capture) return;
  await listen(s.source, elapsed(s));
}

/** « Moment important » : what was just said (3 s ago: the click comes after the sentence). */
export function star() {
  const s = session();
  if (!s || s.phase !== 'running') return;
  const time = Math.max(0, elapsed(s) - 3);
  const last = s.segments.at(-1)?.text ?? '';
  const said = `${last} ${useRecLive.getState().interim}`.trim();
  patch(x => ({
    stars: [...x.stars, time],
    segments: x.segments.map(seg => (time >= seg.start - 1 && time < seg.end + 1 ? { ...seg, starred: true } : seg)),
    alerts: [{ id: uid(), time, keyword: null, excerpt: excerpt(said) || 'Moment marqué' }, ...x.alerts],
  }));
  toast('⭐ Moment marqué', 'success');
}

/** Ends the class: last sound written down, last parts rewritten, then the documents in the Drive. */
export async function finishRecording() {
  const s = session();
  if (!s || s.phase !== 'running') return;
  patch(() => ({ phase: 'finishing', endedAt: Date.now() }));
  capture?.stop(true);
  capture = null;
  release();
  live({ hearing: false, interim: '', problem: null });
  live({ step: 'Transcription des dernières secondes…', progress: null });
  while (pieces.length || pumpRun) await pump();
  await completeDocuments();
}

/** The course rewritten to the end, then the documents in the Drive (again after a reload in the middle). */
export async function completeDocuments() {
  if (session()?.phase !== 'finishing') return;
  try {
    live({ step: 'Rédaction du cours…', progress: [session()!.parts.length, session()!.parts.length + 1] });
    await writeParts(true);
    await saveDocuments();
  } catch (e) {
    toast(e instanceof Error && e.message ? e.message : 'Les documents n’ont pas pu être enregistrés.', 'error');
    live({ step: null, progress: null });
    patch(() => ({ phase: 'running' }));
    throw e;
  }
}

async function folderFor(s: Session): Promise<string | null> {
  if (!s.newFolder) return s.folderId;
  const parent = s.folderId && useDrive.getState().items.some(i => i.id === s.folderId && i.kind === 'folder') ? s.folderId : null;
  const existing = useDrive.getState().items.find(i => i.kind === 'folder' && i.parentId === parent && normalize(i.name) === normalize(s.newFolder!));
  const id = existing?.id ?? useDrive.getState().createFolder(s.newFolder, parent).id;
  patch(() => ({ folderId: id, newFolder: undefined }));
  return id;
}

async function upload(name: string, md: string, title: string, folderId: string | null): Promise<DriveItem> {
  const { markdownToDocx, DOCX_MIME } = await import('../lib/docx');
  const blob = await markdownToDocx(md, { title, author: 'Kompaly' });
  const [item] = await useDrive.getState().uploadFiles([new File([blob], `${name}.docx`, { type: DOCX_MIME })], folderId);
  return item;
}

async function saveDocuments() {
  const s = session()!;
  const when = new Date(s.startedAt);
  const name = baseName(s.title, when);
  const folderId = await folderFor(s);
  live({ step: 'Enregistrement dans le Drive…', progress: null });
  const md = courseMarkdown({ title: s.title, date: when.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), seconds: elapsed(s), parts: s.parts, alerts: s.alerts, missing: s.segments.filter(x => x.origin === 'manquant').length });
  const cours = s.files.cours ?? (await upload(name, md, s.title, folderId)).id;
  patch(x => ({ files: { ...x.files, cours } }));

  const info = await pointsOf(s);
  const failed: Make[] = [];
  for (const kind of ['fiche', 'examen'] as Make[]) {
    if (!s.make[kind] || session()!.files[kind]) continue;
    live({ step: kind === 'fiche' ? 'Fiche de révision…' : 'Examen…', progress: null });
    try {
      const id = await makeDoc(kind, s.title, info, name, folderId);
      patch(x => ({ files: { ...x.files, [kind]: id } }));
    } catch {
      failed.push(kind);
    }
  }
  const done = session()!;
  const past: Past = { id: done.id, title: done.title, date: done.startedAt, seconds: elapsed(done), folderId, files: done.files, ...info };
  useRecorder.setState(st => ({
    history: [past, ...st.history.filter(h => h.id !== past.id)].slice(0, 100),
    folders: { ...st.folders, [normalize(done.title)]: folderId },
  }));
  patch(() => ({ phase: 'done', ...(failed.length && { failed }) }));
  live({ step: null, progress: null });
  notify('Ton cours est prêt', `« ${done.title} » est rangé dans ton Drive.`);
  if (failed.length) toast(`${failed.map(f => (f === 'fiche' ? 'La fiche de révision' : 'L’examen')).join(' et ')} n’a pas pu être fait : réessaie depuis la liste des cours.`, 'error');
}

/** The essentials of the class: the AI's points per part (or, when it couldn't write the parts, asked now). */
async function pointsOf(s: Session): Promise<Pick<Past, 'points' | 'parts' | 'moments'>> {
  const parts = s.parts.map(p => p.title);
  const moments = momentLines(s.alerts);
  let points = s.parts.flatMap(p => p.points);
  if (!points.length && s.segments.length && !s.aiOff) {
    const text = s.segments.filter(x => x.text).map(x => x.text).join('\n');
    points = await pointsFromText(s.title, text).catch(() => []);
  }
  return { points, parts, moments };
}

async function pointsFromText(title: string, text: string): Promise<string[]> {
  const chunks = chunkText(text, 10_000).slice(0, 12);
  const out: string[] = [];
  for (const [i, chunk] of chunks.entries()) {
    live({ progress: [i, chunks.length] });
    out.push(...(await withRetry(() => listPoints({ title, text: chunk }), { onWait: w => live({ waiting: w }) })));
    live({ waiting: null });
  }
  return out;
}

async function makeDoc(kind: Make, title: string, info: Pick<Past, 'points' | 'parts' | 'moments'>, name: string, folderId: string | null): Promise<string> {
  if (!info.points.length) throw new Error('Pas assez de contenu pour faire ce document.');
  const md = await withRetry(() => writeDoc(kind, { title, ...info }), { onWait: w => live({ waiting: w }) });
  live({ waiting: null });
  const label = kind === 'fiche' ? 'Fiche de révision' : 'Examen';
  return (await upload(`${name} – ${label}`, md, `${label} : ${title}`, folderId)).id;
}

/** The revision sheet or the exam of a class recorded before (when it wasn't ticked at the end). */
export async function makeLater(pastId: string, kind: Make) {
  const past = useRecorder.getState().history.find(h => h.id === pastId);
  if (!past || useRecLive.getState().making) return;
  live({ making: { id: pastId, kind } });
  try {
    const folder = past.folderId && useDrive.getState().items.some(i => i.id === past.folderId) ? past.folderId : null;
    const id = await makeDoc(kind, past.title, past, baseName(past.title, new Date(past.date)), folder);
    useRecorder.setState(st => ({ history: st.history.map(h => (h.id === pastId ? { ...h, files: { ...h.files, [kind]: id } } : h)) }));
    const s = session();
    if (s?.id === pastId) patch(x => ({ files: { ...x.files, [kind]: id }, failed: x.failed?.filter(f => f !== kind) }));
    toast(kind === 'fiche' ? 'Fiche de révision rangée dans le Drive' : 'Examen rangé dans le Drive', 'success', { label: 'Ouvrir', run: () => openInDrive(id) });
  } catch (e) {
    toast(errorText(e), 'error');
  } finally {
    live({ making: null, progress: null });
  }
}

/** Opens a file of the Drive (its preview). */
export function openInDrive(id: string) {
  const item = useDrive.getState().items.find(i => i.id === id);
  if (!item) return toast('Ce fichier n’est plus dans le Drive.', 'error');
  const q = new URLSearchParams({ ...(item.parentId && { dossier: item.parentId }), fichier: id });
  window.history.pushState(null, '', `/drive?${q}`);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function errorText(e: unknown): string {
  if (e instanceof CoursError) {
    if (e.code === 'disabled') return 'L’IA de Kompaly n’est pas activée sur le serveur.';
    if (e.code === 'daily_limit') return 'Tu as utilisé toutes tes demandes à l’IA pour aujourd’hui : réessaie demain.';
    if (e.code === 'site_limit') return 'L’IA gratuite de Kompaly a atteint sa limite du jour : réessaie demain.';
    if (e.code === 'network' || e.code === 'timeout') return 'Pas de connexion au serveur : réessaie dans un instant.';
    return 'L’IA n’a pas pu faire ce document : réessaie dans un instant.';
  }
  return e instanceof Error && e.message ? e.message : 'Une erreur est survenue.';
}

/** A revision sheet or an exam from any course document of the Drive (Word, PDF, text), saved next to it. */
export async function makeFromFile(item: DriveItem, kind: Make) {
  if (useRecLive.getState().making) return toast('Un document est déjà en cours de création.', 'info');
  live({ making: { id: item.id, kind } });
  toast(kind === 'fiche' ? 'Kompaly prépare la fiche de révision…' : 'Kompaly prépare l’examen…', 'info');
  try {
    const blob = await blobStore.get(blobKey(item.id));
    if (!blob) throw new Error('Le fichier n’a pas pu être lu.');
    const text = await fileText(item, blob);
    if (text.trim().length < 200) throw new Error('Ce document est trop court pour en faire une fiche ou un examen.');
    const title = item.name.replace(/\.[^.]+$/, '').replace(/^\d{4}-\d{2}-\d{2} – /, '');
    const found = essentialsOf(text);
    const points = found?.points ?? (await pointsFromText(title, text));
    const id = await makeDoc(kind, title, { points, parts: [], moments: found?.moments ?? [] }, item.name.replace(/\.[^.]+$/, ''), item.parentId);
    toast(kind === 'fiche' ? 'Fiche de révision rangée à côté du document' : 'Examen rangé à côté du document', 'success', { label: 'Ouvrir', run: () => openInDrive(id) });
  } catch (e) {
    toast(errorText(e), 'error');
  } finally {
    live({ making: null, progress: null, waiting: null });
  }
}

/** Files a revision sheet or an exam can be made from. */
export const canMakeFrom = (item: DriveItem) => item.kind === 'file' && /\.(docx|pdf|txt|md)$/i.test(item.name);

async function fileText(item: DriveItem, blob: Blob): Promise<string> {
  const name = item.name.toLowerCase();
  if (name.endsWith('.docx')) return (await import('../lib/docx')).docxToText(blob);
  if (name.endsWith('.pdf')) return (await (await import('../lib/docText')).pdfPages(blob, 150_000)).pages.join('\n');
  return blob.slice(0, 300_000).text();
}
