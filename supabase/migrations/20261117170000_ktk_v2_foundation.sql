begin;

create table public.ktk_v2_worlds (
  id text primary key,
  world_seed bigint not null default 20261117,
  king_user_id uuid null references auth.users(id) on delete set null,
  crown_version bigint not null default 0,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ktk_v2_players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  world_id text not null references public.ktk_v2_worlds(id),
  display_name text not null check (char_length(display_name) between 2 and 24),
  appearance jsonb not null default '{}'::jsonb check (jsonb_typeof(appearance) = 'object'),
  clan_color text null,
  x double precision not null default 960,
  y double precision not null default 540,
  direction smallint not null default 2 check (direction between 0 and 3),
  is_alive boolean not null default true,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 1 check (revision >= 1),
  spawned_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  position_updated_at timestamptz not null default clock_timestamp(),
  movement_updated_at timestamptz not null default clock_timestamp()
);

create index ktk_v2_players_world_alive_idx
  on public.ktk_v2_players(world_id, is_alive, last_seen_at);

create table public.ktk_v2_entities (
  world_id text not null references public.ktk_v2_worlds(id),
  entity_id text not null,
  entity_type text not null check (entity_type in ('item','resource','enemy','obstacle','crown','projectile')),
  x double precision not null,
  y double precision not null,
  collision_radius double precision not null default 0 check (collision_radius >= 0),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(world_id, entity_id)
);

alter table public.ktk_v2_worlds enable row level security;
alter table public.ktk_v2_players enable row level security;
alter table public.ktk_v2_entities enable row level security;

revoke all on table public.ktk_v2_worlds from public, anon, authenticated;
revoke all on table public.ktk_v2_players from public, anon, authenticated;
revoke all on table public.ktk_v2_entities from public, anon, authenticated;

grant select on table public.ktk_v2_worlds to authenticated;
grant select on table public.ktk_v2_players to authenticated;
grant select on table public.ktk_v2_entities to authenticated;

create policy "KTK V2 worlds are visible to signed-in players"
  on public.ktk_v2_worlds for select to authenticated using (true);
create policy "KTK V2 players are visible inside the world"
  on public.ktk_v2_players for select to authenticated using (world_id = 'main');
create policy "KTK V2 entities are visible inside the world"
  on public.ktk_v2_entities for select to authenticated using (world_id = 'main');

insert into public.ktk_v2_worlds(id, world_seed)
values ('main', 20261117)
on conflict (id) do nothing;

insert into public.ktk_v2_entities(
  world_id, entity_id, entity_type, x, y, collision_radius, state
)
values (
  'main', 'crown-main', 'crown', 960, 540, 9,
  '{"status":"ground","unique":true}'::jsonb
)
on conflict (world_id, entity_id) do nothing;

