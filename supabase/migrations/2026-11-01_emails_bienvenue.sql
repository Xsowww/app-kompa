-- E-mails de bienvenue et de conseils (server/emails.mjs). À coller dans Supabase › SQL Editor
-- (après 2026-10-31_agendas_series.sql). Le serveur (clé secrète) demande qui doit recevoir quoi, puis le note.
alter table public.profiles add column if not exists welcome_sent_at timestamptz;
alter table public.profiles add column if not exists tips_sent_at timestamptz;

-- Qui attend un e-mail : « welcome » une fois l'adresse confirmée (compte de moins de 2 jours), « tips » 3 à 5 jours
-- après l'inscription (sauf si coupé dans Profil › Notifications). Les comptes plus anciens ne reçoivent rien.
create or replace function public.mail_queue() returns table (id uuid, email text, name text, settings jsonb, kind text)
language sql security definer set search_path = '' as $$
  (select u.id, u.email::text, p.name, p.settings, 'welcome'
     from auth.users u join public.profiles p on p.id = u.id
    where u.email is not null and u.email_confirmed_at is not null and p.welcome_sent_at is null
      and u.created_at > now() - interval '2 days'
    limit 50)
  union all
  (select u.id, u.email::text, p.name, p.settings, 'tips'
     from auth.users u join public.profiles p on p.id = u.id
    where u.email is not null and u.email_confirmed_at is not null and p.tips_sent_at is null
      and u.created_at between now() - interval '5 days' and now() - interval '3 days'
      and coalesce(p.settings->>'emailTips', 'true') <> 'false'
    limit 50);
$$;
revoke all on function public.mail_queue() from public, anon, authenticated;
grant execute on function public.mail_queue() to service_role;

create or replace function public.mail_sent(p_id uuid, p_kind text) returns void
language sql security definer set search_path = '' as $$
  update public.profiles
     set welcome_sent_at = case when p_kind = 'welcome' then now() else welcome_sent_at end,
         tips_sent_at = case when p_kind = 'tips' then now() else tips_sent_at end
   where id = p_id;
$$;
revoke all on function public.mail_sent(uuid, text) from public, anon, authenticated;
grant execute on function public.mail_sent(uuid, text) to service_role;
