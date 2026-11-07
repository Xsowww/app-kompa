// Administration › Tests: tools to try the app on a phone, in the admin's own account, through the usual stores (and
// so the usual sync), never anyone else's. What they make starts with « [Test] » (testTools), so « Tout supprimer
// (éléments de test) » finds it again, and only it.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, ChevronRight, Database, FolderClosed, ListChecks, Loader2, Palette, Timer, type LucideIcon } from 'lucide-react';
import { useTodos } from '../../store/todos';
import { useCalendar, type NewEvent } from '../../store/calendar';
import { useNotes } from '../../store/notes';
import { useDrive } from '../../store/drive';
import { useFocus } from '../../store/focus';
import { useCopilot } from '../../store/copilot';
import { useAuth } from '../../store/auth';
import { useWelcome } from '../../store/welcome';
import { getSettings, useSettings, applyAppearance, PRO_WALLS, TEXT_SIZES, type ProWall, type TextSize, type Settings } from '../../store/settings';
import { confirmAction, toast, useUi } from '../../store/ui';
import { useService } from '../../lib/serviceStatus';
import { lastPullAt, pendingCount, refusedCount } from '../../lib/cloudSync';
import { deviceState, pushActive, sendTestPush } from '../../lib/push';
import { deviceInfo, deviceWord, offerKey, reminderDevice } from '../../lib/phoneReminders';
import { sendReminderTest, testMessage, type TestWay } from '../../lib/reminderTest';
import { canNotify, showSystemNotification } from '../../lib/notify';
import { openNews } from '../../lib/news';
import { spanDays, repeatDays, ruleOf } from '../../lib/repeat';
import { rememberRule } from '../../lib/repeatSeries';
import { newSeries } from '../../lib/seriesId';
import { forgetJumpSaid } from '../calendar/layout';
import { fmt, todayKey } from '../../lib/dates';
import { formatBytes, uid, cx } from '../../lib/utils';
import { checklistHtml, linesHtml, mixedTasks, nextInCycle, nextWeek, shiftDay, soon, storageBytes, swVersions, testCount, testItems, testName, type TestSelection } from './testTools';
import { t, tn } from '../../i18n';

// The commit the page was built from (vite.config.ts › define), '' in development.
declare const __BUILD__: string;

interface Tool {
  label: string;
  hint: string;
  run: () => unknown;
  danger?: boolean;
}

const WALL_LABELS: Record<ProWall, string> = { montagne: t('Montagne'), nuit: t('Nuit'), aurore: t('Aurore'), maree: t('Marée'), braise: t('Braise') };
const TEXT_LABELS: Record<TextSize, string> = { normal: t('Normal'), grand: t('Grand'), tresgrand: t('Très grand') };

