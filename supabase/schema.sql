-- COP-PILOT · schéma Supabase
-- À coller une seule fois dans Supabase › SQL Editor › New query, puis « Run ».
-- Chaque étudiant ne peut lire et modifier QUE ses propres données (Row Level Security).

-- ── Profil et réglages ─────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  settings jsonb not null default '{}'::jsonb,
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);
-- Bases créées avec une version précédente de ce script :
alter table public.profiles add column if not exists onboarded boolean not null default false;

-- ── Calendrier ─────────────────────────────────────────────────────────────
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  date date not null,
  start_time text,
  end_time text,
  -- « c-… » : une catégorie créée par l'étudiant (nom et couleur dans ses réglages).
  category text not null constraint events_category_check check (category in ('cours', 'examen', 'devoir', 'perso', 'sport') or category ~ '^c-[a-z0-9-]{1,40}$'),
  done boolean not null default false,
  details text,
  created_at timestamptz not null default now()
);
create index if not exists events_user_date on public.events (user_id, date);

-- ── Notes ──────────────────────────────────────────────────────────────────
create table if not exists public.note_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  parent_id uuid references public.note_folders on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null default 'Sans titre',
  content text not null default '',
  folder_id uuid references public.note_folders on delete cascade,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user on public.notes (user_id);

-- ── Drive (le contenu des fichiers est dans Storage, bucket « drive ») ───────
create table if not exists public.drive_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  kind text not null check (kind in ('folder', 'file')),
  parent_id uuid references public.drive_items on delete cascade,
  mime text,
  size bigint,
  starred boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drive_user on public.drive_items (user_id);

-- ── Sécurité : chacun ne voit que ses lignes ───────────────────────────────
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.note_folders enable row level security;
alter table public.notes enable row level security;
alter table public.drive_items enable row level security;

drop policy if exists "mon profil" on public.profiles;
create policy "mon profil" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "mes événements" on public.events;
create policy "mes événements" on public.events for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "mes dossiers de notes" on public.note_folders;
create policy "mes dossiers de notes" on public.note_folders for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "mes notes" on public.notes;
create policy "mes notes" on public.notes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "mon drive" on public.drive_items;
create policy "mon drive" on public.drive_items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ── Profil créé automatiquement à l'inscription ────────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Google gives full_name, Apple sometimes nothing: the first name only, like the sign-up form.
  insert into public.profiles (id, name) values (new.id, left(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'given_name', ''), ' ', 1)
  ), 60));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Suppression de son propre compte (bouton « Supprimer mon compte ») ─────
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.mfa_ok() then
    raise exception 'mfa required';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ── Fichiers du Drive : bucket privé, un dossier par utilisateur ───────────
insert into storage.buckets (id, name, public)
values ('drive', 'drive', false)
on conflict (id) do nothing;

drop policy if exists "drive : lire mes fichiers" on storage.objects;
create policy "drive : lire mes fichiers" on storage.objects for select to authenticated
  using (bucket_id = 'drive' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "drive : ajouter mes fichiers" on storage.objects;
create policy "drive : ajouter mes fichiers" on storage.objects for insert to authenticated
  with check (bucket_id = 'drive' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "drive : modifier mes fichiers" on storage.objects;
create policy "drive : modifier mes fichiers" on storage.objects for update to authenticated
  using (bucket_id = 'drive' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "drive : supprimer mes fichiers" on storage.objects;
create policy "drive : supprimer mes fichiers" on storage.objects for delete to authenticated
  using (bucket_id = 'drive' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 1. Double authentification : la base refuse l'accès sans le code du téléphone ─
-- Un compte qui a associé un téléphone doit être en niveau « aal2 » (mot de passe + code)
-- pour lire ou modifier ses données, même en interrogeant l'API directement.
create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified');
$$;
revoke all on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'events', 'note_folders', 'notes', 'drive_items'] loop
    execute format('drop policy if exists "2fa obligatoire" on public.%I', t);
    execute format('create policy "2fa obligatoire" on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
  end loop;
end $$;

drop policy if exists "drive : 2fa obligatoire" on storage.objects;
create policy "drive : 2fa obligatoire" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'drive' or (select public.mfa_ok()))
  with check (bucket_id <> 'drive' or (select public.mfa_ok()));

-- ── 2. Administrateurs ─────────────────────────────────────────────────────
create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security; -- aucune règle : illisible depuis l'API

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Statistiques globales : réservé aux administrateurs connectés AVEC leur code (aal2).
-- Seulement des chiffres et la liste des comptes, jamais le contenu des notes ou fichiers.
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admins where user_id = auth.uid()) then
    raise exception 'forbidden';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'mfa required';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'users', (
      select jsonb_build_object(
        'total', count(*),
        'confirmed', count(email_confirmed_at),
        'new_7d', count(*) filter (where created_at > now() - interval '7 days'),
        'active_24h', count(*) filter (where last_sign_in_at > now() - interval '24 hours'),
        'active_7d', count(*) filter (where last_sign_in_at > now() - interval '7 days'),
        'active_30d', count(*) filter (where last_sign_in_at > now() - interval '30 days')
      ) from auth.users
    ),
    'mfa_users', (select count(distinct user_id) from auth.mfa_factors where status = 'verified'),
    'content', jsonb_build_object(
      'notes', (select count(*) from public.notes),
      'note_folders', (select count(*) from public.note_folders),
      'events', (select count(*) from public.events),
      'events_done', (select count(*) from public.events where done),
      'files', (select count(*) from public.drive_items where kind = 'file'),
      'folders', (select count(*) from public.drive_items where kind = 'folder'),
      'storage_bytes', (select coalesce(sum(size), 0) from public.drive_items where kind = 'file')
    ),
    'events_by_category', (
      select coalesce(jsonb_object_agg(category, n), '{}'::jsonb)
      from (select category, count(*) as n from public.events group by category) c
    ),
    'custom_categories', (
      select coalesce(jsonb_agg(jsonb_build_object('label', label, 'events', n, 'users', users) order by n desc, label), '[]'::jsonb)
      from (
        select min(btrim(cc.value ->> 'label')) as label, count(e.id) as n, count(distinct p.id) as users
        from public.profiles p
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(p.settings -> 'customCategories') = 'array' then p.settings -> 'customCategories' else '[]'::jsonb end
        ) cc
        left join public.events e on e.user_id = p.id and e.category = cc.value ->> 'id'
        where coalesce(btrim(cc.value ->> 'label'), '') <> ''
        group by lower(btrim(cc.value ->> 'label'))
      ) x
    ),
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'signups', (select count(*) from auth.users u where u.created_at::date = d.day),
        'created', (select count(*) from public.notes n where n.created_at::date = d.day)
                 + (select count(*) from public.events e where e.created_at::date = d.day)
                 + (select count(*) from public.drive_items i where i.created_at::date = d.day)
      ) order by d.day), '[]'::jsonb)
      from (select generate_series(current_date - 29, current_date, interval '1 day')::date as day) d
    ),
    'accounts', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
      from (
        select
          u.id, u.email, coalesce(p.name, '') as name, u.created_at, u.last_sign_in_at,
          u.email_confirmed_at is not null as confirmed,
          exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as mfa,
          exists (select 1 from public.admins ad where ad.user_id = u.id) as admin,
          (select count(*) from public.notes n where n.user_id = u.id) as notes,
          (select count(*) from public.events e where e.user_id = u.id) as events,
          (select count(*) from public.drive_items i where i.user_id = u.id and i.kind = 'file') as files,
          (select coalesce(sum(size), 0) from public.drive_items i where i.user_id = u.id) as storage
        from auth.users u
        left join public.profiles p on p.id = u.id
        order by u.created_at desc
        limit 1000
      ) a
    )
  );
end;
$$;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

-- ── Corbeille, couleurs/étiquettes, liens de notes, import .ics, tâches, sessions focus ─
-- ── Corbeille : les éléments supprimés gardent une date de suppression ─────
alter table public.drive_items add column if not exists deleted_at timestamptz;
alter table public.notes add column if not exists deleted_at timestamptz;
alter table public.note_folders add column if not exists deleted_at timestamptz;
alter table public.events add column if not exists deleted_at timestamptz;

-- ── Drive : couleur de dossier et étiquettes ───────────────────────────────
alter table public.drive_items add column if not exists color text;
alter table public.drive_items add column if not exists tags text[] not null default '{}';

-- ── Notes liées à des fichiers / événements ────────────────────────────────
alter table public.notes add column if not exists links jsonb not null default '[]'::jsonb;

-- ── Calendrier : identifiant d'origine des événements importés (.ics) ──────
alter table public.events add column if not exists external_id text;

-- ── Calendrier : événements marqués importants ─────────────────────────────
alter table public.events add column if not exists important boolean not null default false;

-- ── Liste de tâches ────────────────────────────────────────────────────────
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  done boolean not null default false,
  due date,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists todos_user on public.todos (user_id);

-- ── Sessions focus (temps de travail par matière) ──────────────────────────
create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject text not null default '',
  minutes integer not null check (minutes > 0 and minutes <= 600),
  started_at timestamptz not null default now()
);
create index if not exists focus_sessions_user on public.focus_sessions (user_id);

alter table public.todos enable row level security;
alter table public.focus_sessions enable row level security;

drop policy if exists "mes tâches" on public.todos;
create policy "mes tâches" on public.todos for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "mes sessions focus" on public.focus_sessions;
create policy "mes sessions focus" on public.focus_sessions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

do $$
declare t text;
begin
  foreach t in array array['todos', 'focus_sessions'] loop
    execute format('drop policy if exists "2fa obligatoire" on public.%I', t);
    execute format('create policy "2fa obligatoire" on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
  end loop;
end $$;

-- ════ Groupes de travail (notes partagées, révisions en commun) ════
-- ── Groupes : tables ─────────────────────────────────────────────────────────────────
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text check (color is null or color ~ '^#[0-9a-f]{6}$'),
  invite_code text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  -- null le temps d'un transfert (compte supprimé) : le déclencheur plus bas désigne un nouveau propriétaire.
  owner_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user on public.group_members (user_id);

create table if not exists public.group_notes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  title text not null default 'Sans titre' check (char_length(title) <= 200),
  content text not null default '' check (char_length(content) <= 500000),
  created_by uuid default auth.uid() references auth.users on delete set null,
  updated_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists group_notes_group on public.group_notes (group_id, updated_at desc);

create table if not exists public.group_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  date date not null,
  start_time text check (start_time is null or start_time ~ '^\d{2}:\d{2}$'),
  end_time text check (end_time is null or end_time ~ '^\d{2}:\d{2}$'),
  place text check (place is null or char_length(place) <= 300),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (id, group_id) -- cible de la clé étrangère composite des présences
);
create index if not exists group_events_group on public.group_events (group_id, date);

create table if not exists public.group_event_attendees (
  event_id uuid not null,
  group_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id),
  -- la présence appartient forcément au groupe de l'événement
  foreign key (event_id, group_id) references public.group_events (id, group_id) on delete cascade
);
create index if not exists group_event_attendees_group on public.group_event_attendees (group_id);

-- Essais de codes d'invitation (limite les essais au hasard). Illisible depuis l'API.
create table if not exists public.group_join_attempts (
  user_id uuid not null references auth.users on delete cascade,
  at timestamptz not null default now()
);
create index if not exists group_join_attempts_user on public.group_join_attempts (user_id, at);

