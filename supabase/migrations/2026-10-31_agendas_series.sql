-- Agendas partagés : événements qui se répètent et événements sur plusieurs jours.
-- À coller dans Supabase › SQL Editor (après 2026-10-30_evenements_repetes.sql).
-- Chaque fois (ou chaque jour) est un événement normal ; le même identifiant de série les relie.
alter table public.group_events add column if not exists series text
  check (series is null or char_length(series) <= 60);
create index if not exists group_events_series on public.group_events (group_id, series) where series is not null;
