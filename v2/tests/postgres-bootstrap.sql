-- Minimal Supabase-compatible objects for isolated SQL integration tests.
-- This file is used only inside a disposable PostgreSQL service in GitHub Actions.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;
create table auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $function$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create schema if not exists realtime;
create table realtime.messages (
  id bigserial primary key,
  topic text not null,
  event text not null,
  extension text not null
);
alter table realtime.messages enable row level security;
grant usage on schema realtime to anon, authenticated;
grant select, insert on realtime.messages to authenticated;

create or replace function realtime.topic()
returns text
language sql
stable
as $function$
  select nullif(current_setting('realtime.topic', true), '')
$function$;

create or replace function realtime.broadcast_changes(
  p_topic text,
  p_event text,
  p_operation text,
  p_table_name text,
  p_table_schema text,
  p_new_record anyelement,
  p_old_record anyelement
)
returns void
language plpgsql
as $function$
begin
  insert into realtime.messages(topic,event,extension)
  values (p_topic,p_event,'broadcast');
end
$function$;

grant execute on function realtime.topic() to anon, authenticated;

-- Simulate the production V1 catalog so the V2 compatibility import is tested.
create schema if not exists ktk_private;
create table if not exists ktk_private.item_catalog (
  item_id text primary key,
  display_name text not null,
  item_type text not null,
  wear_slot text null,
  attack_bonus integer not null default 0,
  defense_bonus integer not null default 0,
  range_tiles numeric not null default 0.8,
  stamina_cost numeric not null default 0,
  attack_interval numeric not null default 0.5,
  max_durability integer not null default 0,
  durability_unit text null,
  two_handed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);
insert into ktk_private.item_catalog(
  item_id,display_name,item_type,attack_bonus,defense_bonus,range_tiles,
  stamina_cost,attack_interval,max_durability,durability_unit,metadata
) values (
  'test-v1-catalog-import','Item legado de teste','tool',7,2,1.25,
  4,0.75,55,'uses','{"imported_from_v1":true}'::jsonb
) on conflict(item_id) do nothing;
