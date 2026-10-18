import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search, ShieldCheck, Users, Activity, HardDrive, NotebookText, CalendarDays, FolderClosed, Loader2, LayoutDashboard, Inbox } from 'lucide-react';
import { supabase, cloudEnabled, checkIsAdmin } from '../../lib/supabase';
import { CATEGORIES, type BuiltinCategory } from '../../store/calendar';
import { formatBytes, relativeTime, cx } from '../../lib/utils';
import { fmt, fromKey } from '../../lib/dates';
import AdminInbox from './AdminInbox';
import { fetchInbox, openCount, type Inbox as InboxData } from './inbox';
import { useUi } from '../../store/ui';

interface Account {
  id: string;
  email: string;
  name: string;
  created_at: string;
  last_sign_in_at: string | null;
  confirmed: boolean;
  mfa: boolean;
  admin: boolean;
  notes: number;
  events: number;
  files: number;
  storage: number;
}

interface Stats {
  generated_at: string;
  users: { total: number; confirmed: number; new_7d: number; active_24h: number; active_7d: number; active_30d: number };
  mfa_users: number;
  content: { notes: number; note_folders: number; events: number; events_done: number; files: number; folders: number; storage_bytes: number };
  events_by_category: Partial<Record<string, number>>;
  /** Categories created by the users (migration 2026-10-16), grouped by name. */
  custom_categories?: { label: string; events: number; users: number }[];
  days: { day: string; signups: number; created: number }[];
  accounts: Account[];
}

const REFRESH_MS = 20_000;

function Kpi({ icon: Icon, label, value, sub, color, className }: { icon: typeof Users; label: string; value: string | number; sub?: string; color: string; className?: string }) {
  return (
    <div className={cx('card p-4', className)}>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${color} 12%, var(--color-surface))`, color }}>
          <Icon size={14} />
        </span>
        <span className="text-[12px] font-medium text-stone-500">{label}</span>
      </div>
      <p className="tabular mt-3 text-[28px] font-semibold leading-none tracking-tight">{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-stone-500">{sub}</p>}
    </div>
  );
}

/** Daily columns, one series: 2px gaps, 4px rounded caps, hover tooltip, recessive grid. */
function DailyColumns({ data, valueKey, label, labelOne, color }: { data: Stats['days']; valueKey: 'signups' | 'created'; label: string; labelOne: string; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = data.map(d => d[valueKey]);
  const max = Math.max(1, ...values);
  const top = max <= 4 ? 4 : Math.ceil(max / 5) * 5;
  const W = 600;
  const H = 140;
  const PLOT = W - 26; // the axis numbers sit in the gutter on the right, clear of the last bars
  const slot = PLOT / data.length;
  const bar = Math.min(16, slot - 2);
  const total = values.reduce((a, b) => a + b, 0);
  const tip = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <p className="tabular text-[13px] text-stone-500">
        <span className="text-[20px] font-semibold text-ink">{total}</span> {total > 1 ? label : labelOne} sur 30 jours
      </p>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="mt-3 w-full overflow-visible" role="img" aria-label={`${label} par jour sur 30 jours : ${total} au total, maximum ${max} par jour`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1="0" x2={PLOT} y1={H - f * H} y2={H - f * H} stroke="var(--color-stone-200)" strokeWidth="1" />
            {f > 0 && (
              <text x={W} y={H - f * H + 3} textAnchor="end" fontSize="10" fill="var(--color-stone-500)">
                {Math.round(top * f)}
              </text>
            )}
          </g>
        ))}
        {data.map((d, i) => {
          const h = (d[valueKey] / top) * H;
          const x = i * slot + (slot - bar) / 2;
          const r = Math.min(4, h / 2, bar / 2);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={i * slot} y="0" width={slot} height={H} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x} ${H} V${H - h + r} Q${x} ${H - h} ${x + r} ${H - h} H${x + bar - r} Q${x + bar} ${H - h} ${x + bar} ${H - h + r} V${H} Z`}
                  fill={color}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
            </g>
          );
        })}
        {[0, 14, 29].map(i => (
          <text key={i} x={i * slot + slot / 2} y={H + 14} textAnchor={i === 0 ? 'start' : i === 29 ? 'end' : 'middle'} fontSize="10" fill="var(--color-stone-500)">
            {fmt(fromKey(data[i].day), 'd MMM')}
          </text>
        ))}
      </svg>
      {tip && hover !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 whitespace-nowrap rounded-md bg-inverse px-2.5 py-1.5 text-[12px] text-on-inverse shadow-pop"
          // Glisse sous la colonne survolée sans jamais dépasser du cadre, même au bord.
          style={{ left: `${((hover + 0.5) / data.length) * 100}%`, transform: `translateX(-${((hover + 0.5) / data.length) * 100}%)` }}
        >
          <p className="text-on-inverse/60">{fmt(fromKey(tip.day), 'EEEE d MMMM')}</p>
          <p className="tabular font-medium">
            {tip[valueKey]} {tip[valueKey] > 1 ? label : labelOne}
          </p>
        </div>
      )}
    </div>
  );
}

