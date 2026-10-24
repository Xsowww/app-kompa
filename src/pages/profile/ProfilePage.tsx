import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SelectField, TimeField } from '../../components/Pickers';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  User, Palette, Sparkles, GraduationCap, Bell, Database, ShieldCheck, Camera, Check, Download, Upload, CalendarArrowUp, LogOut, Trash2, ChevronRight,
  HardDrive, Smartphone, Keyboard, Briefcase, House, UserPlus, MessageSquareText,
} from 'lucide-react';
import { openFeedback } from '../../lib/feedback';
import AccountList from '../../components/AccountList';
import PasswordStrength from '../../components/PasswordStrength';
import Field, { FieldError } from '../../components/Field';
import { needsCredentials, savedAccounts, STALE_DAYS } from '../../lib/accounts';
import { confirmLogout, sameEmail, useAuth } from '../../store/auth';
import { useFocusLog } from '../../store/focusLog';
import { useSettings, ACCENTS, AVATAR_COLORS, applyAppearance, UI_STYLES, type AccentKey, type ThemeMode, type Chattiness, type UiStyle } from '../../store/settings';
import { useCopilot } from '../../store/copilot';
import { useDrive } from '../../store/drive';
import { useNotes } from '../../store/notes';
import { applyUsage, useCalendar } from '../../store/calendar';
import { loadUserData } from '../../store/session';
import { confirmAction, toast } from '../../store/ui';
import { exportBackup, importBackup, exportIcs, wipeUserData, clearBeforeAccountDeletion, resetLocalData, imageToAvatar } from '../../lib/backup';
import { chime, showSystemNotification } from '../../lib/notify';
import { deviceState, disableDevice, enableDevice, pushActive, sendTestPush } from '../../lib/push';
import { devicePushChanged } from '../../lib/reminderScheduler';
import { TIMED_OPTIONS } from '../../lib/reminders';
import { install, installed, macSafari, useInstallOffer } from '../../lib/install';
import { formatBytes, noteText, cx } from '../../lib/utils';
import { fmt, todayKey } from '../../lib/dates';
import Avatar from '../../components/Avatar';
import Character from '../../copilot/Character';
import { Section, Row, Toggle, Segmented, Stepper } from './controls';
import PasskeySection from './PasskeySection';
import { cloudEnabled, remembered } from '../../lib/supabase';
import { getStorageUser } from '../../lib/userStorage';
import { currentStreak, useBadges } from '../../lib/badges';
import { checkAiStatus, resetClaudeHistory } from '../../copilot/claudeBrain';
import { aiPausedUntil, aiPauseReason } from '../../copilot/aiPause';
import BadgeGrid from './BadgeGrid';
import { USAGES, WORDS, groupWords, type Usage } from '../../lib/usage';
import { PERSONAS, personaLabel } from '../../lib/personas';
import LanguagePicker from '../../components/LanguagePicker';
import { t, tn, lang, locale } from '../../i18n';

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
    if (location.hash === '#badges') document.getElementById('badges')?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash]);
  return (
    <section id="badges" className="card enter scroll-mt-4">
      <h2>
        <button onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls="badges-grille" className="flex w-full items-center gap-2 rounded-xl px-5 py-4 text-left">
          <ChevronRight size={15} className={cx('text-stone-400 transition-transform', open && 'rotate-90')} />
          <span className="text-[14px] font-semibold">{t('Badges')}</span>
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
      label: tn(stats.focusSessions, 'session focus', 'sessions focus'),
      sub: stats.focusHours ? t('{hours} h', { hours: stats.focusHours.toLocaleString(locale(), { maximumFractionDigits: 1 }) }) : undefined,
    },
    { value: stats.notes, label: tn(stats.notes, 'note', 'notes'), sub: stats.words ? tn(stats.words, '{count} mot', '{count} mots', { count: stats.words.toLocaleString(locale()) }) : undefined },
    { value: stats.files, label: tn(stats.files, 'fichier', 'fichiers'), sub: stats.files ? formatBytes(stats.size) : undefined },
  ].filter(s => s.value > 0);
  const [name, setName] = useState(user.name);
  const [nameError, setNameError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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
      {/* Phones and tablets: here rather than in a corner of every page (the « + » button's); computers: the sidebar. */}
      <button
        type="button"
        onClick={() => openFeedback()}
        className="card flex h-12 w-full items-center gap-3 px-4 text-left text-[14px] font-medium text-stone-700 transition-colors hover:bg-stone-50 lg:hidden"
      >
        <MessageSquareText size={18} strokeWidth={1.9} className="text-stone-500" aria-hidden />
        <span className="flex-1">{t('Donner mon avis ou signaler un bug')}</span>
        <ChevronRight size={16} className="text-stone-400" aria-hidden />
      </button>
      <Section label={t('Profil')}>
        <div className="flex flex-wrap items-center gap-5 px-5 py-5">
          <div className="relative">
            <Avatar size={72} />
            <button onClick={() => fileRef.current?.click()} className="hit absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-ink text-paper hover:bg-stone-700" title={t('Changer la photo')} aria-label={t('Changer la photo')}>
              <Camera size={13} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="break-words text-[18px] font-semibold tracking-tight">{user.name}</p>
            {/* Phones: the date on its own line, so a long e-mail never leaves « · » at the start of a line. */}
            <p className="text-[13px] text-stone-500 [overflow-wrap:anywhere]">
              {user.email}<span className="max-sm:hidden">{'\u00a0'}· </span>
              <span className="max-sm:block max-sm:first-letter:uppercase">{t('inscription le {date}', { date: fmt(new Date(user.createdAt), 'd MMMM yyyy').replace(/ /g, '\u00a0') })}</span>
            </p>
            {/* Touch: 36 px dots 8 px apart, each with a 44 px tap zone (.hit). */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 pointer-coarse:gap-2">
              {AVATAR_COLORS.map((c, i) => (
                <button
                  key={c}
                  aria-label={t('Couleur de l’avatar {n}', { n: i + 1 })}
                  aria-pressed={!settings.avatarImage && settings.avatarColor === c}
                  onClick={() => settings.set({ avatarColor: c, avatarImage: null })}
                  className="hit flex h-6 w-6 items-center justify-center rounded-full ring-offset-2 transition-transform hover:scale-110 pointer-coarse:h-9 pointer-coarse:w-9"
                  style={{ background: c, boxShadow: !settings.avatarImage && settings.avatarColor === c ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${c}` : undefined }}
                  title={t('Couleur de l’avatar')}
                />
              ))}
              {settings.avatarImage && (
                <button className="hit ml-2 text-[12px] text-stone-500 underline underline-offset-2 hover:text-ink" onClick={async () => (await confirmAction(t('Retirer ta photo ?'), undefined, t('Retirer'))) && settings.set({ avatarImage: null })}>
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
          <SelectField<Usage> className="w-56" label={t('Kompaly sert pour')} value={settings.usage} options={USAGES.map(u => ({ value: u.key, label: u.label }))} onChange={usage => { if (usage === settings.usage) return; settings.set({ usage, year: '', school: '', program: '' }); applyUsage(usage); }} />
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

/** A small picture of each style: its page, a card and a button (drawn, not the real thing). */
function StylePreview({ look }: { look: UiStyle }) {
  const page: Record<UiStyle, string> = {
    classique: '#eceef3',
    verre: 'radial-gradient(60% 70% at 10% 10%, #b7c4ff, transparent 70%), radial-gradient(60% 70% at 95% 90%, #ffd6b0, transparent 70%), radial-gradient(50% 60% at 90% 5%, #ffc6dc, transparent 70%), #e7eaf6',
    liquide: 'radial-gradient(70% 60% at 10% 0%, #ffffff, transparent 70%), #e6e8ec',
    relief: '#e4e9f2',
  };
  const card: Record<UiStyle, React.CSSProperties> = {
    classique: { background: '#ffffff', borderRadius: 10 },
    verre: { background: 'rgb(255 255 255 / 0.55)', borderRadius: 10, boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.8), 0 6px 14px -8px rgb(40 52 110 / 0.4)', backdropFilter: 'blur(6px)' },
    liquide: { background: 'linear-gradient(140deg, rgb(255 255 255 / 0.85), rgb(255 255 255 / 0.35) 45%, rgb(255 255 255 / 0.55))', borderRadius: 12, boxShadow: 'inset 1px 1px 0 #fff, 0 0 0 0.5px rgb(20 22 31 / 0.08), 0 6px 14px -8px rgb(20 22 31 / 0.35)' },
    relief: { background: '#e4e9f2', borderRadius: 10, boxShadow: '4px 4px 9px #bdc6d6, -4px -4px 9px #ffffff' },
  };
  const button: Record<UiStyle, React.CSSProperties> = {
    classique: { background: '#14161f', borderRadius: 5 },
    verre: { background: '#14161f', borderRadius: 5 },
    liquide: { background: '#14161f', borderRadius: 999 },
    relief: { background: '#e4e9f2', borderRadius: 5, boxShadow: '2px 2px 4px #bdc6d6, -2px -2px 4px #ffffff' },
  };
  return (
    <span aria-hidden className="relative block h-16 overflow-hidden rounded-[11px]" style={{ background: page[look] }}>
      <span className="absolute inset-x-2.5 top-2.5 bottom-2.5 flex flex-col justify-between p-2" style={card[look]}>
        <span className="block h-1.5 w-2/3 rounded-full" style={{ background: look === 'relief' ? '#9aa3b8' : 'rgb(20 22 31 / 0.55)' }} />
        <span className="block h-3 w-8" style={button[look]} />
      </span>
    </span>
  );
}

function AppearanceTab() {
  const settings = useSettings();
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
  return (
    <Section label={t('Apparence')}>
      <Row label={t('Thème')}>
        <Segmented
          label={t('Thème')}
          value={settings.theme}
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
              aria-pressed={(settings.style ?? 'classique') === k}
              className={cx('rounded-[16px] p-1.5 text-left ring-1 transition-colors', (settings.style ?? 'classique') === k ? 'ring-2 ring-brand-500' : 'ring-stone-200 hover:ring-stone-300')}
            >
              <StylePreview look={k} />
              <span className="mt-1.5 flex items-center gap-1.5 px-1 text-[13px] font-semibold">
                {(settings.style ?? 'classique') === k && <Check size={13} strokeWidth={3} className="text-brand-600" aria-hidden />}
                {STYLE_LABELS[k]}
              </span>
            </button>
          ))}
        </div>
      </div>
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
      {/* Preview only: no real button (no Tab stop), nothing announced. */}
      <div className="flex items-center gap-4 overflow-hidden bg-stone-50/70 px-5 py-4" aria-hidden>
        <span className="btn-primary pointer-events-none">{t('Bouton')}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-solid text-[13px] font-semibold text-on-brand">{new Date().getDate()}</span>
        <span className="rounded-md bg-brand-50 px-2 py-1 text-[12px] font-medium text-brand-700">{t('Sélection')}</span>
        <div className="relative ml-auto h-16 w-24 overflow-hidden">
          <div className="absolute -right-1 top-[-14px]">
            <Character pose="peek" mood="happy" size={80} />
          </div>
        </div>
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
        <div className="flex items-center gap-3 px-5 py-4">
          <span className={cx('h-2 w-2 shrink-0 rounded-full', !aiEnabled ? 'bg-stone-400' : paused ? 'bg-amber-500' : 'bg-emerald-500')} />
          <p className="text-[13px]">
            {paused ? (
              <>
                <span className="font-medium">{t('Mode simple pour l’instant.')}</span>{' '}
                <span className="text-stone-500">
                  {aiPauseReason() === 'error' ? t('L’IA ne répond pas, retour dans') : t('L’IA gratuite a atteint sa limite, retour dans')} <span className="tabular">{clock}</span>.
                </span>
              </>
            ) : aiEnabled ? (
              <>
                <span className="font-medium">{t('Mode intelligent activé.')}</span>{' '}
                {provider && <span className="text-stone-500">{t('IA\u00a0: {provider}', { provider })}</span>}
              </>
            ) : (
              <>
                <span className="font-medium">{t('Mode simple.')}</span> <span className="text-stone-500">{t('Il comprend les commandes courantes.')}</span>
              </>
            )}
          </p>
        </div>
        <Row label={t('Afficher Kompaly')}>
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
        <Row label={t('Annoncer les nouveaux badges')}>
          <Toggle label={t('Annoncer les nouveaux badges')} checked={s.badgeAnnouncements} onChange={v => s.set({ badgeAnnouncements: v })} />
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
  return (
    <div className="space-y-5">
      <Section title={t('Sessions focus')}>
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

      <Section title={s.usage === 'etudes' ? t('Planification des révisions') : t('Temps de préparation')}>
        <Row label={t('Nombre de séances')}>
          <Stepper label={t('Nombre de séances')} value={s.revisionSessions} min={1} max={6} onChange={v => s.set({ revisionSessions: v })} />
        </Row>
        <Row label={t('Heure des séances')} hint={t('Chaque séance dure 1 h 30.')}>
          <TimeField className="w-32" label={t('Heure des séances')} value={s.revisionTime} onChange={v => v && s.set({ revisionTime: v })} />
        </Row>
      </Section>
    </div>
  );
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: t('Partout'),
    keys: [
      ['Ctrl K', t('Rechercher')],
      [t('↑ ↓ · Entrée'), t('Choisir un résultat')],
      [t('Échap'), t('Fermer, désélectionner')],
      [t('Maj F10'), t('Menu contextuel')],
    ],
  },
  {
    group: t('Drive'),
    keys: [
      [t('Entrée'), t('Ouvrir')],
      [t('Espace'), t('Sélectionner')],
      ['Ctrl A', t('Tout sélectionner')],
      ['Ctrl C · Ctrl X · Ctrl V', t('Copier, couper, coller')],
      ['Ctrl D', t('Dupliquer')],
      ['F2', t('Renommer')],
      [t('Suppr'), t('Mettre à la corbeille')],
      [t('Retour arrière'), t('Dossier parent')],
    ],
  },
  {
    group: t('Calendrier'),
    keys: [
      ['← →', t('Jour précédent, suivant')],
      ['↑ ↓', t('Semaine précédente, suivante')],
      [t('Échap'), t('Annuler un déplacement')],
    ],
  },
  {
    group: t('Notes'),
    keys: [
      ['Ctrl B · Ctrl I · Ctrl U', t('Gras, italique, souligné')],
      ['Ctrl Z', t('Annuler la frappe')],
      [t('Entrée'), t('Du titre au texte')],
      ['F2', t('Renommer un dossier')],
    ],
  },
  {
    group: t('Corbeille'),
    keys: [
      [t('Entrée'), t('Aperçu||d’un fichier')],
      ['↑ ↓', t('Élément précédent, suivant')],
      ['Ctrl A', t('Tout sélectionner')],
      [t('Suppr'), t('Supprimer définitivement')],
    ],
  },
  {
    group: t('Souris'),
    keys: [
      [t('Double-clic'), t('Ouvrir un fichier ou un dossier')],
      [t('Clic droit'), t('Plus d’options')],
      [t('Ctrl + clic'), t('Sélectionner plusieurs éléments')],
      [t('Glisser'), t('Ranger dans un dossier, déplacer un événement')],
      [t('Alt + glisser'), t('Copier au lieu de déplacer (Drive)')],
    ],
  },
];

const keyLabel = (k: string) => (IS_MAC ? k.replace(/Ctrl /g, '⌘ ').replace(/Alt /g, '⌥ ') : k);

function ShortcutsTab() {
  return (
    <div className="space-y-5">
      <Section title={t('Raccourcis clavier')}>
        {SHORTCUTS.map(g => (
          <div key={g.group} className="px-5 py-3">
            <h3 className="eyebrow mb-1">{g.group}</h3>
            <dl className="grid gap-x-8 sm:grid-cols-2">
              {g.keys.map(([k, d]) => (
                <div key={k + d} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
                  <dt className="text-stone-600">{d}</dt>
                  <dd className="kbd shrink-0">{keyLabel(k)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </Section>
    </div>
  );
}

// ── Notifications ───────────────────────────────────────────────────────────

function NotificationsTab() {
  const s = useSettings();
  const [state, setState] = useState(deviceState);
  const [push, setPush] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const canInstall = useInstallOffer();
  useEffect(() => {
    let alive = true;
    void pushActive().then(p => alive && setPush(p));
    return () => {
      alive = false;
    };
  }, [state]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        const next = await enableDevice();
        setState(next);
        if (next === 'denied') toast(t('Notifications bloquées : autorise-les dans les réglages du navigateur.'), 'error');
      } else {
        await disableDevice();
        setState(deviceState());
      }
      await devicePushChanged();
    } finally {
      setBusy(false);
    }
  };

  const testClosed = async () => {
    const r = await sendTestPush(10);
    if (r === 'ok') toast(t('Ferme ou quitte Kompaly : la notification arrive dans 10 secondes.'), 'success');
    else toast(r === 'unavailable' ? t('Pas encore disponible.') : t('L’essai n’a pas pu partir, réessaie dans un instant.'), 'error');
  };

  const hint =
    state === 'on'
      ? push
        ? t('Même quand Kompaly est fermé.')
        : push === false && cloudEnabled
          ? t('Seulement quand Kompaly est ouvert.')
          : undefined
      : state === 'denied'
        ? t('Bloquées par le navigateur : autorise-les via le cadenas à gauche de l’adresse, puis recharge la page.')
        : state === 'install'
          ? t('Sur iPhone et iPad : ajoute d’abord Kompaly à l’écran d’accueil (Partager › « Sur l’écran d’accueil »), puis ouvre-le depuis son icône.')
          : state === 'unsupported'
            ? t('Non disponibles dans ce navigateur.')
            : undefined;

  const defaultValue = s.defaultReminders[0] ?? -1;
  return (
    <div className="space-y-5">
      <Section title={t('Sur cet appareil')}>
        <Row label={t('Notifications')} hint={hint}>
          {(state === 'on' || state === 'off') && <Toggle label={t('Notifications sur cet appareil')} checked={state === 'on'} onChange={v => !busy && void toggle(v)} />}
        </Row>
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
        {state === 'on' && (
          <Row label={t('Tester')}>
            <button className="btn-secondary h-8" onClick={() => void showSystemNotification(t('Notifications activées'), t('Tes rappels Kompaly arriveront ici.\nEssai'), 'test', '/profil?onglet=notifications')}>
              <Bell size={14} /> {t('Essayer')}
            </button>
            {push && (
              <button className="btn-secondary h-8" title={t('Ferme Kompaly juste après : la notification arrive 10 secondes plus tard.')} onClick={() => void testClosed()}>
                {t('Site fermé')}
              </button>
            )}
          </Row>
        )}
      </Section>
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
      </Section>
      <Section title={t('Autres notifications')}>
        <Row label={t('Son des rappels')}>
          <Toggle label={t('Son des rappels')} checked={s.reminderSound} onChange={v => s.set({ reminderSound: v })} />
        </Row>
        <Row label={t('Groupes et agendas partagés')}>
          <Toggle label={t('Groupes et agendas partagés')} checked={s.groupNews} onChange={v => s.set({ groupNews: v })} />
        </Row>
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
        <Row label={t('Exporter mes données')} hint={t('Sans les fichiers du Drive.')}>
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
        <Row label={t('Effacer toutes mes données')} hint={t('Drive, notes, événements, tâches et conversation, corbeilles comprises. Ton compte, tes réglages et tes {groups} restent.', { groups: groupWords(useSettings.getState().usage).groups })}>
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

function AccountTab() {
  const navigate = useNavigate();
  const { changePassword, deleteAccount, logout } = useAuth.getState();
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
  const userId = useAuth(s => s.user?.id);
  // Two-factor is optional: on or off, read from Supabase (null while loading).
  const [mfaOn, setMfaOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (cloudEnabled) void useAuth.getState().hasMfa().then(setMfaOn);
  }, []);
  // Signed up with Google or Apple: no password yet, so none to ask for.
  const noPassword = useAuth(s => !!s.user?.noPassword);
  const [switching, setSwitching] = useState<string | null>(null);

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

      <Section title={t('Mot de passe')}>
        <form onSubmit={onChange} noValidate className="grid items-start gap-4 px-5 py-4 sm:grid-cols-3 sm:gap-x-3">
          {!noPassword && (
            <Field label={t('Mot de passe actuel')} error={pwErr.current}>
              <input type="password" className="field w-full" {...pwProps('current', setCurrent)} autoComplete="current-password" />
            </Field>
          )}
          <Field label={t('Nouveau mot de passe')} error={pwErr.next} hint={next && <PasswordStrength password={next} />}>
            <input type="password" className="field w-full" {...pwProps('next', setNext)} autoComplete="new-password" />
          </Field>
          <Field label={t('Confirmer')} error={pwErr.confirm}>
            <input type="password" className="field w-full" aria-label={t('Confirmer le nouveau mot de passe')} {...pwProps('confirm', setConfirmPw)} autoComplete="new-password" />
          </Field>
          {/* 16 px of the grid + 8: 24 px before the main button. */}
          <div className="mt-2 sm:col-span-3">
            <button className="btn-primary h-8" disabled={busy}>
              {noPassword ? t('Choisir un mot de passe') : t('Modifier le mot de passe')}
            </button>
          </div>
        </form>
      </Section>

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

export default function ProfilePage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(x => x.key === params.get('onglet'))?.key ?? 'profil') as TabKey;
  const usage = useSettings(s => s.usage);

  return (
    <div className="h-full overflow-y-auto px-4 pb-room md:px-8">
      <div className="mx-auto max-w-[1180px]">
        <div className="pb-5 pt-2">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{t('Profil et réglages')}</h1>
        </div>
        <div className="flex flex-col gap-6 md:flex-row">
          <nav aria-label={t('Sections du profil')} className="grid shrink-0 grid-cols-4 gap-1.5 max-[359px]:grid-cols-3 md:flex md:w-48 md:flex-col md:gap-0.5">
            {TABS.map(tb => (
              <button
                key={tb.key}
                aria-current={tab === tb.key ? 'page' : undefined}
                onClick={() => setParams(tb.key === 'profil' ? {} : { onglet: tb.key })}
                className={cx(
                  // Phone: every section visible at once (a grid of 4, of 3 under 360 px where « Notifications » was cut), no hidden tabs to swipe to.
                  'flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11.5px] font-medium transition-colors md:h-8 md:shrink-0 md:flex-row md:justify-start md:gap-2.5 md:rounded-md md:px-2.5 md:py-0 md:text-[13px] md:pointer-coarse:h-9',
                  tab === tb.key ? 'bg-ink font-semibold text-paper md:bg-surface md:text-ink md:shadow-card md:ring-1 md:ring-stone-200' : 'bg-surface text-stone-600 hover:bg-stone-100 hover:text-ink md:bg-transparent',
                )}
              >
                {(() => {
                  // The « Études » tab is « Travail » or « Organisation » for other usages: its icon follows.
                  const Icon = tb.key === 'etudes' ? USAGE_ICONS[usage] ?? tb.icon : tb.icon;
                  return <Icon size={15} className={cx('shrink-0', tab === tb.key && 'md:text-brand-600')} />;
                })()}
                <span className="max-w-full truncate">{tb.key === 'etudes' ? (WORDS[usage] ?? WORDS.etudes).profileTab : tb.label}</span>
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
            {tab === 'profil' && <ProfileTab />}
            {tab === 'apparence' && <AppearanceTab />}
            {tab === 'copilot' && <CopilotTab />}
            {tab === 'etudes' && <StudiesTab />}
            {tab === 'notifications' && <NotificationsTab />}
            {tab === 'donnees' && <DataTab />}
            {tab === 'raccourcis' && <ShortcutsTab />}
            {tab === 'compte' && <AccountTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
