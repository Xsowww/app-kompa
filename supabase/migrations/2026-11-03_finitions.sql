-- Finitions (3 novembre 2026) : tâches, événements, groupes et agendas partagés : à coller dans Supabase › SQL Editor (après 2026-11-02_recette_finale.sql).
-- Sans elle l'appli marche comme avant (chaque nouveauté se cache ou dit « pas encore disponible »).

-- ── Qui a modifié un événement en dernier, et quand (« modifié par Léa · hier ») ─────────────
alter table public.group_events add column if not exists updated_by uuid references auth.users on delete set null;
alter table public.group_events add column if not exists updated_at timestamptz;
-- Les événements d'avant : leur création. (Avant le nouveau déclencheur ci-dessous, qui ne garde pas ces valeurs.)
update public.group_events set updated_at = created_at, updated_by = created_by where updated_at is null;

create or replace function public.group_events_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Mise à jour faite par la base elle-même (suppression d'un compte : son nom passe à vide dans
  -- ses notes, événements et fichiers de groupe) : on la laisse passer telle quelle.
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_by := auth.uid();
    new.updated_at := now();
    return new;
  end if;
  new.group_id := old.group_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  -- Posés par la base, seulement quand quelqu'un change ce que les membres voient (personne ne se fait passer pour un autre).
  if auth.uid() is not null
     and (old.title, old.date, old.start_time, old.end_time, old.place, old.category, old.details, old.people, old.reminders)
         is distinct from (new.title, new.date, new.start_time, new.end_time, new.place, new.category, new.details, new.people, new.reminders) then
    new.updated_by := auth.uid();
    new.updated_at := clock_timestamp();
  else
    new.updated_by := old.updated_by;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

-- ── Révisions / réunions d'un groupe : modifiées ou annulées, les membres sont prévenus ──────
-- Une série modifiée d'un coup (« celle-ci et les suivantes ») : une seule notification (même clé, la minute près).
create or replace function public.notify_group_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ev public.group_events := case when tg_op = 'DELETE' then old else new end;
  g public.groups;
  quand text;
  url text;
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then return null; end if; -- groupe supprimé, compte supprimé…
  select * into g from public.groups where id = ev.group_id;
  if g.id is null or g.kind is distinct from 'groupe' then return null; end if;
  if tg_op = 'UPDATE' and (old.title, old.date, old.start_time, old.end_time, old.place, old.details)
     is not distinct from (new.title, new.date, new.start_time, new.end_time, new.place, new.details) then
    return null;
  end if;
  quand := public.fr_day(ev.date) || coalesce(' à ' || public.fr_time(ev.start_time), '');
  url := '/groupes?g=' || ev.group_id || '&onglet=revisions';
  if tg_op = 'INSERT' then
    perform public.notify_group_members(ev.group_id, 'revision:' || ev.id, public.actor_name() || ' propose un créneau',
      '« ' || left(ev.title, 80) || ' » · ' || quand || E'\n' || 'Groupe « ' || left(g.name, 60) || ' »', url);
  elsif tg_op = 'UPDATE' then
    perform public.notify_group_members(ev.group_id,
      'revision:' || coalesce(ev.series, ev.id::text) || ':modifie:' || floor(extract(epoch from now()) / 60)::bigint,
      public.actor_name() || ' a modifié un créneau',
      '« ' || left(ev.title, 80) || ' » · maintenant le ' || quand || E'\n' || 'Groupe « ' || left(g.name, 60) || ' »', url);
  else
    perform public.notify_group_members(ev.group_id,
      'revision:' || coalesce(ev.series, ev.id::text) || ':annule:' || floor(extract(epoch from now()) / 60)::bigint,
      public.actor_name() || ' a annulé un créneau',
      '« ' || left(ev.title, 80) || ' » · prévu le ' || quand || E'\n' || 'Groupe « ' || left(g.name, 60) || ' »', url);
  end if;
  return null;
end;
$$;
revoke all on function public.notify_group_event() from public, anon, authenticated;
drop trigger if exists group_events_notify_group on public.group_events;
create trigger group_events_notify_group after insert or update or delete on public.group_events
  for each row execute procedure public.notify_group_event();

