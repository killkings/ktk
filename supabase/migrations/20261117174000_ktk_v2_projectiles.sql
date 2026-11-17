begin;

create or replace function public.ktk_v2_launch_projectile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_player public.ktk_v2_players;
  v_item_def public.ktk_v2_item_catalog;
  v_state jsonb;
  v_inventory jsonb;
  v_item jsonb;
  v_ammo jsonb;
  v_slot integer;
  v_ammo_slot integer:=-1;
  v_i integer;
  v_quantity integer;
  v_durability integer;
  v_direction integer;
  v_vx double precision;
  v_vy double precision;
  v_projectile_id text;
  v_projectile_type text;
  v_speed numeric;
  v_max_distance numeric;
  v_stamina_cost numeric;
  v_mana_cost numeric;
  v_attack integer;
  v_now timestamptz:=clock_timestamp();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_catalog.set_config('lock_timeout','500ms',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));

  select * into v_player
  from public.ktk_v2_players
  where user_id=v_uid and world_id='main' and is_alive
  for update;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  v_state:=coalesce(v_player.state,'{}'::jsonb);
  v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
  v_slot:=greatest(0,least(jsonb_array_length(v_inventory)-1,coalesce((v_state->>'selected_slot')::integer,0)));
  v_item:=v_inventory->v_slot;
  if v_item is null or v_item='null'::jsonb then raise exception 'PROJECTILE_WEAPON_REQUIRED'; end if;

  select * into v_item_def from public.ktk_v2_item_catalog
  where item_id=v_item->>'item_id';
  if not found or v_item_def.item_type not in ('ranged','magic') then
    raise exception 'INVALID_PROJECTILE_WEAPON';
  end if;

  if nullif(v_state->>'next_attack_at','') is not null
     and (v_state->>'next_attack_at')::timestamptz>v_now then
    raise exception 'ATTACK_COOLDOWN';
  end if;

  v_stamina_cost:=greatest(0,coalesce(v_item_def.stamina_cost,0));
  v_mana_cost:=greatest(0,coalesce((v_item_def.metadata->>'mana_cost')::numeric,0));
  if coalesce((v_state->>'stamina')::numeric,100)<v_stamina_cost then
    raise exception 'NOT_ENOUGH_STAMINA';
  end if;
  if coalesce((v_state->>'mana')::numeric,0)<v_mana_cost then
    raise exception 'NOT_ENOUGH_MANA';
  end if;

  if coalesce(v_item_def.metadata->>'ammo','')='arrow' then
    for v_i in 0..jsonb_array_length(v_inventory)-1 loop
      if v_inventory->v_i<>'null'::jsonb
         and v_inventory->v_i->>'item_id'='equipment-arrow' then
        v_ammo_slot:=v_i;
        exit;
      end if;
    end loop;
    if v_ammo_slot<0 then raise exception 'AMMO_REQUIRED'; end if;
    v_ammo:=v_inventory->v_ammo_slot;
    v_quantity:=greatest(1,coalesce((v_ammo->>'quantity')::integer,1))-1;
    if v_quantity<=0 then
      v_inventory:=jsonb_set(v_inventory,array[v_ammo_slot::text],'null'::jsonb,true);
    else
      v_inventory:=jsonb_set(v_inventory,array[v_ammo_slot::text],
        jsonb_set(v_ammo,'{quantity}',to_jsonb(v_quantity),true),true);
    end if;
  end if;

  if v_item_def.max_durability>0 and v_item_def.durability_unit is not null then
    v_durability:=greatest(0,coalesce((v_item->>'durability')::integer,v_item_def.max_durability)-1);
    if v_durability<=0 then
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],'null'::jsonb,true);
    else
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],
        jsonb_set(v_item,'{durability}',to_jsonb(v_durability),true),true);
    end if;
  end if;

  v_direction:=v_player.direction;
  v_vx:=case v_direction when 1 then -1 when 3 then 1 else 0 end;
  v_vy:=case v_direction when 0 then -1 when 2 then 1 else 0 end;
  v_projectile_type:=case
    when v_item_def.item_id ilike '%boomerang%' then 'boomerang'
    when v_item_def.item_type='magic' then 'magic'
    else 'arrow'
  end;
  v_speed:=coalesce((v_item_def.metadata->>'projectile_speed')::numeric,
    case v_projectile_type when 'boomerang' then 480 when 'magic' then 620 else 720 end);
  v_max_distance:=greatest(72,coalesce(v_item_def.range_tiles,6)*72);
  v_attack:=greatest(1,round(coalesce((v_state->>'attack')::numeric,10)+v_item_def.attack_bonus)::integer);
  v_projectile_id:='projectile-'||gen_random_uuid()::text;

  v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
  v_state:=jsonb_set(v_state,'{stamina}',
    to_jsonb(greatest(0,coalesce((v_state->>'stamina')::numeric,100)-v_stamina_cost)),true);
  v_state:=jsonb_set(v_state,'{mana}',
    to_jsonb(greatest(0,coalesce((v_state->>'mana')::numeric,0)-v_mana_cost)),true);
  v_state:=jsonb_set(v_state,'{next_attack_at}',
    to_jsonb(v_now+make_interval(secs=>greatest(0.3,v_item_def.attack_interval)::double precision)),true);
  v_state:=jsonb_set(v_state,'{last_attack_at}',to_jsonb(v_now),true);
  v_state:=jsonb_set(v_state,'{last_attack_direction}',to_jsonb(v_direction),true);
  v_state:=jsonb_set(v_state,'{last_attack_type}',to_jsonb(v_projectile_type),true);
  v_state:=jsonb_set(v_state,'{last_attack_weapon_id}',to_jsonb(v_item_def.item_id),true);

  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main',v_projectile_id,'projectile',
    v_player.x+v_vx*18,v_player.y+v_vy*18,6,
    jsonb_build_object(
      'owner_id',v_uid::text,
      'owner_clan_color',v_player.clan_color,
      'weapon_id',v_item_def.item_id,
      'projectile_type',v_projectile_type,
      'vector_x',v_vx,'vector_y',v_vy,
      'speed',v_speed,'max_distance',v_max_distance,
      'distance',0,'damage',v_attack,'direction',v_direction,
      'phase','outbound','created_at',v_now,'last_tick_at',v_now,'ttl',15
    ),1
  );

  update public.ktk_v2_players
  set state=v_state,revision=revision+1
  where user_id=v_uid and world_id='main'
  returning * into v_player;

  return jsonb_build_object('ok',true,'projectile_id',v_projectile_id,
    'projectile_type',v_projectile_type,'state',v_state,'attacker',to_jsonb(v_player));
