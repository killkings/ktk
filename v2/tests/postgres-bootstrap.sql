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
