-- Nuits et vacances scolaires refusées (test n°3, bloquant n°1) : à coller dans Supabase › SQL Editor
-- (après 2026-11-06_invitation_apercu.sql). Peut être collé plusieurs fois sans risque.
-- Un événement qui passe minuit (garde de nuit 22 h → 7 h) est un événement par jour, reliés par une série
-- « span-<identifiant> » de 41 caractères ; celle des vacances scolaires (.ics) est encore plus longue. La limite
-- était de 40 : le serveur refusait (code 23514, events_series_check). L'appli fait maintenant des séries courtes,
-- et la limite passe à 120 pour les versions de l'appli encore ouvertes sur les téléphones.
alter table public.events drop constraint if exists events_series_check;
alter table public.events add constraint events_series_check check (series is null or char_length(series) <= 120);
alter table public.group_events drop constraint if exists group_events_series_check;
alter table public.group_events add constraint group_events_series_check check (series is null or char_length(series) <= 120);
