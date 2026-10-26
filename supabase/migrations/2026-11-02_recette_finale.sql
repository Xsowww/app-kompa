-- Recette finale (26 octobre 2026) : failles trouvées par l'audit de sécurité.

-- ── Codes de groupe et liens d'agenda : essais comptés un par un ───────────────
-- 80 essais envoyés en même temps passaient tous (chacun lisait le compte avant que les autres l'écrivent).
-- Un verrou par compte les fait passer l'un après l'autre : 15 essais ratés par quart d'heure, pas plus.
create or replace function public.join_group(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  gid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  perform pg_advisory_xact_lock(hashtext('join:' || me::text));
  if (select count(*) from public.group_join_attempts where user_id = me and at > now() - interval '15 minutes') >= 15 then
    raise exception 'too many attempts';
  end if;
  select id into gid from public.groups where kind = 'groupe' and invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if gid is null then
    delete from public.group_join_attempts where user_id = me and at < now() - interval '1 day';
    insert into public.group_join_attempts (user_id) values (me);
    return null;
  end if;
  if exists (select 1 from public.group_members where group_id = gid and user_id = me) then
    return gid;
  end if;
  if (select count(*) from public.group_members where group_id = gid) >= 50 then
    raise exception 'group full';
  end if;
  if (select count(*) from public.group_members where user_id = me) >= 30 then
    raise exception 'too many groups';
  end if;
  insert into public.group_members (group_id, user_id) values (gid, me);
  return gid;
end;
$$;
revoke all on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;

create or replace function public.join_agenda(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.groups;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  perform pg_advisory_xact_lock(hashtext('join:' || me::text));
  if (select count(*) from public.group_join_attempts where user_id = me and at > now() - interval '15 minutes') >= 15 then
    raise exception 'too many attempts';
  end if;
  select * into g from public.groups where kind = 'agenda' and invite_token = lower(btrim(coalesce(p_token, '')));
  if g.id is null then
    delete from public.group_join_attempts where user_id = me and at < now() - interval '1 day';
    insert into public.group_join_attempts (user_id) values (me);
    return null;
  end if;
  if exists (select 1 from public.group_members where group_id = g.id and user_id = me) then
    return g.id;
  end if;
  if (select count(*) from public.group_members where group_id = g.id) >= 50 then raise exception 'group full'; end if;
  if (select count(*) from public.group_members where user_id = me) >= 30 then raise exception 'too many groups'; end if;
  insert into public.group_members (group_id, user_id) values (g.id, me);
  return g.id;
end;
$$;
revoke all on function public.join_agenda(text) from public, anon;
grant execute on function public.join_agenda(text) to authenticated;

-- ── Fichier de groupe retiré par l'administrateur : vraiment effacé ────────────
-- Postgres demande le droit de voir un fichier pour l'effacer : sans lui, la ligne partait mais le fichier restait.
drop policy if exists "groupes : lecture par l'administrateur" on storage.objects;
create policy "groupes : lecture par l'administrateur" on storage.objects for select to authenticated
  using (bucket_id = 'groups' and (select public.is_admin()) and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2');

-- ── « Pour qui » : seulement des membres de l'agenda ou du groupe ──────────────
-- Sinon la notification envoyée aux membres affichait le prénom de n'importe quel compte.
create or replace function public.keep_member_people() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(new.people) > 0 then
    new.people := array(select p from unnest(new.people) p
                        where exists (select 1 from public.group_members m where m.group_id = new.group_id and m.user_id = p));
  end if;
  return new;
end;
$$;
revoke all on function public.keep_member_people() from public, anon, authenticated;
drop trigger if exists keep_member_people on public.group_events;
create trigger keep_member_people before insert or update of people, group_id on public.group_events
  for each row execute function public.keep_member_people();
drop trigger if exists keep_member_people on public.group_periods;
create trigger keep_member_people before insert or update of people, group_id on public.group_periods
  for each row execute function public.keep_member_people();

-- ── Groupes supprimés : code de double authentification exigé, comme partout ───
drop policy if exists "2fa obligatoire" on public.deleted_groups;
create policy "2fa obligatoire" on public.deleted_groups as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