create or replace function public.ktk_v2_broadcast_player_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform realtime.broadcast_changes(
    'v2:world:main',
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  return null;
end;
$function$;

create or replace function public.ktk_v2_broadcast_entity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform realtime.broadcast_changes(
    'v2:world:main',
    'ENTITY_' || TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  return null;
end;
$function$;

create or replace function public.ktk_v2_broadcast_world_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform realtime.broadcast_changes(
    'v2:world:main',
    'WORLD_UPDATE',
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  return null;
end;
$function$;

revoke all on function public.ktk_v2_broadcast_player_change() from public, anon, authenticated;
revoke all on function public.ktk_v2_broadcast_entity_change() from public, anon, authenticated;
revoke all on function public.ktk_v2_broadcast_world_change() from public, anon, authenticated;

create trigger ktk_v2_player_broadcast
after insert or update or delete on public.ktk_v2_players
for each row execute function public.ktk_v2_broadcast_player_change();

create trigger ktk_v2_entity_broadcast
after insert or update or delete on public.ktk_v2_entities
for each row execute function public.ktk_v2_broadcast_entity_change();

create trigger ktk_v2_world_broadcast
after update on public.ktk_v2_worlds
for each row execute function public.ktk_v2_broadcast_world_change();

drop policy if exists "KTK V2 clients can receive world broadcasts" on realtime.messages;
create policy "KTK V2 clients can receive world broadcasts"
on realtime.messages for select to authenticated
using (
  (select realtime.topic()) = 'v2:world:main'
  and extension = 'broadcast'
);

drop policy if exists "KTK V2 clients can receive world presence" on realtime.messages;
create policy "KTK V2 clients can receive world presence"
on realtime.messages for select to authenticated
using (
  (select realtime.topic()) = 'v2:world:main'
  and extension = 'presence'
);

drop policy if exists "KTK V2 clients can publish own presence" on realtime.messages;
create policy "KTK V2 clients can publish own presence"
on realtime.messages for insert to authenticated
with check (
  (select realtime.topic()) = 'v2:world:main'
  and extension = 'presence'
);

create or replace function public.ktk_v2_enter_world(
  p_display_name text,
  p_appearance jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_player public.ktk_v2_players;
  v_spawn_x double precision;
  v_spawn_y double precision;
  v_name text := left(btrim(coalesce(p_display_name, '')), 24);
  v_appearance jsonb;
  v_state jsonb := jsonb_build_object(
    'health', 100, 'max_health', 100,
    'stamina', 100, 'max_stamina', 100,
    'satiety', 99, 'hydration', 99, 'mana', 0,
    'inventory', jsonb_build_array(null, null),
    'wearables', jsonb_build_object(
      'head', null, 'chest', null, 'waist', null, 'legs', null, 'feet', null
    ),
    'moving', false, 'running', false, 'guarding', false
  );
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_name) < 2 then raise exception 'INVALID_DISPLAY_NAME'; end if;
  if p_appearance is not null and jsonb_typeof(p_appearance) <> 'object' then
    raise exception 'INVALID_APPEARANCE';
  end if;

  v_appearance := jsonb_build_object(
    'gender', case when p_appearance->>'gender' = 'female' then 'female' else 'male' end,
    'skin', case when p_appearance->>'skin' in ('light','amber','olive','taupe','bronze','brown','black')
      then p_appearance->>'skin' else 'brown' end,
    'eyes', case when p_appearance->>'eyes' in ('brown','blue','green','gray','amber','purple')
      then p_appearance->>'eyes' else 'brown' end,
    'hair', case when p_appearance->>'hair' in ('black','dark_brown','brown','chestnut','ginger','blonde','white')
      then p_appearance->>'hair' else 'dark_brown' end,
    'hairstyle', left(coalesce(nullif(p_appearance->>'hairstyle',''),'hair_pixie'), 100),
    'beard', left(coalesce(nullif(p_appearance->>'beard',''),'none'), 100),
    'mustache', left(coalesce(nullif(p_appearance->>'mustache',''),'none'), 100),
    'clothing', case
      when length(coalesce(p_appearance->>'clothing','')) = 7
        and left(coalesce(p_appearance->>'clothing',''),1) = '#'
        and translate(substr(coalesce(p_appearance->>'clothing',''),2),
          '0123456789abcdefABCDEF','') = ''
      then p_appearance->>'clothing'
      else '#e7e2c9'
    end

  perform 1 from public.ktk_v2_worlds where id = 'main' for update;
  if not found then raise exception 'WORLD_NOT_FOUND'; end if;

  select * into v_player
  from public.ktk_v2_players
  where user_id = v_uid
  for update;

  if found then
    if v_player.is_alive then
      return to_jsonb(v_player);
    end if;
    raise exception 'CHARACTER_ALREADY_DEAD_NEW_SESSION_REQUIRED';
  end if;

  select
    960 + cos(candidate * 2 * pi() / 16) * 120,
    540 + sin(candidate * 2 * pi() / 16) * 120
  into v_spawn_x, v_spawn_y
  from generate_series(0, 15) as candidate
  where not exists (
    select 1 from public.ktk_v2_players p
    where p.world_id = 'main' and p.is_alive
      and sqrt(power(p.x - (960 + cos(candidate * 2 * pi() / 16) * 120), 2)
             + power(p.y - (540 + sin(candidate * 2 * pi() / 16) * 120), 2)) < 52
  )
  order by candidate
  limit 1;

  if v_spawn_x is null then raise exception 'WORLD_SPAWN_FULL'; end if;

  insert into public.ktk_v2_players(
    user_id, world_id, display_name, appearance, x, y, direction,
    is_alive, state, revision, spawned_at, last_seen_at,
    position_updated_at, movement_updated_at
  )
  values (
    v_uid, 'main', v_name, v_appearance, v_spawn_x, v_spawn_y, 2,
    true, v_state, 1, clock_timestamp(), clock_timestamp(),
    clock_timestamp(), clock_timestamp()
  )
  returning * into v_player;

  return to_jsonb(v_player);
end;
$function$;

create or replace function public.ktk_v2_world_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_world public.ktk_v2_worlds;
  v_players jsonb;
  v_entities jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.ktk_v2_players
    where user_id = v_uid and world_id = 'main' and is_alive
  ) then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  select * into v_world from public.ktk_v2_worlds where id = 'main';
  select coalesce(jsonb_agg(to_jsonb(p) order by p.spawned_at), '[]'::jsonb)
    into v_players
  from public.ktk_v2_players p
  where p.world_id = 'main' and p.is_alive;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.entity_id), '[]'::jsonb)
    into v_entities
  from public.ktk_v2_entities e
  where e.world_id = 'main';

  return jsonb_build_object(
    'world', to_jsonb(v_world),
    'players', v_players,
    'entities', v_entities
  );
end;
$function$;

create or replace function public.ktk_v2_step_player(
  p_input_x smallint,
  p_input_y smallint,
  p_running boolean default false,
  p_guarding boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_player public.ktk_v2_players;
  v_other public.ktk_v2_players;
  v_entity public.ktk_v2_entities;
  v_state jsonb;
  v_moving boolean;
  v_running boolean;
  v_guarding boolean;
  v_direction smallint;
  v_elapsed double precision;
  v_speed double precision;
  v_length double precision;
  v_dx double precision := 0;
  v_dy double precision := 0;
  v_next_x double precision;
  v_next_y double precision;
  v_old_distance double precision;
  v_new_distance double precision;
  v_blocked boolean;
  v_now timestamptz;
  v_stamina numeric;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce(p_input_x, 0) not between -1 and 1
     or coalesce(p_input_y, 0) not between -1 and 1 then
    raise exception 'INVALID_MOVEMENT_INPUT';
  end if;

  perform pg_catalog.set_config('lock_timeout', '500ms', true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));

  select * into v_player
  from public.ktk_v2_players
  where user_id = v_uid and world_id = 'main' and is_alive
  for update;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  v_now := clock_timestamp();
  v_state := coalesce(v_player.state, '{}'::jsonb);
  v_stamina := greatest(0, coalesce((v_state->>'stamina')::numeric, 100));
  v_moving := coalesce(p_input_x,0) <> 0 or coalesce(p_input_y,0) <> 0;
  v_running := coalesce(p_running,false) and v_moving and v_stamina > 0;
  v_guarding := coalesce(p_guarding,false) and not v_moving;

  if v_moving then
    if abs(coalesce(p_input_x,0)) > abs(coalesce(p_input_y,0)) then
      v_direction := case when p_input_x > 0 then 3 else 1 end;
    else
      v_direction := case when p_input_y > 0 then 2 else 0 end;
    end if;

    v_length := sqrt(power(coalesce(p_input_x,0)::double precision,2)
                   + power(coalesce(p_input_y,0)::double precision,2));
    v_elapsed := least(0.20, greatest(0,
      extract(epoch from (v_now - v_player.movement_updated_at))));
    v_speed := case when v_running then 337.5 else 225.0 end;
    v_dx := (p_input_x::double precision / v_length) * v_speed * v_elapsed;
    v_dy := (p_input_y::double precision / v_length) * v_speed * v_elapsed;
  else
    v_direction := v_player.direction;
    v_elapsed := least(2.0, greatest(0,
      extract(epoch from (v_now - v_player.movement_updated_at))));
  end if;

  v_next_x := v_player.x + v_dx;
  for v_other in
    select * from public.ktk_v2_players
    where world_id = 'main' and user_id <> v_uid and is_alive
  loop
    v_old_distance := sqrt(power(v_player.x-v_other.x,2)+power(v_player.y-v_other.y,2));
    v_new_distance := sqrt(power(v_next_x-v_other.x,2)+power(v_player.y-v_other.y,2));
    if v_new_distance < 36 and v_new_distance + 0.01 < v_old_distance then
      v_next_x := v_player.x;
      exit;
    end if;
  end loop;

  for v_entity in
    select * from public.ktk_v2_entities
    where world_id = 'main' and entity_type = 'obstacle'
  loop
    v_old_distance := sqrt(power(v_player.x-v_entity.x,2)+power(v_player.y-v_entity.y,2));
    v_new_distance := sqrt(power(v_next_x-v_entity.x,2)+power(v_player.y-v_entity.y,2));
    if v_new_distance < 18 + v_entity.collision_radius
       and v_new_distance + 0.01 < v_old_distance then
      v_next_x := v_player.x;
      exit;
    end if;
  end loop;

  v_next_y := v_player.y + v_dy;
  for v_other in
    select * from public.ktk_v2_players
    where world_id = 'main' and user_id <> v_uid and is_alive
  loop
    v_old_distance := sqrt(power(v_next_x-v_other.x,2)+power(v_player.y-v_other.y,2));
    v_new_distance := sqrt(power(v_next_x-v_other.x,2)+power(v_next_y-v_other.y,2));
    if v_new_distance < 36 and v_new_distance + 0.01 < v_old_distance then
      v_next_y := v_player.y;
      exit;
    end if;
  end loop;

  for v_entity in
    select * from public.ktk_v2_entities
    where world_id = 'main' and entity_type = 'obstacle'
  loop
    v_old_distance := sqrt(power(v_next_x-v_entity.x,2)+power(v_player.y-v_entity.y,2));
    v_new_distance := sqrt(power(v_next_x-v_entity.x,2)+power(v_next_y-v_entity.y,2));
    if v_new_distance < 18 + v_entity.collision_radius
       and v_new_distance + 0.01 < v_old_distance then
      v_next_y := v_player.y;
      exit;
    end if;
  end loop;

  if v_running then
    v_stamina := greatest(0, v_stamina - (v_elapsed * 2));
  elsif not v_moving then
    v_stamina := least(100, v_stamina + (v_elapsed * 1));
  end if;

  v_state := jsonb_set(v_state, '{moving}', to_jsonb(v_moving), true);
  v_state := jsonb_set(v_state, '{running}', to_jsonb(v_running), true);
  v_state := jsonb_set(v_state, '{guarding}', to_jsonb(v_guarding), true);
  v_state := jsonb_set(v_state, '{stamina}', to_jsonb(round(v_stamina,2)), true);

  update public.ktk_v2_players
  set x = v_next_x,
      y = v_next_y,
      direction = v_direction,
      state = v_state,
      revision = revision + 1,
      last_seen_at = v_now,
      position_updated_at = v_now,
      movement_updated_at = v_now
  where user_id = v_uid and world_id = 'main'
  returning * into v_player;

  return to_jsonb(v_player);
end;
$function$;

create or replace function public.ktk_v2_leave_world()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_player public.ktk_v2_players;
  v_state jsonb;
  v_was_king boolean := false;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'AUTH_REQUIRED'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));
  perform 1 from public.ktk_v2_worlds where id = 'main' for update;

  select * into v_player
  from public.ktk_v2_players
  where user_id = v_uid and world_id = 'main'
  for update;

  if not found or not v_player.is_alive then
    return jsonb_build_object('ok', true, 'already_dead', true);
  end if;

  select (king_user_id = v_uid) into v_was_king
  from public.ktk_v2_worlds where id = 'main';

  v_state := coalesce(v_player.state, '{}'::jsonb);

  -- Inventory actions and drops are implemented in the following V2 stage.
  -- The base character is empty, so ending this first test character is lossless.
  v_state := jsonb_set(v_state, '{inventory}', '[null,null]'::jsonb, true);
  v_state := jsonb_set(v_state, '{wearables}',
    '{"head":null,"chest":null,"waist":null,"legs":null,"feet":null}'::jsonb, true);
  v_state := jsonb_set(v_state, '{health}', '0'::jsonb, true);
  v_state := jsonb_set(v_state, '{moving}', 'false'::jsonb, true);
  v_state := jsonb_set(v_state, '{running}', 'false'::jsonb, true);
  v_state := jsonb_set(v_state, '{guarding}', 'false'::jsonb, true);

  update public.ktk_v2_players
  set is_alive = false,
      state = v_state,
      revision = revision + 1,
      last_seen_at = clock_timestamp(),
      position_updated_at = clock_timestamp()
  where user_id = v_uid and world_id = 'main';

  if v_was_king then
    update public.ktk_v2_worlds
    set king_user_id = null, crown_version = crown_version + 1, revision = revision + 1,
        updated_at = clock_timestamp()
    where id = 'main' and king_user_id = v_uid;

    update public.ktk_v2_entities
    set x = v_player.x,
        y = v_player.y,
        state = '{"status":"ground","unique":true}'::jsonb,
        revision = revision + 1,
        updated_at = clock_timestamp()
    where world_id = 'main' and entity_id = 'crown-main';
  end if;

  return jsonb_build_object('ok', true, 'dead', true);
