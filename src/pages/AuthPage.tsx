import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff, Fingerprint, Loader2 } from 'lucide-react';
import { AUTH_MSG, awaitConfirmation, useAuth } from '../store/auth';
import AccountList from '../components/AccountList';
import { needsCredentials, reloginHint, savedAccounts, type SavedAccount } from '../lib/accounts';
import { takeAfterLogin } from '../lib/afterLogin';
import { toast } from '../store/ui';
import { loadUserData, markLocalWelcome } from '../store/session';
import { cloudEnabled, linkError, passkeysAvailable, setRememberMe } from '../lib/supabase';
import { prefetchCaptcha } from '../lib/captcha';
import { offerPasskey } from '../lib/passkeyOffer';
import Character from '../copilot/Character';
import Logo from '../components/Logo';
import FileIcon from '../components/FileIcon';
import OAuthButtons from '../components/OAuthButtons';
import PasswordStrength from '../components/PasswordStrength';
import { FieldError } from '../components/Field';
import LanguagePicker from '../components/LanguagePicker';
import { LEGAL_LINKS } from './legal/links';
import { t, tn } from '../i18n';

function Showcase() {
  const days = [
    { d: t('Lun'), n: 13 },
    { d: t('Mar'), n: 14, dot: '#3b6fd8' },
    { d: t('Mer'), n: 15, dot: '#d48a17' },
    { d: t('Jeu'), n: 16, active: true },
    { d: t('Ven'), n: 17, dot: '#d9483b' },
  ];
  return (
    <div className="relative flex h-full flex-col justify-center overflow-hidden px-14">
      <div className="max-w-[440px]">
        <p className="eyebrow">{t('Études, travail, vie perso')}</p>
        <h2 className="mt-2 text-[32px] font-extrabold leading-[1.05] tracking-[-0.035em]">
          {t('Ton agenda, tes notes et tes fichiers, enfin au même endroit.')}
        </h2>
      </div>

      {/* Product preview */}
      <div className="mt-10 grid max-w-[460px] grid-cols-5 gap-3">
        <div className="card col-span-3 p-4">
          <p className="eyebrow">{t('Cette semaine')}</p>
          <div className="mt-3 grid grid-cols-5 gap-1.5 text-center">
            {days.map(x => (
              <div key={x.n} className={x.active ? 'rounded-xl bg-tile-blue py-1.5 text-white' : 'py-1.5'}>
                <p className={x.active ? 'text-[10px] text-white/90' : 'text-[10px] text-stone-500'}>{x.d}</p>
                <p className="tabular text-[14px] font-semibold">{x.n}</p>
                <span className="mx-auto mt-1 block h-1 w-1 rounded-full" style={{ background: x.dot ?? 'transparent' }} />
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-2 rounded-md bg-stone-50 px-2 py-1.5 text-[12px]">
              <span className="h-3 w-0.5 rounded-full bg-[#3b6fd8]" /> {t('Rendez-vous chez le dentiste')} <span className="ml-auto tabular text-stone-500">09:00</span>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-stone-50 px-2 py-1.5 text-[12px]">
              <span className="h-3 w-0.5 rounded-full bg-[#d48a17]" /> {t('Envoyer le dossier')} <span className="ml-auto tabular text-stone-500">18:00</span>
            </div>
          </div>
        </div>
        <div className="card col-span-2 flex flex-col bg-tile-dark p-4 text-white">
          <p className="text-[12px] font-semibold text-white/65">{t('Prochain grand jour')}</p>
          <p className="mt-auto flex items-baseline gap-1.5">
            <span className="tabular text-[56px] font-extrabold leading-[0.8] tracking-[-0.06em] text-urgent">4</span>
            <span className="text-[13px] font-bold">{tn(4, 'jour', 'jours')}</span>
          </p>
          <p className="mt-2 text-[12px] font-semibold">{t('Présentation du projet')}</p>
        </div>
        <div className="card col-span-2 flex items-center gap-2.5 p-3">
          <FileIcon category="folder" size={30} />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium">{t('Projets 2026')}</p>
            <p className="text-[11px] text-stone-500">{tn(24, '{n} fichier', '{n} fichiers')}</p>
          </div>
        </div>
        <div className="card col-span-3 flex items-center gap-2.5 p-3">
          <FileIcon category="pdf" size={30} />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium">{t('Devis — Rénovation cuisine.pdf')}</p>
            <p className="text-[11px] text-stone-500">{t('Modifié hier')}</p>
          </div>
        </div>
      </div>

      {/* Kompaly peeking from the edge, under the preview (never over it) */}
      <div className="-mr-14 mt-6 flex items-center justify-end gap-1">
        <div className="pop mb-6 w-48 rounded-2xl rounded-br-sm border border-stone-200 bg-surface px-3 py-2 text-[12.5px] leading-snug shadow-pop" style={{ animationDelay: '600ms' }}>
          {t('Psst. Ta présentation est dans 4\u00a0jours, on bloque du temps pour la préparer\u00a0?')}
        </div>
        <Character pose="peek" look={{ x: -0.9, y: -0.2 }} mood="happy" size={104} />
      </div>
    </div>
  );
}

type Mode = 'login' | 'register' | 'forgot' | 'reset';
type Field = 'name' | 'email' | 'password' | 'code' | 'agreed' | 'age';

const COPY: Record<Mode, { title: string; subtitle?: string; submit: string }> = {
  login: { title: t('Connexion'), submit: t('Se connecter') },
  register: { title: t('Créer un compte'), subtitle: t('Gratuit, prêt en quelques secondes.'), submit: t('Créer mon compte') },
  forgot: { title: t('Mot de passe oublié'), subtitle: t('On t’envoie un lien pour le changer.'), submit: t('Envoyer le lien') },
  reset: { title: t('Nouveau mot de passe'), submit: t('Enregistrer||sauver') },
};

export default function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const confirmedElsewhere = useAuth(s => s.confirmedElsewhere);
  const { login, register, requestPasswordReset, setNewPassword, resendConfirmation } = useAuth.getState();
  const [name, setName] = useState('');
  // « Ajouter un compte » for a saved account whose session ended: its e-mail is already known.
  const [askedEmail] = useState(() => (mode === 'login' ? new URLSearchParams(location.search).get('email') ?? '' : ''));
  const [email, setEmail] = useState(askedEmail);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [oldEnough, setOldEnough] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState(mode === 'login' ? (linkError ?? '') : '');
  const [info, setInfo] = useState(askedEmail ? reloginHint(savedAccounts().find(a => a.email.toLowerCase() === askedEmail.toLowerCase())) : '');
  const [switching, setSwitching] = useState<string | null>(null);
  const [hasSaved, setHasSaved] = useState(() => savedAccounts().length > 0);
  const [canResend, setCanResend] = useState(mode === 'login' && !!linkError);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';
  const needsEmail = mode !== 'reset';
  const needsPassword = mode !== 'forgot';
  const passwordRef = useRef<HTMLInputElement>(null);
  // Errors about a field go right under it (and the focus into it); the others in the banner (`error`).
  const [errs, setErrs] = useState<Partial<Record<Field, string>>>({});
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const fail = (field: Field | null, message: string) => {
    if (!field) return setError(message);
    setErrs(e => ({ ...e, [field]: message }));
    setTimeout(() => refs.current[field]?.focus(), 0);
  };
  // Reset link of an account with a phone paired: the new password also needs its code.
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  // The anti-robot check runs while the form is being filled in.
  useEffect(() => {
    if (mode !== 'reset') prefetchCaptcha();
  }, [mode]);
  useEffect(() => {
    if (mode === 'reset' && cloudEnabled) void useAuth.getState().resetNeedsCode().then(setNeedsCode);
  }, [mode]);
  // Face ID / fingerprint: offered once switched on in Supabase and possible on this device.
  const [passkeys, setPasskeys] = useState(false);
  useEffect(() => {
    if (mode === 'login') void passkeysAvailable().then(setPasskeys);
  }, [mode]);

  // What is wrong with a field ('' when nothing), with its current value or the one being typed.
  const values = { name, email, password, code, agreed, age: oldEnough };
  const check = (field: Field, v: string | boolean = values[field]): string => {
    const s = typeof v === 'string' ? v : '';
    if (field === 'name') return isRegister && s.trim().length < 2 ? t('Ton prénom doit contenir au moins 2 caractères.') : '';
    if (field === 'email') return needsEmail && !/^\S+@\S+\.\S+$/.test(s) ? (s.trim() ? t('Adresse e-mail invalide.') : t('Entre ton adresse e-mail.')) : '';
    if (field === 'password') {
      if ((isRegister || mode === 'reset') && (s.length < 8 || !/\p{L}/u.test(s) || !/\d/.test(s))) return t('Au moins 8 caractères, avec des lettres et des chiffres.');
      return mode === 'login' && !s ? t('Entre ton mot de passe.') : '';
    }
    if (field === 'code') return mode === 'reset' && needsCode && !/^\d{6}$/.test(s.replace(/\s/g, '')) ? t('Entre le code à 6 chiffres de ton téléphone.') : '';
    if (field === 'agreed') return isRegister && !v ? t('Accepte les conditions pour continuer.') : '';
    return isRegister && !v ? t('Kompaly est ouvert dès 15 ans, ou avant avec l’accord d’un parent.') : '';
  };
  // Leaving a filled-in field checks it; an empty one waits for the submit.
  const blurCheck = (field: Field) => () => {
    const v = values[field];
    if (typeof v === 'string' && v && check(field)) setErrs(e => ({ ...e, [field]: check(field) }));
  };
  // Typing (or ticking) clears the field's error as soon as it is right.
  const edit = (field: Field, v: string | boolean) => {
    if (errs[field] && !check(field, v)) setErrs(e => ({ ...e, [field]: undefined }));
  };

  async function passkeyLogin() {
    setError('');
    setErrs({});
    setBusy(true);
    try {
      setRememberMe(remember);
      if (!(await useAuth.getState().loginWithPasskey())) return; // prompt closed
      if (useAuth.getState().mfaStep) return navigate('/securite');
      await loadUserData();
      navigate(takeAfterLogin());
    } catch (err) {
      fail(null, (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    // Every wrong field at once, each under itself; the focus goes to the first one.
    const found = (['name', 'email', 'password', 'code', 'agreed', 'age'] as Field[]).map(f => [f, check(f)] as const).filter(([, m]) => m);
    setErrs(Object.fromEntries(found));
    if (found.length) return fail(found[0][0], found[0][1]);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await requestPasswordReset(email);
        setInfo(t('Si un compte existe, un e-mail vient de partir (regarde aussi les spams).'));
        return;
      }
      if (mode === 'reset') {
        await setNewPassword(password, needsCode ? code : undefined);
        await loadUserData();
        navigate('/');
        toast(t('Mot de passe modifié'), 'success');
        return;
      }
      if (isRegister) {
        setRememberMe(true); // a new account stays signed in on the device it was created on
        const user = await register(name, email, password);
        if (!user) {
          setInfo(t('Presque fini ! Ouvre l’e-mail envoyé à {email} sur cet appareil et clique sur le lien.', { email: email.trim() }));
          awaitConfirmation(true);
          setCanResend(true);
          setPassword('');
          return;
        }
        if (useAuth.getState().mfaStep) return navigate('/securite'); // pair the phone first
        if (!cloudEnabled) markLocalWelcome(user.id); // cloud mode knows it from the profile on load
        await loadUserData();
      } else {
        setRememberMe(remember);
        const user = await login(email, password);
        if (useAuth.getState().mfaStep) return navigate('/securite');
        await loadUserData();
        if (cloudEnabled) void offerPasskey(user.id);
      }
      navigate(takeAfterLogin());
    } catch (err) {
      const message = (err as Error).message;
      // The button was disabled while waiting, so the focus fell out of the form: back to the field at fault.
      // Compared with the same t() texts as the store's (AUTH_MSG), so in every language.
      const aboutEmail = message === AUTH_MSG.accountExists || message === AUTH_MSG.accountExistsSignIn || message === AUTH_MSG.notConfirmed;
      const aboutCode = /\bcode\b/i.test(message) || message === AUTH_MSG.wrongCode || message === AUTH_MSG.needCode;
      const aboutPassword = [AUTH_MSG.wrongPassword, t('E-mail ou mot de passe incorrect.'), t('Mot de passe trop faible : au moins 8 caractères, avec lettres et chiffres.'), t('Le nouveau mot de passe doit être différent de l’ancien.')].includes(message);
      // The others (network, too many tries, expired link…) are about no field: in the banner.
      const field: Field | null = aboutEmail ? 'email' : aboutCode && mode === 'reset' ? 'code' : aboutPassword && needsPassword ? 'password' : null;
      if (field === 'code') setNeedsCode(true);
      fail(field, message);
      if (message === AUTH_MSG.notConfirmed) setCanResend(true);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError('');
    setInfo('');
    if (!/^\S+@\S+\.\S+$/.test(email)) return fail('email', t('Entre ton e-mail ci-dessus, puis réessaie.'));
    setBusy(true);
    try {
      await resendConfirmation(email);
      setInfo(t('E-mail renvoyé. Ouvre-le sur cet appareil et clique sur le lien.'));
      awaitConfirmation(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // `also`: what the field is already described by (the strength line under a new password).
  const invalid = (field: Field, also?: string) => ({
    'aria-invalid': errs[field] ? true : undefined,
    'aria-describedby': [also, errs[field] && `auth-err-${field}`].filter(Boolean).join(' ') || undefined,
    onBlur: blurCheck(field),
  });
  const errAt = (field: Field) => <FieldError id={`auth-err-${field}`}>{errs[field]}</FieldError>;

  const copy = COPY[mode];
  const adding = mode === 'login' && new URLSearchParams(location.search).has('ajout');

  // A saved account: opened with a click, or its e-mail filled in when the password is needed again.
  const pick = async (a: SavedAccount) => {
    const askPassword = (msg: string) => {
      setEmail(a.email);
      setPassword('');
      setError('');
      setErrs({});
      setInfo(msg);
      setTimeout(() => passwordRef.current?.focus(), 0);
    };
    if (needsCredentials(a)) return askPassword(reloginHint(a));
    setSwitching(a.id);
    try {
      if ((await useAuth.getState().switchAccount(a.id)) === 'credentials') askPassword(t('Session expirée : entre ton mot de passe.'));
    } catch {
      askPassword(t('Entre ton mot de passe pour ouvrir ce compte.'));
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="flex h-full overflow-y-auto">
      <main className="flex flex-1 flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" aria-label={t('Kompaly, accueil')} className="hit shrink-0">
            <Logo />
          </Link>
          <LanguagePicker />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          {confirmedElsewhere ? (
            // The e-mail link opened the account in another tab: one tab is enough.
            <div className="enter w-full max-w-[340px] text-center" role="status">
              <CheckCircle2 size={36} className="mx-auto text-emerald-600" aria-hidden />
              <h1 className="mt-4 text-[24px] font-extrabold tracking-[-0.03em]">{t('Adresse confirmée')}</h1>
              <p className="mt-2 text-[13.5px] text-stone-500">{t('Ton compte est ouvert dans l’autre onglet. Tu peux fermer celui-ci.')}</p>
              <button
                type="button"
                className="btn-secondary mt-6"
                onClick={() => {
                  awaitConfirmation(false);
                  location.reload();
                }}
              >
                {t('Continuer ici')}
              </button>
            </div>
          ) : (
          <form onSubmit={onSubmit} noValidate className="enter w-full max-w-[340px]">
            <h1 className="text-[30px] font-extrabold tracking-[-0.035em]">{adding ? t('Ajouter un compte') : copy.title}</h1>
            {(adding || copy.subtitle) && <p className="mt-1 text-[13px] text-stone-500">{adding ? t('Tu passeras de l’un à l’autre en un clic.') : copy.subtitle}</p>}

            {mode === 'login' && hasSaved && (
              <section aria-labelledby="comptes-appareil" className="mt-6">
                <h2 id="comptes-appareil" className="eyebrow mb-2">
                  {t('Comptes sur cet appareil')}
                </h2>
                <AccountList
                  onPick={a => void pick(a)}
                  busy={switching}
                  onEmpty={() => {
                    setHasSaved(false);
                    setTimeout(() => refs.current.email?.focus(), 0); // the list went away with the focus
                  }}
                />
                <p className="mt-5 flex items-center gap-3 text-[12px] text-stone-500">
                  <span className="h-px flex-1 bg-stone-200" />
                  {t('ou un autre compte')}
                  <span className="h-px flex-1 bg-stone-200" />
                </p>
              </section>
            )}

            {cloudEnabled && !adding && (mode === 'login' || isRegister) && (
              <OAuthButtons
                remember={isRegister || remember}
                onError={m => fail(null, m)}
                first={
                  mode === 'login' && passkeys ? (
                    <button type="button" className="btn-secondary h-10 w-full justify-center gap-2.5" disabled={busy} onClick={() => void passkeyLogin()}>
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <Fingerprint size={16} />}
                      {t('Face ID ou empreinte')}
                    </button>
                  ) : undefined
                }
              >
                <p className="mt-2 text-[11.5px] leading-snug text-stone-500">
                  {t('En continuant, tu acceptes les')}{' '}
                  <Link to="/conditions" target="_blank" className="underline decoration-stone-300 underline-offset-2 hover:text-ink">
                    {t('conditions')}
                  </Link>{' '}
                  {t('et confirmes avoir 15\u00a0ans ou plus.')}
                </p>
              </OAuthButtons>
            )}

            <div className="mt-7 space-y-4">
              {isRegister && (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Prénom')}</span>
                  <input ref={el => { refs.current.name = el; }} {...invalid('name')} className="field w-full" value={name} maxLength={40} onChange={e => (setName(e.target.value), edit('name', e.target.value))} autoComplete="given-name" autoFocus />
                  {errAt('name')}
                </label>
              )}
              {needsEmail && (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('E-mail')}</span>
                  <input ref={el => { refs.current.email = el; }} {...invalid('email')} className="field w-full" type="email" value={email} onChange={e => (setEmail(e.target.value), edit('email', e.target.value))} autoComplete="username" autoFocus={!isRegister && !askedEmail} placeholder={t('prenom@exemple.fr')} />
                  {errAt('email')}
                </label>
              )}
              {needsPassword && (
                // A div, not a label: the eye button and « Oublié ? » must not end up in the field's name.
                <div>
                  <span className="mb-1.5 flex items-center text-[12px] font-medium text-stone-600">
                    <label htmlFor="auth-password">{t('Mot de passe')}</label>
                    {mode === 'login' && cloudEnabled && (
                      <Link to="/mot-de-passe-oublie" className="ml-auto font-normal text-stone-500 hover:text-ink">
                        {t('Oublié ?')}
                      </Link>
                    )}
                  </span>
                  <span className="relative block">
                    <input
                      ref={el => {
                        passwordRef.current = el;
                        refs.current.password = el;
                      }}
                      {...invalid('password', mode === 'login' ? undefined : 'password-strength')}
                      id="auth-password"
                      className="field w-full pr-10"
                      type={show ? 'text' : 'password'}
                      value={password}
                      onChange={e => (setPassword(e.target.value), edit('password', e.target.value))}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      autoFocus={mode === 'reset' || !!askedEmail}
                    />
                    <button type="button" onClick={() => setShow(s => !s)} className="hit absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-1.5 text-stone-500 hover:text-stone-700 pointer-coarse:h-9 pointer-coarse:w-9" title={show ? t('Masquer le mot de passe') : t('Afficher le mot de passe')} aria-label={show ? t('Masquer le mot de passe') : t('Afficher le mot de passe')}>
                      {show ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </span>
                  {mode !== 'login' && <PasswordStrength id="password-strength" password={password} avoid={[name, email.split('@')[0]]} />}
                  {errAt('password')}
                </div>
              )}
              {mode === 'reset' && needsCode && (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-stone-600">{t('Code de ton application d’authentification')}</span>
                  <input
                    ref={el => {
                      refs.current.code = el;
                    }}
                    {...invalid('code')}
                    className="field w-full font-mono tracking-[0.3em]"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    value={code}
                    onChange={e => (setCode(e.target.value), edit('code', e.target.value))}
                    placeholder="123456"
                  />
                  {errAt('code')}
                </label>
              )}
            </div>

            {mode === 'login' && cloudEnabled && (
              <label className="hit mt-4 flex cursor-pointer items-center gap-2.5 text-[12.5px] text-stone-600">
                <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="relative z-[1] h-4 w-4 shrink-0 accent-[var(--color-ink)]" />
                <span>
                  {t('Rester connecté')}
                  <span className="block text-[11.5px] text-stone-500">{t('Décoche sur un ordinateur partagé.')}</span>
                </span>
              </label>
            )}

            {isRegister && (
              // .hit: the label takes taps up to 44 px high; its box and links stay above that margin (z-[1]).
              <>
              <label className="hit mt-4 flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-snug text-stone-600">
                <input ref={el => { refs.current.agreed = el; }} {...invalid('agreed')} type="checkbox" checked={agreed} onChange={e => (setAgreed(e.target.checked), edit('agreed', e.target.checked))} className="relative z-[1] mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-ink)]" />
                <span>
                  {t('J’accepte les')}{' '}
                  <Link to="/conditions" target="_blank" className="relative z-[1] font-medium text-ink underline decoration-stone-300 underline-offset-2">
                    {t('conditions d’utilisation')}
                  </Link>{' '}
                  {t('et la')}{' '}
                  <Link to="/confidentialite" target="_blank" className="relative z-[1] font-medium text-ink underline decoration-stone-300 underline-offset-2">
                    {t('politique de confidentialité')}
                  </Link>
                  .
                </span>
              </label>
              {errAt('agreed')}
              </>
            )}
            {isRegister && (
              // Touch: 20 px apart, so the two 44 px tap zones don't overlap.
              <>
              <label className="hit mt-2.5 flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-snug text-stone-600 pointer-coarse:mt-5">
                <input ref={el => { refs.current.age = el; }} {...invalid('age')} type="checkbox" checked={oldEnough} onChange={e => (setOldEnough(e.target.checked), edit('age', e.target.checked))} className="relative z-[1] mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-ink)]" />
                <span>{t('J’ai 15\u00a0ans ou plus, ou l’accord d’un parent.')}</span>
              </label>
              {errAt('age')}
              </>
            )}

            {error && (
              <p id="auth-error" role="alert" className="mt-3 text-[13px] text-red-600">
                {error}
              </p>
            )}
            {info && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">{info}</p>}
            {canResend && cloudEnabled && (mode === 'login' || mode === 'register') && (
              <button type="button" onClick={() => void resend()} disabled={busy} className="mt-2 text-[13px] font-medium text-ink underline decoration-stone-300 underline-offset-4 hover:decoration-ink disabled:opacity-50">
                {t('Renvoyer l’e-mail de confirmation')}
              </button>
            )}

            <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">
              {busy && <Loader2 size={15} className="animate-spin" />}
              {copy.submit}
            </button>

            <p className="mt-6 text-center text-[13px] text-stone-500">
              {mode === 'login' ? t('Pas encore de compte ?') : mode === 'register' ? t('Déjà un compte ?') : null}{' '}
              <Link to={mode === 'login' ? '/inscription' : '/connexion'} className="hit font-medium text-ink underline decoration-stone-300 underline-offset-4 hover:decoration-ink">
                {mode === 'login' ? t('Créer un compte') : mode === 'register' ? t('Se connecter') : t('Retour à la connexion')}
              </Link>
            </p>
          </form>
          )}
        </div>
        <p className="text-[11px] text-stone-500">
          {cloudEnabled ? t('Tes données sont chiffrées et protégées.') : t('Tes données restent sur cet appareil.')}
          {LEGAL_LINKS.map(l => (
            <span key={l.to}>
              {'\u00a0· '}
              <Link to={l.to} className="hit whitespace-nowrap underline decoration-stone-300 underline-offset-2 hover:text-ink">
                {l.label}
              </Link>
            </span>
          ))}
        </p>
      </main>
      <aside className="hidden flex-1 border-l border-stone-200/80 bg-stone-100/60 lg:block">
        <Showcase />
      </aside>
    </div>
  );
}
