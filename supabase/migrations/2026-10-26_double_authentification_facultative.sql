-- Double authentification facultative : à coller dans Supabase › SQL Editor (après 2026-10-25_connexion_google_apple.sql).
-- Le code du téléphone n'est plus imposé à l'inscription : chacun l'active s'il veut (Profil › Compte).
-- La base le savait déjà (mfa_ok : le code est exigé seulement pour un compte qui a associé un téléphone),
-- sauf pour les signalements, qui exigeaient le code de tout le monde. Les fonctions d'administration,
-- elles, exigent toujours le code : un compte administrateur doit garder sa double authentification.
create or replace function public.report_group_item(p_kind text, p_item uuid, p_reason text, p_message text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_group uuid;
  v_author uuid;
  v_snap jsonb;
begin
  -- Avec un téléphone associé, le code est exigé (mfa_ok) ; la double authentification est facultative.
  if auth.uid() is null or not public.mfa_ok() then
    raise exception 'mfa required';
  end if;
  -- 20 signalements par jour et par compte : assez pour un vrai problème, pas pour inonder.
  if (select count(*) from public.reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many reports';
  end if;
  if p_kind = 'note' then
    select group_id, created_by, jsonb_build_object('title', title, 'excerpt',
             left(btrim(regexp_replace(regexp_replace(content, '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), 600))
      into v_group, v_author, v_snap from public.group_notes where id = p_item;
  elsif p_kind = 'file' then
    select group_id, created_by, jsonb_build_object('title', name, 'mime', mime, 'size', size)
      into v_group, v_author, v_snap from public.group_files where id = p_item;
  elsif p_kind = 'event' then
    select group_id, created_by, jsonb_build_object('title', title, 'date', date, 'start', start_time, 'place', place)
      into v_group, v_author, v_snap from public.group_events where id = p_item;
  else
    raise exception 'bad kind';
  end if;
  if v_group is null or not public.is_group_member(v_group) then
    raise exception 'forbidden';
  end if;
  v_snap := v_snap || jsonb_build_object('group', (select name from public.groups where id = v_group));
  insert into public.reports (reporter_id, group_id, kind, item_id, author_id, reason, message, snapshot)
  values (auth.uid(), v_group, p_kind, p_item, v_author, p_reason, nullif(btrim(left(coalesce(p_message, ''), 1000)), ''), v_snap);
end;
$$;
revoke all on function public.report_group_item(text, uuid, text, text) from public, anon;
grant execute on function public.report_group_item(text, uuid, text, text) to authenticated;