end;
$function$;

create or replace function public.ktk_v2_claim_crown()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_player public.ktk_v2_players;
  v_world public.ktk_v2_worlds;
  v_crown public.ktk_v2_entities;
  v_distance double precision;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  -- A single lock order protects crown ownership against claims and exits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));
  select * into v_world
  from public.ktk_v2_worlds where id = 'main' for update;
  if not found then raise exception 'WORLD_NOT_FOUND'; end if;
  if v_world.king_user_id is not null then raise exception 'CROWN_ALREADY_CLAIMED'; end if;

  select * into v_player
  from public.ktk_v2_players
  where user_id = v_uid and world_id = 'main' and is_alive
  for update;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  select * into v_crown
  from public.ktk_v2_entities
  where world_id = 'main' and entity_id = 'crown-main' and entity_type = 'crown'
  for update;
  if not found or coalesce(v_crown.state->>'status','ground') <> 'ground' then
    raise exception 'CROWN_NOT_AVAILABLE';
  end if;

  v_distance := sqrt(power(v_player.x-v_crown.x,2)+power(v_player.y-v_crown.y,2));
  if v_distance > 64 then raise exception 'CROWN_TOO_FAR'; end if;

  update public.ktk_v2_worlds
  set king_user_id = v_uid,
      crown_version = crown_version + 1,
      revision = revision + 1,
      updated_at = clock_timestamp()
  where id = 'main'
  returning * into v_world;

  update public.ktk_v2_entities
  set state = jsonb_build_object('status','held','unique',true,'owner_id',v_uid::text),
      revision = revision + 1,
      updated_at = clock_timestamp()
  where world_id = 'main' and entity_id = 'crown-main'
  returning * into v_crown;

  return jsonb_build_object('ok',true,'world',to_jsonb(v_world),'crown',to_jsonb(v_crown));
