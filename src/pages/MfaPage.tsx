import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { useAuth, type MfaEnrollment } from '../store/auth';
import { loadUserData, useWelcome } from '../store/session';
import { takeAfterLogin } from '../lib/afterLogin';
import Logo from '../components/Logo';
import { toast } from '../store/ui';

/**
 * Second factor: the student scans a QR code with their phone camera (or an authenticator
 * app), the phone then shows a 6-digit code that changes every 30 s, to type here.
 * Shown once when the account is created, then at each new login.
 */
/** The key as a small text file, to keep with the student's documents or password manager. */
function downloadKey(secret: string, email: string) {
  const text = `Clé de secours Kompaly (double authentification)\nCompte : ${email}\nClé : ${secret}\n\nEn cas de perte du téléphone : dans une app d’authentification, « Ajouter un compte » puis « Saisir une clé », et colle cette clé.\nGarde ce fichier en lieu sûr : avec ton mot de passe, il ouvre ton compte.\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = 'kompaly-cle-de-secours.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function MfaPage() {
  const navigate = useNavigate();
  const { user, mfaStep, startMfaSetup, submitMfaCode, logout } = useAuth();
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [keptKey, setKeptKey] = useState(false);
  const started = useRef(false);
  const submitting = useRef(false); // the submit itself navigates once the account's data is loaded
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mfaStep !== 'setup' || started.current) return;
    started.current = true;
    startMfaSetup().then(setEnrollment, (e: Error) => setError(e.message));
  }, [mfaStep, startMfaSetup]);

  useEffect(() => {
    if (!user) navigate('/connexion', { replace: true });
    else if (!mfaStep && !submitting.current) navigate('/', { replace: true });
  }, [user, mfaStep, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) return setError('Le code contient 6 chiffres.');
    if (mfaStep === 'setup' && !keptKey) return setError('Garde d’abord ta clé de secours (étape 2).');
    setBusy(true);
    setError('');
    submitting.current = true;
    try {
      await submitMfaCode(code, enrollment?.factorId);
      await loadUserData();
      // Straight to the right page: going through « / » first left a blank screen when the questionnaire was due.
      navigate(useWelcome.getState().pending ? '/bienvenue' : takeAfterLogin(), { replace: true });
    } catch (err) {
      submitting.current = false;
      const msg = (err as Error).message;
      setError(
        mfaStep === 'setup' && msg.startsWith('Code incorrect')
          ? 'Code refusé. Tape le code de l’entrée Kompaly que tu viens d’ajouter (celle d’un ancien compte supprimé ne marche plus), et vérifie que l’heure de ton téléphone est réglée sur automatique.'
          : msg,
      );
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const isSetup = mfaStep === 'setup';

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-6 sm:px-10">
      <Logo />
      <div className="flex flex-1 items-center justify-center py-8">
        <form onSubmit={submit} className="enter w-full max-w-[380px]">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            {isSetup ? <ShieldCheck size={20} /> : <Smartphone size={20} />}
          </span>
          <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.015em]">{isSetup ? 'Sécurise ton compte' : 'Code de sécurité'}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-stone-500">
            {isSetup
              ? 'Dernière étape : associe ton téléphone. Même si quelqu’un découvre ton mot de passe, il ne pourra pas entrer sans lui.'
              : 'Ouvre l’app où tu as ajouté Kompaly et tape le code à 6 chiffres affiché.'}
          </p>

          {isSetup && (
            <ol className="mt-6 space-y-4 text-[13px]">
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-paper">1</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Scanne ce QR code avec ton téléphone</p>
                  <p className="mt-0.5 text-stone-500">
                    iPhone : l’appareil photo, puis « Ajouter dans Mots de passe ». Android : Google Authenticator ou Microsoft Authenticator.
                  </p>
                  {user?.email && (
                    <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-[12.5px] leading-relaxed text-amber-900">
                      Ce QR code est celui du compte <strong className="[overflow-wrap:anywhere]">{user.email}</strong>. Si ton iPhone propose une autre adresse, ne la choisis pas : range le code dans l’identifiant {user.email} (ou crée-le), sinon le code de l’autre compte serait remplacé.
                    </p>
                  )}
                  <div className="mt-3 flex h-[180px] w-[180px] items-center justify-center rounded-xl border border-stone-200 bg-surface p-2.5">
                    {enrollment ? <img src={enrollment.qrCode} alt="QR code à scanner" className="h-full w-full" /> : <Loader2 className="animate-spin text-stone-400" />}
                  </div>
                  {enrollment && (
                    <div className="mt-2 text-[12px] text-stone-500">
                      <a href={enrollment.uri} className="underline decoration-stone-300 underline-offset-2 hover:text-ink">
                        Tu es déjà sur ton téléphone ? Touche ici
                      </a>
                      {' · '}
                      <button type="button" onClick={() => setShowSecret(s => !s)} className="underline decoration-stone-300 underline-offset-2 hover:text-ink">
                        Saisir la clé à la main
                      </button>
                      {showSecret && <p className="mt-1.5 break-all rounded-md bg-stone-100 px-2 py-1.5 font-mono text-[12px] text-ink">{enrollment.secret}</p>}
                    </div>
                  )}
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-paper">2</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Garde ta clé de secours</p>
                  <p className="mt-0.5 text-stone-500">
                    Si tu perds ton téléphone, cette clé permet de réinstaller tes codes sur un nouveau (option « Saisir une clé » de l’app). Sans elle, le compte reste bloqué.
                  </p>
                  {enrollment && (
                    <>
                      <p className="mt-2 break-all rounded-md bg-stone-100 px-2 py-1.5 font-mono text-[12px] text-ink">{enrollment.secret}</p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" className="btn-secondary h-8" onClick={() => {
                            const failed = () => toast('Copie impossible : télécharge la clé, ou recopie-la à la main.', 'error');
                            if (!navigator.clipboard) return failed();
                            navigator.clipboard.writeText(enrollment.secret).then(() => {
                              setKeptKey(true);
                              toast('Clé copiée. Colle-la dans un endroit sûr (gestionnaire de mots de passe, note privée).', 'success');
                            }, failed);
                          }}>
                          Copier
                        </button>
                        <button type="button" className="btn-secondary h-8" onClick={() => (downloadKey(enrollment.secret, user?.email ?? ''), setKeptKey(true))}>
                          Télécharger
                        </button>
                      </div>
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px] text-stone-600">
                        <input type="checkbox" checked={keptKey} onChange={e => setKeptKey(e.target.checked)} className="h-4 w-4 shrink-0 accent-[var(--color-ink)]" />
                        Je l’ai gardée en lieu sûr (gestionnaire de mots de passe, papier…)
                      </label>
                    </>
                  )}
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-paper">3</span>
                <p className="font-medium">Tape le code à 6 chiffres affiché par ton téléphone</p>
              </li>
            </ol>
          )}

          <input
            ref={inputRef}
            value={code}
            onChange={e => setCode(e.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus={!isSetup}
            placeholder="123 456"
            aria-label="Code à 6 chiffres"
            className="field mt-5 h-12 w-full text-center font-mono text-[22px] tracking-[0.3em]"
          />

          {error && <p className="mt-3 text-[13px] text-red-600">{error}</p>}

          <button type="submit" disabled={busy || (isSetup && !enrollment)} className="btn-primary mt-4 w-full">
            {busy && <Loader2 size={15} className="animate-spin" />}
            {isSetup ? 'Activer et entrer' : 'Valider'}
          </button>

          <p className="mt-5 text-center text-[13px] text-stone-500">
            {isSetup ? 'Pas le bon compte ?' : 'Tu n’as plus accès à ton téléphone ?'}{' '}
            <button
              type="button"
              onClick={() => void logout().then(() => navigate('/connexion', { replace: true }))}
              className="font-medium text-ink underline decoration-stone-300 underline-offset-4 hover:decoration-ink"
            >
              Se déconnecter
            </button>
          </p>
          {!isSetup && (
            <p className="mt-2 text-center text-[12px] leading-relaxed text-stone-500">
              Avec ta clé de secours, ajoute Kompaly dans l’app d’authentification de ton nouveau téléphone (« Saisir une clé »), puis tape le code. Sinon, écris au support depuis la page{' '}
              <a href="/mentions-legales" className="underline decoration-stone-300 underline-offset-2">
                Mentions légales
              </a>
              .
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