type View = 'apercu' | 'traiter' | 'comptes' | 'contenus';
const VIEWS: { key: View; label: string; short?: string; icon: typeof Users }[] = [
  { key: 'apercu', label: 'Vue d’ensemble', short: 'Aperçu', icon: LayoutDashboard },
  { key: 'traiter', label: 'À traiter', icon: Inbox },
  { key: 'comptes', label: 'Comptes', icon: Users },
  { key: 'contenus', label: 'Contenus', icon: CalendarDays },
];

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [inbox, setInbox] = useState<InboxData | null>(null);
  const [inboxMissing, setInboxMissing] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find(v => v.key === params.get('vue'))?.key ?? 'apercu') as View;
  const show = (v: View) => setParams(v === 'apercu' ? {} : { vue: v }, { replace: true });

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [{ data, error: err }, box] = await Promise.all([supabase.rpc('admin_stats'), fetchInbox()]);
    setLoading(false);
    // Échec passager : on garde la liste déjà affichée et on prévient.
    const boxFailed = !box.inbox && !box.missing;
    if (!boxFailed) {
      setInbox(box.inbox);
      setInboxMissing(box.missing);
    }
    if (err) {
      setError(err.message.includes('mfa') ? 'Reconnecte-toi avec ton code de sécurité pour voir ces chiffres.' : boxFailed ? 'Impossible d’actualiser : les chiffres et la liste affichés ne sont peut-être pas à jour.' : 'Impossible de charger les statistiques.');
      return;
    }
    setError(boxFailed ? 'Impossible d’actualiser les signalements à traiter : la liste affichée n’est peut-être pas à jour.' : '');
    setStats(data as Stats);
  }, []);

  useEffect(() => {
    void checkIsAdmin().then(setAllowed);
  }, []);

  // Live view: refresh every 20 s and when coming back to the tab.
  useEffect(() => {
    if (!allowed) return;
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [allowed, load]);

  const accounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (stats?.accounts ?? []).filter(a => !q || a.email.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  }, [stats, query]);

  // The menu's badge follows what is handled here.
  useEffect(() => {
    if (inbox) useUi.setState({ adminPending: openCount(inbox) });
  }, [inbox]);

  if (!cloudEnabled || allowed === false) return <Navigate to="/" replace />;

  const u = stats?.users;
  const c = stats?.content;
  const pending = openCount(inbox);
  const pendingReports = inbox?.reports.filter(r => r.status === 'open').length ?? 0;
  const count: Partial<Record<View, number>> = { traiter: pending, comptes: stats?.accounts.length };

  return (
    <div className="h-full overflow-y-auto px-4 pb-16 md:px-8">
      <div className="mx-auto max-w-[1180px]">
        <div className="flex flex-wrap items-center gap-3 pb-4 pt-2">
          <div className="mr-auto">
            <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Administration</h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-stone-500">
              {/* Green and pulsing only while the figures are fresh. */}
              <span className="relative flex h-2 w-2">
                {!error && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
                <span className={cx('relative inline-flex h-2 w-2 rounded-full', error ? 'bg-stone-400' : 'bg-emerald-500')} />
              </span>
              {error ? 'Pas à jour' : 'En direct'} · {stats ? `mis à jour à ${fmt(new Date(stats.generated_at), 'HH:mm:ss')}` : 'chargement…'} · visible par toi uniquement
            </p>
          </div>
          <button className="btn-secondary h-8" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualiser
          </button>
        </div>

        <nav aria-label="Parties de l’administration" className="-mx-4 mb-5 overflow-x-auto border-b border-stone-200 px-4 md:mx-0 md:px-0">
          <div className="flex min-w-max gap-1">
            {VIEWS.map(v => (
              <button
                key={v.key}
                type="button"
                aria-current={view === v.key ? 'page' : undefined}
                ref={view === v.key ? el => el?.scrollIntoView({ inline: 'nearest', block: 'nearest' }) : undefined}
                onClick={() => show(v.key)}
                className={cx(
                  '-mb-px flex h-10 items-center gap-2 border-b-2 px-3 text-[13.5px] transition-colors',
                  view === v.key ? 'border-ink font-medium text-ink' : 'border-transparent text-stone-500 hover:text-ink',
                )}
              >
                <v.icon size={15} aria-hidden className="hidden sm:block" />
                {v.short ? (
                  <>
                    <span className="sm:hidden">{v.short}</span>
                    <span className="hidden sm:inline">{v.label}</span>
                  </>
                ) : (
                  v.label
                )}
                {!!count[v.key] && (
                  <span
                    className={cx(
                      'tabular rounded-full px-1.5 py-px text-[11px] font-semibold',
                      v.key === 'traiter' ? 'bg-red-50 text-red-700' : 'bg-stone-100 text-stone-600',
                    )}
                  >
                    {count[v.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>

        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}

        {!stats ? (
          !error && (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-stone-400" />
            </div>
          )
        ) : view === 'apercu' ? (
          <div className="space-y-6">
            {pending > 0 && (
              <button
                type="button"
                onClick={() => show('traiter')}
                className="flex w-full items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-[13.5px] text-red-800 transition-colors hover:bg-red-100"
              >
                <Inbox size={16} aria-hidden />
                <span className="flex-1">
                  {pendingReports > 0 && `${pendingReports} signalement${pendingReports > 1 ? 's' : ''}`}
                  {pendingReports > 0 && pending - pendingReports > 0 && ' et '}
                  {pending - pendingReports > 0 && `${pending - pendingReports} avis ou bug${pending - pendingReports > 1 ? 's' : ''}`} à traiter
                </span>
                <span className="font-medium">Voir</span>
              </button>
            )}

            <section aria-labelledby="admin-users">
              <h2 id="admin-users" className="eyebrow mb-2">Utilisateurs</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Kpi icon={Users} label="Comptes" value={u!.total} sub={`+${u!.new_7d} cette semaine`} color="var(--color-brand-500)" />
                <Kpi icon={Activity} label="Actifs (7 jours)" value={u!.active_7d} sub={`${u!.active_24h} aujourd’hui · ${u!.active_30d} sur 30 jours`} color="#2f9e6b" />
                <Kpi icon={ShieldCheck} label="Double authentification" value={`${u!.total ? Math.round((stats.mfa_users / u!.total) * 100) : 0} %`} sub={`${stats.mfa_users} compte${stats.mfa_users > 1 ? 's' : ''} protégé${stats.mfa_users > 1 ? 's' : ''}`} color="#7a5ad6" className="col-span-2 md:col-span-1" />
              </div>
            </section>

            <section aria-labelledby="admin-content">
              <h2 id="admin-content" className="eyebrow mb-2">Contenus</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi icon={NotebookText} label="Notes" value={c!.notes} sub={`${c!.note_folders} dossiers`} color="#d48a17" />
                <Kpi icon={CalendarDays} label="Événements" value={c!.events} sub={`${c!.events ? Math.round((c!.events_done / c!.events) * 100) : 0} % terminés`} color="#d9483b" />
                <Kpi icon={FolderClosed} label="Fichiers" value={c!.files} sub={u!.total ? `${(c!.files / u!.total).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} par compte` : undefined} color="#3b6fd8" />
                <Kpi icon={HardDrive} label="Stockage" value={formatBytes(c!.storage_bytes)} sub={`${c!.folders} dossiers`} color="#3b6fd8" />
              </div>
            </section>

            <section aria-labelledby="admin-trends">
              <h2 id="admin-trends" className="eyebrow mb-2">30 derniers jours</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="card p-4">
                  <h3 className="text-[13px] font-medium text-stone-600">Activité</h3>
                  <p className="text-[12px] text-stone-500">Notes, événements et fichiers créés par jour</p>
                  <div className="mt-3">
                    <DailyColumns data={stats.days} valueKey="created" label="éléments créés" labelOne="élément créé" color="var(--color-brand-500)" />
                  </div>
                </div>
                <div className="card p-4">
                  <h3 className="text-[13px] font-medium text-stone-600">Inscriptions</h3>
                  <p className="text-[12px] text-stone-500">Nouveaux comptes par jour</p>
                  <div className="mt-3">
                    <DailyColumns data={stats.days} valueKey="signups" label="inscriptions" labelOne="inscription" color="#3b6fd8" />
                  </div>
                </div>
              </div>
            </section>
          </div>
        ) : view === 'traiter' ? (
          <AdminInbox inbox={inbox} missing={inboxMissing} reload={() => void load()} />
        ) : view === 'comptes' ? (
          <AccountsTable accounts={accounts} total={stats.accounts.length} query={query} setQuery={setQuery} />
        ) : (
          <Categories stats={stats} />
        )}

        <p className="mt-6 text-[11px] text-stone-500">
          Ici, seulement des chiffres et la liste des comptes : le contenu des notes, des événements et des fichiers n’est jamais visible, sauf la copie d’un contenu de groupe signalé.
        </p>
      </div>
    </div>
  );
}

function AccountsTable({ accounts, total, query, setQuery }: { accounts: Account[]; total: number; query: string; setQuery: (q: string) => void }) {
  return (
    <section className="card overflow-hidden" aria-labelledby="admin-accounts">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-100 px-4 py-3">
        <h2 id="admin-accounts" className="mr-auto text-[13px] font-medium text-stone-600">
          Comptes <span className="tabular text-stone-500">({accounts.length === total ? total : `${accounts.length} sur ${total}`})</span>
        </h2>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nom ou e-mail" aria-label="Chercher un compte" className="field h-8 w-56 pl-8" />
        </div>
      </div>
      {accounts.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-stone-500">Aucun compte ne correspond.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="border-b border-stone-100 text-left text-[12px] text-stone-500">
                <th className="px-4 py-2 font-medium">Compte</th>
                <th className="px-3 py-2 font-medium">Inscrit</th>
                <th className="px-3 py-2 font-medium">Dernière connexion</th>
                <th className="px-3 py-2 font-medium">Sécurité</th>
                <th className="px-3 py-2 text-right font-medium">Notes</th>
                <th className="px-3 py-2 text-right font-medium">Événements</th>
                <th className="px-3 py-2 text-right font-medium">Fichiers</th>
                <th className="px-4 py-2 text-right font-medium">Stockage</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id} className="border-b border-stone-50 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">
                      {a.name || '—'}
                      {a.admin && <span className="ml-1.5 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">Admin</span>}
                    </p>
                    <p className="text-[12px] text-stone-500">{a.email}</p>
                  </td>
                  <td className="px-3 py-2.5 text-stone-600">{fmt(new Date(a.created_at), 'd MMM yyyy')}</td>
                  <td className="px-3 py-2.5 text-stone-600">{a.last_sign_in_at ? relativeTime(a.last_sign_in_at) : 'jamais'}</td>
                  <td className="px-3 py-2.5">
                    <span className={cx('inline-flex items-center gap-1 text-[12px]', a.mfa ? 'text-emerald-700' : 'text-stone-500')}>
                      <ShieldCheck size={13} /> {a.mfa ? '2FA active' : 'Sans 2FA'}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{a.notes}</td>
                  <td className="tabular px-3 py-2.5 text-right">{a.events}</td>
                  <td className="tabular px-3 py-2.5 text-right">{a.files}</td>
                  <td className="tabular px-4 py-2.5 text-right text-stone-600">{formatBytes(a.storage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Categories({ stats }: { stats: Stats }) {
  const categories = (Object.keys(CATEGORIES) as BuiltinCategory[]).map(k => ({ key: k, n: stats.events_by_category[k] ?? 0 }));
  // « Autres » : the events in the categories users created themselves (ids « c-… »).
  const others = Object.entries(stats.events_by_category).reduce((sum, [k, n]) => (k.startsWith('c-') ? sum + (n ?? 0) : sum), 0);
  const customs = stats.custom_categories;
  const catMax = Math.max(1, others, ...categories.map(x => x.n));
  const row = (key: string, label: string, n: number, color: string) => (
    <div key={key} className="grid grid-cols-[110px_1fr_48px] items-center gap-3 text-[13px]">
      <span className="flex items-center gap-2 text-stone-600">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="h-3 overflow-hidden rounded-r-[4px] bg-stone-100">
        <span className="block h-full rounded-r-[4px]" style={{ width: `${(n / catMax) * 100}%`, background: color }} />
      </span>
      <span className="tabular text-right text-stone-600">{n}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
      <section className="card p-4" aria-labelledby="admin-cats">
        <h2 id="admin-cats" className="text-[13px] font-medium text-stone-600">Événements par catégorie</h2>
        <p className="text-[12px] text-stone-500">Tous les comptes confondus</p>
        <div className="mt-4 space-y-2">
          {categories.map(({ key, n }) => row(key, CATEGORIES[key].label, n, CATEGORIES[key].color))}
          {row('autres', 'Autres', others, 'var(--color-stone-400)')}
        </div>
      </section>
      <section className="card p-4" aria-labelledby="admin-customs">
        <h2 id="admin-customs" className="text-[13px] font-medium text-stone-600">
          Autres : catégories créées par les utilisateurs{customs ? ` (${customs.length})` : ''}
        </h2>
        {!customs ? (
          <p className="mt-2 text-[12px] text-stone-500">Le détail s’affichera une fois la migration 2026-10-16 appliquée sur Supabase.</p>
        ) : customs.length === 0 ? (
          <p className="mt-2 text-[12px] text-stone-500">Aucune catégorie personnelle pour l’instant.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100 text-[13px]">
            {customs.map(c => (
              <li key={c.label} className="flex items-baseline gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate" title={c.label}>{c.label}</span>
                <span className="tabular shrink-0 text-[12px] text-stone-500">
                  {c.events} événement{c.events > 1 ? 's' : ''} · {c.users} compte{c.users > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