-- ── Fonctions d'appartenance (security definer : lisent group_members sans repasser par la RLS) ─
create or replace function public.is_group_member(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid());
$$;
revoke all on function public.is_group_member(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;

create or replace function public.is_group_owner(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.groups where id = gid and owner_id = auth.uid());
$$;
revoke all on function public.is_group_owner(uuid) from public, anon;
grant execute on function public.is_group_owner(uuid) to authenticated;

-- Code de 6 caractères sans ambiguïté (pas de 0/O, 1/I/L), tiré au hasard cryptographique.
create or replace function public.new_group_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  b bytea;
begin
  loop
    b := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + (get_byte(b, i) % length(alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.groups where invite_code = code);
  end loop;
  return code;
end;
$$;
revoke all on function public.new_group_code() from public, anon, authenticated;

-- ── Déclencheurs ───────────────────────────────────────────────────────────
-- Notes : date et auteur de la dernière modification posés par la base, groupe et créateur figés.
create or replace function public.group_notes_touch() returns trigger
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
  else
    new.group_id := old.group_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists group_notes_touch on public.group_notes;
create trigger group_notes_touch before insert or update on public.group_notes
  for each row execute procedure public.group_notes_touch();

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
  else
    new.group_id := old.group_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
drop trigger if exists group_events_touch on public.group_events;
create trigger group_events_touch before insert or update on public.group_events
  for each row execute procedure public.group_events_touch();

-- Départ d'un membre (quitter, être retiré, compte supprimé) : un groupe vide disparaît,
-- un groupe sans propriétaire est confié au plus ancien membre restant.
create or replace function public.group_members_after_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  heir uuid;
begin
  if not exists (select 1 from public.groups where id = old.group_id) then
    return old; -- le groupe lui-même est en cours de suppression
  end if;
  delete from public.group_event_attendees where group_id = old.group_id and user_id = old.user_id;
  select user_id into heir from public.group_members
    where group_id = old.group_id order by joined_at, user_id limit 1;
  if heir is null then
    delete from public.groups where id = old.group_id;
  else
    update public.groups set owner_id = heir
      where id = old.group_id and (owner_id is null or owner_id = old.user_id);
  end if;
  return old;
end;
$$;
revoke all on function public.group_members_after_delete() from public, anon, authenticated;
drop trigger if exists group_members_after_delete on public.group_members;
create trigger group_members_after_delete after delete on public.group_members
  for each row execute procedure public.group_members_after_delete();

-- ── Sécurité (Row Level Security) ──────────────────────────────────────────
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_notes enable row level security;
alter table public.group_events enable row level security;
alter table public.group_event_attendees enable row level security;
alter table public.group_join_attempts enable row level security; -- aucune règle : illisible depuis l'API

-- Groupes : visibles par leurs membres ; seul le propriétaire renomme / change la couleur / supprime.
-- Création et code d'invitation : uniquement via les fonctions plus bas.
drop policy if exists "groupes : membres" on public.groups;
create policy "groupes : membres" on public.groups for select to authenticated
  using ((select public.is_group_member(id)));
drop policy if exists "groupes : propriétaire modifie" on public.groups;
create policy "groupes : propriétaire modifie" on public.groups for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "groupes : propriétaire supprime" on public.groups;
create policy "groupes : propriétaire supprime" on public.groups for delete to authenticated
  using (owner_id = (select auth.uid()));
revoke insert, update on public.groups from anon, authenticated;
grant update (name, color) on public.groups to authenticated;

-- Membres : visibles entre membres ; on peut se retirer soi-même, le propriétaire peut retirer
-- n'importe qui. Pas d'ajout direct : join_group / create_group.
drop policy if exists "membres : lecture" on public.group_members;
create policy "membres : lecture" on public.group_members for select to authenticated
  using ((select public.is_group_member(group_id)));
drop policy if exists "membres : départ" on public.group_members;
create policy "membres : départ" on public.group_members for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_group_owner(group_id)));
revoke insert, update on public.group_members from anon, authenticated;

-- Notes partagées : tout membre lit, crée, modifie et supprime.
drop policy if exists "notes de groupe : membres" on public.group_notes;
create policy "notes de groupe : membres" on public.group_notes for all to authenticated
  using ((select public.is_group_member(group_id))) with check ((select public.is_group_member(group_id)));

-- Révisions : tout membre lit et propose ; l'auteur ou le propriétaire modifie / supprime.
drop policy if exists "révisions : lecture" on public.group_events;
create policy "révisions : lecture" on public.group_events for select to authenticated
  using ((select public.is_group_member(group_id)));
drop policy if exists "révisions : ajout" on public.group_events;
create policy "révisions : ajout" on public.group_events for insert to authenticated
  with check ((select public.is_group_member(group_id)));
drop policy if exists "révisions : modification" on public.group_events;
create policy "révisions : modification" on public.group_events for update to authenticated
  using ((select public.is_group_member(group_id)) and (created_by = (select auth.uid()) or (select public.is_group_owner(group_id))))
  with check ((select public.is_group_member(group_id)));
drop policy if exists "révisions : suppression" on public.group_events;
create policy "révisions : suppression" on public.group_events for delete to authenticated
  using ((select public.is_group_member(group_id)) and (created_by = (select auth.uid()) or (select public.is_group_owner(group_id))));

-- Présences (« Je viens ») : visibles des membres, chacun ne gère que la sienne.
drop policy if exists "présences : lecture" on public.group_event_attendees;
create policy "présences : lecture" on public.group_event_attendees for select to authenticated
  using ((select public.is_group_member(group_id)));
drop policy if exists "présences : je viens" on public.group_event_attendees;
create policy "présences : je viens" on public.group_event_attendees for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_group_member(group_id)));
drop policy if exists "présences : je ne viens plus" on public.group_event_attendees;
create policy "présences : je ne viens plus" on public.group_event_attendees for delete to authenticated
  using (user_id = (select auth.uid()));
revoke update on public.group_event_attendees from anon, authenticated;

