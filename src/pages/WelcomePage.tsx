import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Briefcase, Check, GraduationCap, House } from 'lucide-react';
import Logo from '../components/Logo';
import { useAuth } from '../store/auth';
import { afterSignIn, finishWelcome, loadWelcomeDraft, saveWelcomeDraft } from '../store/session';
import { PERSONAS, personaLabel } from '../lib/personas';
import { USAGES } from '../lib/usage';
import { DEFAULT_ANSWERS, OTHER_STATUS, WELCOME_STEPS, needOptions, statusGroups, type WelcomeAnswers } from '../lib/welcome';
import { cx } from '../lib/utils';
import { t } from '../i18n';

const USAGE_ICONS = { etudes: GraduationCap, travail: Briefcase, perso: House };

// Longer than the double-click delay of the systems (500 ms on Windows): the second click of a
// double click lands on the next question, often on the answer just under the pointer.
const LOCK_MS = 700;

/**
 * Four short questions before the first visit (each can be skipped): what Kompaly is for, who you are, what you want to
 * do (it orders the navigation), how Kompaly talks. Every answer is kept in the account: a sign-in on any device comes
 * back to the same question.
 */
export default function WelcomePage() {
  const navigate = useNavigate();
  const name = useAuth(s => s.user?.name ?? '');
  const [draft] = useState(loadWelcomeDraft);
  const [step, setStep] = useState(draft?.step ?? 0);
  const [a, setA] = useState<WelcomeAnswers>(draft?.answers ?? DEFAULT_ANSWERS);
  // The persona has a default answer: nothing looks chosen until it is picked (coming back to it shows the answer).
  const [personaPicked, setPersonaPicked] = useState(!!draft && draft.step >= WELCOME_STEPS - 1);
  useEffect(() => saveWelcomeDraft({ step, answers: a }), [step, a]);
  // The app's code arrives while the questions are answered: « C'est parti » opens it at once.
  useEffect(() => {
    void import('../layout/AppShell').catch(() => undefined);
    void import('./Dashboard').catch(() => undefined);
  }, []);
  // A double click would also answer the next question, shown under the pointer.
  const moving = useRef(false);
  const settled = () => {
    if (moving.current) return false;
    moving.current = true;
    setTimeout(() => (moving.current = false), LOCK_MS);
    return true;
  };
  const go = (to: number) => settled() && setStep(to);
  const set = (patch: Partial<WelcomeAnswers>) => setA(prev => ({ ...prev, ...patch }));
  const last = step === WELCOME_STEPS - 1;

  function finish(answers: WelcomeAnswers) {
    finishWelcome(answers);
    navigate(afterSignIn(), { replace: true });
  }
  const next = () => (last ? finish(a) : go(step + 1));

  const choice = (selected: boolean) =>
    cx(
      'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
      selected ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50',
    );
  const box = (on: boolean) => (
    <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-300')} aria-hidden>
      {on && <Check size={12} />}
    </span>
  );
  const chip = (on: boolean) =>
    cx('hit inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] transition-colors', on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 hover:bg-stone-50');

  // The two buttons under each question: go on, or skip it (the last one ends the questionnaire either way).
  const actions = (primary: string) => (
    <div className="mt-6 space-y-1">
      <button type="button" className="btn-primary w-full" onClick={() => !moving.current && next()}>
        {primary}
      </button>
      <button
        type="button"
        onClick={() => !moving.current && (last ? finish({ ...a, persona: personaPicked ? a.persona : DEFAULT_ANSWERS.persona }) : go(step + 1))}
        className="hit w-full py-3 text-center text-[13px] text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-ink"
      >
        {t('Passer')}
      </button>
    </div>
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
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={WELCOME_STEPS}
              aria-valuenow={step + 1}
              aria-label={t('Question {n} sur {total}', { n: step + 1, total: WELCOME_STEPS })}
            >
              <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${((step + 1) / WELCOME_STEPS) * 100}%` }} />
            </div>
            <span className="tabular text-[12px] text-stone-500">
              {step + 1}/{WELCOME_STEPS}
            </span>
          </div>

          {step === 0 && (
            <Question
              key={0}
              title={name ? t('Bienvenue, {name} ! Kompaly, c’est pour…', { name }) : t('Bienvenue ! Kompaly, c’est pour…')}
              hint={t('Plusieurs réponses possibles.')}
            >
              {USAGES.map(u => {
                const Icon = USAGE_ICONS[u.key];
                const on = a.usages.includes(u.key);
                return (
                  <button
                    key={u.key}
                    type="button"
                    aria-pressed={on}
                    className={choice(on)}
                    onClick={() => {
                      if (moving.current) return;
                      const usages = on ? a.usages.filter(x => x !== u.key) : [...a.usages, u.key];
                      // The first one chosen is the main one (the words of the app); « Tu es… » keeps only what still fits.
                      set({ usages, usage: usages[0] ?? DEFAULT_ANSWERS.usage, year: statusGroups(usages).some(g => g.options.includes(a.year)) ? a.year : '' });
                    }}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium">{u.label}</span>
                      <span className="block text-[12px] text-stone-500">{u.hint}</span>
                    </span>
                    {box(on)}
                  </button>
                );
              })}
              {actions(t('Continuer'))}
            </Question>
          )}

          {step === 1 && (
            <Question key={1} title={t('Tu es…')} hint={t('Pour que Kompaly te parle avec tes mots.')}>
              <div className="space-y-4">
                {statusGroups(a.usages).map(g => (
                  <div key={g.title} role="group" aria-label={g.title}>
                    <p className="eyebrow mb-2">{g.title}</p>
                    <div className="flex flex-wrap gap-2">
                      {g.options.map(o => (
                        <button key={o} type="button" aria-pressed={a.year === o} className={chip(a.year === o)} onClick={() => !moving.current && (set({ year: o }), go(2))}>
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button type="button" aria-pressed={a.year === OTHER_STATUS} className={chip(a.year === OTHER_STATUS)} onClick={() => !moving.current && (set({ year: OTHER_STATUS }), go(2))}>
                    {OTHER_STATUS}
                  </button>
                </div>
              </div>
              {actions(t('Continuer'))}
            </Question>
          )}

          {step === 2 && (
            <Question key={2} title={t('Ce que tu veux faire')} hint={t('Plusieurs réponses possibles. Ton menu mettra ces espaces en premier.')}>
              <div className="flex flex-wrap gap-2">
                {needOptions(a).map(n => {
                  const on = a.needs.includes(n.key);
                  return (
                    <button key={n.key} type="button" aria-pressed={on} className={chip(on)} onClick={() => !moving.current && set({ needs: on ? a.needs.filter(x => x !== n.key) : [...a.needs, n.key] })}>
                      {on && <Check size={13} aria-hidden />}
                      {n.label}
                    </button>
                  );
                })}
              </div>
              {actions(t('Continuer'))}
            </Question>
          )}

          {step === 3 && (
            <Question key={3} title={t('Comment Kompaly te parle ?')} hint={t('Facultatif : tu pourras changer ça dans ton profil.')}>
              {PERSONAS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={personaPicked && a.persona === p.key}
                  className={choice(personaPicked && a.persona === p.key)}
                  onClick={() => {
                    if (moving.current) return;
                    setPersonaPicked(true);
                    set({ persona: p.key });
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium">{personaLabel(p, a.usage)}</span>
                    <span className="block text-[12px] text-stone-500">{p.description}</span>
                  </span>
                </button>
              ))}
              {actions(t('C’est parti'))}
            </Question>
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