end;
$function$;

revoke all on function public.ktk_v2_enter_world(text,jsonb) from public, anon;
revoke all on function public.ktk_v2_world_state() from public, anon;
revoke all on function public.ktk_v2_step_player(smallint,smallint,boolean,boolean) from public, anon;
revoke all on function public.ktk_v2_leave_world() from public, anon;
revoke all on function public.ktk_v2_claim_crown() from public, anon;

grant execute on function public.ktk_v2_enter_world(text,jsonb) to authenticated;
grant execute on function public.ktk_v2_world_state() to authenticated;
grant execute on function public.ktk_v2_step_player(smallint,smallint,boolean,boolean) to authenticated;
grant execute on function public.ktk_v2_leave_world() to authenticated;
grant execute on function public.ktk_v2_claim_crown() to authenticated;


commit;

      then p_appearance->>'clothing' else '#e7e2c9' end
  );

  perform 1 from public.ktk_v2_worlds where id = 'main' for update;
  if not found then raise exception 'WORLD_NOT_FOUND'; end if;

  select * into v_player
  from public.ktk_v2_players
  where user_id = v_uid
  for update;

  if found then
    if v_player.is_alive then
      return to_jsonb(v_player);
    end if;
    raise exception 'CHARACTER_ALREADY_DEAD_NEW_SESSION_REQUIRED';
  end if;

  select
    960 + cos(candidate * 2 * pi() / 16) * 120,
    540 + sin(candidate * 2 * pi() / 16) * 120
  into v_spawn_x, v_spawn_y
  from generate_series(0, 15) as candidate
  where not exists (
    select 1 from public.ktk_v2_players p
    where p.world_id = 'main' and p.is_alive
      and sqrt(power(p.x - (960 + cos(candidate * 2 * pi() / 16) * 120), 2)
             + power(p.y - (540 + sin(candidate * 2 * pi() / 16) * 120), 2)) < 52
  )
  order by candidate
  limit 1;

  if v_spawn_x is null then raise exception 'WORLD_SPAWN_FULL'; end if;

  insert into public.ktk_v2_players(
    user_id, world_id, display_name, appearance, x, y, direction,
    is_alive, state, revision, spawned_at, last_seen_at,
    position_updated_at, movement_updated_at
  )
  values (
    v_uid, 'main', v_name, v_appearance, v_spawn_x, v_spawn_y, 2,
    true, v_state, 1, clock_timestamp(), clock_timestamp(),
    clock_timestamp(), clock_timestamp()
  )
  returning * into v_player;

  return to_jsonb(v_player);
