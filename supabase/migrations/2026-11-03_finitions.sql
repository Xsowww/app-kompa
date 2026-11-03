-- Finitions (3 novembre 2026).

-- ── Tâches : corbeille (30 jours) et répétition ─────────────────────────────
-- Une tâche supprimée va à la corbeille (deleted_at), comme les notes et les événements ; une tâche peut se répéter
-- (cochée, la suivante est créée avec la prochaine échéance). Sans ces colonnes, l'appli continue comme avant :
-- une tâche supprimée l'est aussi en ligne, la répétition reste sur l'appareil.
alter table public.todos add column if not exists deleted_at timestamptz;
alter table public.todos add column if not exists repeat text check (repeat is null or repeat in ('day', 'week', 'month', 'year'));
