import { createElement, useEffect, useRef, useState, type FormEvent } from 'react';
import { SelectField, TimeField } from '../../components/Pickers';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  User, Palette, Sparkles, GraduationCap, Bell, Database, ShieldCheck, Camera, Check, Download, Upload, CalendarArrowUp, LogOut, Trash2, ChevronRight,
  HardDrive, Smartphone, Keyboard, Briefcase, House, UserPlus, MessageSquareText, FolderDown, Mail, Megaphone, Settings2, ChevronLeft,
} from 'lucide-react';
import { GESTURES, IS_MAC, MARKDOWN, SHORTCUTS, keyChips } from './shortcuts';
import { openFeedback } from '../../lib/feedback';
import { openNews } from '../../lib/news';
import KompalyMark from '../../components/KompalyMark';
import AccountList from '../../components/AccountList';
import PasswordStrength from '../../components/PasswordStrength';
import Field, { FieldError } from '../../components/Field';
import { needsCredentials, PROVIDER_NAMES, savedAccounts, STALE_DAYS } from '../../lib/accounts';
import PasswordInput from '../../components/PasswordInput';
import { LEGAL_LINKS } from '../legal/links';
import { CONTACT } from '../../lib/feedback';
import { latestRelease, newsName, newsToShow } from '../../lib/news';
import { useTrashCount } from '../../lib/trash';
import { AUTH_MSG, confirmLogout, sameEmail, useAuth } from '../../store/auth';
import { useFocusLog } from '../../store/focusLog';
import { useSettings, ACCENTS, AVATAR_COLORS, applyAppearance, resolveDark, UI_STYLES, PRO_WALLS, type AccentKey, type ThemeMode, type Chattiness, type UiStyle, type ProWall, type TextSize } from '../../store/settings';
import { useCopilot } from '../../store/copilot';
import { useDrive } from '../../store/drive';
import { downloadZip } from '../drive/download';
import { useNotes } from '../../store/notes';
import { applyUsage, useCalendar } from '../../store/calendar';
import { loadUserData } from '../../store/session';
import { confirmAction, toast } from '../../store/ui';
import { exportBackup, importBackup, exportIcs, wipeUserData, clearBeforeAccountDeletion, resetLocalData, imageToAvatar } from '../../lib/backup';
import { chime } from '../../lib/notify';
import { deviceState, disableDevice } from '../../lib/push';
import PhoneReminders from '../../components/PhoneReminders';
import { devicePushChanged } from '../../lib/reminderScheduler';
import { TASK_DEFAULTS, TIMED_OPTIONS } from '../../lib/reminders';
import { install, installed, macSafari, useInstallOffer } from '../../lib/install';
import { formatBytes, noteText, cx } from '../../lib/utils';
import { fmt, fromKey, todayKey } from '../../lib/dates';
import Avatar from '../../components/Avatar';
import { Section, Row, Toggle, Segmented, Stepper } from './controls';
import PasskeySection from './PasskeySection';
import NavOrderSection from './NavOrderSection';
import { cloudEnabled, remembered } from '../../lib/supabase';
import { getStorageUser } from '../../lib/userStorage';
import { currentStreak, useBadges } from '../../lib/badges';
import { checkAiStatus, resetClaudeHistory } from '../../copilot/claudeBrain';
import { aiPausedUntil, aiPauseReason } from '../../copilot/aiPause';
import BadgeGrid from './BadgeGrid';
import { USAGES, WORDS, groupWords, type Usage } from '../../lib/usage';
import { PERSONAS, personaLabel } from '../../lib/personas';
import { scrollMotion } from '../../lib/a11y';
import LanguagePicker from '../../components/LanguagePicker';
import { t, tn, lang, locale } from '../../i18n';

/** The commit this version was built from (vite.config › define), '' in development. */
declare const __BUILD__: string;

/** Singular or plural of words that come from elsewhere (tn() takes fixed texts), by the language's rule like tn(). */
const plural = (n: number, one: string, many: string) => ((lang === 'fr' ? Math.abs(n) < 2 : Math.abs(n) === 1) ? one : many);

