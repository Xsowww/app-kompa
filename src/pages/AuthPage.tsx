import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../store/auth';
import AccountList from '../components/AccountList';
import { needsCredentials, reloginHint, savedAccounts, type SavedAccount } from '../lib/accounts';
import { takeAfterLogin } from '../lib/afterLogin';
import { toast } from '../store/ui';
import { loadUserData, markLocalWelcome } from '../store/session';
import { cloudEnabled, linkError, setRememberMe } from '../lib/supabase';
import { prefetchCaptcha } from '../lib/captcha';
import Character from '../copilot/Character';
import Logo from '../components/Logo';
import FileIcon from '../components/FileIcon';
import { LEGAL_LINKS } from './legal/links';

function Showcase() {
  const days = [
    { d: 'Lun', n: 13 },
    { d: 'Mar', n: 14, dot: '#3b6fd8' },
    { d: 'Mer', n: 15, dot: '#d48a17' },
    { d: 'Jeu', n: 16, active: true },
    { d: 'Ven', n: 17, dot: '#d9483b' },
  ];
  return (
    <div className="relative flex h-full flex-col justify-center overflow-hidden px-14">
      <div className="max-w-[440px]">
        <p className="eyebrow">Études, travail, vie perso</p>
        <h2 className="mt-2 text-[32px] font-extrabold leading-[1.05] tracking-[-0.035em]">
          Ton agenda, tes notes et tes fichiers, enfin au même endroit.
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-stone-500">Un espace calme pour t’organiser, et Kompaly pour te rappeler ce qui compte.</p>
      </div>

      {/* Product preview */}
      <div className="mt-10 grid max-w-[460px] grid-cols-5 gap-3">
        <div className="card col-span-3 p-4">
          <p className="eyebrow">Cette semaine</p>
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
              <span className="h-3 w-0.5 rounded-full bg-[#3b6fd8]" /> Rendez-vous chez le dentiste <span className="ml-auto tabular text-stone-500">09:00</span>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-stone-50 px-2 py-1.5 text-[12px]">
              <span className="h-3 w-0.5 rounded-full bg-[#d48a17]" /> Envoyer le dossier <span className="ml-auto tabular text-stone-500">18:00</span>
            </div>
          </div>
        </div>
        <div className="card col-span-2 flex flex-col bg-tile-dark p-4 text-white">
          <p className="text-[12px] font-semibold text-white/65">Prochain grand jour</p>
          <p className="mt-auto flex items-baseline gap-1.5">
            <span className="tabular text-[56px] font-extrabold leading-[0.8] tracking-[-0.06em] text-urgent">4</span>
            <span className="text-[13px] font-bold">jours</span>
          </p>
          <p className="mt-2 text-[12px] font-semibold">Présentation du projet</p>
        </div>
        <div className="card col-span-2 flex items-center gap-2.5 p-3">
          <FileIcon category="folder" size={30} />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium">Projets 2026</p>
            <p className="text-[11px] text-stone-500">24 fichiers</p>
          </div>
        </div>
        <div className="card col-span-3 flex items-center gap-2.5 p-3">
          <FileIcon category="pdf" size={30} />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium">Devis — Rénovation cuisine.pdf</p>
            <p className="text-[11px] text-stone-500">Modifié hier</p>
          </div>
        </div>
      </div>

      {/* Kompaly peeking from the edge, under the preview (never over it) */}
      <div className="-mr-14 mt-6 flex items-center justify-end gap-1">
        <div className="pop mb-6 w-48 rounded-2xl rounded-br-sm border border-stone-200 bg-surface px-3 py-2 text-[12.5px] leading-snug shadow-pop" style={{ animationDelay: '600ms' }}>
          Psst. Ta présentation est dans 4&nbsp;jours, on bloque du temps pour la préparer&nbsp;?
        </div>
        <Character pose="peek" look={{ x: -0.9, y: -0.2 }} mood="happy" size={104} />
      </div>
    </div>
  );
}

