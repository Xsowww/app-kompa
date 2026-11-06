-- Synchro groupée : à coller dans Supabase › SQL Editor (après 2026-11-07_series_nuits.sql et
-- 2026-10-29_synchro_legere.sql). Peut être collé plusieurs fois sans risque.
-- Quand l'appli regarde ce qui a changé sur tes autres appareils (en revenant sur l'onglet, toutes les 2 minutes),
-- elle posait 8 questions au serveur (une par sorte de données). Avec cette fonction, une seule.
-- « security invoker » : la fonction lit avec les droits du compte connecté (ses règles d'accès s'appliquent).
-- Sans elle, l'appli marche comme avant.
create or replace function public.sync_changes(since timestamptz)
returns json
language sql stable security invoker set search_path = '' as $$
  select json_build_object(
    'events', coalesce((select json_agg(t) from public.events t where t.user_id = (select auth.uid()) and t.synced_at > since), '[]'::json),
    'note_folders', coalesce((select json_agg(t) from public.note_folders t where t.user_id = (select auth.uid()) and t.synced_at > since), '[]'::json),
    'notes', coalesce((select json_agg(t) from public.notes t where t.user_id = (select auth.uid()) and t.synced_at > since), '[]'::json),
    'drive_items', coalesce((select json_agg(t) from public.drive_items t where t.user_id = (select auth.uid()) and t.synced_at > since), '[]'::json),
    'todos', coalesce((select json_agg(t) from public.todos t where t.user_id = (select auth.uid()) and t.synced_at > since), '[]'::json),
    'focus_sessions', coalesce((select json_agg(t) from public.focus_sessions t where t.user_id = (select auth.uid()) and t.synced_at > since), '[]'::json),
    'gone', coalesce((select json_agg(d) from public.sync_deletions d where d.user_id = (select auth.uid()) and d.deleted_at > since), '[]'::json),
    'profile', (select row_to_json(p) from public.profiles p where p.id = (select auth.uid()))
  );
$$;
revoke all on function public.sync_changes(timestamptz) from public, anon;
grant execute on function public.sync_changes(timestamptz) to authenticated;
