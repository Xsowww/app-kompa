-- Connexion avec Google ou Apple : à coller dans Supabase › SQL Editor (après 2026-10-24_evenements_pour_qui.sql).
-- Le prénom du profil vient aussi de ce que Google donne (full_name) ; Apple ne donne parfois rien.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name) values (new.id, left(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'given_name', ''), ' ', 1)
  ), 60));
  return new;
end;
$$;