type Mode = 'login' | 'register' | 'forgot' | 'reset';
type Field = 'name' | 'email' | 'password' | 'code' | 'agreed' | 'age';

const COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  login: { title: 'Connexion', subtitle: 'Retrouve ton espace là où tu l’as laissé.', submit: 'Se connecter' },
  register: { title: 'Créer un compte', subtitle: 'Gratuit, et prêt en quelques secondes.', submit: 'Créer mon compte' },
  forgot: { title: 'Mot de passe oublié', subtitle: 'On t’envoie un lien pour en choisir un nouveau.', submit: 'Envoyer le lien' },
  reset: { title: 'Nouveau mot de passe', subtitle: 'Choisis ton nouveau mot de passe.', submit: 'Enregistrer' },
};

export default function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
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
  // The field an error is about: the message goes right under it and the focus into it.
  const [errField, setErrField] = useState<Field | null>(null);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const fail = (field: Field | null, message: string) => {
    setError(message);
    setErrField(field);
    if (field) setTimeout(() => refs.current[field]?.focus(), 0);
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setErrField(null);
    setInfo('');
    if (isRegister && name.trim().length < 2) return fail('name', 'Ton prénom doit contenir au moins 2 caractères.');
    if (needsEmail && !/^\S+@\S+\.\S+$/.test(email)) return fail('email', email.trim() ? 'Adresse e-mail invalide.' : 'Entre ton adresse e-mail.');
    if ((isRegister || mode === 'reset') && (password.length < 8 || !/\p{L}/u.test(password) || !/\d/.test(password))) {
      return fail('password', 'Le mot de passe doit contenir au moins 8 caractères, avec des lettres et des chiffres.');
    }
    if (mode === 'reset' && needsCode && !/^\d{6}$/.test(code.replace(/\s/g, ''))) return fail('code', 'Entre le code à 6 chiffres affiché sur ton téléphone.');
    if (isRegister && !agreed) return fail('agreed', 'Accepte les conditions d’utilisation pour créer ton compte.');
    if (isRegister && !oldEnough) return fail('age', 'Kompaly est ouvert dès 15 ans. Avant, il faut l’accord d’un parent.');
    if (mode === 'login' && !password) return fail('password', 'Entre ton mot de passe.');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await requestPasswordReset(email);
        setInfo('Si un compte existe avec cette adresse, un e-mail vient de partir. Pense à regarder dans les spams.');
        return;
      }
      if (mode === 'reset') {
        await setNewPassword(password, needsCode ? code : undefined);
        await loadUserData();
        navigate('/');
        toast('Mot de passe modifié', 'success');
        return;
      }
      if (isRegister) {
        setRememberMe(true); // a new account stays signed in on the device it was created on
        const user = await register(name, email, password);
        if (!user) {
          setInfo(
            `Presque fini ! Un e-mail vient de partir à ${email.trim()}. Ouvre-le sur cet appareil (en laissant ce site ouvert) et clique sur le lien : la connexion se fera automatiquement.`,
          );
          setCanResend(true);
          setPassword('');
          return;
        }
        if (useAuth.getState().mfaStep) return navigate('/securite'); // pair the phone first
        if (!cloudEnabled) markLocalWelcome(user.id); // cloud mode knows it from the profile on load
        await loadUserData();
      } else {
        setRememberMe(remember);
        await login(email, password);
        if (useAuth.getState().mfaStep) return navigate('/securite');
        await loadUserData();
      }
      navigate(takeAfterLogin());
    } catch (err) {
      const message = (err as Error).message;
      // The button was disabled while waiting, so the focus fell out of the form: back to the field at fault.
      const field: Field | null = message.startsWith('Un compte existe') || message.startsWith('Confirme d’abord') ? 'email' : /\bcode\b/i.test(message) && mode === 'reset' ? 'code' : needsPassword ? 'password' : 'email';
      if (field === 'code') setNeedsCode(true);
      fail(field, message);
      if (message.startsWith('Confirme d’abord')) setCanResend(true);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError('');
    setInfo('');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Entre ton adresse e-mail ci-dessus, puis clique à nouveau sur « Renvoyer l’e-mail ».');
    setBusy(true);
    try {
      await resendConfirmation(email);
      setInfo('Nouvel e-mail envoyé. Ouvre-le sur cet appareil, dans ce navigateur, et clique sur le lien une seule fois.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const invalid = (field: Field) => (error && errField === field ? { 'aria-invalid': true, 'aria-describedby': 'auth-error' } : {});
  const errAt = (field: Field) =>
    error && errField === field ? (
      <span id="auth-error" role="alert" className="mt-1.5 block text-[12.5px] text-red-600">
        {error}
      </span>
    ) : null;

  const copy = COPY[mode];
  const adding = mode === 'login' && new URLSearchParams(location.search).has('ajout');

  // A saved account: opened with a click, or its e-mail filled in when the password is needed again.
  const pick = async (a: SavedAccount) => {
    const askPassword = (msg: string) => {
      setEmail(a.email);
      setPassword('');
      setError('');
      setInfo(msg);
      setTimeout(() => passwordRef.current?.focus(), 0);
    };
    if (needsCredentials(a)) return askPassword(reloginHint(a));
    setSwitching(a.id);
    try {
      if ((await useAuth.getState().switchAccount(a.id)) === 'credentials') askPassword('La session de ce compte a expiré : entre de nouveau ton mot de passe.');
    } catch {
      askPassword('Impossible d’ouvrir ce compte directement : entre ton mot de passe.');
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="flex h-full overflow-y-auto">
      <main className="flex flex-1 flex-col px-6 py-6 sm:px-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <form onSubmit={onSubmit} noValidate className="enter w-full max-w-[340px]">
            <h1 className="text-[30px] font-extrabold tracking-[-0.035em]">{adding ? 'Ajouter un compte' : copy.title}</h1>
            <p className="mt-1 text-[13px] text-stone-500">{adding ? 'Connecte-toi à un autre compte : tu pourras passer de l’un à l’autre en un clic.' : copy.subtitle}</p>

            {mode === 'login' && hasSaved && (
              <section aria-labelledby="comptes-appareil" className="mt-6">
                <h2 id="comptes-appareil" className="eyebrow mb-2">
                  Comptes sur cet appareil
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
                  ou un autre compte
                  <span className="h-px flex-1 bg-stone-200" />
                </p>
              </section>
            )}

            <div className="mt-7 space-y-3.5">
              {isRegister && (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-stone-600">Prénom</span>
                  <input ref={el => { refs.current.name = el; }} {...invalid('name')} className="field w-full" value={name} onChange={e => setName(e.target.value)} autoComplete="given-name" autoFocus />
                  {errAt('name')}
                </label>
              )}
              {needsEmail && (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-stone-600">E-mail</span>
                  <input ref={el => { refs.current.email = el; }} {...invalid('email')} className="field w-full" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" autoFocus={!isRegister && !askedEmail} placeholder="prenom@exemple.fr" />
                  {errAt('email')}
                </label>
              )}
              {needsPassword && (
                // A div, not a label: the eye button and « Oublié ? » must not end up in the field's name.
                <div>
                  <span className="mb-1.5 flex items-center text-[12px] font-medium text-stone-600">
                    <label htmlFor="auth-password">{mode === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe'}</label>
                    {mode === 'login' && cloudEnabled && (
                      <Link to="/mot-de-passe-oublie" className="ml-auto font-normal text-stone-500 hover:text-ink">
                        Oublié ?
                      </Link>
                    )}
                  </span>
                  <span className="relative block">
                    <input
                      ref={el => {
                        passwordRef.current = el;
                        refs.current.password = el;
                      }}
                      {...invalid('password')}
                      id="auth-password"
                      className="field w-full pr-10"
                      type={show ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      placeholder={mode === 'login' ? undefined : '8 caractères, lettres et chiffres'}
                      autoFocus={mode === 'reset' || !!askedEmail}
                    />
                    <button type="button" onClick={() => setShow(s => !s)} className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-1.5 text-stone-500 hover:text-stone-700 pointer-coarse:h-9 pointer-coarse:w-9" title={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                      {show ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </span>
                  {errAt('password')}
                </div>
              )}
              {mode === 'reset' && needsCode && (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-stone-600">Code de ton application d’authentification</span>
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
                    onChange={e => setCode(e.target.value)}
                    placeholder="123456"
                  />
                  <span className="mt-1 block text-[11.5px] text-stone-500">Ton compte est protégé par la double authentification : le code du téléphone est aussi demandé.</span>
                  {errAt('code')}
                </label>
              )}
            </div>

            {mode === 'login' && cloudEnabled && (
              <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[12.5px] text-stone-600">
                <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="h-4 w-4 shrink-0 accent-[var(--color-ink)]" />
                <span>
                  Garder la session ouverte sur cet appareil
                  <span className="block text-[11.5px] text-stone-500">Décoche sur un ordinateur partagé : la session se fermera avec l’onglet.</span>
                </span>
              </label>
            )}

            {isRegister && (
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-snug text-stone-600">
                <input ref={el => { refs.current.agreed = el; }} {...invalid('agreed')} type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-ink)]" />
                <span>
                  J’accepte les{' '}
                  <Link to="/conditions" target="_blank" className="font-medium text-ink underline decoration-stone-300 underline-offset-2">
                    conditions d’utilisation
                  </Link>{' '}
                  et la{' '}
                  <Link to="/confidentialite" target="_blank" className="font-medium text-ink underline decoration-stone-300 underline-offset-2">
                    politique de confidentialité
                  </Link>
                  .
                </span>
              </label>
            )}
            {isRegister && (
              // Touch: 10 px more above and below to tap, taken back by the margins (same layout).
              <label className="mt-2.5 flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-snug text-stone-600 pointer-coarse:-mb-2.5 pointer-coarse:mt-0 pointer-coarse:py-2.5">
                <input ref={el => { refs.current.age = el; }} {...invalid('age')} type="checkbox" checked={oldEnough} onChange={e => setOldEnough(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-ink)]" />
                <span>J’ai 15&nbsp;ans ou plus, ou l’accord d’un parent.</span>
              </label>
            )}

            {error && (errField === null || errField === 'agreed' || errField === 'age') && (
              <p id="auth-error" role="alert" className="mt-3 text-[13px] text-red-600">
                {error}
              </p>
            )}
            {info && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">{info}</p>}
            {canResend && cloudEnabled && (mode === 'login' || mode === 'register') && (
              <button type="button" onClick={() => void resend()} disabled={busy} className="mt-2 text-[13px] font-medium text-ink underline decoration-stone-300 underline-offset-4 hover:decoration-ink disabled:opacity-50">
                Renvoyer l’e-mail de confirmation
              </button>
            )}

            <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">
              {busy && <Loader2 size={15} className="animate-spin" />}
              {copy.submit}
            </button>

            <p className="mt-6 text-center text-[13px] text-stone-500">
              {mode === 'login' ? 'Pas encore de compte ?' : mode === 'register' ? 'Déjà un compte ?' : null}{' '}
              <Link to={mode === 'login' ? '/inscription' : '/connexion'} className="hit font-medium text-ink underline decoration-stone-300 underline-offset-4 hover:decoration-ink">
                {mode === 'login' ? 'Créer un compte' : mode === 'register' ? 'Se connecter' : 'Retour à la connexion'}
              </Link>
            </p>
          </form>
        </div>
        <p className="text-[11px] text-stone-500">
          {cloudEnabled ? 'Tes données sont chiffrées en transit et protégées : personne d’autre que toi n’y a accès.' : 'Tes données restent enregistrées sur cet appareil.'}
          {LEGAL_LINKS.map(l => (
            <span key={l.to}>
              {'\u00a0· '}
              <Link to={l.to} className="whitespace-nowrap underline decoration-stone-300 underline-offset-2 hover:text-ink">
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
