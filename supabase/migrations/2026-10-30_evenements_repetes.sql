-- Événements qui se répètent : à coller dans Supabase › SQL Editor (après 2026-10-29_synchro_legere.sql).
-- Chaque fois est un événement normal ; le même identifiant de série les relie (« celui-ci et les suivants »).
-- Sans cette colonne, l'appli garde la série sur l'appareil et envoie les événements sans elle.
alter table public.events add column if not exists series text
  check (series is null or char_length(series) <= 40);
create index if not exists events_series on public.events (user_id, series) where series is not null;