-- Double authentification obligatoire, comme partout ailleurs.
do $$
declare t text;
begin
  foreach t in array array['groups', 'group_members', 'group_notes', 'group_events', 'group_event_attendees', 'group_join_attempts'] loop
    execute format('drop policy if exists "2fa obligatoire" on public.%I', t);
    execute format('create policy "2fa obligatoire" on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
  end loop;
end $$;

-- ── Fonctions appelées par l'application ───────────────────────────────────
-- Les fonctions security definer contournent la RLS : elles vérifient elles-mêmes la session et la 2FA.

-- Crée un groupe et en fait de soi le propriétaire.
create or replace function public.create_group(p_name text, p_color text default null) returns public.groups
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.groups;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  if (select count(*) from public.group_members where user_id = me) >= 30 then
    raise exception 'too many groups';
  end if;
  insert into public.groups (name, color, invite_code, owner_id)
    values (btrim(p_name), nullif(lower(p_color), ''), public.new_group_code(), me)
    returning * into g;
  insert into public.group_members (group_id, user_id) values (g.id, me);
  return g;
end;
$$;
revoke all on function public.create_group(text, text) from public, anon;
grant execute on function public.create_group(text, text) to authenticated;

-- Rejoint un groupe avec son code. Renvoie l'identifiant du groupe, ou null si le code n'existe pas.
-- Au-delà de 15 codes faux en 15 minutes, les essais sont refusés.
create or replace function public.join_group(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  gid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  if (select count(*) from public.group_join_attempts where user_id = me and at > now() - interval '15 minutes') >= 15 then
    raise exception 'too many attempts';
  end if;
  select id into gid from public.groups where invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
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

-- Nouveau code d'invitation (l'ancien cesse de marcher). Propriétaire seulement.
create or replace function public.regenerate_group_code(p_group uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  code text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  if not public.is_group_owner(p_group) then raise exception 'forbidden'; end if;
  code := public.new_group_code();
  update public.groups set invite_code = code where id = p_group;
  return code;
end;
$$;
revoke all on function public.regenerate_group_code(uuid) from public, anon;
grant execute on function public.regenerate_group_code(uuid) to authenticated;

-- Membres d'un groupe avec leur prénom (jamais l'e-mail). Réservé aux membres de ce groupe.
drop function if exists public.group_member_list(uuid); -- redéfinie plus bas avec les droits (2026-10-13c)
create or replace function public.group_member_list(p_group uuid)
returns table (user_id uuid, name text, joined_at timestamptz, is_owner boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  if not public.is_group_member(p_group) then raise exception 'forbidden'; end if;
  return query
    select m.user_id, coalesce(nullif(btrim(p.name), ''), 'Membre'), m.joined_at, (g.owner_id = m.user_id)
    from public.group_members m
    join public.groups g on g.id = m.group_id
    left join public.profiles p on p.id = m.user_id
    where m.group_id = p_group
    order by m.joined_at;
end;
$$;
revoke all on function public.group_member_list(uuid) from public, anon;
grant execute on function public.group_member_list(uuid) to authenticated;

-- ── Temps réel : les membres voient les modifications des autres en direct ─
-- (Supabase Realtime applique la RLS ci-dessus à chaque abonné.)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['groups', 'group_members', 'group_notes', 'group_events', 'group_event_attendees'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ── Groupes : droits des membres et fichiers partagés (migration 2026-10-13c) ──
-- Principes :
-- - le propriétaire a toujours tous les droits ; il choisit pour chaque membre :
--   « lecteur » (lit tout, dit s'il vient, peut partir) ou « éditeur » (ajoute, modifie, supprime
--   notes, fichiers et révisions), et s'il peut voir le code d'invitation ;
-- - tout est vérifié par la base (RLS + fonctions security definer), l'interface ne fait que suivre ;
-- - le code d'invitation n'est plus lisible dans la table groups (droits par colonne) : seule la
--   fonction group_invite_code le donne, au propriétaire et aux membres autorisés ;
-- - fichiers : table group_files + bucket privé « groups », objets rangés en <group_id>/<file_id>.

-- ── Droits des membres ─────────────────────────────────────────────────────
alter table public.group_members add column if not exists role text not null default 'editeur'
  check (role in ('lecteur', 'editeur'));
alter table public.group_members add column if not exists can_invite boolean not null default true;

-- Peut modifier le contenu du groupe : propriétaire, ou membre éditeur.
create or replace function public.can_edit_group(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.groups where id = gid and owner_id = auth.uid())
      or exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid() and role = 'editeur');
$$;
revoke all on function public.can_edit_group(uuid) from public, anon;
grant execute on function public.can_edit_group(uuid) to authenticated;

-- Notes partagées : tout membre lit ; seuls les éditeurs (et le propriétaire) créent, modifient, suppriment.
drop policy if exists "notes de groupe : membres" on public.group_notes;
drop policy if exists "notes de groupe : lecture" on public.group_notes;
create policy "notes de groupe : lecture" on public.group_notes for select to authenticated
  using ((select public.is_group_member(group_id)));
drop policy if exists "notes de groupe : ajout" on public.group_notes;
create policy "notes de groupe : ajout" on public.group_notes for insert to authenticated
  with check ((select public.can_edit_group(group_id)));
drop policy if exists "notes de groupe : modification" on public.group_notes;
create policy "notes de groupe : modification" on public.group_notes for update to authenticated
  using ((select public.can_edit_group(group_id))) with check ((select public.can_edit_group(group_id)));
drop policy if exists "notes de groupe : suppression" on public.group_notes;
create policy "notes de groupe : suppression" on public.group_notes for delete to authenticated
  using ((select public.can_edit_group(group_id)));

-- Révisions : les éditeurs proposent ; l'auteur (s'il est encore éditeur) ou le propriétaire modifie / annule.
drop policy if exists "révisions : ajout" on public.group_events;
create policy "révisions : ajout" on public.group_events for insert to authenticated
  with check ((select public.can_edit_group(group_id)));
drop policy if exists "révisions : modification" on public.group_events;
create policy "révisions : modification" on public.group_events for update to authenticated
  using ((select public.can_edit_group(group_id)) and (created_by = (select auth.uid()) or (select public.is_group_owner(group_id))))
  with check ((select public.can_edit_group(group_id)));
drop policy if exists "révisions : suppression" on public.group_events;
create policy "révisions : suppression" on public.group_events for delete to authenticated
  using ((select public.can_edit_group(group_id)) and (created_by = (select auth.uid()) or (select public.is_group_owner(group_id))));
-- (Présences « Je viens » : inchangées, tout membre gère la sienne.)

-- ── Code d'invitation : plus lisible directement ───────────────────────────
-- Lecture de groups colonne par colonne, sans invite_code.
revoke select on public.groups from anon, authenticated;
grant select (id, name, color, owner_id, created_at) on public.groups to authenticated;

-- Le code, pour le propriétaire et les membres autorisés à inviter ; null pour les autres.
create or replace function public.group_invite_code(p_group uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  return (
    select g.invite_code from public.groups g
    where g.id = p_group
      and (g.owner_id = auth.uid()
           or exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid() and m.can_invite))
  );
end;
$$;
revoke all on function public.group_invite_code(uuid) from public, anon;
grant execute on function public.group_invite_code(uuid) to authenticated;

-- Le propriétaire règle les droits d'un membre (pas les siens : il a toujours tout).
create or replace function public.set_member_rights(p_group uuid, p_member uuid, p_role text, p_can_invite boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  if not public.is_group_owner(p_group) then raise exception 'forbidden'; end if;
  if p_role is null or p_role not in ('lecteur', 'editeur') or p_can_invite is null then raise exception 'invalid rights'; end if;
  if exists (select 1 from public.groups where id = p_group and owner_id = p_member) then raise exception 'forbidden'; end if;
  update public.group_members set role = p_role, can_invite = p_can_invite
    where group_id = p_group and user_id = p_member;
  if not found then raise exception 'not a member'; end if;
end;
$$;
revoke all on function public.set_member_rights(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.set_member_rights(uuid, uuid, text, boolean) to authenticated;

-- La liste des membres donne aussi leurs droits (le type de retour change : on recrée).
drop function if exists public.group_member_list(uuid);
create function public.group_member_list(p_group uuid)
returns table (user_id uuid, name text, joined_at timestamptz, is_owner boolean, role text, can_invite boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  if not public.is_group_member(p_group) then raise exception 'forbidden'; end if;
  return query
    select m.user_id, coalesce(nullif(btrim(p.name), ''), 'Membre'), m.joined_at, (g.owner_id = m.user_id),
           case when g.owner_id = m.user_id then 'editeur' else m.role end,
           (g.owner_id = m.user_id or m.can_invite)
    from public.group_members m
    join public.groups g on g.id = m.group_id
    left join public.profiles p on p.id = m.user_id
    where m.group_id = p_group
    order by m.joined_at;
end;
$$;
revoke all on function public.group_member_list(uuid) from public, anon;
grant execute on function public.group_member_list(uuid) to authenticated;

-- ── Fichiers partagés ──────────────────────────────────────────────────────
create table if not exists public.group_files (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 255),
  mime text check (mime is null or char_length(mime) <= 200),
  size bigint not null default 0 check (size between 0 and 52428800), -- 50 Mo
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists group_files_group on public.group_files (group_id, created_at desc);

create or replace function public.group_files_touch() returns trigger
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
  else
    new.id := old.id;
    new.group_id := old.group_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
drop trigger if exists group_files_touch on public.group_files;
create trigger group_files_touch before insert or update on public.group_files
  for each row execute procedure public.group_files_touch();

alter table public.group_files enable row level security;
drop policy if exists "fichiers de groupe : lecture" on public.group_files;
create policy "fichiers de groupe : lecture" on public.group_files for select to authenticated
  using ((select public.is_group_member(group_id)));
drop policy if exists "fichiers de groupe : ajout" on public.group_files;
create policy "fichiers de groupe : ajout" on public.group_files for insert to authenticated
  with check ((select public.can_edit_group(group_id)));
drop policy if exists "fichiers de groupe : suppression" on public.group_files;
create policy "fichiers de groupe : suppression" on public.group_files for delete to authenticated
  using ((select public.can_edit_group(group_id)));
revoke update on public.group_files from anon, authenticated; -- pas de renommage : on supprime et on repartage
drop policy if exists "2fa obligatoire" on public.group_files;
create policy "2fa obligatoire" on public.group_files as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- ── Stockage : bucket privé « groups », objets en <group_id>/<file_id> ─────
insert into storage.buckets (id, name, public, file_size_limit)
values ('groups', 'groups', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Accès à un chemin du bucket : membre du groupe nommé par le premier dossier (éditeur si p_edit).
-- Compare en texte : aucun cast qui pourrait échouer sur un objet d'un autre bucket.
create or replace function public.group_path_access(p_path text, p_edit boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    join public.groups g on g.id = m.group_id
    where m.group_id::text = (storage.foldername(p_path))[1]
      and m.user_id = auth.uid()
      and (not p_edit or m.role = 'editeur' or g.owner_id = auth.uid())
  );
$$;
revoke all on function public.group_path_access(text, boolean) from public, anon;
grant execute on function public.group_path_access(text, boolean) to authenticated;

drop policy if exists "groupes : lire les fichiers" on storage.objects;
create policy "groupes : lire les fichiers" on storage.objects for select to authenticated
  using (bucket_id = 'groups' and (select public.group_path_access(name, false)));
drop policy if exists "groupes : ajouter des fichiers" on storage.objects;
create policy "groupes : ajouter des fichiers" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'groups'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select public.group_path_access(name, true))
  );
drop policy if exists "groupes : supprimer des fichiers" on storage.objects;
create policy "groupes : supprimer des fichiers" on storage.objects for delete to authenticated
  using (bucket_id = 'groups' and (select public.group_path_access(name, true)));
-- Pas de règle « update » : un fichier partagé ne se remplace pas.

drop policy if exists "groupes : 2fa obligatoire" on storage.objects;
create policy "groupes : 2fa obligatoire" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'groups' or (select public.mfa_ok()))
  with check (bucket_id <> 'groups' or (select public.mfa_ok()));

-- ── Temps réel ─────────────────────────────────────────────────────────────
-- groups sort de la publication : Realtime ne respecte pas de façon sûre les droits par colonne
-- et enverrait le code d'invitation. L'application relit la liste des groupes quand group_members
-- change (suppression du groupe en cascade, départs) et au retour sur l'onglet.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'groups') then
      alter publication supabase_realtime drop table public.groups;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_files') then
      alter publication supabase_realtime add table public.group_files;
    end if;
  end if;
end $$;

-- ── Synchro : une version plus ancienne n'écrase pas une plus récente ───────
create or replace function public.keep_newest() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists notes_keep_newest on public.notes;
create trigger notes_keep_newest before update on public.notes
  for each row execute function public.keep_newest();

drop trigger if exists drive_items_keep_newest on public.drive_items;
create trigger drive_items_keep_newest before update on public.drive_items
  for each row execute function public.keep_newest();

-- Événements, tâches, dossiers de notes (avec l'heure de chaque modification) ; réglages fusionnés.
alter table public.events add column if not exists updated_at timestamptz;
alter table public.todos add column if not exists updated_at timestamptz;
alter table public.note_folders add column if not exists updated_at timestamptz;

-- Sans heure d'un côté ou de l'autre (anciennes versions de l'appli) : la modification passe, comme avant.
create or replace function public.keep_newest_if_dated() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.updated_at is not null and old.updated_at is not null and new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists events_keep_newest on public.events;
create trigger events_keep_newest before update on public.events
  for each row execute function public.keep_newest_if_dated();

drop trigger if exists todos_keep_newest on public.todos;
create trigger todos_keep_newest before update on public.todos
  for each row execute function public.keep_newest_if_dated();

drop trigger if exists note_folders_keep_newest on public.note_folders;
create trigger note_folders_keep_newest before update on public.note_folders
  for each row execute function public.keep_newest_if_dated();

-- Droits du compte connecté (security invoker) : les règles de la table profiles s'appliquent.
create or replace function public.merge_settings(patch jsonb) returns void
language sql security invoker set search_path = '' as $$
  update public.profiles set settings = coalesce(settings, '{}'::jsonb) || patch where id = (select auth.uid());
$$;
revoke all on function public.merge_settings(jsonb) from public, anon;
grant execute on function public.merge_settings(jsonb) to authenticated;

-- ── Stockage : 50 Mo par fichier, quota par compte ──────────────────────────────
update storage.buckets set file_size_limit = 52428800 where id in ('drive', 'groups');

create or replace function public.storage_quota() returns bigint
language sql immutable as $$ select 1024::bigint * 1024 * 1024 * 1024 $$; -- 1 To = pas de limite (usage perso) ; 50 Mo : 50::bigint * 1024 * 1024

-- Place utilisée par le compte connecté, d'après la taille enregistrée de chaque fichier.
create or replace function public.storage_used() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((metadata ->> 'size')::bigint), 0)
  from storage.objects
  where owner_id = (select auth.uid())::text and bucket_id in ('drive', 'groups');
$$;
revoke all on function public.storage_used() from public, anon;
grant execute on function public.storage_used() to authenticated;

drop policy if exists "stockage : quota par compte" on storage.objects;
create policy "stockage : quota par compte" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id not in ('drive', 'groups') or public.storage_used() < public.storage_quota());

-- ── Signalements dans les groupes, avis et bugs ─────────────────────────────
-- ── Signalements ─────────────────────────────────────────────────────────────
-- Un membre signale une note, un fichier ou un événement d'un groupe. Une copie du contenu
-- signalé (titre et début du texte) est gardée pour que l'administrateur puisse juger,
-- même si l'auteur le modifie ensuite.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users on delete set null,
  group_id uuid references public.groups on delete set null,
  kind text not null check (kind in ('note', 'file', 'event')),
  item_id uuid not null,
  author_id uuid references auth.users on delete set null,
  reason text not null check (reason in ('illegal', 'hate', 'rights', 'spam', 'other')),
  message text check (message is null or char_length(message) <= 1000),
  snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'dismissed', 'removed')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index if not exists reports_status on public.reports (status, created_at desc);
create index if not exists reports_reporter on public.reports (reporter_id, created_at);
alter table public.reports enable row level security; -- aucune règle : seulement par les fonctions ci-dessous

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

-- ── Avis et bugs ─────────────────────────────────────────────────────────────
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users on delete set null,
  kind text not null check (kind in ('idea', 'bug')),
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  page text check (page is null or char_length(page) <= 300),
  device text check (device is null or char_length(device) <= 300),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_status on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;
drop policy if exists "avis : envoi" on public.feedback;
create policy "avis : envoi" on public.feedback for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'open');
drop policy if exists "2fa obligatoire" on public.feedback;
create policy "2fa obligatoire" on public.feedback as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
revoke update, delete on public.feedback from anon, authenticated;

