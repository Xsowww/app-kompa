-- « Pour qui » sur les événements des agendas partagés : à coller dans Supabase › SQL Editor
-- (après 2026-10-23_periodes_jours.sql). Comme pour les périodes : un événement peut concerner certains
-- membres (« Léa · Dentiste ») ; vide, il concerne tout l'agenda.
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
