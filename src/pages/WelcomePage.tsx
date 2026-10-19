import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Briefcase, Check, GraduationCap, House, Loader2 } from 'lucide-react';
import Logo from '../components/Logo';
import { useAuth } from '../store/auth';
import { finishWelcome, loadWelcomeDraft, saveWelcomeDraft, type WelcomeAnswers } from '../store/session';
import { PERSONAS, personaLabel } from '../lib/personas';
import { USAGES, WORDS, type Usage } from '../lib/usage';
import { cx } from '../lib/utils';
import { t } from '../i18n';

const USAGE_ICONS = { etudes: GraduationCap, travail: Briefcase, perso: House };

const NEEDS = (usage: Usage) => [
  { key: 'agenda', label: t('Ne rien oublier (agenda, rappels)') },
  { key: 'fichiers', label: t('Retrouver mes fichiers') },
  { key: 'notes', label: t('Prendre et ranger mes notes') },
  { key: 'taches', label: t('Suivre mes tâches') },
  { key: 'equipe', label: usage === 'travail' ? t('Travailler en équipe') : t('Travailler à plusieurs') },
  { key: 'enregistrer', label: usage === 'travail' ? t('Enregistrer mes réunions (compte rendu)') : usage === 'perso' ? t('Enregistrer et résumer (conférence, vidéo…)') : t('Enregistrer mes cours (texte et fiche)') },
  { key: 'ia', label: t('Me faire aider par une IA') },
];


const TIMES = [
  { value: '09:00', label: t('Le matin') },
  { value: '14:00', label: t('L’après-midi') },
  { value: '18:00', label: t('En fin de journée') },
  { value: '21:00', label: t('Le soir') },
];

const TIME_QUESTION: Record<Usage, string> = {
  etudes: t('Quand révises-tu le mieux\u00a0?'),
  travail: t('Quand te concentres-tu le mieux\u00a0?'),
  perso: t('Quand as-tu du temps pour toi\u00a0?'),
};

const STEPS = 6;

const DEFAULT_ANSWERS: WelcomeAnswers = { usage: 'etudes', year: '', school: '', program: '', needs: [], persona: 'pote', revisionTime: '18:00' };

// Longer than the double-click delay of the systems (500 ms on Windows): the second click of a
// double click lands on the next question, often on the answer just under the pointer.
const LOCK_MS = 700;