end;
$function$;

create or replace function public.ktk_v2_world_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_world public.ktk_v2_worlds;
  v_players jsonb;
  v_entities jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.ktk_v2_players
    where user_id = v_uid and world_id = 'main' and is_alive
  ) then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  select * into v_world from public.ktk_v2_worlds where id = 'main';
  select coalesce(jsonb_agg(to_jsonb(p) order by p.spawned_at), '[]'::jsonb)
    into v_players
  from public.ktk_v2_players p
  where p.world_id = 'main' and p.is_alive;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.entity_id), '[]'::jsonb)
    into v_entities
  from public.ktk_v2_entities e
  where e.world_id = 'main';

  return jsonb_build_object(
    'world', to_jsonb(v_world),
    'players', v_players,
    'entities', v_entities
  );
end;
$function$;

create or replace function public.ktk_v2_step_player(
  p_input_x smallint,
  p_input_y smallint,
  p_running boolean default false,
  p_guarding boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_player public.ktk_v2_players;
  v_other public.ktk_v2_players;
  v_entity public.ktk_v2_entities;
  v_state jsonb;
  v_moving boolean;
  v_running boolean;
  v_guarding boolean;
  v_direction smallint;
  v_elapsed double precision;
  v_speed double precision;
  v_length double precision;
  v_dx double precision := 0;
  v_dy double precision := 0;
  v_next_x double precision;
  v_next_y double precision;
  v_old_distance double precision;
  v_new_distance double precision;
  v_blocked boolean;
  v_now timestamptz;
  v_stamina numeric;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce(p_input_x, 0) not between -1 and 1
     or coalesce(p_input_y, 0) not between -1 and 1 then
    raise exception 'INVALID_MOVEMENT_INPUT';
  end if;

  perform pg_catalog.set_config('lock_timeout', '500ms', true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));

  select * into v_player
  from public.ktk_v2_players
  where user_id = v_uid and world_id = 'main' and is_alive
  for update;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  v_now := clock_timestamp();
  v_state := coalesce(v_player.state, '{}'::jsonb);
  v_stamina := greatest(0, coalesce((v_state->>'stamina')::numeric, 100));
  v_moving := coalesce(p_input_x,0) <> 0 or coalesce(p_input_y,0) <> 0;
  v_running := coalesce(p_running,false) and v_moving and v_stamina > 0;
  v_guarding := coalesce(p_guarding,false) and not v_moving;

  if v_moving then
    if abs(coalesce(p_input_x,0)) > abs(coalesce(p_input_y,0)) then
      v_direction := case when p_input_x > 0 then 3 else 1 end;
    else
      v_direction := case when p_input_y > 0 then 2 else 0 end;
    end if;

    v_length := sqrt(power(coalesce(p_input_x,0)::double precision,2)
                   + power(coalesce(p_input_y,0)::double precision,2));
    v_elapsed := least(0.20, greatest(0,
      extract(epoch from (v_now - v_player.movement_updated_at))));
    v_speed := case when v_running then 337.5 else 225.0 end;
    v_dx := (p_input_x::double precision / v_length) * v_speed * v_elapsed;
    v_dy := (p_input_y::double precision / v_length) * v_speed * v_elapsed;
  else
    v_direction := v_player.direction;
    v_elapsed := least(2.0, greatest(0,
      extract(epoch from (v_now - v_player.movement_updated_at))));
  end if;

  v_next_x := v_player.x + v_dx;
  for v_other in
    select * from public.ktk_v2_players
    where world_id = 'main' and user_id <> v_uid and is_alive
  loop
    v_old_distance := sqrt(power(v_player.x-v_other.x,2)+power(v_player.y-v_other.y,2));
    v_new_distance := sqrt(power(v_next_x-v_other.x,2)+power(v_player.y-v_other.y,2));
    if v_new_distance < 36 and v_new_distance + 0.01 < v_old_distance then
      v_next_x := v_player.x;
      exit;
    end if;
  end loop;

  for v_entity in
    select * from public.ktk_v2_entities
    where world_id = 'main' and entity_type = 'obstacle'
  loop
    v_old_distance := sqrt(power(v_player.x-v_entity.x,2)+power(v_player.y-v_entity.y,2));
    v_new_distance := sqrt(power(v_next_x-v_entity.x,2)+power(v_player.y-v_entity.y,2));
    if v_new_distance < 18 + v_entity.collision_radius
       and v_new_distance + 0.01 < v_old_distance then
      v_next_x := v_player.x;
      exit;
    end if;
  end loop;

  v_next_y := v_player.y + v_dy;
  for v_other in
    select * from public.ktk_v2_players
    where world_id = 'main' and user_id <> v_uid and is_alive
  loop
    v_old_distance := sqrt(power(v_next_x-v_other.x,2)+power(v_player.y-v_other.y,2));
    v_new_distance := sqrt(power(v_next_x-v_other.x,2)+power(v_next_y-v_other.y,2));
    if v_new_distance < 36 and v_new_distance + 0.01 < v_old_distance then
      v_next_y := v_player.y;
      exit;
    end if;
  end loop;

  for v_entity in
    select * from public.ktk_v2_entities
    where world_id = 'main' and entity_type = 'obstacle'
  loop
    v_old_distance := sqrt(power(v_next_x-v_entity.x,2)+power(v_player.y-v_entity.y,2));
    v_new_distance := sqrt(power(v_next_x-v_entity.x,2)+power(v_next_y-v_entity.y,2));
    if v_new_distance < 18 + v_entity.collision_radius
       and v_new_distance + 0.01 < v_old_distance then
      v_next_y := v_player.y;
      exit;
    end if;
  end loop;

  if v_running then
    v_stamina := greatest(0, v_stamina - (v_elapsed * 2));
  elsif not v_moving then
    v_stamina := least(100, v_stamina + (v_elapsed * 1));
  end if;

  v_state := jsonb_set(v_state, '{moving}', to_jsonb(v_moving), true);
  v_state := jsonb_set(v_state, '{running}', to_jsonb(v_running), true);
  v_state := jsonb_set(v_state, '{guarding}', to_jsonb(v_guarding), true);
  v_state := jsonb_set(v_state, '{stamina}', to_jsonb(round(v_stamina,2)), true);

  update public.ktk_v2_players
  set x = v_next_x,
      y = v_next_y,
      direction = v_direction,
      state = v_state,
      revision = revision + 1,
      last_seen_at = v_now,
      position_updated_at = v_now,
      movement_updated_at = v_now
  where user_id = v_uid and world_id = 'main'
  returning * into v_player;

  return to_jsonb(v_player);
