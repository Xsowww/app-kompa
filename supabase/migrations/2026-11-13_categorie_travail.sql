-- Catégorie « Travail » (un client, un chantier, un dossier), à côté de Cours, Examen, Devoir, Perso et Sport.
-- Avant cette migration, l'appli enregistre un événement « Travail » sous l'identifiant « c-travail » (accepté par
-- l'ancienne règle) et le relit comme « Travail » : rien n'est perdu, rien n'est à convertir. Peut être relancée.
alter table public.events drop constraint if exists events_category_check;
alter table public.events add constraint events_category_check
  check (category in ('cours', 'examen', 'devoir', 'travail', 'perso', 'sport') or category ~ '^c-[a-z0-9-]{1,40}$');

alter table public.group_events drop constraint if exists group_events_category_check;
alter table public.group_events add constraint group_events_category_check
  check (category is null or category in ('cours', 'examen', 'devoir', 'travail', 'perso', 'sport') or category ~ '^c-[a-z0-9-]{1,20}$');
