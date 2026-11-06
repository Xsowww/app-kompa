-- Page d'invitation (6 novembre 2026) : à coller dans Supabase › SQL Editor (après 2026-11-03_finitions.sql).
-- Sans elle l'appli marche comme avant : la page d'arrivée d'un invité affiche ce que dit le lien lui-même.

-- ── « Sandrine t'invite dans l'agenda Famille » : ce que voit un invité qui n'a pas encore de compte ─────────
-- Avec le jeton secret du lien (64 caractères, impossible à deviner) : le nom de l'agenda, sa couleur et le prénom
-- de son propriétaire, rien d'autre (ni les événements, ni les membres). null si le lien ne marche plus.
create or replace function public.agenda_invite_preview(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'name', g.name,
           'color', g.color,
           'owner', coalesce(split_part(nullif(btrim(p.name), ''), ' ', 1), '')
         )
  from public.groups g
  left join public.profiles p on p.id = g.owner_id
  where g.kind = 'agenda'
    and lower(btrim(coalesce(p_token, ''))) ~ '^[0-9a-f]{64}$'
    and g.invite_token = lower(btrim(p_token));
$$;
revoke all on function public.agenda_invite_preview(text) from public;
grant execute on function public.agenda_invite_preview(text) to anon, authenticated;