end;
$function$;

create or replace function public.ktk_v2_attack()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_player public.ktk_v2_players;
  v_target public.ktk_v2_players;
  v_enemy public.ktk_v2_entities;
  v_world public.ktk_v2_worlds;
  v_inventory jsonb;
  v_state jsonb;
  v_target_state jsonb;
  v_item jsonb;
  v_item_def public.ktk_v2_item_catalog;
  v_direction integer;
  v_vx double precision;
  v_vy double precision;
  v_range double precision:=54;
  v_cost numeric:=4;
  v_interval numeric:=0.55;
  v_attack integer:=6;
  v_defense integer:=0;
  v_damage integer:=0;
  v_health numeric:=0;
  v_hit_result jsonb;
  v_target_id text;
  v_target_type text:='';
  v_blocked boolean:=false;
  v_next_x double precision;
  v_next_y double precision;
  v_distance double precision;
  v_forward double precision;
  v_sideways double precision;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_catalog.set_config('lock_timeout','500ms',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));

  select * into v_world from public.ktk_v2_worlds where id='main' for update;
  select * into v_player from public.ktk_v2_players
  where user_id=v_uid and world_id='main' and is_alive for update;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  v_state:=coalesce(v_player.state,'{}'::jsonb);
  v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
  v_direction:=v_player.direction;
  v_vx:=case v_direction when 1 then -1 when 3 then 1 else 0 end;
  v_vy:=case v_direction when 0 then -1 when 2 then 1 else 0 end;

  if v_inventory->greatest(0,least(jsonb_array_length(v_inventory)-1,coalesce((v_state->>'selected_slot')::integer,0)))<>'null'::jsonb then
    v_item:=v_inventory->greatest(0,least(jsonb_array_length(v_inventory)-1,coalesce((v_state->>'selected_slot')::integer,0)));
    select * into v_item_def from public.ktk_v2_item_catalog where item_id=v_item->>'item_id';
    if found then
      if v_item_def.item_type in ('ranged','magic') then return public.ktk_v2_launch_projectile(); end if;
      v_attack:=greatest(1,coalesce((v_state->>'attack')::integer,10)+v_item_def.attack_bonus);
      v_range:=greatest(0.75,v_item_def.range_tiles)*72;
      v_cost:=greatest(1,v_item_def.stamina_cost);
      v_interval:=greatest(0.3,v_item_def.attack_interval);
    end if;
  end if;

  if nullif(v_state->>'next_attack_at','') is not null
     and (v_state->>'next_attack_at')::timestamptz>clock_timestamp() then
    raise exception 'ATTACK_COOLDOWN';
  end if;
  if coalesce((v_state->>'stamina')::numeric,100)<v_cost then raise exception 'NOT_ENOUGH_STAMINA'; end if;

  if v_world.king_user_id is not null then
    select * into v_target
    from public.ktk_v2_players p
    where p.world_id='main' and p.is_alive and p.user_id<>v_uid
      and not (
        p.user_id=v_world.king_user_id
        and v_player.clan_color is not null
        and p.clan_color=v_player.clan_color
      )
      and ((p.x-v_player.x)*v_vx+(p.y-v_player.y)*v_vy)>0
      and ((p.x-v_player.x)*v_vx+(p.y-v_player.y)*v_vy)<=v_range+18
      and abs((p.x-v_player.x)*v_vy-(p.y-v_player.y)*v_vx)<=32
    order by sqrt(power(p.x-v_player.x,2)+power(p.y-v_player.y,2))
    limit 1 for update skip locked;
  else
    select * into v_target
    from public.ktk_v2_players p
    where p.world_id='main' and p.is_alive and p.user_id<>v_uid
      and ((p.x-v_player.x)*v_vx+(p.y-v_player.y)*v_vy)>0
      and ((p.x-v_player.x)*v_vx+(p.y-v_player.y)*v_vy)<=v_range+18
      and abs((p.x-v_player.x)*v_vy-(p.y-v_player.y)*v_vx)<=32
    order by sqrt(power(p.x-v_player.x,2)+power(p.y-v_player.y,2))
    limit 1 for update skip locked;
  end if;

  v_state:=jsonb_set(v_state,'{stamina}',to_jsonb(greatest(0,coalesce((v_state->>'stamina')::numeric,100)-v_cost)),true);
  v_state:=jsonb_set(v_state,'{next_attack_at}',to_jsonb(clock_timestamp()+make_interval(secs=>v_interval::double precision)),true);
  v_state:=jsonb_set(v_state,'{last_attack_at}',to_jsonb(clock_timestamp()),true);
  v_state:=jsonb_set(v_state,'{last_attack_direction}',to_jsonb(v_direction),true);
  v_state:=jsonb_set(v_state,'{last_attack_type}',to_jsonb(case when v_item_def.item_id is null then 'punch' else 'slash' end),true);
  update public.ktk_v2_players
  set state=v_state,revision=revision+1
  where user_id=v_uid and world_id='main'
  returning * into v_player;

  if found and v_target.user_id is not null then
    v_target_type:='player';
    v_hit_result:=ktk_v2_private.apply_player_hit(
      v_target.user_id,v_attack,v_vx,v_vy
    );
    v_damage:=coalesce((v_hit_result->>'damage')::integer,0);
    v_health:=coalesce((v_hit_result->>'health')::numeric,0);
    select * into v_target
    from public.ktk_v2_players
    where user_id=v_target.user_id and world_id='main';
    return jsonb_build_object('ok',true,'hit',true,'target_type',v_target_type,
      'damage',v_damage,'target',to_jsonb(v_target),'attacker',to_jsonb(v_player));
  end if;

  select * into v_enemy
  from public.ktk_v2_entities e
  where e.world_id='main' and e.entity_type='enemy'
    and coalesce((e.state->>'defeated')::boolean,false)=false
    and ((e.x-v_player.x)*v_vx+(e.y-v_player.y)*v_vy)>0
    and ((e.x-v_player.x)*v_vx+(e.y-v_player.y)*v_vy)<=v_range+14
    and abs((e.x-v_player.x)*v_vy-(e.y-v_player.y)*v_vx)<=34
  order by sqrt(power(e.x-v_player.x,2)+power(e.y-v_player.y,2))
  limit 1 for update skip locked;

  if found then
    v_target_type:='enemy';
    v_health:=greatest(0,coalesce((v_enemy.state->>'health')::numeric,50));
    v_defense:=greatest(0,coalesce((v_enemy.state->>'defense')::integer,0));
    v_damage:=greatest(1,round(v_attack*10.0/(10.0+v_defense))::integer);
    v_health:=greatest(0,v_health-v_damage);
    update public.ktk_v2_entities
    set x=x+v_vx*10,y=y+v_vy*10,
        state=state||jsonb_build_object('health',v_health,'defeated',v_health<=0,
          'last_hit_by',v_uid::text,'last_hit_at',clock_timestamp()),
        revision=revision+1,updated_at=clock_timestamp()
    where world_id='main' and entity_id=v_enemy.entity_id
    returning * into v_enemy;
    if v_health<=0 then
      insert into public.ktk_v2_entities(
        world_id,entity_id,entity_type,x,y,collision_radius,state,revision
      ) values (
        'main','drop-'||gen_random_uuid()::text,'item',
        v_enemy.x+20,v_enemy.y+12,5,
        jsonb_build_object('status','ground','item_id','resource-bone',
          'display_name','Osso','quantity',2,
          'expires_at',clock_timestamp()+interval '15 minutes'),1
      );
    end if;
    return jsonb_build_object('ok',true,'hit',true,'target_type',v_target_type,
      'damage',v_damage,'target',to_jsonb(v_enemy),'attacker',to_jsonb(v_player));
  end if;

  return jsonb_build_object('ok',true,'hit',false,'reason','NO_TARGET','attacker',to_jsonb(v_player));
