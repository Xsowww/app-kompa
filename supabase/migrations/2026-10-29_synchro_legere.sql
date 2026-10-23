-- Synchro légère : à coller dans Supabase › SQL Editor (après 2026-10-28_passkey_sans_code.sql).
-- L'appli ne relit plus tout le compte : seulement ce qui a changé depuis sa dernière lecture.
-- Chaque ligne garde l'heure du serveur à laquelle elle a changé (synced_at) ; une ligne supprimée
-- laisse une trace (son identifiant seul, sans contenu) pendant 30 jours, pour que les autres appareils l'enlèvent aussi.
create or replace function public.touch_synced() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

create table if not exists public.sync_deletions (
  user_id uuid not null,
  tbl text not null,
  row_id uuid not null,
  deleted_at timestamptz not null default clock_timestamp()
);
create index if not exists sync_deletions_user on public.sync_deletions (user_id, deleted_at);
create index if not exists sync_deletions_age on public.sync_deletions (deleted_at);
alter table public.sync_deletions enable row level security;
drop policy if exists "mes suppressions" on public.sync_deletions;
create policy "mes suppressions" on public.sync_deletions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "2fa obligatoire" on public.sync_deletions;
create policy "2fa obligatoire" on public.sync_deletions as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
revoke all on public.sync_deletions from anon, authenticated;
grant select on public.sync_deletions to authenticated;

create or replace function public.note_deletion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Compte supprimé (suppression en cascade) : pas de trace.
  if exists (select 1 from auth.users where id = old.user_id) then
    insert into public.sync_deletions (user_id, tbl, row_id) values (old.user_id, tg_table_name, old.id);
  end if;
  -- De temps en temps, les traces de plus de 30 jours partent.
  if random() < 0.02 then
    delete from public.sync_deletions where deleted_at < now() - interval '30 days';
  end if;
  return null;
end;
$$;

-- Le déclencheur « *_synced_at » passe après « *_keep_newest » (ordre alphabétique) : une version plus
-- ancienne refusée ne change pas l'heure.
do $$
declare t text;
begin
  foreach t in array array['events', 'note_folders', 'notes', 'drive_items', 'todos', 'focus_sessions'] loop
    execute format('alter table public.%I add column if not exists synced_at timestamptz not null default clock_timestamp()', t);
    execute format('create index if not exists %I on public.%I (user_id, synced_at)', t || '_synced', t);
    execute format('drop trigger if exists %I on public.%I', t || '_synced_at', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.touch_synced()', t || '_synced_at', t);
    execute format('drop trigger if exists %I on public.%I', t || '_deleted', t);
    execute format('create trigger %I after delete on public.%I for each row execute function public.note_deletion()', t || '_deleted', t);
  end loop;
end $$;
