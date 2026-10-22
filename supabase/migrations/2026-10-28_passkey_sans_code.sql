-- Face ID / empreinte (passkeys) : à coller dans Supabase › SQL Editor (après 2026-10-27_agendas_rappels_categories.sql).
-- Une connexion par passkey vérifie déjà deux choses (l'appareil et la personne, par son visage, son empreinte
-- ou le code de l'appareil) : la base ne demande plus en plus le code du téléphone pour lire et écrire ses données.
-- Supabase l'indique dans le jeton : « amr » contient la méthode « passkey » (la session reste en « aal1 »).
-- Les fonctions d'administration, elles, exigent toujours le code (aal2) : rien ne change pour elles.
create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
        where (case when jsonb_typeof(e) = 'object' then e ->> 'method' else e #>> '{}' end) = 'passkey'
      )
      or not exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified');
$$;
revoke all on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated;