end;
$function$;create or replace function ktk_v2_private.projectile_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz:=clock_timestamp();
  v_world public.ktk_v2_worlds;
  v_projectile public.ktk_v2_entities;
  v_owner public.ktk_v2_players;
  v_target public.ktk_v2_players;
  v_enemy public.ktk_v2_entities;
  v_state jsonb;
  v_owner_id uuid;
  v_projectile_type text;
  v_phase text;
  v_speed double precision;
  v_max_distance double precision;
  v_damage integer;
  v_dt double precision;
  v_vx double precision;
  v_vy double precision;
  v_dx double precision;
  v_dy double precision;
  v_end_x double precision;
  v_end_y double precision;
  v_len2 double precision;
  v_t double precision;
  v_cx double precision;
  v_cy double precision;
  v_distance double precision;
  v_step double precision;
  v_hit boolean;
  v_health numeric;
  v_defense integer;
  v_ttl double precision;
begin
  perform pg_catalog.set_config('lock_timeout','750ms',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));
  select * into v_world from public.ktk_v2_worlds where id='main' for update;
  if not found then return; end if;

  for v_projectile in
    select * from public.ktk_v2_entities
    where world_id='main' and entity_type='projectile'
    order by updated_at,entity_id
    for update skip locked
  loop
    v_state:=coalesce(v_projectile.state,'{}'::jsonb);
    v_owner_id:=nullif(v_state->>'owner_id','')::uuid;
    v_projectile_type:=coalesce(v_state->>'projectile_type','arrow');
    v_phase:=coalesce(v_state->>'phase','outbound');
    v_ttl:=greatest(1,coalesce((v_state->>'ttl')::numeric,15));
    if nullif(v_state->>'created_at','') is not null
       and extract(epoch from (v_now-(v_state->>'created_at')::timestamptz))>v_ttl then
      delete from public.ktk_v2_entities
      where world_id='main' and entity_id=v_projectile.entity_id;
      continue;
    end if;

    select * into v_owner from public.ktk_v2_players
    where user_id=v_owner_id and world_id='main' and is_alive
    for update;
    if not found then
      delete from public.ktk_v2_entities
      where world_id='main' and entity_id=v_projectile.entity_id;
      continue;
    end if;

    v_speed:=greatest(1,coalesce((v_state->>'speed')::double precision,620));
    v_max_distance:=greatest(1,coalesce((v_state->>'max_distance')::double precision,432));
    v_damage:=greatest(1,coalesce((v_state->>'damage')::integer,1));
    v_dt:=least(1.0,greatest(0,extract(epoch from (
      v_now-coalesce(nullif(v_state->>'last_tick_at','')::timestamptz,v_projectile.updated_at)
    ))));
    if v_dt<0.01 then continue; end if;

    if v_phase='return' and v_projectile_type='boomerang' then
      v_dx:=v_owner.x-v_projectile.x;
      v_dy:=v_owner.y-v_projectile.y;
      v_distance:=sqrt(power(v_dx,2)+power(v_dy,2));
      if v_distance<=24 then
        delete from public.ktk_v2_entities
        where world_id='main' and entity_id=v_projectile.entity_id;
        continue;
      end if;
      v_step:=least(v_distance,v_speed*v_dt);
      v_end_x:=v_projectile.x+(v_dx/nullif(v_distance,0))*v_step;
      v_end_y:=v_projectile.y+(v_dy/nullif(v_distance,0))*v_step;
      update public.ktk_v2_entities
      set x=v_end_x,y=v_end_y,
          state=v_state||jsonb_build_object(
            'vector_x',v_dx/nullif(v_distance,0),
            'vector_y',v_dy/nullif(v_distance,0),
            'distance',coalesce((v_state->>'distance')::numeric,0)+v_step,
            'last_tick_at',v_now
          ),
          revision=revision+1,updated_at=v_now
      where world_id='main' and entity_id=v_projectile.entity_id;
      continue;
    end if;

    v_vx:=coalesce((v_state->>'vector_x')::double precision,0);
    v_vy:=coalesce((v_state->>'vector_y')::double precision,0);
    v_dx:=v_vx*v_speed*v_dt;
    v_dy:=v_vy*v_speed*v_dt;
    v_len2:=power(v_dx,2)+power(v_dy,2);
    if v_len2<0.0001 then
      delete from public.ktk_v2_entities
      where world_id='main' and entity_id=v_projectile.entity_id;
      continue;
    end if;
    v_end_x:=v_projectile.x+v_dx;
    v_end_y:=v_projectile.y+v_dy;
    v_step:=sqrt(v_len2);
    v_hit:=false;

    -- Swept segment collision prevents fast arrows from skipping through targets.
    select * into v_target
    from public.ktk_v2_players p
    where p.world_id='main' and p.is_alive=true and p.user_id<>v_owner_id
      and p.last_seen_at>v_now-interval '30 seconds'
      and not (
        p.user_id=v_world.king_user_id
        and v_owner.clan_color is not null
        and p.clan_color=v_owner.clan_color
      )
      and sqrt(
        power(p.x-(v_projectile.x+
          greatest(0,least(1,((p.x-v_projectile.x)*v_dx+(p.y-v_projectile.y)*v_dy)/v_len2))*v_dx),2)
        +power(p.y-(v_projectile.y+
          greatest(0,least(1,((p.x-v_projectile.x)*v_dx+(p.y-v_projectile.y)*v_dy)/v_len2))*v_dy),2)
      )<=22
    order by sqrt(power(p.x-v_projectile.x,2)+power(p.y-v_projectile.y,2))
    limit 1 for update skip locked;

    if found then
      perform ktk_v2_private.apply_player_hit(v_target.user_id,v_damage,v_vx,v_vy);
      delete from public.ktk_v2_entities
      where world_id='main' and entity_id=v_projectile.entity_id;
      continue;
    end if;

    select * into v_enemy
    from public.ktk_v2_entities e
    where e.world_id='main' and e.entity_type='enemy'
      and coalesce((e.state->>'defeated')::boolean,false)=false
      and sqrt(
        power(e.x-(v_projectile.x+
          greatest(0,least(1,((e.x-v_projectile.x)*v_dx+(e.y-v_projectile.y)*v_dy)/v_len2))*v_dx),2)
        +power(e.y-(v_projectile.y+
          greatest(0,least(1,((e.x-v_projectile.x)*v_dx+(e.y-v_projectile.y)*v_dy)/v_len2))*v_dy),2)
      )<=e.collision_radius+6
    order by sqrt(power(e.x-v_projectile.x,2)+power(e.y-v_projectile.y,2))
    limit 1 for update skip locked;

    if found then
      v_health:=greatest(0,coalesce((v_enemy.state->>'health')::numeric,50));
      v_defense:=greatest(0,coalesce((v_enemy.state->>'defense')::integer,0));
      v_health:=greatest(0,v_health-greatest(1,round(v_damage*10.0/(10.0+v_defense))::integer));
      update public.ktk_v2_entities
      set state=state||jsonb_build_object(
          'health',v_health,'defeated',v_health<=0,
          'last_hit_by',v_owner_id::text,'last_hit_at',v_now
        ),
        revision=revision+1,updated_at=v_now
      where world_id='main' and entity_id=v_enemy.entity_id;
      if v_health<=0 then
        insert into public.ktk_v2_entities(
          world_id,entity_id,entity_type,x,y,collision_radius,state,revision
        ) values (
          'main','drop-'||gen_random_uuid()::text,'item',
          v_enemy.x+20,v_enemy.y+12,5,
          jsonb_build_object('status','ground','item_id','resource-bone',
            'display_name','Osso','quantity',2,
            'expires_at',v_now+interval '15 minutes'),1
        );
      end if;
      delete from public.ktk_v2_entities
      where world_id='main' and entity_id=v_projectile.entity_id;
      continue;
    end if;

    select exists(
      select 1 from public.ktk_v2_entities e
      where e.world_id='main' and e.entity_type='obstacle'
        and sqrt(
          power(e.x-(v_projectile.x+
            greatest(0,least(1,((e.x-v_projectile.x)*v_dx+(e.y-v_projectile.y)*v_dy)/v_len2))*v_dx),2)
          +power(e.y-(v_projectile.y+
            greatest(0,least(1,((e.x-v_projectile.x)*v_dx+(e.y-v_projectile.y)*v_dy)/v_len2))*v_dy),2)
        )<=e.collision_radius+6
    ) into v_hit;
    if v_hit then
      delete from public.ktk_v2_entities
      where world_id='main' and entity_id=v_projectile.entity_id;
      continue;
    end if;

    v_distance:=coalesce((v_state->>'distance')::double precision,0)+v_step;
    if v_distance>=v_max_distance then
      if v_projectile_type='boomerang' then
        v_dx:=v_owner.x-v_end_x;
        v_dy:=v_owner.y-v_end_y;
        v_distance:=sqrt(power(v_dx,2)+power(v_dy,2));
        if v_distance<=24 then
          delete from public.ktk_v2_entities
          where world_id='main' and entity_id=v_projectile.entity_id;
          continue;
        end if;
        update public.ktk_v2_entities
        set x=v_end_x,y=v_end_y,
            state=v_state||jsonb_build_object(
              'phase','return',
              'vector_x',v_dx/nullif(v_distance,0),
              'vector_y',v_dy/nullif(v_distance,0),
              'distance',v_max_distance,
              'last_tick_at',v_now
            ),
            revision=revision+1,updated_at=v_now
        where world_id='main' and entity_id=v_projectile.entity_id;
      else
        delete from public.ktk_v2_entities
        where world_id='main' and entity_id=v_projectile.entity_id;
      end if;
      continue;
    end if;

    update public.ktk_v2_entities
    set x=v_end_x,y=v_end_y,
        state=v_state||jsonb_build_object('distance',v_distance,'last_tick_at',v_now),
        revision=revision+1,updated_at=v_now
    where world_id='main' and entity_id=v_projectile.entity_id;
  end loop;
end;
$function$;

revoke all on function public.ktk_v2_launch_projectile() from public,anon;
grant execute on function public.ktk_v2_launch_projectile() to authenticated;
revoke all on function ktk_v2_private.projectile_tick() from public,anon,authenticated;

do $schedule_v2_projectiles$
begin
  if pg_catalog.to_regnamespace('cron') is not null then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = ''ktk-v2-projectile-simulation''';
    execute 'select cron.schedule(''ktk-v2-projectile-simulation'',''1 second'',''select ktk_v2_private.projectile_tick()'')';
  end if;
end;
$schedule_v2_projectiles$;

commit;