create or replace function public.feedback_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := now();
  if (select count(*) from public.feedback where user_id = new.user_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many messages';
  end if;
  return new;
end;
$$;
drop trigger if exists feedback_limit on public.feedback;
create trigger feedback_limit before insert on public.feedback
  for each row execute procedure public.feedback_limit();

-- ── Administration ───────────────────────────────────────────────────────────
create or replace function public.admin_inbox() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'forbidden';
  end if;
  -- Gardés 2 ans au plus (politique de confidentialité).
  delete from public.feedback where created_at < now() - interval '2 years';
  delete from public.reports where created_at < now() - interval '2 years';
  return jsonb_build_object(
    'reports', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'item_id', r.item_id, 'group_id', r.group_id, 'reason', r.reason,
        'message', r.message, 'snapshot', r.snapshot, 'status', r.status, 'created_at', r.created_at,
        'reporter', ur.email, 'author', ua.email,
        'still_there', case r.kind
          when 'note' then exists (select 1 from public.group_notes n where n.id = r.item_id)
          when 'file' then exists (select 1 from public.group_files f where f.id = r.item_id)
          else exists (select 1 from public.group_events e where e.id = r.item_id) end
      ) order by (r.status = 'open') desc, r.created_at desc), '[]'::jsonb)
      from (select * from public.reports order by (status = 'open') desc, created_at desc limit 100) r
      left join auth.users ur on ur.id = r.reporter_id
      left join auth.users ua on ua.id = r.author_id),
    'feedback', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'kind', f.kind, 'message', f.message, 'page', f.page, 'device', f.device,
        'status', f.status, 'created_at', f.created_at, 'email', u.email
      ) order by (f.status = 'open') desc, f.created_at desc), '[]'::jsonb)
      from (select * from public.feedback order by (status = 'open') desc, created_at desc limit 100) f
      left join auth.users u on u.id = f.user_id)
  );
end;
$$;
revoke all on function public.admin_inbox() from public, anon;
grant execute on function public.admin_inbox() to authenticated;

