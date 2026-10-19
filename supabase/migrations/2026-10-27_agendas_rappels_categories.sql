-- Agendas partagés : rappels et catégories personnalisées. À coller dans Supabase › SQL Editor
-- (après 2026-10-26_double_authentification_facultative.sql).

-- ── Catégories propres à chaque agenda partagé ────────────────────────────────
-- Une liste [{ id: 'c-…', label, color }] gardée avec l'agenda : tous les membres la voient, les éditeurs la changent.
alter table public.groups add column if not exists categories jsonb not null default '[]'::jsonb
  check (jsonb_typeof(categories) = 'array' and jsonb_array_length(categories) <= 30);
grant select (categories) on public.groups to authenticated;

-- Un événement d'agenda peut avoir une de ces catégories (« c-… ») en plus des cinq de base.
alter table public.group_events drop constraint if exists group_events_category_check;
alter table public.group_events add constraint group_events_category_check
  check (category is null or category in ('cours', 'examen', 'devoir', 'perso', 'sport') or category ~ '^c-[a-z0-9-]{1,20}$');

create or replace function public.set_agenda_categories(p_group uuid, p_list jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  clean jsonb;
begin
  if auth.uid() is null or not public.mfa_ok() then
    raise exception 'mfa required';
  end if;
  if not public.can_edit_group(p_group) then
    raise exception 'forbidden';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x->>'id', 'label', btrim(x->>'label'), 'color', lower(x->>'color'))), '[]'::jsonb)
    into clean
  from (
    select x from jsonb_array_elements(case when jsonb_typeof(p_list) = 'array' then p_list else '[]'::jsonb end) x limit 30
  ) s
  where (x->>'id') ~ '^c-[a-z0-9-]{1,20}$'
    and char_length(btrim(coalesce(x->>'label', ''))) between 1 and 24
    and (x->>'color') ~ '^#[0-9a-fA-F]{6}$';
  update public.groups set categories = clean where id = p_group;
  return clean;
end;
$$;
revoke all on function public.set_agenda_categories(uuid, jsonb) from public, anon;
grant execute on function public.set_agenda_categories(uuid, jsonb) to authenticated;

-- ── Rappels sur les événements d'un agenda partagé ─────────────────────────────
-- Minutes avant le début (ou avant 9 h pour un événement sans heure), comme sur l'agenda perso.
alter table public.group_events add column if not exists reminders integer[] not null default '{}'
  check (cardinality(reminders) <= 5 and 0 <= all(reminders) and 40320 >= all(reminders));

-- Chaque membre concerné (« pour qui », sinon tout l'agenda) reçoit les rappels, même appli fermée :
-- la base les prépare dans public.reminders, que le serveur envoie à l'heure (server/push.mjs).
-- Heures de Paris. La clé contient le moment : un événement déplacé redonne un rappel.
create or replace function public.agenda_reminders_insert(p_group uuid, p_event uuid, p_user uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.reminders (user_id, key, fire_at, title, body, url)
  select mm.user_id,
         'rappel-agenda:' || e.id || ':' || m || ':' || floor(extract(epoch from x.at))::bigint,
         x.at,
         left(e.title, 200),
         left(to_char(e.date, 'DD/MM') || coalesce(' · ' || e.start_time, '') || ' · ' || g.name, 300),
         '/agendas?g=' || e.group_id || '&jour=' || e.date
  from public.group_events e
  join public.groups g on g.id = e.group_id and g.kind = 'agenda'
  join public.group_members mm on mm.group_id = e.group_id
  cross join lateral unnest(e.reminders) m
  cross join lateral (select ((e.date + coalesce(e.start_time, '09:00')::time) at time zone 'Europe/Paris') - make_interval(mins => m) as at) x
  where e.group_id = p_group
    and (p_event is null or e.id = p_event)
    and (p_user is null or mm.user_id = p_user)
    and (cardinality(e.people) = 0 or mm.user_id = any(e.people))
    and x.at > now()
  on conflict do nothing;
$$;
revoke all on function public.agenda_reminders_insert(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.agenda_event_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ev public.group_events := case when tg_op = 'DELETE' then old else new end;
begin
  -- Moved, changed or deleted: the reminders not sent yet are made again.
  delete from public.reminders where key like 'rappel-agenda:' || ev.id || ':%' and sent_at is null;
  if tg_op <> 'DELETE' and cardinality(ev.reminders) > 0 then
    perform public.agenda_reminders_insert(ev.group_id, ev.id, null);
  end if;
  return null;
end;
$$;
drop trigger if exists agenda_event_reminders on public.group_events;
create trigger agenda_event_reminders after insert or update or delete on public.group_events
  for each row execute procedure public.agenda_event_reminders();

-- Un nouveau membre reçoit les rappels à venir ; un membre qui part n'en reçoit plus.
create or replace function public.agenda_member_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.reminders r using public.group_events e
    where e.group_id = old.group_id and r.user_id = old.user_id and r.sent_at is null and r.key like 'rappel-agenda:' || e.id || ':%';
    return null;
  end if;
  perform public.agenda_reminders_insert(new.group_id, null, new.user_id);
  return null;
end;
$$;
drop trigger if exists agenda_member_reminders on public.group_members;
create trigger agenda_member_reminders after insert or delete on public.group_members
  for each row execute procedure public.agenda_member_reminders();

-- Ses prochains rappels d'agendas partagés, pour que l'appli les montre aussi sans notification push.
create or replace function public.my_shared_reminders() returns table (key text, fire_at timestamptz, title text, body text, url text)
language sql stable security definer set search_path = '' as $$
  select r.key, r.fire_at, r.title, r.body, r.url from public.reminders r
  where r.user_id = auth.uid() and public.mfa_ok() and r.key like 'rappel-agenda:%' and r.sent_at is null
    and r.fire_at < now() + interval '26 hours'
  order by r.fire_at
  limit 100;
$$;
revoke all on function public.my_shared_reminders() from public, anon;
grant execute on function public.my_shared_reminders() to authenticated;
