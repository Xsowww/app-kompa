-- Corrections du mega test du 18 octobre : à coller dans Supabase › SQL Editor (après 2026-10-21c_titres_courts.sql).

-- ── Périodes des agendas : auteur et date de création fixés par la base ─────
-- Comme pour les événements : un membre ne peut pas faire passer sa période pour celle d'un autre.
create or replace function public.group_periods_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- changement fait par la base elle-même (suppression d'un compte)
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.group_id := old.group_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.group_periods_touch() from public, anon, authenticated;
drop trigger if exists group_periods_touch on public.group_periods;
create trigger group_periods_touch before insert or update on public.group_periods
  for each row execute procedure public.group_periods_touch();

-- ── Rejoindre un agenda : une seule notification ───────────────────────────
-- Le déclencheur des arrivées (2026-10-21b) prévient déjà tous les membres : l'envoi fait ici en plus
-- au propriétaire lui en faisait recevoir deux.
create or replace function public.join_agenda(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.groups;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
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

-- ── Fichiers partagés à la suite : une seule notification ──────────────────
-- Avant, des tranches fixes de 2 minutes : 3 fichiers envoyés à cheval sur deux tranches donnaient deux
-- notifications, la première presque tout de suite. Maintenant la première envoie la notification à
-- 2 minutes, et les fichiers qui suivent avant son départ la complètent.
create or replace function public.notify_group_file() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  v_key text;
  since timestamptz;
  n integer;
  names text;
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then return null; end if;
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'groupe' then return null; end if;
  select r.key, r.fire_at - interval '2 minutes' into v_key, since
    from public.reminders r
    join public.group_members m on m.user_id = r.user_id and m.group_id = new.group_id
    where r.key like 'fichiers:' || new.group_id || ':' || auth.uid() || ':%' and r.sent_at is null
      and r.fire_at > now() -- still to leave (one stuck after an outage is never joined)
    order by r.fire_at desc limit 1;
  if v_key is null then
    since := now();
    v_key := 'fichiers:' || new.group_id || ':' || auth.uid() || ':' || floor(extract(epoch from now()) * 1000)::bigint;
  end if;
  select string_agg(x.name, ', ')
    into names
    from (select f.name from public.group_files f
          where f.group_id = new.group_id and f.created_by = auth.uid() and f.created_at >= since
          order by f.created_at limit 3) x;
  select count(*) into n from public.group_files f where f.group_id = new.group_id and f.created_by = auth.uid() and f.created_at >= since;
  perform public.notify_group_members(
    new.group_id,
    v_key,
    public.actor_name() || case when n > 1 then ' a partagé ' || n || ' fichiers' else ' a partagé un fichier' end,
    left(names, 160) || case when n > 3 then '…' else '' end || E'\n' || 'Groupe « ' || left(g.name, 60) || ' »',
    '/groupes?g=' || new.group_id || '&onglet=fichiers',
    since + interval '2 minutes');
  return null;
end;
$$;
revoke all on function public.notify_group_file() from public, anon, authenticated;

-- ── Période modifiée : pour qui ─────────────────────────────────────────────
create or replace function public.notify_agenda_period_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text;
  g public.groups;
  pour text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if (old.title, old.start_date, old.end_date, old.people) is not distinct from (new.title, new.start_date, new.end_date, new.people) then return null; end if;
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'agenda' then return null; end if;
  select coalesce(nullif(btrim(name), ''), 'Un membre') into who from public.profiles where id = auth.uid();
  select ' pour ' || string_agg(coalesce(nullif(btrim(p.name), ''), 'un membre'), ', ' order by p.name)
    into pour from public.profiles p where p.id = any(coalesce(new.people, '{}'));
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  select m.user_id, 'periode:' || new.id || ':UPDATE:' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
         left(coalesce(who, 'Un membre') || ' a modifié une période', 200),
         left('« ' || left(new.title, 60) || ' »' || coalesce(pour, '') || ' · ' || case when new.start_date = new.end_date then 'maintenant le ' || public.fr_day(new.start_date)
                   else 'maintenant du ' || public.fr_day(new.start_date) || ' au ' || public.fr_day(new.end_date) end
              || E'\n' || 'Agenda partagé « ' || left(g.name, 60) || ' »', 300),
         '/agendas?g=' || new.group_id || '&jour=' || new.start_date,
         auth.uid()
  from public.group_members m
  where m.group_id = new.group_id and m.user_id is distinct from auth.uid()
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.notify_agenda_period_changed() from public, anon, authenticated;

-- ── Avis sur plusieurs lignes : une seule ligne dans la notification ────────
-- (la dernière ligne d'une notification dit d'où elle vient : « Administration »)
create or replace function public.notify_admins() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_title text;
  v_body text;
begin
  if tg_table_name = 'reports' then
    v_title := 'Nouveau signalement à traiter';
    v_body := '« ' || left(regexp_replace(coalesce(new.snapshot ->> 'title', 'Un contenu de groupe'), '\s+', ' ', 'g'), 120) || ' »' || E'\n' || 'Administration';
  else
    v_title := case when new.kind = 'bug' then 'Nouveau bug signalé' else 'Nouvel avis reçu' end;
    v_body := left(regexp_replace(btrim(new.message), '\s+', ' ', 'g'), 140) || E'\n' || 'Administration';
  end if;
  insert into public.reminders (user_id, key, fire_at, title, body, url)
  select a.user_id, 'admin:' || tg_table_name || ':' || new.id, now(), v_title, coalesce(v_body, ''), '/admin?vue=traiter'
  from public.admins a
  on conflict do nothing;
  return new;
end;
$$;
