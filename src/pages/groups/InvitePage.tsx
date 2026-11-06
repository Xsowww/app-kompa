import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CalendarHeart, Lock, Users } from 'lucide-react';
import Logo from '../../components/Logo';
import LanguagePicker from '../../components/LanguagePicker';
import Character from '../../copilot/Character';
import { supabase } from '../../lib/supabase';
import { readInvite } from './invitePending';
import { cx } from '../../lib/utils';
import { t } from '../../i18n';

/** What the server says about a shared calendar's link: its name and owner, or that it no longer works. */
type Preview = { name: string; from: string; color: string | null } | 'gone' | null;

/**
 * The server's own word on a shared calendar's link, for a visitor without an account (migration
 * 2026-11-06_invitation_apercu: `agenda_invite_preview`). null when it can't tell (no cloud, function not there yet,
 * no connection): the page then shows what the link itself says.
 */
async function previewAgenda(token: string): Promise<Preview> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('agenda_invite_preview', { p_token: token });
    if (error) return null;
    if (!data) return 'gone';
    const row = data as { name?: unknown; owner?: unknown; color?: unknown };
    return { name: String(row.name ?? ''), from: String(row.owner ?? ''), color: typeof row.color === 'string' ? row.color : null };
  } catch {
    return null;
  }
}

/**
 * An invitation link opened without an account (App › RequireAuth keeps it: groups/invitePending): who invites to
 * what, what the guest will see (only that calendar or group), and the two ways in. Once inside the app, the
 * invitation is joined by itself (layout/AppShell › useInvitations), after the sign-up and its e-mail confirmation.
 */
export default function InvitePage() {
  const { pathname, search } = useLocation();
  const link = readInvite(pathname + search);
  const agenda = link?.kind !== 'groupe';
  const [preview, setPreview] = useState<Preview>(null);
  useEffect(() => {
    if (link?.kind === 'agenda') void previewAgenda(link.secret).then(setPreview);
  }, [link?.kind, link?.secret]);

  const known = preview && preview !== 'gone' ? preview : null;
  // Who sent it (a member may invite too), else the owner; the name: the server's (renamed since?), else the link's.
  const from = link?.from || known?.from || '';
  const name = known?.name || link?.name || '';
  const gone = preview === 'gone' || !link;
  const title = gone
    ? t('Ce lien d’invitation ne marche plus')
    : agenda
      ? from && name
        ? t('{from} t’invite dans l’agenda « {name} »', { from, name })
        : name
          ? t('On t’invite dans l’agenda « {name} »', { name })
          : t('On t’invite dans un agenda partagé')
      : from && name
        ? t('{from} t’invite dans le groupe « {name} »', { from, name })
        : name
          ? t('On t’invite dans le groupe « {name} »', { name })
          : t('On t’invite dans un groupe');
  useEffect(() => {
    document.title = `${title} · Kompaly`;
  }, [title]);

  const steps = [
    t('Crée ton compte gratuit, en une minute.'),
    t('Si on te le demande, confirme ton adresse depuis l’e-mail reçu.'),
    agenda ? t('L’agenda s’ouvre : tu en fais déjà partie.') : t('Le groupe s’ouvre : tu en fais déjà partie.'),
  ];

  return (
    <div className="h-full overflow-y-auto bg-paper text-ink">
      <header className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-3 px-5 md:px-8">
        <Link to="/" aria-label={t('Kompaly, accueil')} className="flex h-11 shrink-0 items-center rounded-xl">
          <Logo />
        </Link>
        <LanguagePicker className="h-9" />
      </header>
      <main className="mx-auto flex max-w-[1120px] justify-center px-5 pb-16 pt-4 md:px-8 md:pt-10">
        <div className="enter w-full max-w-[460px]">
          <div className="card overflow-hidden p-0 shadow-pop">
            {/* What the guest is invited to, drawn as it will look: its colour, its name. */}
            <div className="flex items-center gap-3.5 border-b border-stone-200 bg-stone-50 px-5 py-4">
              <span
                className={cx('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white', gone && 'bg-stone-400')}
                style={gone ? undefined : { background: known?.color ?? (agenda ? '#7a5ad6' : '#3b6fd8') }}
                aria-hidden
              >
                {agenda ? <CalendarHeart size={22} strokeWidth={1.9} /> : <Users size={22} strokeWidth={1.9} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-stone-500">{agenda ? t('Agenda partagé') : t('Groupe')}</span>
                <span className="block text-[17px] font-semibold leading-snug [overflow-wrap:anywhere]">{name || (agenda ? t('Agenda partagé') : t('Groupe'))}</span>
              </span>
            </div>

            <div className="p-5 sm:p-6">
              <h1 className="text-[24px] font-extrabold leading-tight tracking-[-0.03em] [overflow-wrap:anywhere] sm:text-[26px]">{title}</h1>
              {gone ? (
                <p className="mt-3 text-[15px] leading-relaxed text-stone-700">
                  {t('Le lien a peut-être été changé. Demande un nouveau lien à la personne qui te l’a envoyé.')}
                </p>
              ) : (
                <>
                  <p className="mt-3 flex gap-3 rounded-2xl bg-brand-50 p-3.5 text-[15px] leading-snug">
                    <Lock size={18} strokeWidth={1.9} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
                    <span className="min-w-0">
                      {agenda
                        ? from
                          ? t('Tu verras seulement cet agenda, jamais l’agenda perso de {from}, ni ses notes, ni ses fichiers.', { from })
                          : t('Tu verras seulement cet agenda, jamais l’agenda perso des autres, ni leurs notes, ni leurs fichiers.')
                        : t('Tu verras seulement ce que les membres partagent dans ce groupe.')}
                    </span>
                  </p>
                  <ol className="mt-5 space-y-3">
                    {steps.map((s, i) => (
                      <li key={s} className="flex items-start gap-3">
                        <span className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tile-blue text-[13px] font-bold text-white" aria-hidden>
                          {i + 1}
                        </span>
                        <span className="min-w-0 pt-0.5 text-[15px] leading-snug">{s}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              <div className="mt-6 grid gap-2.5">
                <Link to="/inscription" className="btn-primary h-12 w-full text-[16px]">
                  {t('Créer mon compte gratuit')}
                </Link>
                <Link to="/connexion" className="btn-secondary h-12 w-full text-[15px]">
                  {t('J’ai déjà un compte')}
                </Link>
              </div>
              {!gone && <p className="mt-4 text-center text-[14px] leading-snug text-stone-600">{t('L’invitation est gardée sur cet appareil : tu la retrouves après ton inscription.')}</p>}
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <div className="shrink-0" aria-hidden>
              <Character pose="open" look={{ x: 0.8, y: -0.2 }} mood="happy" size={56} />
            </div>
            <p className="min-w-0 text-[14px] leading-snug text-stone-600">
              {t('Kompaly réunit ton agenda, tes notes et tes fichiers. Gratuit, sans pub.')}{' '}
              <Link to="/" className="font-semibold text-ink underline decoration-stone-400 underline-offset-2 hover:decoration-ink">
                {t('Découvrir Kompaly')}
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
