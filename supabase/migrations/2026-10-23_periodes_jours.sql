-- Périodes en plusieurs morceaux : à coller dans Supabase › SQL Editor (après 2026-10-22_corrections_recette.sql).
-- Une période peut sauter des jours entre son premier et son dernier jour (deux semaines de cours, une semaine
-- en entreprise…) : c'est toujours une seule période, les jours sautés sont listés ici.
alter table public.group_periods add column if not exists skip date[] not null default '{}' check (cardinality(skip) <= 400);

-- Retirer ou remettre des jours compte comme une modification de la période (notification « a modifié »).
create or replace function public.notify_agenda_period_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text;
  g public.groups;
  pour text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if (old.title, old.start_date, old.end_date, old.people, old.skip) is not distinct from (new.title, new.start_date, new.end_date, new.people, new.skip) then return null; end if;
  select * into g from public.groups where id = new.group_id;
  if g.kind is distinct from 'agenda' then return null; end if;
  select coalesce(nullif(btrim(name), ''), 'Un membre') into who from public.profiles where id = auth.uid();
  select ' pour ' || string_agg(coalesce(nullif(btrim(p.name), ''), 'un membre'), ', ' order by p.name)
    into pour from public.profiles p where p.id = any(coalesce(new.people, '{}'));
  insert into public.reminders (user_id, key, fire_at, title, body, url, actor)
  select m.user_id, 'periode:' || new.id || ':UPDATE:' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, now(),
         left(coalesce(who, 'Un membre') || ' a modifié une période', 200),
         left('« ' || left(new.title, 60) || ' »' || coalesce(pour, '') || ' · ' || case when new.start_date = new.end_date then 'maintenant le ' || public.fr_day(new.start_date)
                   else 'maintenant du ' || public.fr_day(new.start_date) || ' au ' || public.fr_day(new.end_date) end
              || E'\n' || 'Agenda partagé « ' || left(g.name, 60) || ' »', 300),
         '/agendas?g=' || new.group_id || '&jour=' || new.start_date,
         auth.uid()
  from public.group_members m
  where m.group_id = new.group_id and m.user_id is distinct from auth.uid()
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.notify_agenda_period_changed() from public, anon, authenticated;