-- Les annulations comptent dans la pastille de l'onglet (l'événement n'est plus là pour être compté) :
-- celles reçues par la personne connectée depuis `p_since` (7 jours au plus).
create or replace function public.my_group_cancellations(p_since timestamptz) returns table (group_id uuid, at timestamptz)
language sql stable security definer set search_path = '' as $$
  select x.gid, x.fire_at
  from (
    select substring(r.url from 'g=([0-9a-f-]{36})')::uuid as gid, r.fire_at
    from public.reminders r
    where r.user_id = auth.uid() and r.key like 'revision:%:annule:%'
      and r.fire_at > greatest(coalesce(p_since, '-infinity'::timestamptz), now() - interval '7 days')
  ) x
  where public.mfa_ok() and x.gid is not null and public.is_group_member(x.gid)
  order by x.fire_at desc
  limit 200;
$$;
revoke all on function public.my_group_cancellations(timestamptz) from public, anon;
grant execute on function public.my_group_cancellations(timestamptz) to authenticated;

-- ── Rappels : aussi pour les révisions / réunions des groupes (avant : agendas partagés seulement) ─
create or replace function public.agenda_reminders_insert(p_group uuid, p_event uuid, p_user uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.reminders (user_id, key, fire_at, title, body, url)
  select mm.user_id,
         'rappel-agenda:' || e.id || ':' || m || ':' || floor(extract(epoch from x.at))::bigint,
         x.at,
         left(e.title, 200),
         left(to_char(e.date, 'DD/MM') || coalesce(' · ' || e.start_time, '') || ' · ' || g.name, 300),
         case when g.kind = 'agenda' then '/agendas?g=' || e.group_id || '&jour=' || e.date else '/groupes?g=' || e.group_id || '&onglet=revisions' end
  from public.group_events e
  join public.groups g on g.id = e.group_id
  join public.group_members mm on mm.group_id = e.group_id
  cross join lateral unnest(e.reminders) m
  cross join lateral (select ((e.date + coalesce(e.start_time, '09:00')::time) at time zone 'Europe/Paris') - make_interval(mins => m) as at) x
  where e.group_id = p_group
    and (p_event is null or e.id = p_event)
    and (p_user is null or mm.user_id = p_user)
    and (cardinality(e.people) = 0 or mm.user_id = any(e.people))
    and x.at > now()
  on conflict do nothing;
$$;
revoke all on function public.agenda_reminders_insert(uuid, uuid, uuid) from public, anon, authenticated;

-- ── Notes et fichiers d'un groupe : supprimés par leur auteur ou le propriétaire (comme les révisions) ─
drop policy if exists "notes de groupe : suppression" on public.group_notes;
create policy "notes de groupe : suppression" on public.group_notes for delete to authenticated
  using ((select public.can_edit_group(group_id)) and (created_by = (select auth.uid()) or (select public.is_group_owner(group_id))));
drop policy if exists "fichiers de groupe : suppression" on public.group_files;
create policy "fichiers de groupe : suppression" on public.group_files for delete to authenticated
  using ((select public.can_edit_group(group_id)) and (created_by = (select auth.uid()) or (select public.is_group_owner(group_id))));

-- Le contenu du fichier aussi : la personne qui l'a envoyé, ou le propriétaire du groupe.
create or replace function public.group_path_owner(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.groups g where g.id::text = (storage.foldername(p_path))[1] and g.owner_id = auth.uid());
$$;
revoke all on function public.group_path_owner(text) from public, anon;
grant execute on function public.group_path_owner(text) to authenticated;
drop policy if exists "groupes : supprimer des fichiers" on storage.objects;
create policy "groupes : supprimer des fichiers" on storage.objects for delete to authenticated
  using (bucket_id = 'groups' and (select public.group_path_access(name, true))
         and (owner_id = (select auth.uid())::text or (select public.group_path_owner(name))));

-- ── Fichiers d'un groupe : renommer (le nom seulement ; éditeurs et propriétaire) ─────────────
grant update (name) on public.group_files to authenticated;
drop policy if exists "fichiers de groupe : renommer" on public.group_files;
create policy "fichiers de groupe : renommer" on public.group_files for update to authenticated
  using ((select public.can_edit_group(group_id))) with check ((select public.can_edit_group(group_id)));

-- ── Rôle des nouveaux membres, choisi par le propriétaire ─────────────────────────────────────
alter table public.groups add column if not exists default_role text not null default 'editeur'
  check (default_role in ('lecteur', 'editeur'));
alter table public.groups add column if not exists default_can_invite boolean not null default true;
grant select (default_role, default_can_invite) on public.groups to authenticated;
grant update (name, color, photo, default_role, default_can_invite) on public.groups to authenticated;

create or replace function public.join_group(p_code text) returns uuid
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
  select * into g from public.groups where kind = 'groupe' and invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if g.id is null then
    delete from public.group_join_attempts where user_id = me and at < now() - interval '1 day';
    insert into public.group_join_attempts (user_id) values (me);
    return null;
  end if;
  if exists (select 1 from public.group_members where group_id = g.id and user_id = me) then
    return g.id;
  end if;
  if (select count(*) from public.group_members where group_id = g.id) >= 50 then
    raise exception 'group full';
  end if;
  if (select count(*) from public.group_members where user_id = me) >= 30 then
    raise exception 'too many groups';
  end if;
  insert into public.group_members (group_id, user_id, role, can_invite) values (g.id, me, g.default_role, g.default_can_invite);
  return g.id;
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
  insert into public.group_members (group_id, user_id, role, can_invite) values (g.id, me, g.default_role, g.default_can_invite);
  return g.id;
end;
$$;
revoke all on function public.join_agenda(text) from public, anon;
grant execute on function public.join_agenda(text) to authenticated;

-- ── Nommer un autre membre propriétaire (aussi avant de partir) ───────────────────────────────
-- L'ancien propriétaire reste membre, éditeur et peut inviter ; le nouveau est prévenu.
create or replace function public.transfer_group(p_group uuid, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  select * into g from public.groups where id = p_group for update;
  if g.id is null or g.owner_id is distinct from auth.uid() then raise exception 'forbidden'; end if;
  if p_member is null or p_member = auth.uid()
     or not exists (select 1 from public.group_members where group_id = p_group and user_id = p_member) then
    raise exception 'not a member';
  end if;
  update public.group_members set role = 'editeur', can_invite = true where group_id = p_group and user_id = auth.uid();
  update public.groups set owner_id = p_member where id = p_group;
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  values (p_member, 'proprietaire:' || p_group || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
          left(public.actor_name() || ' t’a confié « ' || left(g.name, 60) || ' »', 200),
          case when g.kind = 'agenda' then 'Tu es maintenant propriétaire de l’agenda partagé' else 'Tu es maintenant propriétaire du groupe' end,
          case when g.kind = 'agenda' then '/agendas?g=' || p_group else '/groupes?g=' || p_group || '&onglet=membres' end,
          auth.uid())
  on conflict do nothing;
end;
$$;
revoke all on function public.transfer_group(uuid, uuid) from public, anon;
grant execute on function public.transfer_group(uuid, uuid) to authenticated;

-- ── Liste des membres : avec la photo ou la couleur de leur profil ───────────────────────────
-- (le type de retour change : on recrée)
drop function if exists public.group_member_list(uuid);
create function public.group_member_list(p_group uuid)
returns table (user_id uuid, name text, joined_at timestamptz, is_owner boolean, role text, can_invite boolean, avatar_color text, avatar_image text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  if not public.is_group_member(p_group) then raise exception 'forbidden'; end if;
  return query
    select m.user_id, coalesce(nullif(btrim(p.name), ''), 'Membre'), m.joined_at, (g.owner_id = m.user_id),
           case when g.owner_id = m.user_id then 'editeur' else m.role end,
           (g.owner_id = m.user_id or m.can_invite),
           case when (p.settings ->> 'avatarColor') ~ '^#[0-9a-fA-F]{6}$' then p.settings ->> 'avatarColor' end,
           -- Seulement une petite image (Profil › Photo la réduit) : jamais un autre genre de lien.
           case when char_length(p.settings ->> 'avatarImage') <= 150000
                 and left(p.settings ->> 'avatarImage', 30) ~ '^data:image/(jpeg|png|webp);base64,' then p.settings ->> 'avatarImage' end
    from public.group_members m
    join public.groups g on g.id = m.group_id
    left join public.profiles p on p.id = m.user_id
    where m.group_id = p_group
    order by m.joined_at;
end;
$$;
revoke all on function public.group_member_list(uuid) from public, anon;
grant execute on function public.group_member_list(uuid) to authenticated;

-- ── Retiré d'un groupe, ou groupe supprimé : la personne est prévenue ─────────────────────────
create or replace function public.notify_member_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
begin
  -- Seulement retiré par le propriétaire (pas un départ, pas une suppression du groupe ou du compte).
  if pg_trigger_depth() > 1 or auth.uid() is null or old.user_id = auth.uid() then return null; end if;
  select * into g from public.groups where id = old.group_id;
  if g.id is null then return null; end if;
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  values (old.user_id, 'retire:' || old.group_id || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
          left('Tu ne fais plus partie de « ' || left(g.name, 60) || ' »', 200),
          case when g.kind = 'agenda' then 'Agenda partagé' else 'Groupe' end,
          case when g.kind = 'agenda' then '/agendas' else '/groupes' end,
          auth.uid())
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.notify_member_removed() from public, anon, authenticated;
drop trigger if exists group_members_notify_removed on public.group_members;
create trigger group_members_notify_removed after delete on public.group_members
  for each row execute procedure public.notify_member_removed();

-- Avant la suppression (après, les membres sont déjà partis avec le groupe).
create or replace function public.notify_group_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then return old; end if;
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  select m.user_id, 'supprime:' || old.id, now(),
         left('Tu ne fais plus partie de « ' || left(old.name, 60) || ' »', 200),
         left(case when old.kind = 'agenda' then 'Agenda partagé supprimé par ' else 'Groupe supprimé par ' end || public.actor_name(), 300),
         case when old.kind = 'agenda' then '/agendas' else '/groupes' end,
         auth.uid()
  from public.group_members m
  where m.group_id = old.id and m.user_id is distinct from auth.uid()
  on conflict do nothing;
  return old;
end;
$$;
revoke all on function public.notify_group_deleted() from public, anon, authenticated;
drop trigger if exists groups_notify_deleted on public.groups;
create trigger groups_notify_deleted before delete on public.groups
  for each row execute procedure public.notify_group_deleted();

-- ── Commentaires des notes de groupe, avec @mention ───────────────────────────────────────────
create table if not exists public.group_note_comments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.group_notes on delete cascade,
  group_id uuid not null references public.groups on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  -- Les membres cités (« @Léa ») : ils reçoivent une notification.
  mentions uuid[] not null default '{}' check (cardinality(mentions) <= 20),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists group_note_comments_note on public.group_note_comments (note_id, created_at);

-- Auteur, date et groupe posés par la base ; seulement des membres cités (jamais soi-même) ; pas d'avalanche.
create or replace function public.group_note_comments_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtext('limit:' || auth.uid()::text));
  new.created_by := auth.uid();
  new.created_at := now();
  new.group_id := (select n.group_id from public.group_notes n where n.id = new.note_id);
  if new.group_id is null then raise exception 'forbidden'; end if;
  new.mentions := array(select distinct p from unnest(new.mentions) p
                        where p is distinct from auth.uid()
                          and exists (select 1 from public.group_members m where m.group_id = new.group_id and m.user_id = p));
  if (select count(*) from public.group_note_comments where created_by = auth.uid() and created_at > now() - interval '1 minute') >= 20
     or (select count(*) from public.group_note_comments where note_id = new.note_id) >= 500 then
    raise exception 'too many comments';
  end if;
  return new;
end;
$$;
revoke all on function public.group_note_comments_touch() from public, anon, authenticated;
drop trigger if exists group_note_comments_touch on public.group_note_comments;
create trigger group_note_comments_touch before insert on public.group_note_comments
  for each row execute procedure public.group_note_comments_touch();

alter table public.group_note_comments enable row level security;
revoke all on public.group_note_comments from anon;
revoke update on public.group_note_comments from authenticated; -- un commentaire ne se modifie pas : on le supprime
-- Tout membre lit et commente (un lecteur aussi : commenter ne change pas la note) ; l'auteur ou le propriétaire supprime.
drop policy if exists "commentaires : lecture" on public.group_note_comments;
create policy "commentaires : lecture" on public.group_note_comments for select to authenticated
  using ((select public.is_group_member(group_id)));
drop policy if exists "commentaires : ajout" on public.group_note_comments;
create policy "commentaires : ajout" on public.group_note_comments for insert to authenticated
  with check ((select public.is_group_member(group_id)) and created_by = (select auth.uid()));
drop policy if exists "commentaires : suppression" on public.group_note_comments;
create policy "commentaires : suppression" on public.group_note_comments for delete to authenticated
  using ((select public.is_group_member(group_id)) and (created_by = (select auth.uid()) or (select public.is_group_owner(group_id))));
drop policy if exists "2fa obligatoire" on public.group_note_comments;
create policy "2fa obligatoire" on public.group_note_comments as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- Les membres cités sont prévenus (la note s'ouvre depuis la notification).
create or replace function public.notify_note_mentions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  n public.group_notes;
begin
  if cardinality(new.mentions) = 0 then return null; end if;
  select * into g from public.groups where id = new.group_id;
  select * into n from public.group_notes where id = new.note_id;
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  select p, 'mention:' || new.id, now(),
         left(public.actor_name() || ' te mentionne dans une note', 200),
         left('« ' || left(regexp_replace(btrim(new.body), '\s+', ' ', 'g'), 100) || ' »' || E'\n'
              || 'Note « ' || left(coalesce(nullif(btrim(n.title), ''), 'Sans titre'), 50) || ' » · Groupe « ' || left(g.name, 60) || ' »', 300),
         '/groupes?g=' || new.group_id || '&note=' || new.note_id,
         auth.uid()
  from unnest(new.mentions) p
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.notify_note_mentions() from public, anon, authenticated;
drop trigger if exists group_note_comments_notify on public.group_note_comments;
create trigger group_note_comments_notify after insert on public.group_note_comments
  for each row execute procedure public.notify_note_mentions();

-- En direct pour les autres membres (Realtime applique la règle de lecture ci-dessus).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_note_comments') then
    alter publication supabase_realtime add table public.group_note_comments;
  end if;
end $$;

-- ── « Léa modifie cette note » : présence en direct, réservée aux membres du groupe de la note ─
-- Canal privé « note:<id> » (Realtime Authorization) : seuls les membres le rejoignent et y voient qui est là.
create or replace function public.can_join_note_topic(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_topic, '') like 'note:%' and public.mfa_ok()
     and exists (select 1 from public.group_notes n
                 join public.group_members m on m.group_id = n.group_id and m.user_id = auth.uid()
                 where n.id::text = substr(p_topic, 6));
$$;
revoke all on function public.can_join_note_topic(text) from public, anon;
grant execute on function public.can_join_note_topic(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    drop policy if exists "notes de groupe : voir qui est là" on realtime.messages;
    create policy "notes de groupe : voir qui est là" on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'presence' and (select public.can_join_note_topic((select realtime.topic()))));
    drop policy if exists "notes de groupe : dire qu'on est là" on realtime.messages;
    create policy "notes de groupe : dire qu'on est là" on realtime.messages for insert to authenticated
      with check (realtime.messages.extension = 'presence' and (select public.can_join_note_topic((select realtime.topic()))));
  end if;
end $$;

-- ── Tâches : corbeille (30 jours) et répétition ─────────────────────────────
-- Une tâche supprimée va à la corbeille (deleted_at), comme les notes et les événements ; une tâche peut se répéter
-- (cochée, la suivante est créée avec la prochaine échéance). Sans ces colonnes, l'appli continue comme avant :
-- une tâche supprimée l'est aussi en ligne, la répétition reste sur l'appareil.
alter table public.todos add column if not exists deleted_at timestamptz;
alter table public.todos add column if not exists repeat text check (repeat is null or repeat in ('day', 'week', 'month', 'year'));

-- ── Événements : un lieu (« 12 rue Géliot ») ────────────────────────────────
-- Sans cette colonne, le lieu reste sur l'appareil.
alter table public.events add column if not exists place text check (place is null or char_length(place) <= 300);