/** A change of the look, saved and shown at once (as Profil › Apparence does it). */
function setLook(patch: Partial<Settings>) {
  useSettings.getState().set(patch);
  applyAppearance(getSettings());
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function ToolCard({ icon: Icon, title, color, tools, busy, onRun, children }: { icon: LucideIcon; title: string; color: string; tools: Tool[]; busy: string | null; onRun: (tool: Tool) => void; children?: React.ReactNode }) {
  return (
    <section className="card min-w-0 overflow-hidden" aria-label={title}>
      <h2 className="flex items-center gap-2 px-4 pb-1 pt-3.5 text-[14px] font-semibold">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${color} 14%, var(--color-surface))`, color }} aria-hidden>
          <Icon size={14} />
        </span>
        {title}
      </h2>
      {children}
      <ul className="pb-1.5">
        {tools.map(tool => (
          <li key={tool.label}>
            <button
              type="button"
              onClick={() => onRun(tool)}
              disabled={busy === tool.label}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-stone-100/70 disabled:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className={cx('block break-words text-[13.5px] font-medium', tool.danger && 'text-red-600')}>{tool.label}</span>
                <span className="block break-words text-[12px] leading-snug text-stone-500">{tool.hint}</span>
              </span>
              {busy === tool.label ? <Loader2 size={15} className="shrink-0 animate-spin text-stone-400" aria-hidden /> : <ChevronRight size={15} className="shrink-0 text-stone-400" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One line of the diagnostic: what, and its value (wraps on a phone, never cut). */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1">
      <dt className="text-[12.5px] text-stone-500">{label}</dt>
      <dd className="tabular min-w-0 break-words text-right text-[12.5px] font-medium">{value}</dd>
    </div>
  );
}

interface Diag {
  pending: number;
  refused: number;
  lastPull: number;
  local: number;
  quota: { usage?: number; quota?: number } | null;
  sw: string;
  server: string;
}

/** What the sync, the storage and the service worker say, read again every 2 s while the tab is open. */
function useDiag(): Diag {
  const [d, setD] = useState<Diag>({ pending: 0, refused: 0, lastPull: 0, local: 0, quota: null, sw: '…', server: '…' });
  useEffect(() => {
    let alive = true;
    const read = async () => {
      let local = 0;
      try {
        local = storageBytes(Object.keys(localStorage).map(k => [k, localStorage.getItem(k) ?? '']));
      } catch {
        /* storage blocked */
      }
      const quota = (await navigator.storage?.estimate?.().catch(() => null)) ?? null;
      const names = typeof caches !== 'undefined' ? await caches.keys().catch(() => []) : [];
      const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
      const sw = !reg ? t('aucun') : swVersions(names).join(', ') || (reg.active ? t('actif, sans cache') : t('en cours d’installation'));
      if (alive) setD(prev => ({ ...prev, pending: pendingCount(), refused: refusedCount(), lastPull: lastPullAt(), local, quota, sw }));
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    // The server's version, once (not in development: only the real server answers /api/sante).
    void fetch('/api/sante', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((h: { version?: string; serveur?: string }) => alive && setD(prev => ({ ...prev, server: h.version || t('en ligne (sans numéro)') })))
      .catch(() => alive && setD(prev => ({ ...prev, server: t('indisponible') })));
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return d;
}

export default function AdminTests() {
  const navigate = useNavigate();
  const userId = useAuth(s => s.user?.id);
  const [busy, setBusy] = useState<string | null>(null);
  const todos = useTodos(s => s.todos);
  const events = useCalendar(s => s.events);
  const notes = useNotes(s => s.notes);
  const drive = useDrive(s => s.items);
  const periods = useSettings(s => s.periods);
  const pro = useSettings(s => s.pro);
  const service = useService(s => s.state);
  const selection = useMemo(() => testItems({ todos, events, notes, drive, periods }), [todos, events, notes, drive, periods]);
  const count = testCount(selection);
  const diag = useDiag();
  const [info] = useState(deviceInfo);
  const where = deviceWord(reminderDevice(info), info.userAgent, info.touchPoints);

  const run = async (tool: Tool) => {
    setBusy(tool.label);
    try {
      await tool.run();
    } catch {
      toast(t('Ça n’a pas marché : {what}', { what: tool.label }), 'error');
    } finally {
      setBusy(null);
    }
  };

  const see = (to: string) => ({ label: t('Voir'), run: () => navigate(to) });

  // ── Tâches ──
  const lateTask = (days: number) => {
    const due = shiftDay(todayKey(), -days);
    const todo = useTodos.getState().add(testName(t('Tâche en retard')), due);
    toast(days === 1 ? t('Tâche en retard créée (hier).') : t('Tâche en retard créée (il y a {n} jours).', { n: days }), 'success', see(`/taches?tache=${todo.id}`));
  };
  const taskTools: Tool[] = [
    { label: t('Tâche en retard d’1 jour'), hint: t('À faire pour hier : elle passe en rouge « En retard ».'), run: () => lateTask(1) },
    { label: t('Tâche en retard de 3 jours'), hint: t('À faire pour il y a 3 jours.'), run: () => lateTask(3) },
    { label: t('Tâche en retard de 2 semaines'), hint: t('À faire pour il y a 14 jours.'), run: () => lateTask(14) },
    {
      label: t('Tâche pour aujourd’hui, rappel dans 1 min'),
      hint: t('Avec un rappel à l’heure dite, dans une à deux minutes : la notification arrive comme une vraie.'),
      run: () => {
        const at = soon(new Date(), 1);
        const st = useTodos.getState();
        const todo = st.add(testName(t('Tâche avec rappel')), at.date, at.time);
        st.update(todo.id, { reminders: [0] });
        toast(t('Tâche créée : rappel à {time}.', { time: at.time }), 'success', see(`/taches?tache=${todo.id}`));
      },
    },
    {
      label: t('Tâche qui se répète'),
      hint: t('Chaque semaine, pour aujourd’hui : coche-la, la suivante apparaît.'),
      run: () => {
        const st = useTodos.getState();
        const todo = st.add(testName(t('Tâche répétée')), todayKey());
        st.update(todo.id, { repeat: 'week' });
        toast(t('Tâche répétée chaque semaine créée.'), 'success', see(`/taches?tache=${todo.id}`));
      },
    },
    {
      label: t('Tâche au titre très long'),
      hint: t('Pour voir comment un long titre passe à la ligne ou se coupe.'),
      run: () => {
        const todo = useTodos.getState().add(testName(t('Un titre de tâche vraiment très long pour vérifier que rien ne déborde : appeler la banque, envoyer le dossier complet à l’assurance, puis relancer le garage pour le devis de la voiture avant vendredi')), todayKey());
        toast(t('Tâche au titre très long créée.'), 'success', see(`/taches?tache=${todo.id}`));
      },
    },
    {
      label: t('10 tâches variées d’un coup'),
      hint: t('En retard, aujourd’hui, plus tard, avec ou sans heure, sans date, une déjà faite.'),
      run: () => {
        const st = useTodos.getState();
        const titles = [t('Payer la facture'), t('Rappeler le plombier'), t('Acheter du pain'), t('Envoyer le devis'), t('Préparer la réunion'), t('Prendre rendez-vous'), t('Ranger le bureau'), t('Lire le contrat'), t('Trier les photos'), t('Arroser les plantes')];
        for (const p of mixedTasks(todayKey(), titles)) {
          const todo = st.add(p.title, p.due, p.time);
          if (p.done) useTodos.getState().toggle(todo.id);
        }
        toast(t('10 tâches de test créées.'), 'success', see('/taches'));
      },
    },
  ];

  // ── Calendrier ──
  const addEvent = (e: Omit<NewEvent, 'category'> & { category?: NewEvent['category'] }, said: string) => {
    const ev = useCalendar.getState().add({ category: 'perso', ...e, title: testName(e.title) });
    toast(said, 'success', see(`/calendrier?jour=${ev.date}&evt=${ev.id}`));
  };
  const calendarTools: Tool[] = [
    {
      label: t('Événement dans 5 min, rappel maintenant'),
      hint: t('Le rappel « 5 min avant » sonne dans la minute.'),
      run: () => {
        const at = soon(new Date(), 5);
        addEvent({ title: t('Rendez-vous imminent'), date: at.date, start: at.time, reminders: [5] }, t('Événement à {time} créé : le rappel arrive dans moins d’une minute.', { time: at.time }));
      },
    },
    {
      label: t('Garde de nuit ce soir, 21 h → 7 h'),
      hint: t('Un événement qui passe minuit (sur deux jours).'),
      run: () => {
        const today = todayKey();
        const series = newSeries(true);
        const title = testName(t('Garde de nuit'));
        useCalendar.getState().addMany(spanDays(today, shiftDay(today, 1), '21:00', '07:00').map((p, i) => ({ ...p, title, category: 'perso' as const, series, ...(i > 0 && { reminders: [] }) })));
        toast(t('Garde de nuit créée : ce soir 21 h → demain 7 h.'), 'success', see(`/calendrier?jour=${today}`));
      },
    },
    {
      label: t('Événement passé (hier)'),
      hint: t('Hier de 14 h à 15 h : il s’affiche comme terminé.'),
      run: () => addEvent({ title: t('Événement d’hier'), date: shiftDay(todayKey(), -1), start: '14:00', end: '15:00' }, t('Événement d’hier créé.')),
    },
    {
      label: t('Prochain grand jour dans 3 jours'),
      hint: t('Marqué important : l’accueil le compte parmi les grands jours.'),
      run: () => addEvent({ title: t('Grand jour'), date: shiftDay(todayKey(), 3), start: '10:00', important: true }, t('Grand jour créé dans 3 jours.')),
    },
    {
      label: t('Période « Vacances » la semaine prochaine'),
      hint: t('Du lundi au dimanche : une teinte sur les jours du calendrier.'),
      run: () => {
        const week = nextWeek(todayKey());
        useSettings.getState().set({ periods: [...getSettings().periods, { id: uid(), title: testName(t('Vacances')), ...week, color: 'vert' }] });
        toast(t('Période « Vacances » créée la semaine prochaine.'), 'success', see(`/calendrier?jour=${week.start}`));
      },
    },
    {
      label: t('Série chaque semaine (8 fois)'),
      hint: t('Le même jour chaque semaine, pendant 2 mois.'),
      run: () => {
        const today = todayKey();
        const rule = { ...ruleOf('week'), until: shiftDay(today, 49) };
        const days = repeatDays(today, 'week', rule.until).days;
        const series = newSeries();
        const title = testName(t('Cours chaque semaine'));
        useCalendar.getState().addMany(days.map(date => ({ title, date, start: '18:00', end: '19:00', category: 'sport' as const, series })));
        rememberRule(series, rule, today);
        toast(t('Série créée : {n} fois.', { n: days.length }), 'success', see(`/calendrier?jour=${today}`));
      },
    },
    {
      label: t('Deux événements qui se chevauchent'),
      hint: t('Demain 10 h → 11 h 30 et 11 h → 12 h : côte à côte dans la journée.'),
      run: () => {
        const day = shiftDay(todayKey(), 1);
        const cal = useCalendar.getState();
        cal.add({ title: testName(t('Réunion A')), date: day, start: '10:00', end: '11:30', category: 'cours' });
        cal.add({ title: testName(t('Réunion B')), date: day, start: '11:00', end: '12:00', category: 'perso' });
        toast(t('Deux événements créés demain matin.'), 'success', see(`/calendrier?jour=${day}`));
      },
    },
    {
      label: t('Événement sur toute la journée'),
      hint: t('Demain, sans heure.'),
      run: () => addEvent({ title: t('Journée entière'), date: shiftDay(todayKey(), 1) }, t('Événement sur toute la journée créé demain.')),
    },
  ];

  // ── Rappels & notifications ──
  const sampleSource = () => {
    const now = new Date();
    return { kind: 'task' as const, id: 'admin-test', title: testName(t('Notification')), date: todayKey(), time: hhmm(now) };
  };
  const wayText = (way: TestWay) =>
    way === 'push'
      ? t('Rappel test envoyé : il arrive sur {device} comme le vrai, même Kompaly fermé.', { device: where })
      : way === 'system'
        ? t('Rappel test affiché. Pour le recevoir Kompaly fermé, active les rappels dans Profil › Notifications.')
        : t('Rappel test affiché dans Kompaly. Sans notifications activées sur {device}, le vrai ne s’affichera que si Kompaly est ouvert.', { device: where });
  const notifyTools: Tool[] = [
    {
      label: t('Envoyer une notification test'),
      hint: t('Maintenant, par le même chemin qu’un vrai rappel.'),
      run: async () => {
        const way = await sendReminderTest(sampleSource(), [0]);
        toast(wayText(way), way === 'app' ? 'info' : 'success');
      },
    },
    {
      label: t('Notification dans 30 secondes'),
      hint: t('Le temps de fermer Kompaly ou de verrouiller le téléphone.'),
      run: async () => {
        const src = sampleSource();
        if ((await pushActive().catch(() => false)) && (await sendTestPush(30, testMessage(src, [0]))) === 'ok') {
          toast(t('Notification prévue dans 30 secondes : tu peux fermer Kompaly.'), 'success');
          return;
        }
        // No push on this device: only while Kompaly stays open.
        setTimeout(() => {
          const msg = testMessage(src, [0]);
          if (canNotify()) void showSystemNotification(msg.title, msg.body, 'admin-test-30', msg.url);
          else useUi.getState().showAlert({ key: `admin-test-${Date.now()}`, title: msg.title, body: msg.body, url: msg.url, at: Date.now() });
        }, 30_000);
        toast(t('Notification prévue dans 30 secondes. Sans notifications activées ici, garde Kompaly ouvert.'), 'info');
      },
    },
    { label: t('Message de réussite'), hint: t('Le message vert habituel.'), run: () => toast(t('C’est enregistré (message de test).'), 'success') },
    { label: t('Message d’erreur'), hint: t('Le message rouge, qui reste plus longtemps.'), run: () => toast(t('Ça n’a pas marché (message de test).'), 'error') },
    {
      label: t('Message avec « Annuler »'),
      hint: t('Comme après une suppression.'),
      run: () => toast(t('Élément supprimé (message de test).'), 'success', { label: t('Annuler'), run: () => toast(t('Annulé (message de test).'), 'info') }),
    },
    {
      label: t('Message de Kompaly avec boutons'),
      hint: t('Kompaly se penche et propose deux choix.'),
      run: () =>
        useCopilot.getState().say({
          text: t('Message de test : tu veux voir tes tâches ?'),
          mood: 'happy',
          offers: [
            { label: t('Ouvrir mes tâches'), kind: 'open', payload: { to: '/taches' } },
            { label: t('Non merci'), kind: 'ack', payload: { text: t('D’accord.') } },
          ],
        }),
    },
    {
      label: t('« Pas enregistré · Réessayer »'),
      hint: t('Le message qui reste quand le serveur refuse quelque chose (simulé).'),
      run: () =>
        toast(t('Pas enregistré : « {name} », {why}', { name: testName(t('Exemple')), why: t('le serveur l’a refusé (message de test).') }), 'error', { label: t('Réessayer'), run: () => toast(t('Enregistré (message de test).'), 'success') }, { duration: 0 }),
    },
    {
      label: t('Bandeau « Hors connexion »'),
      hint: t('Affiché 8 secondes, comme sans réseau (rien n’est coupé pour de vrai).'),
      run: () => {
        if (service !== 'ok') return;
        useService.setState({ state: 'offline' });
        setTimeout(() => useService.getState().state === 'offline' && navigator.onLine && useService.setState({ state: 'ok' }), 8000);
      },
    },
    {
      label: t('Rappel affiché dans l’app'),
      hint: t('La carte de rappel avec « Plus tard » et « Fait ».'),
      run: () =>
        useUi.getState().showAlert({ key: `admin-test-${Date.now()}`, title: testName(t('Rappel')), body: t('Ceci est un rappel de test, affiché dans Kompaly.'), url: '/taches', at: Date.now() }),
    },
  ];

  // ── Concentration ──
  const focusTools: Tool[] = [
    {
      label: t('Session d’1 minute'),
      hint: t('Le minuteur démarre ; à la fin, la pause et le message de Kompaly.'),
      run: () => {
        useFocus.getState().start(testName(t('Concentration')));
        useFocus.setState({ endsAt: Date.now() + 60_000, minutes: 1 });
        toast(t('Session d’1 minute lancée.'), 'success');
      },
    },
    {
      label: t('Terminer la session maintenant'),
      hint: t('Comme si le temps était écoulé (session ou pause en cours).'),
      run: () => {
        const f = useFocus.getState();
        if (!f.phase) return toast(t('Aucune session en cours.'), 'info');
        useFocus.setState({ endsAt: Date.now() - 1, pausedLeft: null });
        useFocus.getState().tick();
      },
    },
    {
      label: t('Lancer une pause d’1 minute'),
      hint: t('Directement en pause ; à la fin, « On repart ? ».'),
      run: () => {
        useFocus.setState({ phase: 'break', endsAt: Date.now() + 60_000, pausedLeft: null, minutes: 1, label: '' });
        toast(t('Pause d’1 minute lancée.'), 'success');
      },
    },
  ];

  // ── Notes & Fichiers ──
  const upload = async (files: File[], parentId: string | null) => useDrive.getState().uploadFiles(files, parentId);
  const textFile = (name: string, text: string) => new File([text], testName(name), { type: 'text/plain' });
  const pdfFile = async (name: string) => {
    const { markdownToPdf } = await import('../../lib/fichePdf');
    const blob = await markdownToPdf(`# ${t('Document de test')}\n\n${t('Ce PDF a été créé dans le navigateur pour tester les fichiers.')}\n\n- ${t('Première ligne')}\n- ${t('Deuxième ligne')}`, { title: t('Document de test') });
    return new File([blob], testName(name), { type: 'application/pdf' });
  };
  const notesTools: Tool[] = [
    {
      label: t('Note longue (60 lignes)'),
      hint: t('Pour tester le défilement et la recherche.'),
      run: () => {
        const note = useNotes.getState().createNote({ title: testName(t('Note longue')), content: linesHtml(60, n => t('Ligne {n} : un peu de texte pour remplir la note.', { n })) });
        toast(t('Note de 60 lignes créée.'), 'success', see(`/notes?note=${note.id}`));
      },
    },
    {
      label: t('Note au titre très long'),
      hint: t('Pour voir le titre dans la liste et l’éditeur.'),
      run: () => {
        const note = useNotes.getState().createNote({ title: testName(t('Un titre de note interminable pour vérifier la liste, le titre de l’éditeur, la recherche et le partage sans que rien ne déborde de l’écran du téléphone')), content: `<p>${t('Une note au titre très long.')}</p>` });
        toast(t('Note au titre très long créée.'), 'success', see(`/notes?note=${note.id}`));
      },
    },
    {
      label: t('Note avec liste à cocher'),
      hint: t('Six cases, deux déjà cochées.'),
      run: () => {
        const note = useNotes.getState().createNote({ title: testName(t('Liste de courses')), content: checklistHtml([t('Pain'), t('Lait'), t('Œufs'), t('Pommes'), t('Café'), t('Riz')]) });
        toast(t('Note avec liste à cocher créée.'), 'success', see(`/notes?note=${note.id}`));
      },
    },
    {
      label: t('Quelques petits fichiers'),
      hint: t('Un texte et un PDF fabriqués dans le navigateur.'),
      run: async () => {
        await upload([textFile('notes.txt', t('Fichier texte de test.\nDeuxième ligne.')), await pdfFile('document.pdf')], null);
        toast(t('2 fichiers de test ajoutés.'), 'success', see('/drive'));
      },
    },
    {
      label: t('Dossier avec des fichiers'),
      hint: t('Un dossier et trois fichiers dedans.'),
      run: async () => {
        const folder = useDrive.getState().createFolder(testName(t('Dossier')), null);
        await upload([textFile('a.txt', t('Premier fichier.')), textFile('b.txt', t('Deuxième fichier.')), await pdfFile('c.pdf')], folder.id);
        toast(t('Dossier de test créé avec 3 fichiers.'), 'success', see(`/drive?dossier=${folder.id}`));
      },
    },
  ];

  // ── Affichage ──
  const lookTools: Tool[] = [
    {
      label: pro ? t('Désactiver l’Affichage Pro') : t('Activer l’Affichage Pro'),
      hint: t('Le même réglage que Profil › Apparence.'),
      run: () => {
        const on = !getSettings().pro;
        setLook({ pro: on });
        toast(on ? t('Affichage Pro activé.') : t('Affichage Pro désactivé.'), 'success');
      },
    },
    {
      label: t('Fond d’écran suivant'),
      hint: pro ? t('Change le fond de l’Affichage Pro.') : t('Visible seulement avec l’Affichage Pro.'),
      run: () => {
        const proWall = nextInCycle(PRO_WALLS, getSettings().proWall);
        setLook({ proWall });
        toast(t('Fond d’écran : {name}', { name: WALL_LABELS[proWall] }), 'success');
      },
    },
    {
      label: t('Taille du texte suivante'),
      hint: t('Normal, grand, très grand, puis normal.'),
      run: () => {
        const textSize = nextInCycle(TEXT_SIZES, getSettings().textSize);
        setLook({ textSize });
        toast(t('Taille du texte : {name}', { name: TEXT_LABELS[textSize] }), 'success');
      },
    },
    {
      label: t('Revoir le questionnaire de bienvenue'),
      hint: t('Tes nouvelles réponses remplaceront les actuelles.'),
      run: async () => {
        if (!(await confirmAction(t('Revoir le questionnaire ?'), t('Tes réponses remplaceront les actuelles (usage, besoins, ton de Kompaly). « Passer » garde les réponses par défaut.'), t('Ouvrir'), false))) return;
        useWelcome.setState({ pending: true });
        navigate('/bienvenue');
      },
    },
    { label: t('Revoir les Nouveautés'), hint: t('La fenêtre des dernières nouveautés.'), run: () => openNews() },
    {
      label: t('Remontrer les messages « une seule fois »'),
      hint: t('« Ton prochain rendez-vous » du calendrier, « Ton rappel est enregistré », la présentation de Kompaly.'),
      run: () => {
        forgetJumpSaid();
        try {
          if (userId) localStorage.removeItem(offerKey(userId));
          sessionStorage.removeItem('cop:greeted');
        } catch {
          /* storage blocked */
        }
        useSettings.getState().set({ kompalyIntroduced: false });
        toast(t('Ils s’afficheront de nouveau. Kompaly se présente au prochain chargement.'), 'success', { label: t('Recharger'), run: () => location.reload() });
      },
    },
  ];

  // ── Données & diagnostic ──
  const cleanAll = async (sel: TestSelection) => {
    const n = testCount(sel);
    if (!n) return toast(t('Aucun élément de test à supprimer.'), 'info');
    const parts = [
      sel.todos.length && tn(sel.todos.length, '{n} tâche', '{n} tâches'),
      sel.events.length && tn(sel.events.length, '{n} événement', '{n} événements'),
      sel.periods.length && tn(sel.periods.length, '{n} période', '{n} périodes'),
      sel.notes.length && tn(sel.notes.length, '{n} note', '{n} notes'),
      sel.drive.length && tn(sel.drive.length, '{n} fichier ou dossier', '{n} fichiers ou dossiers'),
    ].filter(Boolean);
    if (!(await confirmAction(t('Supprimer les éléments de test ?'), t('{list}, tous marqués « [Test] ». Ils vont dans la corbeille.', { list: parts.join(', ') }), t('Tout supprimer')))) return;
    const gonePeriods = getSettings().periods.filter(p => sel.periods.includes(p.id));
    useTodos.getState().removeMany(sel.todos);
    useCalendar.getState().removeMany(sel.events);
    sel.notes.forEach(id => useNotes.getState().removeNote(id));
    useDrive.getState().remove(sel.drive);
    if (gonePeriods.length) useSettings.getState().set({ periods: getSettings().periods.filter(p => !sel.periods.includes(p.id)) });
    toast(tn(n, '{n} élément de test supprimé.', '{n} éléments de test supprimés.'), 'success', {
      label: t('Annuler'),
      run: () => {
        useTodos.getState().restore(sel.todos);
        useCalendar.getState().restore(sel.events);
        useNotes.getState().restore(sel.notes);
        useDrive.getState().restore(sel.drive);
        if (gonePeriods.length) useSettings.getState().set({ periods: [...getSettings().periods, ...gonePeriods] });
      },
    });
  };
  const dataTools: Tool[] = [
    {
      label: t('Mettre à jour l’app (vider son cache)'),
      hint: t('Efface les fichiers de l’app gardés hors connexion, puis recharge.'),
      run: async () => {
        for (const name of typeof caches !== 'undefined' ? await caches.keys() : []) if (name.startsWith('kompaly-app-')) await caches.delete(name).catch(() => false);
        await (await navigator.serviceWorker?.getRegistration().catch(() => undefined))?.update().catch(() => undefined);
        location.reload();
      },
    },
    {
      label: t('Tout supprimer (éléments de test)'),
      hint: count ? tn(count, '{n} élément marqué « [Test] » dans ton compte.', '{n} éléments marqués « [Test] » dans ton compte.') : t('Aucun élément de test pour le moment.'),
      run: () => cleanAll(selection),
      danger: true,
    },
  ];

  const permission = typeof Notification === 'undefined' ? t('non prise en charge') : Notification.permission === 'granted' ? t('autorisées') : Notification.permission === 'denied' ? t('bloquées') : t('pas encore demandées');
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const yesNo = (v: boolean) => (v ? t('oui') : t('non'));

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-stone-500">
        {t('Ces outils agissent seulement sur ton compte, comme si tu le faisais à la main. Tout ce qu’ils créent commence par « [Test] » : « Tout supprimer (éléments de test) », dans « Données et diagnostic », l’enlève d’un coup.')}
      </p>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className="grid min-w-0 gap-3">
          <ToolCard icon={ListChecks} title={t('Tâches')} color="#2f9e6b" tools={taskTools} busy={busy} onRun={run} />
          <ToolCard icon={Bell} title={t('Rappels et notifications')} color="#d48a17" tools={notifyTools} busy={busy} onRun={run} />
          <ToolCard icon={FolderClosed} title={t('Notes et fichiers')} color="#3b6fd8" tools={notesTools} busy={busy} onRun={run} />
        </div>
        <div className="grid min-w-0 gap-3">
          <ToolCard icon={CalendarDays} title={t('Calendrier')} color="#d9483b" tools={calendarTools} busy={busy} onRun={run} />
          <ToolCard icon={Timer} title={t('Concentration')} color="#7a5ad6" tools={focusTools} busy={busy} onRun={run} />
          <ToolCard icon={Palette} title={t('Affichage')} color="#d6457a" tools={lookTools} busy={busy} onRun={run} />
          <ToolCard icon={Database} title={t('Données et diagnostic')} color="#5e6470" tools={dataTools} busy={busy} onRun={run}>
            <dl className="mx-4 my-2 divide-y divide-stone-100 rounded-lg bg-stone-50 px-3 py-1">
              <Fact label={t('Modifications en attente d’envoi')} value={diag.pending} />
              <Fact label={t('Refusées par le serveur')} value={diag.refused} />
              <Fact label={t('Dernière synchronisation')} value={diag.lastPull ? fmt(new Date(diag.lastPull), 'HH:mm:ss') : t('pas encore')} />
              <Fact label={t('Connexion')} value={service === 'ok' ? t('en ligne') : service === 'offline' ? t('hors connexion') : t('service perturbé')} />
              <Fact label={t('Stockage local (navigateur)')} value={formatBytes(diag.local)} />
              {!!diag.quota?.usage && <Fact label={t('Stockage total utilisé')} value={formatBytes(diag.quota.usage)} />}
              <Fact label={t('Version de l’app')} value={__BUILD__ || t('développement')} />
              <Fact label={t('Version du serveur')} value={diag.server} />
              <Fact label={t('Service worker (cache)')} value={diag.sw} />
              <Fact label={t('Appareil')} value={where} />
              <Fact label={t('Écran tactile')} value={yesNo(coarse)} />
              <Fact label={t('Ouverte depuis l’icône (app installée)')} value={yesNo(info.standalone)} />
              <Fact label={t('Notifications du navigateur')} value={permission} />
              <Fact label={t('Rappels sur cet appareil')} value={deviceState() === 'on' ? t('activés') : t('pas activés')} />
              <Fact label={t('Taille de la fenêtre')} value={`${window.innerWidth} × ${window.innerHeight}`} />
            </dl>
          </ToolCard>
        </div>
      </div>
    </div>
  );
}