const TABS = [
  { key: 'profil', label: t('Profil'), icon: User },
  { key: 'apparence', label: t('Apparence'), icon: Palette },
  { key: 'copilot', label: t('Kompaly'), icon: Sparkles },
  { key: 'etudes', label: t('Études'), icon: GraduationCap },
  { key: 'notifications', label: t('Notifications'), icon: Bell },
  { key: 'donnees', label: t('Données'), icon: Database },
  { key: 'raccourcis', label: t('Raccourcis'), icon: Keyboard },
  { key: 'compte', label: t('Compte'), icon: ShieldCheck },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const USAGE_ICONS: Record<Usage, typeof GraduationCap> = { etudes: GraduationCap, travail: Briefcase, perso: House };

// ── Profile ─────────────────────────────────────────────────────────────────

function useStats() {
  const items = useDrive(s => s.items);
  const notes = useNotes(s => s.notes);
  const events = useCalendar(s => s.events);
  const { focusSessions, focusTotalMinutes } = useSettings();
  // The counters live in the settings, which a device left behind can overwrite with older values:
  // the session log (one row per session, never overwritten) is the floor.
  const log = useFocusLog(s => s.sessions);
  const files = items.filter(i => i.kind === 'file');
  const today = todayKey();
  const streak = currentStreak(events);
  return {
    files: files.length,
    size: files.reduce((s, f) => s + (f.size ?? 0), 0),
    notes: notes.length,
    words: notes.reduce((s, n) => s + (noteText(n).match(/\S+/g)?.length ?? 0), 0),
    done: events.filter(e => e.done).length,
    exams: events.filter(e => e.category === 'examen' && (e.done || e.date < today)).length,
    focusSessions: Math.max(focusSessions, log.length),
    focusHours: Math.max(focusTotalMinutes, log.reduce((s, x) => s + x.minutes, 0)) / 60,
    streak,
  };
}

function Stat({ value, label, sub }: { value: string | number; label: string; sub?: string }) {
  return (
    <div className="px-5 py-4">
      <p className="tabular text-[20px] font-semibold leading-none tracking-tight">{value}</p>
      <p className="mt-1 text-[12px] text-stone-500">
        {label}
        {sub && <span className="text-stone-500"> · {sub}</span>}
      </p>
    </div>
  );
}

/** Badges: a quiet, collapsed section (open when reached through a « Voir mes badges » link). */
function BadgesSection() {
  const badges = useBadges();
  const location = useLocation();
  const [open, setOpen] = useState(location.hash === '#badges');
  const earned = badges.filter(b => b.earned).length;
  useEffect(() => {
    if (location.hash === '#badges') document.getElementById('badges')?.scrollIntoView({ behavior: scrollMotion() });
  }, [location.hash]);
  return (
    <section id="badges" className="card enter scroll-mt-4">
      <h2>
        <button onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls="badges-grille" className="flex w-full items-center gap-2 rounded-xl px-5 py-4 text-left">
          <ChevronRight size={15} className={cx('text-stone-400 transition-transform', open && 'rotate-90')} />
          <span className="text-[14px] font-semibold">{t('Récompenses')}</span>
          <span className="tabular text-[13px] font-normal text-stone-500">
            · {t('{n} sur {total}', { n: earned, total: badges.length })}
          </span>
        </button>
      </h2>
      {open && (
        <div id="badges-grille" className="border-t border-stone-100 p-5">
          <BadgeGrid badges={badges} />
        </div>
      )}
    </section>
  );
}

function ProfileTab() {
  const user = useAuth(s => s.user)!;
  const updateName = useAuth(s => s.updateName);
  const settings = useSettings();
  const words = WORDS[settings.usage] ?? WORDS.etudes;
  const stats = useStats();
  const statTiles = [
    { value: stats.streak, label: tn(stats.streak, 'jour d’affilée', 'jours d’affilée') },
    { value: stats.done, label: tn(stats.done, 'élément coché', 'éléments cochés') },
    { value: stats.exams, label: plural(stats.exams, words.pastOne, words.pastMany) },
    {
      value: stats.focusSessions,
      label: tn(stats.focusSessions, 'séance de concentration', 'séances de concentration'),
      sub: stats.focusHours ? t('{hours} h', { hours: stats.focusHours.toLocaleString(locale(), { maximumFractionDigits: 1 }) }) : undefined,
    },
    { value: stats.notes, label: tn(stats.notes, 'note', 'notes'), sub: stats.words ? tn(stats.words, '{count} mot', '{count} mots', { count: stats.words.toLocaleString(locale()) }) : undefined },
    { value: stats.files, label: tn(stats.files, 'fichier', 'fichiers'), sub: stats.files ? formatBytes(stats.size) : undefined },
  ].filter(s => s.value > 0);
  const [name, setName] = useState(user.name);
  const [nameError, setNameError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // The three fields below change meaning with the use (« Établissement » → « Entreprise »): emptied, but
  // « Annuler » brings the use and what they held back.
  const changeUsage = (usage: Usage) => {
    if (usage === settings.usage) return;
    const before = { usage: settings.usage, year: settings.year, school: settings.school, program: settings.program };
    settings.set({ usage, year: '', school: '', program: '' });
    applyUsage(usage);
    if (before.year || before.school || before.program)
      toast(t('{fields} vidés pour « {usage} »', { fields: [words.school, words.program, words.level].join(', '), usage: USAGES.find(u => u.key === usage)?.label ?? '' }), 'info', {
        label: t('Annuler'),
        run: () => {
          useSettings.getState().set(before);
          applyUsage(before.usage);
        },
      });
  };

  const pickPhoto = async (f?: File) => {
    if (!f) return;
    try {
      settings.set({ avatarImage: await imageToAvatar(f) });
      toast(t('Photo mise à jour'), 'success');
    } catch {
      toast(t('Impossible de lire cette image'), 'error');
    }
  };

  return (
    <div className="space-y-5">
      <Section label={t('Profil')}>
        <div className="flex flex-wrap items-center gap-5 px-5 py-5">
          <div className="relative">
            <Avatar size={72} />
            <button onClick={() => fileRef.current?.click()} className="hit absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-ink text-paper hover:bg-stone-700" title={t('Changer la photo')} aria-label={t('Changer la photo')}>
              <Camera size={13} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          {/* Phones: under the photo, the whole width (beside it, the colours went on three rows). */}
          <div className="min-w-0 flex-1 max-sm:basis-full">
            <p className="break-words text-[18px] font-semibold tracking-tight">{user.name}</p>
            {/* Phones: the date on its own line, so a long e-mail never leaves « · » at the start of a line. */}
            <p className="text-[13px] text-stone-500 [overflow-wrap:anywhere]">
              {user.email}<span className="max-sm:hidden">{'\u00a0'}· </span>
              <span className="max-sm:block max-sm:first-letter:uppercase">{t('inscription le {date}', { date: fmt(new Date(user.createdAt), 'd MMMM yyyy').replace(/ /g, '\u00a0') })}</span>
            </p>
            {/* Touch: up to 36 px dots 6 px apart, the eight on one line (a grid: on a small phone they get smaller rather
                than leaving the last one alone on a second line), each with a 44 px tap zone (.hit). */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 pointer-coarse:grid pointer-coarse:max-w-[330px] pointer-coarse:grid-cols-8">
              {AVATAR_COLORS.map((c, i) => (
                <button
                  key={c}
                  aria-label={t('Couleur de l’avatar {n}', { n: i + 1 })}
                  aria-pressed={!settings.avatarImage && settings.avatarColor === c}
                  onClick={() => settings.set({ avatarColor: c, avatarImage: null })}
                  className="hit flex h-6 w-6 items-center justify-center rounded-full ring-offset-2 transition-transform hover:scale-110 pointer-coarse:aspect-square pointer-coarse:h-auto pointer-coarse:w-full pointer-coarse:max-w-9"
                  style={{ background: c, boxShadow: !settings.avatarImage && settings.avatarColor === c ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${c}` : undefined }}
                  title={t('Couleur de l’avatar')}
                />
              ))}
              {settings.avatarImage && (
                <button className="hit ml-2 text-[12px] text-stone-500 underline pointer-coarse:col-span-full pointer-coarse:ml-0 pointer-coarse:justify-self-start underline-offset-2 hover:text-ink" onClick={async () => (await confirmAction(t('Retirer ta photo ?'), undefined, t('Retirer'))) && settings.set({ avatarImage: null })}>
                  {t('Retirer la photo')}
                </button>
              )}
            </div>
          </div>
        </div>
        <Row label={t('Prénom')}>
          <div className="w-56">
          <input
            className="field w-full"
            aria-label={t('Prénom')}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'profile-name-err' : undefined}
            maxLength={40}
            value={name}
            onChange={e => {
              setName(e.target.value);
              if (e.target.value.trim().length >= 2) setNameError('');
            }}
            onBlur={() => {
              if (name.trim().length >= 2 && name.trim() !== user.name) {
                setName(name.trim());
                updateName(name.trim()).then(
                  () => toast(t('Prénom enregistré'), 'success'),
                  (e: Error) => {
                    toast(e.message, 'error');
                    setName(user.name);
                  },
                );
              } else if (name.trim() !== user.name) {
                // Too short: said under the field, which keeps what was typed (the saved name stays).
                setNameError(t('Ton prénom doit contenir au moins 2 caractères.'));
              } else {
                // Same name with spaces around it: shown as saved.
                setName(user.name);
              }
            }}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <FieldError id="profile-name-err">{nameError}</FieldError>
          </div>
        </Row>
        <Row label={t('Kompaly sert pour')}>
          <SelectField<Usage> className="w-56" label={t('Kompaly sert pour')} value={settings.usage} options={USAGES.map(u => ({ value: u.key, label: u.label }))} onChange={changeUsage} />
        </Row>
        <Row label={words.school}>
          <input className="field w-56" aria-label={words.school} value={settings.school} placeholder={words.schoolHint} onChange={e => settings.set({ school: e.target.value })} />
        </Row>
        <Row label={words.program}>
          <input className="field w-56" aria-label={words.program} value={settings.program} placeholder={words.programHint} onChange={e => settings.set({ program: e.target.value })} />
        </Row>
        <Row label={words.level}>
          <SelectField<string>
            className="w-56"
            label={words.level}
            value={settings.year}
            options={(words.levels.includes(settings.year) ? words.levels : [...words.levels, settings.year]).map(y => ({ value: y, label: y || '—' }))}
            onChange={year => settings.set({ year })}
          />
        </Row>
      </Section>

      {/* Only what is not zero: a new account had six tiles at 0 (all zero: no block at all). */}
      {statTiles.length > 0 && (
        <Section title={t('Statistiques')}>
          <div className="grid grid-cols-2 md:grid-cols-3">
            {statTiles.map(s => (
              <Stat key={s.label} {...s} />
            ))}
          </div>
        </Section>
      )}

      <BadgesSection />
    </div>
  );
}

// ── Appearance ──────────────────────────────────────────────────────────────

const STYLE_LABELS: Record<UiStyle, string> = { classique: t('Classique'), verre: t('Verre'), liquide: t('Liquid Glass'), relief: t('Relief') };
/** What each style looks like, in one plain line (under the choices: « Liquid Glass » says nothing to most people). */
const STYLE_HINTS: Record<UiStyle, string> = {
  classique: t('Des cartes blanches et nettes sur un fond gris clair.'),
  verre: t('Des cartes transparentes, comme du verre dépoli, sur un fond coloré.'),
  liquide: t('Des cartes en verre bombé qui reflètent la lumière, aux bords bien arrondis.'),
  relief: t('Des cartes en léger relief, comme moulées dans la page.'),
};

/** A small picture of each style: its page, a card and a button (drawn, not the real thing), in the theme on screen. */
function StylePreview({ look, dark }: { look: UiStyle; dark: boolean }) {
  // The colours of index.css / themes.css: light, then dark.
  const page: Record<UiStyle, [string, string]> = {
    classique: ['#eceef3', '#0c0d12'],
    verre: [
      'radial-gradient(60% 70% at 10% 10%, #b7c4ff, transparent 70%), radial-gradient(60% 70% at 95% 90%, #ffd6b0, transparent 70%), radial-gradient(50% 60% at 90% 5%, #ffc6dc, transparent 70%), #e7eaf6',
      'radial-gradient(60% 70% at 10% 10%, #283a96, transparent 70%), radial-gradient(60% 70% at 95% 90%, #174f5c, transparent 70%), radial-gradient(50% 60% at 90% 5%, #5b2775, transparent 70%), #0b0d18',
    ],
    liquide: ['radial-gradient(70% 60% at 10% 0%, #ffffff, transparent 70%), #e6e8ec', 'radial-gradient(70% 60% at 10% 0%, #2c2e36, transparent 70%), #111215'],
    relief: ['#e4e9f2', '#1e2126'],
  };
  const card: Record<UiStyle, [React.CSSProperties, React.CSSProperties]> = {
    classique: [{ background: '#ffffff', borderRadius: 10 }, { background: '#171922', borderRadius: 10 }],
    verre: [
      { background: 'rgb(255 255 255 / 0.55)', borderRadius: 10, boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.8), 0 6px 14px -8px rgb(40 52 110 / 0.4)', backdropFilter: 'blur(6px)' },
      { background: 'rgb(26 30 50 / 0.55)', borderRadius: 10, boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.12), 0 6px 14px -8px rgb(0 0 0 / 0.6)', backdropFilter: 'blur(6px)' },
    ],
    liquide: [
      { background: 'linear-gradient(140deg, rgb(255 255 255 / 0.85), rgb(255 255 255 / 0.35) 45%, rgb(255 255 255 / 0.55))', borderRadius: 12, boxShadow: 'inset 1px 1px 0 #fff, 0 0 0 0.5px rgb(20 22 31 / 0.08), 0 6px 14px -8px rgb(20 22 31 / 0.35)' },
      { background: 'linear-gradient(140deg, rgb(255 255 255 / 0.14), rgb(255 255 255 / 0.04) 45%, rgb(255 255 255 / 0.08))', borderRadius: 12, boxShadow: 'inset 1px 1px 0 rgb(255 255 255 / 0.22), 0 0 0 0.5px rgb(0 0 0 / 0.4), 0 6px 14px -8px rgb(0 0 0 / 0.7)' },
    ],
    relief: [
      { background: '#e4e9f2', borderRadius: 10, boxShadow: '4px 4px 9px #bdc6d6, -4px -4px 9px #ffffff' },
      { background: '#252930', borderRadius: 10, boxShadow: '4px 4px 9px #0e1013, -3px -3px 8px #30353d' },
    ],
  };
  const ink = dark ? '#eceef3' : '#14161f';
  const button: Record<UiStyle, React.CSSProperties> = {
    classique: { background: ink, borderRadius: 5 },
    verre: { background: ink, borderRadius: 5 },
    liquide: { background: ink, borderRadius: 999 },
    relief: dark ? { background: '#252930', borderRadius: 5, boxShadow: '2px 2px 4px #0e1013, -2px -2px 4px #30353d' } : { background: '#e4e9f2', borderRadius: 5, boxShadow: '2px 2px 4px #bdc6d6, -2px -2px 4px #ffffff' },
  };
  const line = look === 'relief' ? (dark ? '#6b7385' : '#9aa3b8') : dark ? 'rgb(236 238 243 / 0.55)' : 'rgb(20 22 31 / 0.55)';
  const i = dark ? 1 : 0;
  return (
    <span aria-hidden className="relative block h-16 overflow-hidden rounded-[11px]" style={{ background: page[look][i] }}>
      <span className="absolute inset-x-2.5 top-2.5 bottom-2.5 flex flex-col justify-between p-2" style={card[look][i]}>
        <span className="block h-1.5 w-2/3 rounded-full" style={{ background: line }} />
        <span className="block h-3 w-8" style={button[look]} />
      </span>
    </span>
  );
}

const PRO_WALL_LABELS: Record<ProWall, string> = { montagne: t('Montagne'), nuit: t('Nuit'), aurore: t('Aurore'), maree: t('Marée'), braise: t('Braise') };
// The thumbnails: the same pictures and colours as themes.css › data-pro.
const PRO_WALL_PREVIEW: Record<ProWall, string> = {
  montagne: "url('/pro/montagne.webp') center / cover",
  nuit: "url('/pro/nuit.webp') center / cover",
  aurore: 'linear-gradient(180deg, rgb(8 9 14 / 0.24), rgb(8 9 14 / 0.5)), radial-gradient(60% 55% at 18% 22%, #1f7a6a, transparent 70%), radial-gradient(55% 60% at 85% 30%, #5b3fa8, transparent 70%), radial-gradient(70% 60% at 50% 95%, #2a5fa8, transparent 70%), #0d1020',
  maree: 'linear-gradient(180deg, rgb(8 9 14 / 0.24), rgb(8 9 14 / 0.5)), radial-gradient(60% 55% at 18% 22%, #1f5fd1, transparent 70%), radial-gradient(55% 60% at 85% 30%, #2bb3d9, transparent 70%), radial-gradient(70% 60% at 50% 95%, #1b3a8a, transparent 70%), #0a1022',
  braise: 'linear-gradient(180deg, rgb(8 9 14 / 0.24), rgb(8 9 14 / 0.5)), radial-gradient(60% 55% at 18% 22%, #d9542b, transparent 70%), radial-gradient(55% 60% at 85% 30%, #b8452a, transparent 70%), radial-gradient(70% 60% at 50% 95%, #a8243a, transparent 70%), #1a0c0a',
};

/** « Affichage Pro »: one switch, then its wallpaper. Over the theme and the style (kept, they come back when it is off). */
function ProSection() {
  const settings = useSettings();
  const setPro = (pro: boolean) => {
    settings.set({ pro });
    applyAppearance({ ...settings, pro });
  };
  const setWall = (proWall: ProWall) => {
    settings.set({ proWall });
    applyAppearance({ ...settings, proWall });
  };
  return (
    <Section label={t('Affichage Pro')}>
      <Row label={t('Affichage Pro')} hint={t('Un autre look, toujours sombre : un fond d’écran, des tuiles de couleur pour voir d’un coup d’œil ce qui compte, une barre d’icônes qui flotte en bas et le minuteur en haut de l’écran.')}>
        <Toggle label={t('Affichage Pro')} checked={!!settings.pro} onChange={setPro} />
      </Row>
      {settings.pro && (
        <div className="px-5 py-4">
          <p className="text-[13.5px] font-medium" id="pro-wall-label">{t('Fond d’écran')}</p>
          <div role="group" aria-labelledby="pro-wall-label" className="mt-2.5 grid grid-cols-3 gap-2.5 sm:grid-cols-5">
            {PRO_WALLS.map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setWall(k)}
                aria-pressed={settings.proWall === k}
                className={cx('rounded-[18px] p-1.5 text-left ring-1 transition-colors', settings.proWall === k ? 'bg-white/10 ring-2 ring-white/90' : 'ring-white/10 hover:ring-white/25')}
              >
                <span aria-hidden className="block aspect-[4/3] rounded-[12px]" style={{ background: PRO_WALL_PREVIEW[k] }} />
                <span className="mt-1.5 flex items-center gap-1.5 px-1 text-[13px] font-semibold">
                  {settings.proWall === k && <Check size={13} strokeWidth={3} aria-hidden />}
                  {PRO_WALL_LABELS[k]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function AppearanceTab() {
  const settings = useSettings();
  const dark = resolveDark(settings.theme);
  const look = settings.pro ? null : (settings.style ?? 'classique');
  const setAccent = (accent: AccentKey) => {
    settings.set({ accent });
    applyAppearance({ ...settings, accent });
  };
  const setTheme = (theme: ThemeMode) => {
    settings.set({ theme });
    applyAppearance({ ...settings, theme });
  };
  const setStyle = (style: UiStyle) => {
    settings.set({ style });
    applyAppearance({ ...settings, style });
  };
  const setTextSize = (textSize: TextSize) => {
    settings.set({ textSize });
    applyAppearance({ ...settings, textSize });
  };
  return (
    <div className="space-y-5">
    {/* First: the one setting someone who reads with difficulty comes for. */}
    <Section label={t('Taille du texte')}>
      <Row label={t('Taille du texte')} hint={t('Tout le texte de Kompaly, plus grand pour lire sans effort.')}>
        <Segmented
          label={t('Taille du texte')}
          value={settings.textSize ?? 'normal'}
          onChange={setTextSize}
          options={[
            { value: 'normal', label: t('Normal') },
            { value: 'grand', label: t('Grand') },
            { value: 'tresgrand', label: t('Très grand') },
          ]}
        />
      </Row>
    </Section>
    <ProSection />
    <Section label={t('Apparence')}>
      {settings.pro && <p className="px-5 py-3 text-[12.5px] text-stone-500">{t('L’Affichage Pro est actif : il remplace le thème et le style. Coupe-le pour en choisir un autre.')}</p>}
      {/* Pro on: the other looks are off (nothing chosen, nothing to tap); they come back as they were when it is turned off. */}
      <fieldset disabled={!!settings.pro} className={cx('min-w-0 border-0 p-0', settings.pro && 'pointer-events-none opacity-40')}>
      <Row label={t('Thème')}>
        <Segmented
          label={t('Thème')}
          value={settings.pro ? ('' as ThemeMode) : settings.theme}
          onChange={setTheme}
          options={[
            { value: 'clair', label: t('Clair') },
            { value: 'sombre', label: t('Sombre') },
            { value: 'auto', label: t('Automatique') },
          ]}
        />
      </Row>
      <div className="px-5 py-4">
        <p className="text-[13.5px] font-medium" id="style-label">{t('Style')}</p>
        <div role="group" aria-labelledby="style-label" className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {UI_STYLES.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setStyle(k)}
              aria-pressed={look === k}
              className={cx('rounded-[16px] p-1.5 text-left ring-1 transition-colors', look === k ? 'ring-2 ring-brand-500' : 'ring-stone-200 hover:ring-stone-300')}
            >
              <StylePreview look={k} dark={dark} />
              <span className="mt-1.5 flex items-center gap-1.5 px-1 text-[13px] font-semibold">
                {look === k && <Check size={13} strokeWidth={3} className="text-brand-600" aria-hidden />}
                {STYLE_LABELS[k]}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-stone-500" aria-live="polite">
          {look && t('{style}\u00a0: {hint}', { style: STYLE_LABELS[look], hint: STYLE_HINTS[look] })}
        </p>
      </div>
      </fieldset>
      <Row label={t('Langue')}>
        <LanguagePicker />
      </Row>
      <Row label={t('Couleur d’accent')}>
        <div className="flex gap-1.5 pointer-coarse:gap-2" role="group" aria-label={t('Couleur d’accent')}>
          {(Object.keys(ACCENTS) as AccentKey[]).map(k => (
            <button
              key={k}
              onClick={() => setAccent(k)}
              title={ACCENTS[k].label}
              aria-label={ACCENTS[k].label}
              aria-pressed={settings.accent === k}
              className="hit flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110 pointer-coarse:h-9 pointer-coarse:w-9"
              style={{ background: ACCENTS[k].shades[500], boxShadow: settings.accent === k ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${ACCENTS[k].shades[500]}` : undefined }}
            >
              {settings.accent === k && <Check size={13} strokeWidth={3} className="text-white" />}
            </button>
          ))}
        </div>
      </Row>
      {/* Preview only: no real button (no Tab stop), nothing announced. No Kompaly: the real one is beside it. */}
      <div className="flex items-center gap-4 overflow-hidden bg-stone-50/70 px-5 py-4" aria-hidden>
        <span className="btn-primary pointer-events-none">{t('Bouton')}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-solid text-[13px] font-semibold text-on-brand">{new Date().getDate()}</span>
        <span className="rounded-md bg-brand-50 px-2 py-1 text-[12px] font-medium text-brand-700">{t('Sélection')}</span>
      </div>
      <Row label={t('Réduire les animations')}>
        <Toggle
          label={t('Réduire les animations')}
          checked={settings.reduceMotion}
          onChange={v => {
            settings.set({ reduceMotion: v });
            applyAppearance({ ...settings, reduceMotion: v });
          }}
        />
      </Row>
    </Section>
    <NavOrderSection />
    </div>
  );
}

// ── Kompaly ─────────────────────────────────────────────────────────────────


function CopilotTab() {
  const s = useSettings();
  const aiEnabled = useCopilot(c => c.aiEnabled);
  const messages = useCopilot(c => c.messages.length);
  const [provider, setProvider] = useState('');
  useEffect(() => {
    void checkAiStatus().then(st => setProvider(st.enabled ? (st.label ?? st.provider ?? '') : ''));
  }, []);
  // The AI paused after a limit or a problem: simple mode for now, like the header of Kompaly's panel.
  const [now, setNow] = useState(() => Date.now());
  const pausedUntil = aiEnabled ? aiPausedUntil() : 0;
  useEffect(() => {
    if (!aiEnabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [aiEnabled]);
  const left = Math.max(0, Math.ceil((pausedUntil - now) / 1000));
  const clock = left >= 3600 ? `${Math.floor(left / 3600)} h ${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}` : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const paused = left > 0;
  return (
    <div className="space-y-5">
      <Section label={t('Kompaly')}>
        {/* The state on the first line, what it means under it (two lines, never a sentence wrapped into the other). */}
        <div className="flex items-start gap-3 px-5 py-4">
          <span className={cx('mt-[5px] h-2 w-2 shrink-0 rounded-full', !aiEnabled ? 'bg-stone-400' : paused ? 'bg-amber-500' : 'bg-emerald-500')} />
          <div className="min-w-0 text-[13px]">
            <p className="font-medium">{s.simpleOnly ? t('Mode simple uniquement.') : paused ? t('Mode simple pour l’instant.') : aiEnabled ? t('Mode intelligent activé.') : t('Mode simple.')}</p>
            {s.simpleOnly ? (
              <p className="text-[12px] text-stone-500">{t('Rien n’est envoyé à une IA.')}</p>
            ) : paused ? (
              <p className="text-[12px] text-stone-500">
                {aiPauseReason() === 'error' ? t('L’IA ne répond pas, retour dans') : aiPauseReason() === 'mine' ? t('Tes questions du jour sont utilisées, retour dans') : t('L’IA gratuite a atteint sa limite, retour dans')} <span className="tabular">{clock}</span>.
              </p>
            ) : aiEnabled ? (
              provider && <p className="text-[12px] text-stone-500">{t('IA\u00a0: {provider}', { provider })}</p>
            ) : (
              <p className="text-[12px] text-stone-500">{t('Il comprend les commandes courantes.')}</p>
            )}
          </div>
        </div>
        {/* Read by Kompaly's chat (store/copilot › aiEnabled), the recording and the photo sheet (lib/recorder/api), and the server. */}
        <Row label={t('Mode simple uniquement')} hint={t('Rien n’est envoyé à une IA : Kompaly répond sur ton appareil aux demandes courantes (« dentiste mardi 17h30 », « qu’est-ce que j’ai demain ? »). L’enregistrement écrit et la fiche depuis une photo, qui passent par une IA, sont alors coupés.')}>
          <Toggle label={t('Mode simple uniquement')} checked={!!s.simpleOnly} onChange={v => s.set({ simpleOnly: v })} />
        </Row>
        <Row label={t('Afficher Kompaly')} hint={t('Caché, il reste là : « Kompaly » dans le menu (en haut sur téléphone) ou {key} + J.', { key: IS_MAC ? '⌘' : t('Ctrl') })}>
          <Toggle label={t('Afficher Kompaly')} checked={s.copilotVisible} onChange={v => s.set({ copilotVisible: v })} />
        </Row>
        <Row label={t('Initiatives')} hint={s.usage === 'etudes' ? t('Propose des révisions, rappelle les rendus.') : s.usage === 'perso' ? t('Propose du temps de préparation, rappelle les grands jours.') : t('Propose du temps de préparation, rappelle les échéances.')}>
          <Toggle label={t('Initiatives')} checked={s.proactive} onChange={v => s.set({ proactive: v })} />
        </Row>
        <Row label={t('Bavardage')}>
          <Segmented<Chattiness> label={t('Bavardage')}
            value={s.chattiness}
            onChange={v => s.set({ chattiness: v })}
            options={[
              { value: 'calme', label: t('Discret') },
              { value: 'normal', label: t('Normal') },
              { value: 'bavard', label: t('Bavard') },
            ]}
          />
        </Row>
        <Row label={t('Annoncer les nouvelles récompenses')}>
          <Toggle label={t('Annoncer les nouvelles récompenses')} checked={s.badgeAnnouncements} onChange={v => s.set({ badgeAnnouncements: v })} />
        </Row>
      </Section>

      <Section title={t('Personnalité')}>
        <div className="grid gap-2 px-5 py-4 sm:grid-cols-2">
          {PERSONAS.map(p => (
            <button
              key={p.key}
              onClick={() => s.set({ persona: p.key })}
              aria-pressed={s.persona === p.key}
              className={cx(
                'rounded-lg border px-3.5 py-3 text-left transition-colors',
                s.persona === p.key ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">{personaLabel(p, s.usage)}</span>
                {s.persona === p.key && <Check size={14} className="text-brand-600" />}
              </span>
              <span className="mt-0.5 block text-[12px] text-stone-500">{p.description}</span>
            </button>
          ))}
        </div>
        <div className="px-5 py-4">
          <label htmlFor="persona-notes" className="mb-1.5 block text-[13px] font-medium">
            {t('Tes instructions pour Kompaly')}
          </label>
          <textarea
            id="persona-notes"
            className="field h-auto! min-h-[84px] w-full resize-y py-2 leading-relaxed"
            maxLength={600}
            value={s.personaNotes}
            onChange={e => s.set({ personaNotes: e.target.value.slice(0, 600) })}
            placeholder={t('Appelle-moi Capitaine, parle-moi de foot.')}
          />
          <p className={cx('mt-1 text-right text-[11px] tabular', s.personaNotes.length >= 560 ? 'text-amber-600' : 'text-stone-500')}>{s.personaNotes.length}/600</p>
        </div>
      </Section>

      <Section title={t('Rendez-vous||rendez-vous réguliers avec Kompaly : point du matin, bilan')}>
        <Row label={t('Point du matin')}>
          <Toggle label={t('Point du matin')} checked={s.morningBrief} onChange={v => s.set({ morningBrief: v })} />
        </Row>
        <Row label={t('Bilan du dimanche')}>
          <Toggle label={t('Bilan du dimanche')} checked={s.weeklyReview} onChange={v => s.set({ weeklyReview: v })} />
        </Row>
      </Section>

      <Section title={t('Mémoire')}>
        <Row label={t('Conversation')} hint={tn(messages, '{n} message enregistré.', '{n} messages enregistrés.')}>
          <button
            className="btn-secondary h-8"
            onClick={async () => {
              if (!(await confirmAction(t('Effacer la conversation ?'), t('Sur cet appareil.'), t('Effacer')))) return;
              useCopilot.getState().clearHistory();
              resetClaudeHistory();
              toast(t('Conversation effacée'), 'success');
            }}
          >
            {t('Effacer')}
          </button>
        </Row>
        <Row label={t('Remarques déjà faites')} hint={t('Il pourra te les refaire.')}>
          <button className="btn-secondary h-8" onClick={() => { useCopilot.setState({ memory: {} }); toast(t('Mémoire réinitialisée'), 'success'); }}>
            {t('Réinitialiser')}
          </button>
        </Row>
        <Row label={t('Position sur l’écran')}>
          <button className="btn-secondary h-8" onClick={() => { useCopilot.getState().setOffsetY(0.62); toast(t('Kompaly est revenu à sa place')); }}>
            {t('Replacer')}
          </button>
        </Row>
      </Section>
    </div>
  );
}

// ── Studies ─────────────────────────────────────────────────────────────────

function StudiesTab() {
  const s = useSettings();
  // Work and personal use: « créneaux » (time set aside), « séances » are for revising.
  const studies = s.usage === 'etudes';
  const count = studies ? t('Nombre de séances') : t('Nombre de créneaux');
  const hour = studies ? t('Heure des séances') : t('Heure des créneaux');
  return (
    <div className="space-y-5">
      <Section title={t('Concentration')}>
        <Row label={t('Durée de travail')}>
          <Segmented<number> label={t('Durée de travail')} value={s.focusMinutes} onChange={v => s.set({ focusMinutes: v })} options={[15, 25, 45, 50].map(v => ({ value: v, label: t('{n} min', { n: v }) }))} />
        </Row>
        <Row label={t('Durée de pause')}>
          <Segmented<number> label={t('Durée de pause')} value={s.breakMinutes} onChange={v => s.set({ breakMinutes: v })} options={[5, 10, 15].map(v => ({ value: v, label: t('{n} min', { n: v }) }))} />
        </Row>
        <Row label={t('Son de fin de session')}>
          <button className="btn-ghost h-8 text-[12px]" onClick={chime}>
            {t('Écouter')}
          </button>
          <Toggle label={t('Son')} checked={s.focusSound} onChange={v => s.set({ focusSound: v })} />
        </Row>
      </Section>

      <Section title={studies ? t('Planification des révisions') : t('Temps de préparation')}>
        <Row label={count}>
          <Stepper label={count} value={s.revisionSessions} min={1} max={6} onChange={v => s.set({ revisionSessions: v })} />
        </Row>
        <Row label={hour} hint={studies ? t('Chaque séance dure 1 h 30.') : t('Chaque créneau dure 1 h 30.')}>
          <TimeField className="w-32" label={hour} value={s.revisionTime} onChange={v => v && s.set({ revisionTime: v })} />
        </Row>
      </Section>
    </div>
  );
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────

function Keys({ spec }: { spec: string }) {
  return (
    <dd className="flex max-w-[62%] flex-wrap items-center justify-end gap-1">
      {keyChips(spec).map((steps, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-[11px] text-stone-500">{t('ou')}</span>}
          {steps.map((k, j) => (
            <span key={j} className="flex items-center gap-1">
              {j > 0 && <span className="text-[11px] text-stone-500">{t('puis')}</span>}
              <kbd className="kbd">{k}</kbd>
            </span>
          ))}
        </span>
      ))}
    </dd>
  );
}

function ShortcutList({ groups, gestures }: { groups: { group: string; keys: [string, string][] }[]; gestures?: boolean }) {
  return groups.map(g => (
    <div key={g.group} className="@container px-5 py-3">
      <h3 className="eyebrow mb-1">{g.group}</h3>
      {/* Two columns only where each one has room (not beside the tabs on a 1024 px screen: « Rechercher (pages, réglages… » on 5 lines). */}
      <dl className="grid gap-x-8 @2xl:grid-cols-2">
        {g.keys.map(([k, d]) =>
          // A gesture is a sentence: the gesture, and what it does under it.
          gestures ? (
            <div key={k + d} className="py-1.5 text-[13px]">
              <dt className="font-medium text-stone-700">{k}</dt>
              <dd className="text-stone-500">{d}</dd>
            </div>
          ) : (
            <div key={k + d} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
              <dt className="min-w-0 text-stone-600">{d}</dt>
              <Keys spec={k} />
            </div>
          ),
        )}
      </dl>
    </div>
  ));
}

function ShortcutsTab() {
  // A phone or a tablet without a mouse: the gestures first, the keys (a keyboard plugged in) on demand.
  const [touch] = useState(() => matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches);
  const [keys, setKeys] = useState(!touch);
  return (
    <div className="space-y-5">
      {touch && (
        <Section title={t('Gestes')}>
          <ShortcutList groups={GESTURES} gestures />
        </Section>
      )}
      <Section title={t('Raccourcis clavier')} description={touch ? t('Avec un clavier branché.') : undefined}>
        {keys ? (
          <ShortcutList groups={SHORTCUTS} />
        ) : (
          <div className="px-5 py-3">
            <button type="button" className="btn-secondary h-9" onClick={() => setKeys(true)} aria-expanded={false}>
              <Keyboard size={14} aria-hidden /> {t('Voir les raccourcis clavier')}
            </button>
          </div>
        )}
      </Section>
      <Section title={t('Mise en forme en tapant')} description={t('Dans une note, au début d’une ligne ou autour d’un mot.')}>
        <div className="@container px-5 py-3">
          <dl className="grid gap-x-8 @2xl:grid-cols-2">
            {MARKDOWN.map(([k, d]) => (
              <div key={k} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
                <dt className="min-w-0 text-stone-600">{d}</dt>
                <dd className="shrink-0 font-mono text-[12px] text-stone-700">{k}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>
    </div>
  );
}

// ── Notifications ───────────────────────────────────────────────────────────

function NotificationsTab() {
  const s = useSettings();
  // Kept in step with the block above it (« Activer les rappels » there shows the switch here).
  const [state, setState] = useState(deviceState);
  const [busy, setBusy] = useState(false);
  const canInstall = useInstallOffer();

  const turnOff = async () => {
    setBusy(true);
    try {
      await disableDevice();
      setState(deviceState());
      await devicePushChanged();
    } finally {
      setBusy(false);
    }
  };

  const defaultValue = s.defaultReminders[0] ?? -1;
  return (
    <div className="space-y-5">
      <Section label={t('Sur cet appareil')}>
        {/* Per device: the iPhone's three gestures, « Activer », where to allow them again, a test reminder. */}
        <PhoneReminders key={state === 'on' ? 'on' : 'off'} onState={setState} />
        {state === 'on' && (
          <Row label={t('Notifications sur cet appareil')} hint={t('Coupe-les ici si tu ne veux plus de rappels sur cet appareil.')}>
            <Toggle label={t('Notifications sur cet appareil')} checked onChange={v => !v && !busy && void turnOff()} />
          </Row>
        )}
        {!installed() && (canInstall || macSafari()) && (
          <Row
            label={t('Installer Kompaly')}
            hint={canInstall ? t('Il s’ouvre dans sa propre fenêtre.') : t('Dans Safari : menu Fichier › Ajouter au Dock.')}
          >
            {canInstall && (
              <button className="btn-primary h-8" onClick={() => void install().then(ok => ok && toast(t('Kompaly est installé'), 'success'))}>
                {t('Installer')}
              </button>
            )}
          </Row>
        )}
      </Section>
      {/* Its own card, near the top (at the very bottom of the list, it wasn't found). Local mode: no e-mail is ever sent. */}
      {cloudEnabled && (
        <Section title={t('E-mails')}>
          <Row label={t('E-mail de conseils')} hint={t('Un seul, quelques jours après l’inscription : les astuces pour bien démarrer.')}>
            <Toggle label={t('E-mail de conseils')} checked={s.emailTips} onChange={x => s.set({ emailTips: x })} />
          </Row>
        </Section>
      )}
      <Section title={t('Rappels')}>
        <Row label={t('Rappel par défaut')} hint={t('Pour les événements avec une heure.')}>
          <SelectField<number>
            value={defaultValue}
            onChange={v => s.set({ defaultReminders: v < 0 ? [] : [v] })}
            label={t('Rappel par défaut')}
            className="h-9 w-52"
            options={[{ value: -1, label: t('Aucun') }, ...TIMED_OPTIONS.map(o => ({ value: o.minutes, label: o.label }))]}
          />
        </Row>
        {/* With « Point du matin », the 8:00 summary takes the place of the 9:00 reminder (lib/reminders › upcomingReminders). */}
        <Row label={t('Rappel par défaut des tâches')} hint={s.morningBrief ? t('Pour les tâches qui ont une date. Le jour même, c’est le point du matin, à 8 h, qui te les rappelle : pas de second rappel à 9 h.') : t('Pour les tâches datées (1 h avant celles qui ont une heure).')}>
          <SelectField<string>
            value={TASK_DEFAULTS.find(o => o.minutes.join() === [...s.defaultTaskReminders].sort((a, b) => b - a).join())?.value ?? 'les-deux'}
            onChange={v => s.set({ defaultTaskReminders: TASK_DEFAULTS.find(o => o.value === v)?.minutes ?? [900, 0] })}
            label={t('Rappel par défaut des tâches')}
            className="h-9 w-72 max-w-full"
            options={TASK_DEFAULTS.map(o => ({ value: o.value, label: o.label }))}
          />
        </Row>
      </Section>
      <Section title={t('Autres notifications')}>
        <Row label={t('Son des rappels')} hint={t('Un petit son avec chaque rappel, quand Kompaly est ouvert.')}>
          <Toggle label={t('Son des rappels')} checked={s.reminderSound} onChange={v => s.set({ reminderSound: v })} />
        </Row>
        {/* All of them at once; one by one, it's the bell in each group and shared calendar. Local mode: nothing is shared. */}
        {cloudEnabled && (
          <Row label={groupWords(s.usage).Groups} hint={t('Ce que les autres ajoutent ou changent dans tes {groups}.', { groups: groupWords(s.usage).groups })}>
            <Toggle label={groupWords(s.usage).Groups} checked={s.groupNews} onChange={v => s.set({ groupNews: v })} />
          </Row>
        )}
        {cloudEnabled && (
          <Row label={t('Agendas partagés')} hint={t('Les événements ajoutés, changés ou supprimés par les autres.')}>
            <Toggle label={t('Agendas partagés')} checked={s.calendarNews ?? s.groupNews} onChange={v => s.set({ calendarNews: v })} />
          </Row>
        )}
        <Row label={t('Kompaly')} hint={t('Ses suggestions, quand tu es ailleurs.')}>
          <Toggle label={t('Kompaly')} checked={s.copilotNotify} onChange={v => s.set({ copilotNotify: v })} />
        </Row>
      </Section>
    </div>
  );
}

// ── Data ────────────────────────────────────────────────────────────────────

function DataTab() {
  const importRef = useRef<HTMLInputElement>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const events = useCalendar(s => s.events.length);
  const driveCount = useDrive(s => s.items.length);

  useEffect(() => {
    // estimate() counts the files (IndexedDB) but not localStorage, where notes, events and tasks live.
    let local = 0;
    const prefix = `cop:${getStorageUser()}:`;
    for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) local += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2;
    void navigator.storage?.estimate?.().then(e => setUsage({ used: (e.usage ?? 0) + local, quota: e.quota ?? 0 }));
  }, []);

  const onImport = async (f?: File) => {
    if (!f) return;
    if (!(await confirmAction(t('Restaurer cette sauvegarde ?'), t('Ce qui manque sera ajouté. Rien n’est remplacé, sauf tes préférences.'), t('Restaurer'), false))) return;
    try {
      const r = await importBackup(f);
      const parts = [
        r.notes ? tn(r.notes, '{n} note', '{n} notes') : '',
        r.events ? tn(r.events, '{n} événement', '{n} événements') : '',
        r.todos ? tn(r.todos, '{n} tâche', '{n} tâches') : '',
        r.folders ? tn(r.folders, '{n} dossier', '{n} dossiers') : '',
      ].filter(Boolean);
      const list = parts.length > 1 ? t('{list} et {last}', { list: parts.slice(0, -1).join(', '), last: parts.at(-1)! }) : parts[0];
      const trash = r.inTrash ? ` ${r.inTrash > 1 ? tn(r.inTrash, '{n} élément est dans la corbeille.', '{n} éléments sont dans la corbeille.') : t('Un élément est dans la corbeille.')}` : '';
      toast(list ? `${t('Récupéré : {list}.', { list })}${trash}` : r.inTrash ? `${t('Rien de plus à récupérer.')}${trash}` : t('Rien à récupérer : tout est déjà là.'), list || !r.inTrash ? 'success' : 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-5">
      <Section title={t('Sauvegarde')} description={cloudEnabled ? undefined : t('Tes données sont enregistrées sur cet appareil.')}>
        <Row label={t('Exporter mes données')} hint={t('Sans tes fichiers (documents, PDF, photos…).')}>
          <button
            className="btn-secondary h-8"
            onClick={() => {
              exportBackup();
              toast(t('Sauvegarde exportée'), 'success');
            }}
          >
            <Download size={14} /> {t('Exporter')}
          </button>
        </Row>
        <Row label={t('Mes fichiers')} hint={t('Tous tes fichiers et dossiers dans un .zip.')}>
          <button
            className="btn-secondary h-8"
            disabled={!driveCount}
            onClick={() => {
              const items = useDrive.getState().items;
              void downloadZip(items, items.filter(i => !i.parentId).map(i => i.id), `Kompaly ${t('Fichiers')}`);
            }}
          >
            <FolderDown size={14} /> {t('Télécharger')}
          </button>
        </Row>
        <Row label={t('Restaurer une sauvegarde')}>
          <button className="btn-secondary h-8" onClick={() => importRef.current?.click()}>
            <Upload size={14} /> {t('Importer')}
          </button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={e => { void onImport(e.target.files?.[0]); e.target.value = ''; }} />
        </Row>
        <Row label={t('Exporter le calendrier')} hint={t('Fichier .ics (Google Agenda, Outlook…).')}>
          <button
            className="btn-secondary h-8"
            disabled={!events}
            onClick={() => {
              exportIcs();
              toast(t('Calendrier exporté'), 'success');
            }}
          >
            <CalendarArrowUp size={14} /> {t('Exporter')}
          </button>
        </Row>
      </Section>

      {!cloudEnabled && usage && usage.quota > 0 && (
        <Section title={t('Stockage')}>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 text-[13px]">
              <HardDrive size={15} className="text-stone-400" />
              <span className="tabular font-medium">{formatBytes(usage.used)}</span>
              <span className="text-stone-500">{t('utilisés sur {total}', { total: formatBytes(usage.quota) })}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100">
              <div className="h-full rounded-full bg-[#3b6fd8]" style={{ width: `${Math.max(1, (usage.used / usage.quota) * 100)}%` }} />
            </div>
          </div>
        </Section>
      )}

      <Section title={t('Zone sensible')} danger>
        <Row label={t('Effacer toutes mes données')} hint={t('Fichiers, notes, événements, tâches et conversation, corbeilles comprises. Ton compte, tes réglages et tes {groups} restent.', { groups: groupWords(useSettings.getState().usage).groups })}>
          <button
            className="btn-danger h-8"
            onClick={async () => {
              if (!(await confirmAction(t('Tout effacer ?'), cloudEnabled ? t('Fichiers, notes, événements et tâches seront supprimés définitivement sur tous tes appareils. Exporte une sauvegarde avant si tu veux les garder.') : t('Fichiers, notes, événements et tâches seront supprimés définitivement. Exporte une sauvegarde avant si tu veux les garder.'), t('Tout effacer')))) return;
              try {
                await wipeUserData();
                toast(t('Données effacées'), 'success');
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            }}
          >
            <Trash2 size={14} /> {t('Tout effacer')}
          </button>
        </Row>
      </Section>
    </div>
  );
}

// ── Account ─────────────────────────────────────────────────────────────────

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The account's address (online only). A new one is used once the link sent to it is clicked (Supabase also
 * sends one to the current address when the project asks for both): store/auth › changeEmail.
 */
function EmailSection() {
  const user = useAuth(s => s.user)!;
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const asked = `cop-email-change:${user.id}`;

  // Back from the first of the two links: what is left to do. Back from the last one: done.
  useEffect(() => {
    if (/message=confirmation/i.test(location.hash)) {
      toast(t('Lien confirmé. Clique aussi sur celui reçu à ton autre adresse pour finir.'), 'success');
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, [location]);
  useEffect(() => {
    try {
      if (!sameEmail(localStorage.getItem(asked) ?? '', user.email)) return;
      localStorage.removeItem(asked);
      toast(t('Adresse e-mail changée : {email}', { email: user.email }), 'success');
    } catch {
      /* storage blocked: nothing to say */
    }
  }, [asked, user.email]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = {
      email: !VALID_EMAIL.test(email.trim()) ? t('Cette adresse e-mail n’est pas valide.') : sameEmail(email, user.email) ? t('C’est déjà l’adresse de ton compte.') : undefined,
      password: password ? undefined : t('Entre ton mot de passe.'),
    };
    setErr(found);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      await useAuth.getState().changeEmail(email, password);
      try {
        localStorage.setItem(asked, email.trim().toLowerCase());
      } catch {
        /* storage blocked: no « changée » message later, the address still changes */
      }
      toast(t('Presque fini : clique sur le lien envoyé à {email}. Si un e-mail arrive aussi à ton adresse actuelle, clique sur son lien aussi.', { email: email.trim() }), 'success');
      setOpen(false);
      setEmail('');
      setPassword('');
    } catch (error) {
      const msg = (error as Error).message;
      if (msg === AUTH_MSG.wrongPassword) setErr({ password: msg });
      else if (msg === AUTH_MSG.accountExists || msg === t('Cette adresse e-mail n’est pas valide.') || msg === t('C’est déjà l’adresse de ton compte.')) setErr({ email: msg });
      else toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('Adresse e-mail')}>
      <Row
        label={user.email}
        hint={
          user.pendingEmail
            ? t('En attente : {email}. Clique sur le lien reçu pour confirmer.', { email: user.pendingEmail })
            : user.noPassword
              ? t('Ton compte s’ouvre avec {provider} : choisis d’abord un mot de passe ci-dessous pour changer d’adresse.', { provider: user.provider ? PROVIDER_NAMES[user.provider] : 'Google' })
              : undefined
        }
      >
        {!user.noPassword && !open && (
          <button className="btn-secondary h-8" onClick={() => setOpen(true)}>
            <Mail size={14} aria-hidden /> {t('Changer d’adresse')}
          </button>
        )}
      </Row>
      {open && (
        <form onSubmit={submit} noValidate className="grid items-start gap-4 px-5 py-4 sm:grid-cols-2 sm:gap-x-3">
          <Field label={t('Nouvelle adresse e-mail')} error={err.email}>
            <input type="email" className="field w-full" value={email} onChange={e => (setEmail(e.target.value), setErr(x => ({ ...x, email: undefined })))} autoComplete="email" autoFocus />
          </Field>
          <Field label={t('Mot de passe actuel')} error={err.password}>
            <PasswordInput className="field w-full" value={password} onChange={e => (setPassword(e.target.value), setErr(x => ({ ...x, password: undefined })))} autoComplete="current-password" />
          </Field>
          <div className="mt-2 flex gap-2 sm:col-span-2">
            <button className="btn-primary h-8" disabled={busy}>
              {t('Envoyer le lien de confirmation')}
            </button>
            <button type="button" className="btn-ghost h-8" onClick={() => (setOpen(false), setErr({}))}>
              {t('Annuler')}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

/** The accounts of this device (switch, add) and « Se déconnecter »: on the profile (one tap from the avatar) and in Réglages › Compte. */
function AccountsAndSession() {
  const navigate = useNavigate();
  const { logout } = useAuth.getState();
  const userId = useAuth(s => s.user?.id);
  const [switching, setSwitching] = useState<string | null>(null);
  const leave = async () => {
    sessionStorage.removeItem('cop:greeted');
    await loadUserData();
    navigate('/connexion');
  };
  return (
    <>
      <Section title={t('Comptes sur cet appareil')}>
        <div className="space-y-3 px-5 py-4">
          <p className="text-[12.5px] text-stone-500">
            {t('Après {n}\u00a0jours sans utilisation, le mot de passe est redemandé.', { n: STALE_DAYS })}
            {/* Local mode: the other tabs keep showing the old account until they are reloaded. */}
            {!cloudEnabled && ` ${t('Tes autres onglets passent au nouveau compte une fois rechargés.')}`}
          </p>
          <AccountList
            currentId={userId}
            busy={switching}
            onPick={a => {
              if (needsCredentials(a)) return void useAuth.getState().addAccount(a.email);
              setSwitching(a.id);
              void useAuth.getState().switchAccount(a.id).then(r => {
                setSwitching(null);
                if (r === 'credentials') void useAuth.getState().addAccount(a.email);
              });
            }}
          />
          <button className="btn-secondary h-8" onClick={() => void useAuth.getState().addAccount()}>
            <UserPlus size={14} /> {t('Ajouter un compte')}
          </button>
        </div>
      </Section>

      <Section title={t('Session')}>
        <Row
          label={t('Se déconnecter')}
          hint={
            !cloudEnabled
              ? savedAccounts().some(a => a.id !== userId && !needsCredentials(a))
                ? t('Tes données restent sur cet appareil. Tes autres comptes restent ouverts.')
                : t('Tes données restent sur cet appareil.')
              : remembered()
                ? t('Ton compte se rouvrira en un clic sur cet appareil, sans mot de passe. Pour le fermer vraiment : la croix à côté de lui, sur la page de connexion.')
                : undefined
          }
        >
          <button className="btn-secondary h-8" onClick={async () => (await confirmLogout()) && void logout().then(leave)}>
            <LogOut size={14} /> {t('Se déconnecter')}
          </button>
        </Row>
      </Section>
    </>
  );
}

function AccountTab() {
  const navigate = useNavigate();
  const { changePassword, deleteAccount } = useAuth.getState();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [deletePw, setDeletePw] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const deleteRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Errors of the password form, each under its field.
  type Pw = 'current' | 'next' | 'confirm';
  const [pwErr, setPwErr] = useState<Partial<Record<Pw, string>>>({});
  const pwRefs = useRef<Partial<Record<Pw, HTMLInputElement | null>>>({});
  // Two-factor is optional: on or off, read from Supabase (null while loading).
  const [mfaOn, setMfaOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (cloudEnabled) void useAuth.getState().hasMfa().then(setMfaOn);
  }, []);
  // Signed up with Google or Apple: no password yet, so none to ask for.
  const noPassword = useAuth(s => !!s.user?.noPassword);

  const values: Record<Pw, string> = { current, next, confirm: confirmPw };
  // What is wrong with a field ('' when nothing), with its value or the one being typed.
  const checkPw = (f: Pw, v = values[f]): string => {
    if (f === 'current') return !noPassword && !v ? t('Entre ton mot de passe.') : '';
    if (f === 'next') {
      if (v.length < 8 || !/\p{L}/u.test(v) || !/\d/.test(v)) return t('Au moins 8 caractères, avec des lettres et des chiffres.');
      return !noPassword && v === current ? t('Choisis un mot de passe différent de l’actuel.') : '';
    }
    return v !== next ? t('Les deux mots de passe ne correspondent pas.') : '';
  };
  // Leaving a filled-in field checks it; typing clears its error once it is right.
  const pwProps = (f: Pw, set: (v: string) => void) => ({
    ref: (el: HTMLInputElement | null) => {
      pwRefs.current[f] = el;
    },
    value: values[f],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      set(e.target.value);
      if (pwErr[f] && !checkPw(f, e.target.value)) setPwErr(x => ({ ...x, [f]: undefined }));
    },
    onBlur: () => values[f] && checkPw(f) && setPwErr(x => ({ ...x, [f]: checkPw(f) })),
  });

  const onChange = async (e: FormEvent) => {
    e.preventDefault();
    const found = (['current', 'next', 'confirm'] as Pw[]).filter(f => (f !== 'current' || !noPassword) && checkPw(f));
    setPwErr(Object.fromEntries(found.map(f => [f, checkPw(f)])));
    if (found.length) return pwRefs.current[found[0]]?.focus();
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirmPw('');
      toast(noPassword ? t('Mot de passe enregistré') : t('Mot de passe modifié'), 'success');
    } catch (err) {
      const msg = (err as Error).message;
      // A wrong current password is said under it; the other errors (server) stay a toast.
      if (msg === t('Mot de passe actuel incorrect.')) {
        setPwErr({ current: msg });
        pwRefs.current.current?.focus();
      } else toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    sessionStorage.removeItem('cop:greeted');
    await loadUserData();
    navigate('/connexion');
  };

  const forgot = async () => {
    const email = useAuth.getState().user?.email ?? '';
    if (!(await confirmAction(t('Recevoir un lien pour changer de mot de passe ?'), t('Il part à {email}.', { email }), t('Envoyer'), false))) return;
    try {
      await useAuth.getState().requestPasswordReset(email);
      toast(t('Lien envoyé à {email} : ouvre-le pour choisir un nouveau mot de passe.', { email }), 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-5">
      {cloudEnabled && (
        <Section title={t('Double authentification')}>
          <Row label={mfaOn ? t('Activée') : t('Désactivée')} hint={mfaOn === false ? t('Un code de ton téléphone en plus, à chaque connexion.') : undefined}>
            {mfaOn ? (
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
                <ShieldCheck size={15} /> {t('Protégé')}
              </span>
            ) : mfaOn === false ? (
              <button
                className="btn-primary h-8"
                onClick={() => {
                  useAuth.getState().enableMfa();
                  navigate('/securite');
                }}
              >
                <ShieldCheck size={14} /> {t('Activer')}
              </button>
            ) : null}
          </Row>
          {mfaOn && (
            <Row label={t('Changer de téléphone')}>
              <button
                className="btn-secondary h-8"
                onClick={async () => {
                  if (!(await confirmAction(t('Changer de téléphone ?'), t('Tu scanneras un nouveau QR code. L’ancien téléphone ne servira plus.'), t('Continuer'), false))) return;
                  try {
                    await useAuth.getState().resetMfa();
                    navigate('/securite');
                  } catch (e) {
                    toast((e as Error).message, 'error');
                  }
                }}
              >
                <Smartphone size={14} /> {t('Changer')}
              </button>
            </Row>
          )}
          {mfaOn && (
            <Row label={t('Désactiver la double authentification')}>
              <button
                className="btn-secondary h-8"
                onClick={async () => {
                  if (!(await confirmAction(t('Désactiver la double authentification ?'), t('Plus aucun code ne sera demandé à la connexion.'), t('Désactiver')))) return;
                  try {
                    await useAuth.getState().disableMfa();
                    setMfaOn(false);
                    toast(t('Double authentification désactivée'), 'success');
                  } catch (e) {
                    toast((e as Error).message, 'error');
                  }
                }}
              >
                {t('Désactiver')}
              </button>
            </Row>
          )}
        </Section>
      )}

      {cloudEnabled && <PasskeySection />}

      {cloudEnabled && <EmailSection />}

      <Section title={t('Mot de passe')}>
        <form onSubmit={onChange} noValidate className="grid items-start gap-4 px-5 py-4 sm:grid-cols-3 sm:gap-x-3">
          {!noPassword && (
            <div>
              <Field label={t('Mot de passe actuel')} error={pwErr.current}>
                <PasswordInput className="field w-full" {...pwProps('current', setCurrent)} autoComplete="current-password" />
              </Field>
              {/* Online: a link to choose a new one, sent to the account's address (the sign-in page's « Oublié ? »). */}
              {cloudEnabled && (
                <button type="button" className="hit mt-1.5 text-[12px] text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-ink" onClick={() => void forgot()}>
                  {t('Mot de passe oublié ?')}
                </button>
              )}
            </div>
          )}
          <Field label={t('Nouveau mot de passe')} error={pwErr.next} hint={next && <PasswordStrength password={next} />}>
            <PasswordInput className="field w-full" {...pwProps('next', setNext)} autoComplete="new-password" />
          </Field>
          <Field label={t('Confirmer')} error={pwErr.confirm}>
            <PasswordInput className="field w-full" aria-label={t('Confirmer le nouveau mot de passe')} {...pwProps('confirm', setConfirmPw)} autoComplete="new-password" />
          </Field>
          {/* 16 px of the grid + 8: 24 px before the main button. */}
          <div className="mt-2 sm:col-span-3">
            <button className="btn-primary h-8" disabled={busy}>
              {noPassword ? t('Choisir un mot de passe') : t('Modifier le mot de passe')}
            </button>
          </div>
        </form>
      </Section>

      <AccountsAndSession />

      <Section title={t('Supprimer le compte')} danger>
        <Row
          label={t('Supprimer définitivement mon compte')}
          hint={noPassword ? `${t('Tout sera effacé. Exporte une sauvegarde avant.')} ${t('Tape ton adresse e-mail pour confirmer.')}` : t('Tout sera effacé. Exporte une sauvegarde avant.')}
        >
          {/* Google or Apple account: no password, its e-mail typed again instead. */}
          <div className="w-44">
            <input
              ref={deleteRef}
              type={noPassword ? 'email' : 'password'}
              className="field w-full"
              placeholder={noPassword ? t('Ton adresse e-mail') : t('Mot de passe')}
              aria-label={noPassword ? t('Tape ton adresse e-mail pour confirmer.') : t('Mot de passe, pour confirmer la suppression')}
              aria-invalid={deleteError ? true : undefined}
              aria-describedby={deleteError ? 'delete-pw-err' : undefined}
              value={deletePw}
              onChange={e => (setDeletePw(e.target.value), setDeleteError(''))}
            />
            <FieldError id="delete-pw-err">{deleteError}</FieldError>
          </div>
          <button
            className="btn-danger h-8"
            disabled={!deletePw.trim()}
            onClick={async () => {
              // A wrong password (or e-mail) is said at once, not after « Supprimer ton compte ? ».
              try {
                if (noPassword && !sameEmail(deletePw, useAuth.getState().user?.email ?? '')) throw new Error(t('Ce n’est pas l’adresse e-mail de ton compte.'));
                await useAuth.getState().verifyPassword(deletePw);
              } catch (err) {
                setDeleteError((err as Error).message);
                return deleteRef.current?.focus();
              }
              if (!(await confirmAction(t('Supprimer ton compte ?'), t('Cette action est irréversible.'), t('Supprimer')))) return;
              try {
                // Password and server checks come first: never wipe the Drive for a refused deletion.
                await deleteAccount(deletePw, clearBeforeAccountDeletion);
                resetLocalData(); // only once the account is gone: a failed deletion keeps the data
                await leave();
                toast(t('Ton compte et tes données ont été supprimés.'), 'success');
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            }}
          >
            {t('Supprimer')}
          </button>
        </Row>
      </Section>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

/** A round icon of the profile's head (Réglages, avis, visite…), its name said and shown on hover; `count`: a red number. */
function HeadIcon({ icon, label, onClick, count = 0 }: { icon: typeof User; label: string; onClick: () => void; count?: number }) {
  const pro = useSettings(s => s.pro);
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      // Plain to see (asked: they were missed): a round button with its own surface, as the top bar's (Pro: .pro-hbtn).
      className={cx(
        'relative grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors max-[359px]:h-9 max-[359px]:w-9',
        pro ? 'pro-hbtn' : 'bg-surface text-stone-700 shadow-card ring-1 ring-stone-200 hover:bg-stone-50 hover:text-ink',
      )}
    >
      {createElement(icon, { size: 18, strokeWidth: 1.9, 'aria-hidden': true })}
      {count > 0 && (
        <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold leading-none text-white">
          {count}
        </span>
      )}
    </button>
  );
}

export default function ProfilePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  // Two views: the profile (the avatar leads here), and Réglages (the cog: the sections below, « ‹ » back).
  const asked = TABS.find(x => x.key === params.get('onglet'))?.key;
  const settingsView = !!asked && asked !== 'profil';
  const tab = (settingsView ? asked : 'profil') as TabKey;
  const sections = TABS.filter(x => x.key !== 'profil');
  const usage = useSettings(s => s.usage);
  // The « Études » tab is « Travail » or « Organisation » for other usages, its icon too.
  const tabLabel = (key: TabKey) => (key === 'etudes' ? (WORDS[usage] ?? WORDS.etudes).profileTab : TABS.find(x => x.key === key)!.label);
  // Affichage Pro: Kompaly's tab has his mark, not sparkles.
  const pro = useSettings(s => s.pro);
  const tabIcon = (key: TabKey) => (key === 'etudes' ? (USAGE_ICONS[usage] ?? GraduationCap) : pro && key === 'copilot' ? KompalyMark : TABS.find(x => x.key === key)!.icon);
  const newsSeen = useSettings(s => s.newsSeen);
  const createdAt = useAuth(s => s.user?.createdAt);
  const unread = newsToShow(newsSeen, createdAt) ? latestRelease.items.length : 0;
  const trash = useTrashCount();
  const go = (key: TabKey) => setParams({ onglet: key });

  return (
    <div className="h-full overflow-y-auto px-4 pb-room md:px-8">
      <div className="mx-auto max-w-[1180px]">
        {/* The title stays in sight while the page scrolls (the page's own background, solid: nothing shows through; the
            same rule as the shell's sticky page heads). */}
        <div className="page-head -mx-4 flex items-center gap-2 px-4 pb-3 md:-mx-8 md:px-8 md:pb-5">
          {settingsView && (
            <button type="button" onClick={() => setParams({})} className="icon-btn -ml-2 h-10 w-10 shrink-0 rounded-full" title={t('Retour au profil')} aria-label={t('Retour au profil')}>
              <ChevronLeft size={20} aria-hidden />
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-[-0.02em] md:text-[24px]">{settingsView ? t('Réglages') : t('Profil')}</h1>
          {!settingsView && (
            <div className="flex shrink-0 items-center gap-1.5 max-[359px]:gap-1">
              {/* Computers: Nouveautés and the bin are in the bar beside the search. */}
              <span className="contents lg:hidden">
                <HeadIcon icon={pro ? Megaphone : Sparkles} label={newsName(unread)} count={unread} onClick={() => openNews()} />
                {pro && <HeadIcon icon={Trash2} label={trash ? tn(trash, 'Corbeille, {n} élément', 'Corbeille, {n} éléments') : t('Corbeille')} onClick={() => navigate('/corbeille')} />}
              </span>
              <HeadIcon icon={MessageSquareText} label={t('Donner mon avis ou signaler un bug')} onClick={() => openFeedback()} />
              <HeadIcon icon={Settings2} label={t('Réglages')} onClick={() => go('apparence')} />
            </div>
          )}
        </div>
        {settingsView ? (
          <>
            {/* Phones and tablets: every section with its name under its icon (an icon alone wasn't understood: where are
                the notifications?), four by row on a phone, one row on a tablet. Not sticky: it would take a third of the screen. */}
            <nav aria-label={t('Sections des réglages')} className="seg mb-4 grid w-full grid-cols-4 sm:flex md:hidden">
              {sections.map(tb => (
                <button
                  key={tb.key}
                  aria-current={tab === tb.key ? 'page' : undefined}
                  onClick={() => go(tb.key)}
                  className="seg-item h-[52px] min-w-0 flex-col gap-1 px-0 sm:flex-1 sm:shrink"
                  data-active={tab === tb.key || undefined}
                >
                  {createElement(tabIcon(tb.key), { size: 16, 'aria-hidden': true, className: cx('shrink-0', tab === tb.key && 'text-brand-600') })}
                  <span className="max-w-full whitespace-nowrap text-center text-fix-11 font-medium leading-[1.1] max-[359px]:text-fix-10 max-[359px]:tracking-[-0.02em] min-[400px]:text-[min(0.6875rem,13px)]">{tabLabel(tb.key)}</span>
                </button>
              ))}
            </nav>
            <div className="flex flex-col gap-6 md:flex-row">
              <nav aria-label={t('Sections des réglages')} className="hidden shrink-0 md:sticky md:top-16 md:flex md:w-48 md:flex-col md:gap-0.5 md:self-start">
                {sections.map(tb => (
                  <button
                    key={tb.key}
                    aria-current={tab === tb.key ? 'page' : undefined}
                    onClick={() => go(tb.key)}
                    className={cx(
                      'profile-nav-item flex h-8 min-w-0 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors pointer-coarse:h-9',
                      tab === tb.key ? 'bg-surface font-semibold text-ink shadow-card ring-1 ring-stone-200' : 'text-stone-600 hover:bg-stone-100 hover:text-ink',
                    )}
                  >
                    {createElement(tabIcon(tb.key), { size: 15, 'aria-hidden': true, className: cx('shrink-0', tab === tb.key && 'text-brand-600') })}
                    <span className="max-w-full truncate">{tabLabel(tb.key)}</span>
                  </button>
                ))}
              </nav>
              <div className="min-w-0 flex-1">
                <h2 className="mb-3 text-[15px] font-semibold sm:hidden">{tabLabel(tab)}</h2>
                {tab === 'apparence' && <AppearanceTab />}
                {tab === 'copilot' && <CopilotTab />}
                {tab === 'etudes' && <StudiesTab />}
                {tab === 'notifications' && <NotificationsTab />}
                {tab === 'donnees' && <DataTab />}
                {tab === 'raccourcis' && <ShortcutsTab />}
                {tab === 'compte' && <AccountTab />}
              </div>
            </div>
          </>
        ) : (
          <div className="mx-auto max-w-[760px] space-y-5">
            <ProfileTab />
            <AccountsAndSession />
          </div>
        )}
        {/* What a visitor finds at the foot of the home page, reachable once signed in too. */}
        {/* No « · » between the links: wrapped on a phone, one was left hanging at the end of a line. Their spacing
            says they are apart; the version on its own line. */}
        <footer className={cx('mt-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pb-2 text-[12px] text-stone-500 pointer-coarse:gap-y-0', settingsView && 'md:ml-[13.5rem]')}>
          {LEGAL_LINKS.map(l => (
            <Link key={l.to} to={l.to} className="inline-block underline-offset-2 hover:text-ink hover:underline pointer-coarse:py-2">
              {l.label}
            </Link>
          ))}
          <a href={`mailto:${CONTACT}`} className="inline-block underline-offset-2 hover:text-ink hover:underline pointer-coarse:py-2">
            {t('Nous contacter')}
          </a>
          <span className="tabular basis-full text-center">
            {t('Version du {date}', { date: fmt(fromKey(latestRelease.id), 'd MMMM yyyy') })}
            {__BUILD__ && ` (${__BUILD__})`}
          </span>
        </footer>
      </div>
    </div>
  );
}