end;
$function$;

create or replace function public.ktk_v2_leave_world()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_player public.ktk_v2_players;
  v_state jsonb;
  v_was_king boolean := false;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'AUTH_REQUIRED'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));
  perform 1 from public.ktk_v2_worlds where id = 'main' for update;

  select * into v_player
  from public.ktk_v2_players
  where user_id = v_uid and world_id = 'main'
  for update;

  if not found or not v_player.is_alive then
    return jsonb_build_object('ok', true, 'already_dead', true);
  end if;

  select (king_user_id = v_uid) into v_was_king
  from public.ktk_v2_worlds where id = 'main';

  v_state := coalesce(v_player.state, '{}'::jsonb);

  -- Inventory actions and drops are implemented in the following V2 stage.
  -- The base character is empty, so ending this first test character is lossless.
  v_state := jsonb_set(v_state, '{inventory}', '[null,null]'::jsonb, true);
  v_state := jsonb_set(v_state, '{wearables}',
    '{"head":null,"chest":null,"waist":null,"legs":null,"feet":null}'::jsonb, true);
  v_state := jsonb_set(v_state, '{health}', '0'::jsonb, true);
  v_state := jsonb_set(v_state, '{moving}', 'false'::jsonb, true);
  v_state := jsonb_set(v_state, '{running}', 'false'::jsonb, true);
  v_state := jsonb_set(v_state, '{guarding}', 'false'::jsonb, true);

  update public.ktk_v2_players
  set is_alive = false,
      state = v_state,
      revision = revision + 1,
      last_seen_at = clock_timestamp(),
      position_updated_at = clock_timestamp()
  where user_id = v_uid and world_id = 'main';

  if v_was_king then
    update public.ktk_v2_worlds
    set king_user_id = null, crown_version = crown_version + 1, revision = revision + 1,
        updated_at = clock_timestamp()
    where id = 'main' and king_user_id = v_uid;

    update public.ktk_v2_entities
    set x = v_player.x,
        y = v_player.y,
        state = '{"status":"ground","unique":true}'::jsonb,
        revision = revision + 1,
        updated_at = clock_timestamp()
    where world_id = 'main' and entity_id = 'crown-main';
  end if;

  return jsonb_build_object('ok', true, 'dead', true);
