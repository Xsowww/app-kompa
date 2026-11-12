-- Stockage : 500 Mo par compte (Fichiers et leur corbeille + fichiers envoyés dans les groupes). À coller dans
-- Supabase › SQL Editor (après 2026-11-07b_synchro_groupee.sql). La limite de 50 Mo par fichier reste.
-- L'appli refuse déjà, avec un message clair, un envoi qui ferait dépasser 500 Mo (QUOTA dans src/lib/blobStore.ts) ;
-- ici, le serveur refuse tout nouvel envoi d'un compte qui a déjà atteint 500 Mo, même sans passer par l'appli.
-- Pour changer la limite : modifie 500 ici et QUOTA dans src/lib/blobStore.ts.
create or replace function public.storage_quota() returns bigint
language sql immutable as $$ select 500::bigint * 1000 * 1000 $$;

-- La règle elle-même (2026-10-14b_stockage_limites.sql), remise au cas où elle manquerait.
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