-- Classer un signalement, ou retirer le contenu signalé. Pour un fichier, renvoie son chemin
-- dans le stockage : l'appli l'efface ensuite avec la règle « administrateur » ci-dessous.
create or replace function public.admin_handle_report(p_id uuid, p_action text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  v_path text;
begin
  if not public.is_admin() or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'forbidden';
  end if;
  select * into r from public.reports where id = p_id;
  if r.id is null then
    raise exception 'not found';
  end if;
  if p_action = 'remove' then
    if r.kind = 'note' then
      delete from public.group_notes where id = r.item_id;
    elsif r.kind = 'event' then
      delete from public.group_events where id = r.item_id;
    else
      delete from public.group_files where id = r.item_id returning group_id::text || '/' || id::text into v_path;
    end if;
    update public.reports set status = 'removed', handled_at = now()
      where kind = r.kind and item_id = r.item_id and status = 'open';
  elsif p_action = 'dismiss' then
    update public.reports set status = 'dismissed', handled_at = now() where id = p_id;
  else
    raise exception 'bad action';
  end if;
  return v_path;
end;
$$;
revoke all on function public.admin_handle_report(uuid, text) from public, anon;
grant execute on function public.admin_handle_report(uuid, text) to authenticated;

create or replace function public.admin_feedback_done(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'forbidden';
  end if;
  update public.feedback set status = case when p_done then 'done' else 'open' end where id = p_id;
end;
$$;
revoke all on function public.admin_feedback_done(uuid, boolean) from public, anon;
grant execute on function public.admin_feedback_done(uuid, boolean) to authenticated;

-- L'administrateur peut effacer un fichier de groupe retiré après un signalement.
drop policy if exists "groupes : retrait par l'administrateur" on storage.objects;
create policy "groupes : retrait par l'administrateur" on storage.objects for delete to authenticated
  using (bucket_id = 'groups' and (select public.is_admin()) and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2');

-- ── Rappels et notifications push ───────────────────────────────────────────
-- ── Rappels sur les événements et les tâches ────────────────────────────────
-- Minutes avant le moment de l'élément (heure de début, ou 9 h s'il n'a pas d'heure) : [60, 15, 0]…
alter table public.events add column if not exists reminders jsonb
  check (reminders is null or (jsonb_typeof(reminders) = 'array' and jsonb_array_length(reminders) <= 10));
alter table public.todos add column if not exists due_time text check (due_time is null or due_time ~ '^\d{2}:\d{2}$');
alter table public.todos add column if not exists reminders jsonb
  check (reminders is null or (jsonb_typeof(reminders) = 'array' and jsonb_array_length(reminders) <= 10));

-- ── File des rappels à envoyer ──────────────────────────────────────────────
-- L'appli calcule les prochains rappels (elle connaît le fuseau horaire de la personne) et les dépose ici ;
-- le serveur du site envoie ceux qui arrivent à l'heure, puis les marque envoyés.
create table if not exists public.reminders (
  user_id uuid not null references auth.users on delete cascade,
  key text not null check (char_length(key) <= 200),
  fire_at timestamptz not null,
  title text not null check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 300),
  url text not null default '/' check (char_length(url) <= 300 and url like '/%'),
  sent_at timestamptz,
  primary key (user_id, key)
);
create index if not exists reminders_due on public.reminders (fire_at) where sent_at is null;
alter table public.reminders enable row level security; -- aucune règle : seulement par les fonctions ci-dessous

-- Remplace les rappels à venir de la personne connectée par la liste donnée (300 au plus, 40 jours).
-- Ceux déjà envoyés restent marqués : un rappel n'est jamais envoyé deux fois.
create or replace function public.replace_my_reminders(p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if auth.uid() is null or not public.mfa_ok() then
    raise exception 'mfa required';
  end if;
  -- (les notifications d'administration, « admin:… », ne viennent pas de l'appli : elles restent)
  delete from public.reminders where user_id = auth.uid() and key not like 'admin:%' and (sent_at is null or sent_at < now() - interval '3 days');
  insert into public.reminders (user_id, key, fire_at, title, body, url)
  select auth.uid(), left(x.key, 200), x.fire_at, left(coalesce(nullif(btrim(x.title), ''), 'Rappel'), 200), left(coalesce(x.body, ''), 300),
         case when x.url like '/%' then left(x.url, 300) else '/' end
  from jsonb_to_recordset(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
       as x(key text, fire_at timestamptz, title text, body text, url text)
  where x.key is not null and x.fire_at > now() - interval '5 minutes' and x.fire_at < now() + interval '40 days'
  order by x.fire_at
  limit 300
  on conflict (user_id, key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.replace_my_reminders(jsonb) from public, anon;
grant execute on function public.replace_my_reminders(jsonb) to authenticated;

-- Pour le serveur du site seulement (clé « service_role ») : prend les rappels arrivés à l'heure et les marque envoyés.
-- Un rappel en retard de plus de 30 minutes (serveur arrêté) n'est plus envoyé.
create or replace function public.claim_due_reminders() returns table (user_id uuid, key text, title text, body text, url text, fire_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  -- Ménage : les rappels envoyés depuis plus d'une semaine.
  delete from public.reminders r where r.sent_at < now() - interval '7 days';
  return query
  with due as (
    select r.user_id, r.key from public.reminders r
    where r.sent_at is null and r.fire_at <= now() and r.fire_at > now() - interval '30 minutes'
    order by r.fire_at
    limit 500
    for update skip locked
  )
  update public.reminders r set sent_at = now()
  from due where r.user_id = due.user_id and r.key = due.key
  returning r.user_id, r.key, r.title, r.body, r.url, r.fire_at;
end;
$$;
revoke all on function public.claim_due_reminders() from public, anon, authenticated;
grant execute on function public.claim_due_reminders() to service_role;

-- ── Appareils qui reçoivent les notifications push ──────────────────────────
-- Une ligne par compte et par navigateur (un téléphone avec un compte perso et un compte travail : deux lignes).
create table if not exists public.push_subscriptions (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  device text check (device is null or char_length(device) <= 200),
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "appareils : les siens" on public.push_subscriptions;
create policy "appareils : les siens" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "2fa obligatoire" on public.push_subscriptions;
create policy "2fa obligatoire" on public.push_subscriptions as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- ── Administration : ce qu'il reste à traiter ───────────────────────────────
-- Le nombre de signalements et d'avis ouverts, pour la pastille du menu (0 pour un compte qui n'est pas admin).
create or replace function public.admin_open_count() returns integer
language sql stable security definer set search_path = '' as $$
  select case when public.is_admin() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    then (select count(*)::int from public.reports where status = 'open') + (select count(*)::int from public.feedback where status = 'open')
    else 0 end;
$$;
revoke all on function public.admin_open_count() from public, anon;
grant execute on function public.admin_open_count() to authenticated;

-- Un signalement ou un avis arrive : chaque administrateur reçoit une notification (par la même file).
create or replace function public.notify_admins() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_title text;
  v_body text;
begin
  -- (deux branches : les deux tables n'ont pas les mêmes colonnes)
  if tg_table_name = 'reports' then
    v_title := 'Nouveau signalement';
    v_body := coalesce(new.snapshot ->> 'title', 'Un contenu de groupe');
  else
    v_title := case when new.kind = 'bug' then 'Nouveau bug signalé' else 'Nouvel avis' end;
    v_body := left(new.message, 140);
  end if;
  insert into public.reminders (user_id, key, fire_at, title, body, url)
  select a.user_id, 'admin:' || tg_table_name || ':' || new.id, now(), v_title, coalesce(v_body, ''), '/admin?vue=traiter'
  from public.admins a
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists reports_notify_admins on public.reports;
create trigger reports_notify_admins after insert on public.reports for each row execute procedure public.notify_admins();
drop trigger if exists feedback_notify_admins on public.feedback;
create trigger feedback_notify_admins after insert on public.feedback for each row execute procedure public.notify_admins();

-- ── Agendas partagés (des groupes d'un autre genre) ────────────────────────

alter table public.groups add column if not exists kind text not null default 'groupe' check (kind in ('groupe', 'agenda'));
grant select (kind) on public.groups to authenticated;

-- Création : un genre en plus (« groupe » par défaut, comme avant).
drop function if exists public.create_group(text, text);
create or replace function public.create_group(p_name text, p_color text default null, p_kind text default 'groupe') returns public.groups
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.groups;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  if (select count(*) from public.group_members where user_id = me) >= 30 then
    raise exception 'too many groups';
  end if;
  insert into public.groups (name, color, invite_code, owner_id, kind)
    values (btrim(p_name), nullif(lower(p_color), ''), public.new_group_code(), me, case when p_kind = 'agenda' then 'agenda' else 'groupe' end)
    returning * into g;
  insert into public.group_members (group_id, user_id) values (g.id, me);
  return g;
end;
$$;
revoke all on function public.create_group(text, text, text) from public, anon;
grant execute on function public.create_group(text, text, text) to authenticated;

-- Un événement ajouté à un agenda partagé : chaque autre membre reçoit une notification.
create or replace function public.notify_agenda_members() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  who text;
begin
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'agenda' then return new; end if;
  select coalesce(nullif(btrim(name), ''), 'Un membre') into who from public.profiles where id = auth.uid();
  insert into public.reminders (user_id, key, fire_at, title, body, url)
  select m.user_id, 'agenda:' || new.id, now(), left(new.title, 200),
         left(
           'Ajouté par ' || coalesce(who, 'un membre') || ' · ' || to_char(new.date, 'DD/MM')
             || coalesce(' à ' || replace(new.start_time, ':', 'h'), '')
             || E'\n' || 'Agenda « ' || g.name || ' »',
           300),
         '/agendas?g=' || new.group_id
  from public.group_members m
  where m.group_id = new.group_id and m.user_id is distinct from auth.uid()
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.notify_agenda_members() from public, anon, authenticated;
drop trigger if exists group_events_notify_agenda on public.group_events;
create trigger group_events_notify_agenda after insert on public.group_events
  for each row execute procedure public.notify_agenda_members();

-- Les rappels que l'appli remplace sont seulement les siens (événements et tâches) : les notifications
-- posées par la base (administration, agendas partagés) restent jusqu'à leur envoi.
create or replace function public.replace_my_reminders(p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if auth.uid() is null or not public.mfa_ok() then
    raise exception 'mfa required';
  end if;
  delete from public.reminders where user_id = auth.uid() and (key like 'event:%' or key like 'task:%')
    and (sent_at is null or sent_at < now() - interval '3 days');
  insert into public.reminders (user_id, key, fire_at, title, body, url)
  select auth.uid(), left(x.key, 200), x.fire_at, left(coalesce(nullif(btrim(x.title), ''), 'Rappel'), 200), left(coalesce(x.body, ''), 300),
         case when x.url like '/%' then left(x.url, 300) else '/' end
  from jsonb_to_recordset(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
       as x(key text, fire_at timestamptz, title text, body text, url text)
  where (x.key like 'event:%' or x.key like 'task:%') and x.fire_at > now() - interval '5 minutes' and x.fire_at < now() + interval '40 days'
  order by x.fire_at
  limit 300
  on conflict (user_id, key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.replace_my_reminders(jsonb) from public, anon;
grant execute on function public.replace_my_reminders(jsonb) to authenticated;

-- ── Agendas partagés : lien d'invitation, notifications, droits (2026-10-18b) ─

alter table public.groups add column if not exists invite_token text unique check (invite_token is null or invite_token ~ '^[0-9a-f]{64}$');
alter table public.group_events add column if not exists category text check (category is null or category in ('cours', 'examen', 'devoir', 'perso', 'sport'));
alter table public.group_events add column if not exists details text check (details is null or char_length(details) <= 2000);

-- Jeton de lien : 2 × 122 bits tirés au hasard (impossible à deviner, contrairement à un code court).
create or replace function public.new_agenda_token() returns text
language sql volatile security definer set search_path = '' as $$
  select replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', '');
$$;
revoke all on function public.new_agenda_token() from public, anon, authenticated;
update public.groups set invite_token = public.new_agenda_token() where kind = 'agenda' and invite_token is null;

create or replace function public.groups_agenda_token() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'agenda' and new.invite_token is null then new.invite_token := public.new_agenda_token(); end if;
  return new;
end;
$$;
drop trigger if exists groups_agenda_token on public.groups;
create trigger groups_agenda_token before insert on public.groups for each row execute procedure public.groups_agenda_token();

create or replace function public.is_agenda(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.groups where id = gid and kind = 'agenda');
$$;
revoke all on function public.is_agenda(uuid) from public, anon;
grant execute on function public.is_agenda(uuid) to authenticated;

-- Le lien d'un agenda : pour le propriétaire et les membres autorisés à inviter (comme le code d'un groupe).
create or replace function public.agenda_invite_token(p_group uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  return (
    select g.invite_token from public.groups g
    where g.id = p_group and g.kind = 'agenda'
      and (g.owner_id = auth.uid()
           or exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid() and m.can_invite))
  );
end;
$$;
revoke all on function public.agenda_invite_token(uuid) from public, anon;
grant execute on function public.agenda_invite_token(uuid) to authenticated;

-- Nouveau lien (l'ancien cesse de marcher) : propriétaire seulement.
create or replace function public.regenerate_agenda_token(p_group uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  t text := public.new_agenda_token();
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
  if not public.is_group_owner(p_group) or not public.is_agenda(p_group) then raise exception 'forbidden'; end if;
  update public.groups set invite_token = t where id = p_group;
  return t;
end;
$$;
revoke all on function public.regenerate_agenda_token(uuid) from public, anon;
grant execute on function public.regenerate_agenda_token(uuid) to authenticated;

-- Rejoindre par le lien. Renvoie l'agenda, ou null si le lien ne marche plus. Prévient le propriétaire.
create or replace function public.join_agenda(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.groups;
  who text;
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
  select coalesce(nullif(btrim(name), ''), 'Quelqu’un') into who from public.profiles where id = me;
  if g.owner_id is not null then
    insert into public.reminders (user_id, key, fire_at, title, body, url)
    values (g.owner_id, 'agenda-membre:' || g.id || ':' || me, now(), left(coalesce(who, 'Quelqu’un') || ' a rejoint « ' || g.name || ' »', 200),
            'Nouveau membre' || E'\n' || 'Agenda « ' || left(g.name, 60) || ' »', '/agendas?g=' || g.id)
    on conflict do nothing;
  end if;
  return g.id;
end;
$$;
revoke all on function public.join_agenda(text) from public, anon;
grant execute on function public.join_agenda(text) to authenticated;

-- Un code à 6 caractères ne fait plus entrer dans un agenda (seulement dans un groupe).
create or replace function public.join_group(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  gid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then raise exception 'mfa required'; end if;
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

-- Dans un agenda, tout éditeur modifie et supprime n'importe quel événement (dans un groupe : l'auteur ou le propriétaire).
drop policy if exists "révisions : modification" on public.group_events;
create policy "révisions : modification" on public.group_events for update to authenticated
  using ((select public.can_edit_group(group_id)) and (created_by = (select auth.uid()) or (select public.is_group_owner(group_id)) or (select public.is_agenda(group_id))))
  with check ((select public.can_edit_group(group_id)));
drop policy if exists "révisions : suppression" on public.group_events;
create policy "révisions : suppression" on public.group_events for delete to authenticated
  using ((select public.can_edit_group(group_id)) and (created_by = (select auth.uid()) or (select public.is_group_owner(group_id)) or (select public.is_agenda(group_id))));

-- Ajout, modification, suppression dans un agenda : les autres membres sont prévenus.
create or replace function public.notify_agenda_members() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ev public.group_events := case when tg_op = 'DELETE' then old else new end;
  g public.groups;
  who text;
  what text;
begin
  if pg_trigger_depth() > 1 then return null; end if; -- changes made by the database itself (account deleted…)
  select * into g from public.groups where id = ev.group_id;
  if g.kind is distinct from 'agenda' then return null; end if;
  if tg_op = 'UPDATE' and (old.title, old.date, old.start_time, old.end_time, old.category, old.details, old.place)
     is not distinct from (new.title, new.date, new.start_time, new.end_time, new.category, new.details, new.place) then
    return null;
  end if;
  select coalesce(nullif(btrim(name), ''), 'Un membre') into who from public.profiles where id = auth.uid();
  what := case tg_op when 'INSERT' then 'Ajouté' when 'UPDATE' then 'Modifié' else 'Supprimé' end;
  insert into public.reminders (user_id, key, fire_at, title, body, url)
  select m.user_id, 'agenda:' || ev.id || ':' || tg_op || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
         left(ev.title, 200),
         left(
           what || ' par ' || coalesce(who, 'un membre') || ' · ' || to_char(ev.date, 'DD/MM')
             || coalesce(' à ' || regexp_replace(replace(ev.start_time, ':', 'h'), 'h00$', 'h'), '')
             || E'\n' || 'Agenda « ' || left(g.name, 60) || ' »',
           300),
         '/agendas?g=' || ev.group_id || case when tg_op = 'DELETE' then '' else '&jour=' || ev.date end
  from public.group_members m
  where m.group_id = ev.group_id and m.user_id is distinct from auth.uid()
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.notify_agenda_members() from public, anon, authenticated;
drop trigger if exists group_events_notify_agenda on public.group_events;
create trigger group_events_notify_agenda after insert or update or delete on public.group_events
  for each row execute procedure public.notify_agenda_members();

-- ── Notifications : un appareil = le compte qui s'en sert ; nouveautés des agendas (2026-10-18c) ─

-- Cet appareil (adresse d'envoi du navigateur) est désormais celui du compte connecté : les autres comptes ne
-- l'utilisent plus pour leurs notifications.
create or replace function public.claim_push_endpoint(p_endpoint text, p_p256dh text, p_auth text, p_device text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not public.mfa_ok() then raise exception 'mfa required'; end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or char_length(p_endpoint) > 1000 then raise exception 'invalid endpoint'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> me;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
    values (me, p_endpoint, left(p_p256dh, 200), left(p_auth, 100), left(p_device, 200))
    on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device;
end;
$$;
revoke all on function public.claim_push_endpoint(text, text, text, text) from public, anon;
grant execute on function public.claim_push_endpoint(text, text, text, text) to authenticated;

-- Nouveautés des agendas partagés pour la personne connectée : le nombre de notifications d'agenda reçues après
-- sa dernière visite de chaque agenda (p_seen = { "<agenda>": "<date de la visite>" }).
create or replace function public.my_agenda_news(p_seen jsonb) returns table (group_id uuid, news integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.mfa_ok() then raise exception 'mfa required'; end if;
  return query
    select x.gid, count(*)::int
    from (
      select substring(r.url from 'g=([0-9a-f-]{36})')::uuid as gid, r.fire_at
      from public.reminders r
      where r.user_id = auth.uid() and r.key like 'agenda%' and r.fire_at > now() - interval '7 days'
    ) x
    where x.gid is not null
      and public.is_group_member(x.gid)
      and x.fire_at > coalesce((p_seen ->> x.gid::text)::timestamptz, '-infinity'::timestamptz)
    group by x.gid;
end;
$$;
revoke all on function public.my_agenda_news(jsonb) from public, anon;
grant execute on function public.my_agenda_news(jsonb) to authenticated;

-- ── Grand test (2026-10-18d) ──

-- Cet appareil passe au compte connecté seulement s'il le prouve : un autre compte enregistré sur ce même navigateur
-- a exactement les mêmes clés de chiffrement (p256dh, auth), que seul ce navigateur connaît.
create or replace function public.claim_push_endpoint(p_endpoint text, p_p256dh text, p_auth text, p_device text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not public.mfa_ok() then raise exception 'mfa required'; end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or char_length(p_endpoint) > 1000 then raise exception 'invalid endpoint'; end if;
  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'invalid keys'; end if;
  delete from public.push_subscriptions
    where endpoint = p_endpoint and user_id <> me and p256dh = left(p_p256dh, 200) and auth = left(p_auth, 100);
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
    values (me, p_endpoint, left(p_p256dh, 200), left(p_auth, 100), left(p_device, 200))
    on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device;
end;
$$;
revoke all on function public.claim_push_endpoint(text, text, text, text) from public, anon;
grant execute on function public.claim_push_endpoint(text, text, text, text) to authenticated;

-- Une date lue sans risque : null si elle est illisible.
create or replace function public.try_timestamptz(p text) returns timestamptz
language plpgsql immutable set search_path = '' as $$
begin
  return p::timestamptz;
exception when others then
  return null;
end;
$$;
revoke all on function public.try_timestamptz(text) from public, anon, authenticated;

create or replace function public.my_agenda_news(p_seen jsonb) returns table (group_id uuid, news integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.mfa_ok() then raise exception 'mfa required'; end if;
  if jsonb_typeof(p_seen) is distinct from 'object' then p_seen := '{}'::jsonb; end if;
  return query
    select x.gid, count(*)::int
    from (
      select substring(r.url from 'g=([0-9a-f-]{36})')::uuid as gid, r.fire_at
      from public.reminders r
      where r.user_id = auth.uid() and r.key like 'agenda%' and r.fire_at > now() - interval '7 days'
    ) x
    where x.gid is not null
      and public.is_group_member(x.gid)
      and x.fire_at > coalesce(public.try_timestamptz(p_seen ->> x.gid::text), '-infinity'::timestamptz)
    group by x.gid;
end;
$$;
revoke all on function public.my_agenda_news(jsonb) from public, anon;
grant execute on function public.my_agenda_news(jsonb) to authenticated;

-- Supabase active la RLS sur storage.objects dès la création du projet ; on le vérifie au lieu de le supposer.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    begin
      alter table storage.objects enable row level security;
    exception when insufficient_privilege then
      raise warning 'storage.objects : la protection par ligne (RLS) est désactivée ; active-la dans Supabase › Storage › Policies.';
    end;
  end if;
end $$;

-- ── Fichiers d'un groupe supprimé (2026-10-18e) ──

create table if not exists public.deleted_groups (
  id uuid primary key,
  owner_id uuid not null, -- pas de clé vers auth.users : un compte supprimé emporte ses groupes pendant sa suppression
  deleted_at timestamptz not null default now()
);
alter table public.deleted_groups enable row level security;
revoke all on public.deleted_groups from anon, authenticated;
grant select, delete on public.deleted_groups to authenticated;
drop policy if exists "groupes supprimés : les miens" on public.deleted_groups;
create policy "groupes supprimés : les miens" on public.deleted_groups for select to authenticated
  using (owner_id = (select auth.uid()));
drop policy if exists "groupes supprimés : oublier" on public.deleted_groups;
create policy "groupes supprimés : oublier" on public.deleted_groups for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Seulement les groupes qui avaient des fichiers ; au nom de qui supprime (le propriétaire, le dernier membre).
create or replace function public.groups_after_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.uid(), old.owner_id) is not null
     and exists (select 1 from storage.objects where bucket_id = 'groups' and name like old.id::text || '/%') then
    insert into public.deleted_groups (id, owner_id) values (old.id, coalesce(auth.uid(), old.owner_id))
      on conflict (id) do nothing;
  end if;
  return old;
end;
$$;
revoke all on function public.groups_after_delete() from public, anon, authenticated;
drop trigger if exists groups_after_delete on public.groups;
create trigger groups_after_delete after delete on public.groups
  for each row execute procedure public.groups_after_delete();

create or replace function public.deleted_group_path(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.deleted_groups d
    where d.id::text = (storage.foldername(p_path))[1] and d.owner_id = auth.uid()
  );
$$;
revoke all on function public.deleted_group_path(text) from public, anon;
grant execute on function public.deleted_group_path(text) to authenticated;

drop policy if exists "groupes supprimés : lister les fichiers" on storage.objects;
create policy "groupes supprimés : lister les fichiers" on storage.objects for select to authenticated
  using (bucket_id = 'groups' and (select public.deleted_group_path(name)));
drop policy if exists "groupes supprimés : effacer les fichiers" on storage.objects;
create policy "groupes supprimés : effacer les fichiers" on storage.objects for delete to authenticated
  using (bucket_id = 'groups' and (select public.deleted_group_path(name)));

-- ── 3. Te déclarer administrateur ───────────────────────────────────────────
-- Remplace l'adresse par celle de ton compte COP-PILOT :
-- insert into public.admins (user_id) select id from auth.users where email = 'ton.adresse@exemple.fr' on conflict do nothing;

-- ── Photo d'un groupe ou d'un agenda partagé (2026-10-19) ───────────────────
alter table public.groups add column if not exists photo text
  check (photo is null or (char_length(photo) <= 150000 and photo ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'));
grant select (photo) on public.groups to authenticated;
grant update (name, color, photo) on public.groups to authenticated;

-- ── Couleur des dossiers de notes (2026-10-19c) ─────────────────────────────
alter table public.note_folders add column if not exists color text
  check (color is null or color in ('bleu', 'rouge', 'orange', 'jaune', 'vert', 'violet', 'rose', 'gris'));

-- ── Périodes des agendas partagés (2026-10-20) ─────────────────────────────
create table if not exists public.group_periods (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  start_date date not null,
  end_date date not null,
  color text not null default 'bleu' check (color in ('bleu', 'rouge', 'orange', 'jaune', 'vert', 'violet', 'rose', 'gris')),
  -- Les membres concernés (« Léa est en entreprise ») ; vide : tout le monde.
  people uuid[] not null default '{}' check (cardinality(people) <= 50),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 400)
);
alter table public.group_periods add column if not exists people uuid[] not null default '{}' check (cardinality(people) <= 50);
create index if not exists group_periods_group on public.group_periods (group_id, start_date);
alter table public.group_periods enable row level security;
revoke all on public.group_periods from anon;

drop policy if exists "périodes : lecture" on public.group_periods;
create policy "périodes : lecture" on public.group_periods for select to authenticated
  using ((select public.is_group_member(group_id)));
drop policy if exists "périodes : ajout" on public.group_periods;
create policy "périodes : ajout" on public.group_periods for insert to authenticated
  with check ((select public.can_edit_group(group_id)));
drop policy if exists "périodes : modification" on public.group_periods;
create policy "périodes : modification" on public.group_periods for update to authenticated
  using ((select public.can_edit_group(group_id))) with check ((select public.can_edit_group(group_id)));
drop policy if exists "périodes : suppression" on public.group_periods;
create policy "périodes : suppression" on public.group_periods for delete to authenticated
  using ((select public.can_edit_group(group_id)));
drop policy if exists "2fa obligatoire" on public.group_periods;
create policy "2fa obligatoire" on public.group_periods as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- Pas plus de 300 périodes par agenda (une répétition sur un an en fait au plus 60).
create or replace function public.group_periods_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.group_periods where group_id = new.group_id) >= 300 then
    raise exception 'too many periods';
  end if;
  return new;
end;
$$;
revoke all on function public.group_periods_limit() from public, anon, authenticated;
drop trigger if exists group_periods_limit on public.group_periods;
create trigger group_periods_limit before insert on public.group_periods
  for each row execute procedure public.group_periods_limit();

-- En direct pour les autres membres.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_periods') then
    alter publication supabase_realtime add table public.group_periods;
  end if;
end $$;

-- ── Notifications plus claires, plusieurs comptes par appareil (2026-10-21) ──
-- ── 1. Un appareil, plusieurs comptes ───────────────────────────────────────
create or replace function public.claim_push_endpoint(p_endpoint text, p_p256dh text, p_auth text, p_device text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not public.mfa_ok() then raise exception 'mfa required'; end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or char_length(p_endpoint) > 1000 then raise exception 'invalid endpoint'; end if;
  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'invalid keys'; end if;
  -- Les autres comptes de ce navigateur gardent leur ligne : chacun reçoit ses notifications ici.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
    values (me, p_endpoint, left(p_p256dh, 200), left(p_auth, 100), left(p_device, 200))
    on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device;
end;
$$;
revoke all on function public.claim_push_endpoint(text, text, text, text) from public, anon;
grant execute on function public.claim_push_endpoint(text, text, text, text) to authenticated;

-- ── 4. Qui a fait le changement ─────────────────────────────────────────────
alter table public.reminders add column if not exists actor uuid;

drop function if exists public.claim_due_reminders();
create function public.claim_due_reminders() returns table (user_id uuid, key text, title text, body text, url text, fire_at timestamptz, actor uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  -- Ménage : les rappels envoyés depuis plus d'une semaine.
  delete from public.reminders r where r.sent_at < now() - interval '7 days';
  return query
  with due as (
    select r.user_id, r.key from public.reminders r
    where r.sent_at is null and r.fire_at <= now() and r.fire_at > now() - interval '30 minutes'
    order by r.fire_at
    limit 500
    for update skip locked
  )
  update public.reminders r set sent_at = now()
  from due where r.user_id = due.user_id and r.key = due.key
  returning r.user_id, r.key, r.title, r.body, r.url, r.fire_at, r.actor;
end;
$$;
revoke all on function public.claim_due_reminders() from public, anon, authenticated;
grant execute on function public.claim_due_reminders() to service_role;

-- ── Dates en français pour les notifications (« sam. 17 oct. », « 14h30 ») ─
create or replace function public.fr_day(d date) returns text
language sql immutable set search_path = '' as $$
  select (array['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'])[extract(dow from d)::int + 1]
    || ' ' || extract(day from d)::int
    || ' ' || (array['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'])[extract(month from d)::int];
$$;
create or replace function public.fr_time(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(replace(t, ':', 'h'), 'h00$', 'h');
$$;
revoke all on function public.fr_day(date) from public, anon;
revoke all on function public.fr_time(text) from public, anon;

-- ── 2. Événements d'un agenda partagé ───────────────────────────────────────
-- Titre : qui a fait quoi. Ligne 1 : quand. Ligne 2 : quel agenda.
create or replace function public.notify_agenda_members() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ev public.group_events := case when tg_op = 'DELETE' then old else new end;
  g public.groups;
  who text;
  what text;
  quand text;
begin
  if pg_trigger_depth() > 1 then return null; end if; -- changes made by the database itself (account deleted…)
  select * into g from public.groups where id = ev.group_id;
  if g.kind is distinct from 'agenda' then return null; end if;
  if tg_op = 'UPDATE' and (old.title, old.date, old.start_time, old.end_time, old.category, old.details, old.place)
     is not distinct from (new.title, new.date, new.start_time, new.end_time, new.category, new.details, new.place) then
    return null;
  end if;
  select coalesce(nullif(btrim(name), ''), 'Un membre') into who from public.profiles where id = auth.uid();
  what := case tg_op when 'INSERT' then ' a ajouté « ' when 'UPDATE' then ' a modifié « ' else ' a supprimé « ' end;
  quand := public.fr_day(ev.date) || coalesce(' à ' || public.fr_time(ev.start_time), '');
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  select m.user_id, 'agenda:' || ev.id || ':' || tg_op || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
         left(coalesce(who, 'Un membre') || what || left(ev.title, 120) || ' »', 200),
         left(
           case tg_op when 'INSERT' then 'Le ' when 'UPDATE' then 'Maintenant le ' else 'C’était prévu le ' end || quand
             || E'\n' || 'Agenda partagé « ' || left(g.name, 60) || ' »',
           300),
         '/agendas?g=' || ev.group_id || case when tg_op = 'DELETE' then '' else '&jour=' || ev.date end,
         auth.uid()
  from public.group_members m
  where m.group_id = ev.group_id and m.user_id is distinct from auth.uid()
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.notify_agenda_members() from public, anon, authenticated;

-- ── 3. Périodes d'un agenda partagé ─────────────────────────────────────────
-- Ajout et suppression : une notification par période… ou une seule pour toutes celles d'une même alternance
-- (même nom, mêmes personnes, envoyées ensemble).
create or replace function public.notify_agenda_periods(p_rows jsonb, p_op text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  who text;
  g public.groups;
  pour text;
  dates text;
begin
  select coalesce(nullif(btrim(name), ''), 'Un membre') into who from public.profiles where id = auth.uid();
  for r in
    select x.group_id, x.title, coalesce(x.people, '{}') as people, count(*) as n, min(x.start_date) as s, max(x.end_date) as e, min(x.id::text) as first_id
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(id uuid, group_id uuid, title text, people uuid[], start_date date, end_date date)
    group by x.group_id, x.title, coalesce(x.people, '{}')
  loop
    select * into g from public.groups where id = r.group_id;
    if g.kind is distinct from 'agenda' then continue; end if;
    select ' pour ' || string_agg(coalesce(nullif(btrim(p.name), ''), 'un membre'), ', ' order by p.name)
      into pour from public.profiles p where p.id = any(r.people);
    dates := case when r.s = r.e then 'Le ' || public.fr_day(r.s) else 'Du ' || public.fr_day(r.s) || ' au ' || public.fr_day(r.e) end
      || case when r.n > 1 then ' (' || r.n || ' fois)' else '' end;
    insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
    select m.user_id, 'periode:' || r.first_id || ':' || p_op || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
           left(coalesce(who, 'Un membre')
             || case p_op when 'INSERT' then ' a ajouté ' else ' a supprimé ' end
             || case when r.n > 1 then r.n || ' périodes « ' else 'la période « ' end
             || left(r.title, 60) || ' »' || coalesce(pour, ''), 200),
           left(dates || E'\n' || 'Agenda partagé « ' || left(g.name, 60) || ' »', 300),
           '/agendas?g=' || r.group_id || case when p_op = 'INSERT' then '&jour=' || r.s else '' end,
           auth.uid()
    from public.group_members m
    where m.group_id = r.group_id and m.user_id is distinct from auth.uid()
    on conflict do nothing;
  end loop;
end;
$$;
revoke all on function public.notify_agenda_periods(jsonb, text) from public, anon, authenticated;

create or replace function public.notify_agenda_periods_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 then perform public.notify_agenda_periods((select jsonb_agg(n) from new_rows n), 'INSERT'); end if;
  return null;
end;
$$;
create or replace function public.notify_agenda_periods_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 then perform public.notify_agenda_periods((select jsonb_agg(o) from old_rows o), 'DELETE'); end if;
  return null;
end;
$$;
revoke all on function public.notify_agenda_periods_added() from public, anon, authenticated;
revoke all on function public.notify_agenda_periods_removed() from public, anon, authenticated;

-- Modification d'une période (nom, dates, personnes) : « Léo a modifié la période « Stage » ».
create or replace function public.notify_agenda_period_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text;
  g public.groups;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if (old.title, old.start_date, old.end_date, old.people) is not distinct from (new.title, new.start_date, new.end_date, new.people) then return null; end if;
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'agenda' then return null; end if;
  select coalesce(nullif(btrim(name), ''), 'Un membre') into who from public.profiles where id = auth.uid();
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  select m.user_id, 'periode:' || new.id || ':UPDATE:' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
         left(coalesce(who, 'Un membre') || ' a modifié la période « ' || left(new.title, 60) || ' »', 200),
         left(case when new.start_date = new.end_date then 'Maintenant le ' || public.fr_day(new.start_date)
                   else 'Maintenant du ' || public.fr_day(new.start_date) || ' au ' || public.fr_day(new.end_date) end
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

drop trigger if exists group_periods_notify_insert on public.group_periods;
create trigger group_periods_notify_insert after insert on public.group_periods
  referencing new table as new_rows for each statement execute procedure public.notify_agenda_periods_added();
drop trigger if exists group_periods_notify_delete on public.group_periods;
create trigger group_periods_notify_delete after delete on public.group_periods
  referencing old table as old_rows for each statement execute procedure public.notify_agenda_periods_removed();
drop trigger if exists group_periods_notify_update on public.group_periods;
create trigger group_periods_notify_update after update on public.group_periods
  for each row execute procedure public.notify_agenda_period_changed();

-- Administration : le même ton (« Nouveau signalement » → ce qui est signalé).
create or replace function public.notify_admins() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_title text;
  v_body text;
begin
  if tg_table_name = 'reports' then
    v_title := 'Nouveau signalement à traiter';
    v_body := '« ' || left(coalesce(new.snapshot ->> 'title', 'Un contenu de groupe'), 120) || ' »' || E'\n' || 'Administration';
  else
    v_title := case when new.kind = 'bug' then 'Nouveau bug signalé' else 'Nouvel avis reçu' end;
    v_body := left(new.message, 140) || E'\n' || 'Administration';
  end if;
  insert into public.reminders (user_id, key, fire_at, title, body, url)
  select a.user_id, 'admin:' || tg_table_name || ':' || new.id, now(), v_title, coalesce(v_body, ''), '/admin?vue=traiter'
  from public.admins a
  on conflict do nothing;
  return new;
end;
$$;

-- ── Notifications des groupes de travail (2026-10-21b) ─────────────────────
-- Le nom de la personne connectée, pour les titres.
create or replace function public.actor_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(btrim(name), '') from public.profiles where id = auth.uid()), 'Un membre');
$$;
revoke all on function public.actor_name() from public, anon, authenticated;

-- Prévient les autres membres d'un groupe (pas la personne qui a fait le changement).
create or replace function public.notify_group_members(p_group uuid, p_key text, p_title text, p_body text, p_url text, p_fire timestamptz default now())
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  select m.user_id, left(p_key, 200), p_fire, left(p_title, 200), left(p_body, 300), left(p_url, 300), auth.uid()
  from public.group_members m
  where m.group_id = p_group and m.user_id is distinct from auth.uid()
  on conflict (user_id, key) do update
    set title = excluded.title, body = excluded.body, fire_at = excluded.fire_at
    where public.reminders.sent_at is null;
end;
$$;
revoke all on function public.notify_group_members(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;

-- ── Fichiers partagés dans un groupe ────────────────────────────────────────
-- Les fichiers envoyés à la suite par une même personne (un dossier partagé arrive fichier par fichier) sont
-- regroupés : la notification part deux minutes après le début de l'envoi, avec le nombre de fichiers.
create or replace function public.notify_group_file() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  slot bigint := floor(extract(epoch from now()) / 120);
  since timestamptz := to_timestamp(floor(extract(epoch from now()) / 120) * 120);
  n integer;
  names text;
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then return null; end if;
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'groupe' then return null; end if;
  select string_agg(x.name, ', ')
    into names
    from (select f.name from public.group_files f
          where f.group_id = new.group_id and f.created_by = auth.uid() and f.created_at >= since
          order by f.created_at limit 3) x;
  select count(*) into n from public.group_files f where f.group_id = new.group_id and f.created_by = auth.uid() and f.created_at >= since;
  perform public.notify_group_members(
    new.group_id,
    'fichiers:' || new.group_id || ':' || auth.uid() || ':' || slot,
    public.actor_name() || case when n > 1 then ' a partagé ' || n || ' fichiers' else ' a partagé « ' || left(new.name, 100) || ' »' end,
    case when n > 1 then left(names, 160) || case when n > 3 then '…' else '' end || E'\n' else '' end || 'Groupe « ' || left(g.name, 60) || ' »',
    '/groupes?g=' || new.group_id || '&onglet=fichiers',
    since + interval '2 minutes');
  return null;
end;
$$;
revoke all on function public.notify_group_file() from public, anon, authenticated;
drop trigger if exists group_files_notify on public.group_files;
create trigger group_files_notify after insert on public.group_files
  for each row execute procedure public.notify_group_file();

-- ── Nouvelle note dans un groupe ────────────────────────────────────────────
create or replace function public.notify_group_note() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  t text := nullif(btrim(new.title), '');
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then return null; end if;
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'groupe' then return null; end if;
  perform public.notify_group_members(
    new.group_id,
    'note:' || new.id,
    public.actor_name() || case when t is null or t = 'Sans titre' then ' a commencé une nouvelle note' else ' a ajouté la note « ' || left(t, 100) || ' »' end,
    'Groupe « ' || left(g.name, 60) || ' »',
    '/groupes?g=' || new.group_id || '&onglet=notes');
  return null;
end;
$$;
revoke all on function public.notify_group_note() from public, anon, authenticated;
drop trigger if exists group_notes_notify on public.group_notes;
create trigger group_notes_notify after insert on public.group_notes
  for each row execute procedure public.notify_group_note();

-- ── Révision proposée dans un groupe (les agendas ont déjà la leur) ──────────
create or replace function public.notify_group_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then return null; end if;
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'groupe' then return null; end if;
  perform public.notify_group_members(
    new.group_id,
    'revision:' || new.id,
    public.actor_name() || ' a proposé « ' || left(new.title, 100) || ' »',
    'Le ' || public.fr_day(new.date) || coalesce(' à ' || public.fr_time(new.start_time), '') || E'\n' || 'Groupe « ' || left(g.name, 60) || ' »',
    '/groupes?g=' || new.group_id || '&onglet=revisions');
  return null;
end;
$$;
revoke all on function public.notify_group_event() from public, anon, authenticated;
drop trigger if exists group_events_notify_group on public.group_events;
create trigger group_events_notify_group after insert on public.group_events
  for each row execute procedure public.notify_group_event();

-- ── Quelqu'un rejoint un groupe ou un agenda ────────────────────────────────
create or replace function public.notify_group_joined() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then return null; end if; -- only someone joining by themselves
  select * into g from public.groups where id = new.group_id;
  if g.owner_id = new.user_id and g.created_at > now() - interval '1 minute' then return null; end if; -- its creator, at creation
  perform public.notify_group_members(
    new.group_id,
    'membre:' || new.group_id || ':' || new.user_id,
    public.actor_name() || ' a rejoint « ' || left(g.name, 60) || ' »',
    case when g.kind = 'agenda' then 'Agenda partagé' else 'Groupe' end,
    case when g.kind = 'agenda' then '/agendas?g=' else '/groupes?g=' end || new.group_id || case when g.kind = 'agenda' then '' else '&onglet=membres' end);
  return null;
end;
$$;
revoke all on function public.notify_group_joined() from public, anon, authenticated;
drop trigger if exists group_members_notify on public.group_members;
create trigger group_members_notify after insert on public.group_members
  for each row execute procedure public.notify_group_joined();

-- ── Les rappels de l'appli ne remplacent plus les notifications des autres ────
-- Quand l'appli renvoie ses rappels (événements, tâches), elle remplaçait tout ce qui n'était pas encore parti,
-- y compris une notification de groupe ou d'agenda en attente : seuls ses propres rappels sont remplacés.
create or replace function public.replace_my_reminders(p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if auth.uid() is null or not public.mfa_ok() then
    raise exception 'mfa required';
  end if;
  delete from public.reminders
    where user_id = auth.uid() and (key like 'event:%' or key like 'task:%') and (sent_at is null or sent_at < now() - interval '3 days');
  insert into public.reminders (user_id, key, fire_at, title, body, url)
  select auth.uid(), left(x.key, 200), x.fire_at, left(coalesce(nullif(btrim(x.title), ''), 'Rappel'), 200), left(coalesce(x.body, ''), 300),
         case when x.url like '/%' then left(x.url, 300) else '/' end
  from jsonb_to_recordset(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
       as x(key text, fire_at timestamptz, title text, body text, url text)
  where x.key is not null and (x.key like 'event:%' or x.key like 'task:%')
    and x.fire_at > now() - interval '5 minutes' and x.fire_at < now() + interval '40 days'
  order by x.fire_at
  limit 300
  on conflict (user_id, key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.replace_my_reminders(jsonb) from public, anon;
grant execute on function public.replace_my_reminders(jsonb) to authenticated;

-- ── Titres de notification courts (2026-10-21c) ───────────────────────────
create or replace function public.notify_agenda_members() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ev public.group_events := case when tg_op = 'DELETE' then old else new end;
  g public.groups;
  who text;
  what text;
  quand text;
begin
  if pg_trigger_depth() > 1 then return null; end if; -- changes made by the database itself (account deleted…)
  select * into g from public.groups where id = ev.group_id;
  if g.kind is distinct from 'agenda' then return null; end if;
  if tg_op = 'UPDATE' and (old.title, old.date, old.start_time, old.end_time, old.category, old.details, old.place)
     is not distinct from (new.title, new.date, new.start_time, new.end_time, new.category, new.details, new.place) then
    return null;
  end if;
  select coalesce(nullif(btrim(name), ''), 'Un membre') into who from public.profiles where id = auth.uid();
  what := case tg_op when 'INSERT' then ' a ajouté un événement' when 'UPDATE' then ' a modifié un événement' else ' a supprimé un événement' end;
  quand := public.fr_day(ev.date) || coalesce(' à ' || public.fr_time(ev.start_time), '');
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  select m.user_id, 'agenda:' || ev.id || ':' || tg_op || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
         left(coalesce(who, 'Un membre') || what, 200),
         left(
           '« ' || left(ev.title, 80) || ' » · ' || case tg_op when 'UPDATE' then 'maintenant le ' when 'DELETE' then 'prévu le ' else '' end || quand
             || E'\n' || 'Agenda partagé « ' || left(g.name, 60) || ' »',
           300),
         '/agendas?g=' || ev.group_id || case when tg_op = 'DELETE' then '' else '&jour=' || ev.date end,
         auth.uid()
  from public.group_members m
  where m.group_id = ev.group_id and m.user_id is distinct from auth.uid()
  on conflict do nothing;
  return null;
end;
$$;

create or replace function public.notify_agenda_periods(p_rows jsonb, p_op text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  who text;
  g public.groups;
  pour text;
  dates text;
begin
  select coalesce(nullif(btrim(name), ''), 'Un membre') into who from public.profiles where id = auth.uid();
  for r in
    select x.group_id, x.title, coalesce(x.people, '{}') as people, count(*) as n, min(x.start_date) as s, max(x.end_date) as e, min(x.id::text) as first_id
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(id uuid, group_id uuid, title text, people uuid[], start_date date, end_date date)
    group by x.group_id, x.title, coalesce(x.people, '{}')
  loop
    select * into g from public.groups where id = r.group_id;
    if g.kind is distinct from 'agenda' then continue; end if;
    select ' pour ' || string_agg(coalesce(nullif(btrim(p.name), ''), 'un membre'), ', ' order by p.name)
      into pour from public.profiles p where p.id = any(r.people);
    dates := case when r.s = r.e then 'Le ' || public.fr_day(r.s) else 'Du ' || public.fr_day(r.s) || ' au ' || public.fr_day(r.e) end
      || case when r.n > 1 then ' (' || r.n || ' fois)' else '' end;
    insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
    select m.user_id, 'periode:' || r.first_id || ':' || p_op || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
           left(coalesce(who, 'Un membre')
             || case p_op when 'INSERT' then ' a ajouté ' else ' a supprimé ' end
             || case when r.n > 1 then r.n || ' périodes' else 'une période' end, 200),
           left('« ' || left(r.title, 60) || ' »' || coalesce(pour, '') || ' · ' || lower(left(dates, 1)) || substr(dates, 2)
             || E'\n' || 'Agenda partagé « ' || left(g.name, 60) || ' »', 300),
           '/agendas?g=' || r.group_id || case when p_op = 'INSERT' then '&jour=' || r.s else '' end,
           auth.uid()
    from public.group_members m
    where m.group_id = r.group_id and m.user_id is distinct from auth.uid()
    on conflict do nothing;
  end loop;
end;
$$;

create or replace function public.notify_agenda_period_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text;
  g public.groups;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if (old.title, old.start_date, old.end_date, old.people) is not distinct from (new.title, new.start_date, new.end_date, new.people) then return null; end if;
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'agenda' then return null; end if;
  select coalesce(nullif(btrim(name), ''), 'Un membre') into who from public.profiles where id = auth.uid();
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  select m.user_id, 'periode:' || new.id || ':UPDATE:' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
         left(coalesce(who, 'Un membre') || ' a modifié une période', 200),
         left('« ' || left(new.title, 60) || ' » · ' || case when new.start_date = new.end_date then 'maintenant le ' || public.fr_day(new.start_date)
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

create or replace function public.notify_group_file() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  slot bigint := floor(extract(epoch from now()) / 120);
  since timestamptz := to_timestamp(floor(extract(epoch from now()) / 120) * 120);
  n integer;
  names text;
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then return null; end if;
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'groupe' then return null; end if;
  select string_agg(x.name, ', ')
    into names
    from (select f.name from public.group_files f
          where f.group_id = new.group_id and f.created_by = auth.uid() and f.created_at >= since
          order by f.created_at limit 3) x;
  select count(*) into n from public.group_files f where f.group_id = new.group_id and f.created_by = auth.uid() and f.created_at >= since;
  perform public.notify_group_members(
    new.group_id,
    'fichiers:' || new.group_id || ':' || auth.uid() || ':' || slot,
    public.actor_name() || case when n > 1 then ' a partagé ' || n || ' fichiers' else ' a partagé un fichier' end,
    left(names, 160) || case when n > 3 then '…' else '' end || E'\n' || 'Groupe « ' || left(g.name, 60) || ' »',
    '/groupes?g=' || new.group_id || '&onglet=fichiers',
    since + interval '2 minutes');
  return null;
end;
$$;

create or replace function public.notify_group_note() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  t text := nullif(btrim(new.title), '');
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then return null; end if;
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'groupe' then return null; end if;
  perform public.notify_group_members(
    new.group_id,
    'note:' || new.id,
    public.actor_name() || ' a créé une note',
    case when t is null or t = 'Sans titre' then '' else '« ' || left(t, 100) || ' »' || E'\n' end || 'Groupe « ' || left(g.name, 60) || ' »',
    '/groupes?g=' || new.group_id || '&onglet=notes');
  return null;
end;
$$;

create or replace function public.notify_group_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then return null; end if;
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'groupe' then return null; end if;
  perform public.notify_group_members(
    new.group_id,
    'revision:' || new.id,
    public.actor_name() || ' propose un créneau',
    '« ' || left(new.title, 80) || ' » · ' || public.fr_day(new.date) || coalesce(' à ' || public.fr_time(new.start_time), '') || E'\n' || 'Groupe « ' || left(g.name, 60) || ' »',
    '/groupes?g=' || new.group_id || '&onglet=revisions');
  return null;
end;
$$;

create or replace function public.notify_group_joined() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then return null; end if; -- only someone joining by themselves
  select * into g from public.groups where id = new.group_id;
  if g.owner_id = new.user_id and g.created_at > now() - interval '1 minute' then return null; end if; -- its creator, at creation
  perform public.notify_group_members(
    new.group_id,
    'membre:' || new.group_id || ':' || new.user_id,
    public.actor_name() || case when g.kind = 'agenda' then ' a rejoint l’agenda' else ' a rejoint le groupe' end,
    case when g.kind = 'agenda' then 'Agenda partagé « ' else 'Groupe « ' end || left(g.name, 60) || ' »',
    case when g.kind = 'agenda' then '/agendas?g=' else '/groupes?g=' end || new.group_id || case when g.kind = 'agenda' then '' else '&onglet=membres' end);
  return null;
end;
$$;

-- ── Corrections du mega test (2026-10-22) ───────────────────────────────
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

-- ── Périodes en plusieurs morceaux (2026-10-23) ─────────────────────────────
alter table public.group_periods add column if not exists skip date[] not null default '{}' check (cardinality(skip) <= 400);

-- Retirer ou remettre des jours compte comme une modification de la période (notification « a modifié »).
create or replace function public.notify_agenda_period_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text;
  g public.groups;
  pour text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if (old.title, old.start_date, old.end_date, old.people, old.skip) is not distinct from (new.title, new.start_date, new.end_date, new.people, new.skip) then return null; end if;
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

-- ── « Pour qui » sur les événements des agendas (2026-10-24) ──────────────────
alter table public.group_events add column if not exists people uuid[] not null default '{}' check (cardinality(people) <= 50);

-- Les notifications disent pour qui, et changer « pour qui » compte comme une modification.
create or replace function public.notify_agenda_members() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ev public.group_events := case when tg_op = 'DELETE' then old else new end;
  g public.groups;
  who text;
  what text;
  quand text;
  pour text;
begin
  if pg_trigger_depth() > 1 then return null; end if; -- changes made by the database itself (account deleted…)
  select * into g from public.groups where id = ev.group_id;
  if g.kind is distinct from 'agenda' then return null; end if;
  if tg_op = 'UPDATE' and (old.title, old.date, old.start_time, old.end_time, old.category, old.details, old.place, old.people)
     is not distinct from (new.title, new.date, new.start_time, new.end_time, new.category, new.details, new.place, new.people) then
    return null;
  end if;
  select coalesce(nullif(btrim(name), ''), 'Un membre') into who from public.profiles where id = auth.uid();
  what := case tg_op when 'INSERT' then ' a ajouté un événement' when 'UPDATE' then ' a modifié un événement' else ' a supprimé un événement' end;
  quand := public.fr_day(ev.date) || coalesce(' à ' || public.fr_time(ev.start_time), '');
  select ' pour ' || string_agg(coalesce(nullif(btrim(p.name), ''), 'un membre'), ', ' order by p.name)
    into pour from public.profiles p where p.id = any(coalesce(ev.people, '{}'));
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  select m.user_id, 'agenda:' || ev.id || ':' || tg_op || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
         left(coalesce(who, 'Un membre') || what, 200),
         left(
           '« ' || left(ev.title, 80) || ' »' || coalesce(pour, '') || ' · ' || case tg_op when 'UPDATE' then 'maintenant le ' when 'DELETE' then 'prévu le ' else '' end || quand
             || E'\n' || 'Agenda partagé « ' || left(g.name, 60) || ' »',
           300),
         '/agendas?g=' || ev.group_id || case when tg_op = 'DELETE' then '' else '&jour=' || ev.date end,
         auth.uid()
  from public.group_members m
  where m.group_id = ev.group_id and m.user_id is distinct from auth.uid()
  on conflict do nothing;
  return null;
end;
$$;