/** Six quick questions before the first visit: who is this for, so Kompaly speaks their language. */
export default function WelcomePage() {
  const navigate = useNavigate();
  const name = useAuth(s => s.user?.name ?? '');
  const userId = useAuth(s => s.user?.id ?? '');
  // A reload in the middle comes back to the same question, with the answers already given.
  const [draft] = useState(() => (userId ? loadWelcomeDraft(userId, DEFAULT_ANSWERS, STEPS) : null));
  const [step, setStep] = useState(draft?.step ?? 0);
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState<WelcomeAnswers>(draft?.answers ?? DEFAULT_ANSWERS);
  const words = WORDS[a.usage];
  useEffect(() => {
    if (userId && !busy) saveWelcomeDraft(userId, { step, answers: a });
  }, [userId, step, a, busy]);
  // A double click would also answer the next question, shown under the pointer.
  const moving = useRef(false);
  const settled = () => {
    if (moving.current) return false;
    moving.current = true;
    setTimeout(() => (moving.current = false), LOCK_MS);
    return true;
  };
  const go = (to: number) => settled() && setStep(to);
  const set = (patch: Partial<WelcomeAnswers>, next = true) => {
    if (next && !settled()) return;
    setA(prev => ({ ...prev, ...patch }));
    if (next) setStep(s => s + 1);
  };

  async function finish(answers: WelcomeAnswers) {
    setBusy(true);
    await finishWelcome(answers);
    navigate('/', { replace: true });
  }

  const choice = (selected: boolean) =>
    cx(
      'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
      selected ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50',
    );

  return (
    <div
      className="flex h-full flex-col overflow-y-auto px-6 py-6 sm:px-10"
      // Just after moving on, the end of a double click neither selects a word nor takes the focus off the title.
      onMouseDown={e => (moving.current || e.detail > 1) && !(e.target as HTMLElement).closest('input') && e.preventDefault()}
    >
      <Logo />
      <main className="flex flex-1 justify-center py-8 sm:pt-[8vh]">
        <div className="enter w-full max-w-[440px]">
          <div className="flex items-center gap-3">
            {/* The place of the back arrow is kept on the first question: the bar doesn't move afterwards. */}
            {step > 0 ? (
              <button type="button" onClick={() => go(step - 1)} className="icon-btn -ml-2" aria-label={t('Question précédente')}>
                <ArrowLeft size={16} />
              </button>
            ) : (
              <span className="-ml-2 h-8 w-8 shrink-0" aria-hidden />
            )}
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step + 1} aria-label={t('Question {n} sur {total}', { n: step + 1, total: STEPS })}>
              <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${((step + 1) / STEPS) * 100}%` }} />
            </div>
            <span className="tabular text-[12px] text-stone-500">{step + 1}/{STEPS}</span>
          </div>

          {step === 0 && (
            <Question title={name ? t('Bienvenue, {name}\u00a0! Tu vas utiliser Kompaly pour…', { name }) : t('Bienvenue\u00a0! Tu vas utiliser Kompaly pour…')}>
              {USAGES.map(u => {
                const Icon = USAGE_ICONS[u.key];
                return (
                  <button key={u.key} type="button" className={choice(a.usage === u.key)} onClick={() => set({ usage: u.key, year: '' })}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Icon size={18} /></span>
                    <span>
                      <span className="block text-[14px] font-medium">{u.label}</span>
                      <span className="block text-[12px] text-stone-500">{u.hint}</span>
                    </span>
                  </button>
                );
              })}
            </Question>
          )}

          {step === 1 && (
            <Question title={a.usage === 'etudes' ? t('Tu es en…') : a.usage === 'travail' ? t('Tu es…') : t('Aujourd’hui, tu es…')}>
              <div className="flex flex-wrap gap-2">
                {words.levels.filter(Boolean).map(l => (
                  <button key={l} type="button" onClick={() => set({ year: l })} className={cx('rounded-full border px-3.5 py-2 text-[13px]', a.year === l ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 hover:bg-stone-50')}>
                    {l}
                  </button>
                ))}
              </div>
            </Question>
          )}

          {step === 2 && (
            <Question title={a.usage === 'etudes' ? t('Où étudies-tu\u00a0?') : a.usage === 'travail' ? t('Où travailles-tu\u00a0?') : t('Un peu plus sur toi')} hint={t('Facultatif.')}>
              <label className="block text-[13px] font-medium">
                {words.school}
                <input className="field mt-1 h-10 w-full" value={a.school} placeholder={words.schoolHint} onChange={e => set({ school: e.target.value }, false)} onKeyDown={e => e.key === 'Enter' && go(3)} />
              </label>
              <label className="block text-[13px] font-medium">
                {words.program}
                <input className="field mt-1 h-10 w-full" value={a.program} placeholder={words.programHint} onChange={e => set({ program: e.target.value }, false)} onKeyDown={e => e.key === 'Enter' && go(3)} />
              </label>
              <button type="button" className="btn-primary mt-2 w-full" onClick={() => go(3)}>
                {a.school || a.program ? t('Continuer') : t('Passer')}
              </button>
            </Question>
          )}

          {step === 3 && (
            <Question title={t('De quoi as-tu le plus besoin\u00a0?')} hint={t('Plusieurs réponses possibles.')}>
              {NEEDS(a.usage).map(n => {
                const on = a.needs.includes(n.key);
                return (
                  <button key={n.key} type="button" aria-pressed={on} className={choice(on)} onClick={() => !moving.current && set({ needs: on ? a.needs.filter(x => x !== n.key) : [...a.needs, n.key] }, false)}>
                    <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-300')}>{on && <Check size={12} />}</span>
                    <span className="text-[14px]">{n.label}</span>
                  </button>
                );
              })}
              <button type="button" className="btn-primary mt-2 w-full" onClick={() => go(4)}>
                {t('Continuer')}
              </button>
            </Question>
          )}

          {step === 4 && (
            <Question title={t('Comment Kompaly doit-il te parler\u00a0?')} hint={t('Tu pourras changer ça dans ton profil.')}>
              {PERSONAS.map(p => (
                <button key={p.key} type="button" className={choice(a.persona === p.key)} onClick={() => set({ persona: p.key })}>
                  <span>
                    <span className="block text-[14px] font-medium">{personaLabel(p, a.usage)}</span>
                    <span className="block text-[12px] text-stone-500">{p.description}</span>
                  </span>
                </button>
              ))}
            </Question>
          )}

          {step === 5 && (
            <Question title={TIME_QUESTION[a.usage]} hint={
                a.usage === 'perso' ? (
                  t('Kompaly te proposera ce créneau pour avancer sur tes projets.')
                ) : (
                  <>{a.usage === 'travail' ? t('Kompaly placera tes créneaux de travail à ce') : t('Kompaly placera tes séances de révision à ce')} <span className="whitespace-nowrap">{t('moment-là')}</span>.</>
                )
              }>
              {TIMES.map(o => (
                <button
                  key={o.value}
                  type="button"
                  disabled={busy}
                  className={choice(a.revisionTime === o.value)}
                  onClick={() => {
                    if (!settled()) return;
                    setA(prev => ({ ...prev, revisionTime: o.value })); // the spinner shows on the chosen answer
                    void finish({ ...a, revisionTime: o.value });
                  }}
                >
                  <span className="text-[14px] font-medium">{o.label}</span>
                  {busy && a.revisionTime === o.value && <Loader2 size={14} className="ml-auto animate-spin" />}
                </button>
              ))}
            </Question>
          )}

          {step === 0 && (
            <button type="button" disabled={busy} onClick={() => void finish(a)} className="mt-3 w-full py-3 text-center text-[12px] text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-ink">
              {t('Passer le questionnaire')}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function Question({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  // Each new question takes the keyboard focus (the button that was clicked is gone with the old one).
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  return (
    <section className="mt-6">
      <h1 ref={heading} tabIndex={-1} className="text-[22px] font-semibold leading-snug tracking-[-0.015em] outline-none">
        {title}
      </h1>
      {hint && <p className="mt-1 text-[13px] text-stone-500">{hint}</p>}
      <div className="mt-5 space-y-2.5">{children}</div>
    </section>
  );
}