end;
$function$;

create or replace function public.ktk_v2_claim_crown()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_player public.ktk_v2_players;
  v_world public.ktk_v2_worlds;
  v_crown public.ktk_v2_entities;
  v_distance double precision;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  -- A single lock order protects crown ownership against claims and exits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));
  select * into v_world
  from public.ktk_v2_worlds where id = 'main' for update;
  if not found then raise exception 'WORLD_NOT_FOUND'; end if;
  if v_world.king_user_id is not null then raise exception 'CROWN_ALREADY_CLAIMED'; end if;

  select * into v_player
  from public.ktk_v2_players
  where user_id = v_uid and world_id = 'main' and is_alive
  for update;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  select * into v_crown
  from public.ktk_v2_entities
  where world_id = 'main' and entity_id = 'crown-main' and entity_type = 'crown'
  for update;
  if not found or coalesce(v_crown.state->>'status','ground') <> 'ground' then
    raise exception 'CROWN_NOT_AVAILABLE';
  end if;

  v_distance := sqrt(power(v_player.x-v_crown.x,2)+power(v_player.y-v_crown.y,2));
  if v_distance > 64 then raise exception 'CROWN_TOO_FAR'; end if;

  update public.ktk_v2_worlds
  set king_user_id = v_uid,
      crown_version = crown_version + 1,
      revision = revision + 1,
      updated_at = clock_timestamp()
  where id = 'main'
  returning * into v_world;

  update public.ktk_v2_entities
  set state = jsonb_build_object('status','held','unique',true,'owner_id',v_uid::text),
      revision = revision + 1,
      updated_at = clock_timestamp()
  where world_id = 'main' and entity_id = 'crown-main'
  returning * into v_crown;

  return jsonb_build_object('ok',true,'world',to_jsonb(v_world),'crown',to_jsonb(v_crown));
end;
$function$;

revoke all on function public.ktk_v2_enter_world(text,jsonb) from public, anon;
revoke all on function public.ktk_v2_world_state() from public, anon;
revoke all on function public.ktk_v2_step_player(smallint,smallint,boolean,boolean) from public, anon;
revoke all on function public.ktk_v2_leave_world() from public, anon;
revoke all on function public.ktk_v2_claim_crown() from public, anon;

grant execute on function public.ktk_v2_enter_world(text,jsonb) to authenticated;
grant execute on function public.ktk_v2_world_state() to authenticated;
grant execute on function public.ktk_v2_step_player(smallint,smallint,boolean,boolean) to authenticated;
grant execute on function public.ktk_v2_leave_world() to authenticated;
grant execute on function public.ktk_v2_claim_crown() to authenticated;


commit;
