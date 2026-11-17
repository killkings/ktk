begin;

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
  if coalesce((v_player.state->>'suspended')::boolean,false) then
    raise exception 'PLAYER_SUSPENDED';
  end if;

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
  v_inventory jsonb;
  v_slot integer;
  v_selected_item public.ktk_v2_item_catalog;
  v_has_shield boolean:=false;
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
  if coalesce((v_state->>'suspended')::boolean,false) then
    raise exception 'PLAYER_SUSPENDED';
  end if;
  v_inventory := coalesce(v_state->'inventory','[null,null]'::jsonb);
  v_stamina := greatest(0, coalesce((v_state->>'stamina')::numeric, 100));
  v_moving := coalesce(p_input_x,0) <> 0 or coalesce(p_input_y,0) <> 0;
  v_guarding := coalesce(p_guarding,false);
  v_running := coalesce(p_running,false) and v_moving and v_stamina > 0;

  if v_guarding then
    v_slot:=greatest(0,least(jsonb_array_length(v_inventory)-1,
      coalesce((v_state->>'selected_slot')::integer,0)));
    if v_inventory->v_slot<>'null'::jsonb then
      select * into v_selected_item
      from public.ktk_v2_item_catalog
      where item_id=v_inventory->v_slot->>'item_id';
      if found and v_selected_item.two_handed then
        raise exception 'TWO_HANDED_WEAPON_CANNOT_BLOCK';
      end if;
    end if;
    select exists(
      select 1
      from jsonb_array_elements(v_inventory) inv(item)
      join public.ktk_v2_item_catalog c on c.item_id=inv.item->>'item_id'
      where c.item_type='shield'
    ) into v_has_shield;
    if not v_has_shield then raise exception 'SHIELD_REQUIRED'; end if;
    if v_stamina<1 then raise exception 'NOT_ENOUGH_STAMINA'; end if;
  end if;

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
    v_speed := case
      when v_guarding then case when v_running then 168.75 else 112.5 end
      when v_running then 337.5
      else 225.0
    end;
    v_dx := (p_input_x::double precision / v_length) * v_speed * v_elapsed;
    v_dy := (p_input_y::double precision / v_length) * v_speed * v_elapsed;
  else
    v_direction := v_player.direction;
    -- Survival and stationary stamina recovery belong to the one-second server tick.
    v_elapsed := 0;
  end if;

  v_next_x := v_player.x + v_dx;
  for v_other in
    select * from public.ktk_v2_players
    where world_id = 'main' and user_id <> v_uid and is_alive
      and last_seen_at > v_now-interval '30 seconds'
      and not coalesce((state->>'suspended')::boolean,false)
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
    where world_id = 'main'
      and (
        entity_type='obstacle'
        or (entity_type='resource' and coalesce(state->>'status','ready')='ready')
        or (entity_type='enemy' and not coalesce((state->>'defeated')::boolean,false))
      )
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
      and last_seen_at > v_now-interval '30 seconds'
      and not coalesce((state->>'suspended')::boolean,false)
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
    where world_id = 'main'
      and (
        entity_type='obstacle'
        or (entity_type='resource' and coalesce(state->>'status','ready')='ready')
        or (entity_type='enemy' and not coalesce((state->>'defeated')::boolean,false))
      )
  loop
    v_old_distance := sqrt(power(v_next_x-v_entity.x,2)+power(v_player.y-v_entity.y,2));
    v_new_distance := sqrt(power(v_next_x-v_entity.x,2)+power(v_next_y-v_entity.y,2));
    if v_new_distance < 18 + v_entity.collision_radius
       and v_new_distance + 0.01 < v_old_distance then
      v_next_y := v_player.y;
      exit;
    end if;
  end loop;

  if v_guarding then
    v_stamina:=greatest(0,v_stamina-
      (case when v_moving and v_running then 4.0 else 2.0 end)*v_elapsed);
  elsif v_running then
    v_stamina:=greatest(0,v_stamina-2.0*v_elapsed);
  elsif v_moving then
    v_stamina:=greatest(0,v_stamina-1.0*v_elapsed);
  end if;
  if v_stamina<0.5 then
    v_guarding:=false;
    v_running:=false;
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

alter table public.ktk_v2_worlds
  add column if not exists last_simulation_at timestamptz not null default clock_timestamp();

create or replace function public.ktk_v2_item_action(
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_player public.ktk_v2_players;
  v_entity public.ktk_v2_entities;
  v_item_def public.ktk_v2_item_catalog;
  v_tool_def public.ktk_v2_item_catalog;
  v_state jsonb;
  v_inventory jsonb;
  v_wearables jsonb;
  v_item jsonb;
  v_old_item jsonb;
  v_slot integer;
  v_index integer;
  v_free_slot integer:=-1;
  v_wear_slot text;
  v_entity_id text;
  v_quantity integer;
  v_drop_quantity integer;
  v_efficiency numeric:=1;
  v_health numeric;
  v_required_tool text;
  v_drop_item_id text;
  v_drop_quantity_from_resource integer;
  v_stacked boolean:=false;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action not in ('pickup','drop','equip','unequip','consume','select_slot','harvest') then
    raise exception 'UNKNOWN_ITEM_ACTION';
  end if;

  perform pg_catalog.set_config('lock_timeout','500ms',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));

  select * into v_player from public.ktk_v2_players
  where user_id=v_uid and world_id='main' and is_alive for update;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  v_state:=coalesce(v_player.state,'{}'::jsonb);
  if coalesce((v_state->>'suspended')::boolean,false) then
    raise exception 'PLAYER_SUSPENDED';
  end if;
  v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
  v_wearables:=coalesce(v_state->'wearables','{"head":null,"chest":null,"waist":null,"legs":null,"feet":null}'::jsonb);

  if p_action='select_slot' then
    v_slot:=coalesce((p_payload->>'slot')::integer,-1);
    if v_slot not between 0 and jsonb_array_length(v_inventory)-1 then raise exception 'INVALID_SLOT'; end if;
    v_state:=jsonb_set(v_state,'{selected_slot}',to_jsonb(v_slot),true);
    if coalesce((v_state->>'guarding')::boolean,false)
       and v_inventory->v_slot<>'null'::jsonb then
      select * into v_item_def
      from public.ktk_v2_item_catalog
      where item_id=v_inventory->v_slot->>'item_id';
      if found and v_item_def.two_handed then
        v_state:=jsonb_set(v_state,'{guarding}','false'::jsonb,true);
      end if;
    end if;

  elsif p_action='pickup' then
    v_entity_id:=left(coalesce(p_payload->>'entity_id',''),120);
    select * into v_entity from public.ktk_v2_entities
    where world_id='main' and entity_id=v_entity_id and entity_type='item'
    for update;
    if not found or coalesce(v_entity.state->>'status','ground')<>'ground' then raise exception 'ITEM_NOT_AVAILABLE'; end if;
    if nullif(v_entity.state->>'expires_at','') is not null
       and (v_entity.state->>'expires_at')::timestamptz<=clock_timestamp() then
      raise exception 'ITEM_EXPIRED';
    end if;
    if sqrt(power(v_player.x-v_entity.x,2)+power(v_player.y-v_entity.y,2))>64 then
      raise exception 'ITEM_TOO_FAR';
    end if;
    select * into v_item_def from public.ktk_v2_item_catalog
    where item_id=v_entity.state->>'item_id';
    if not found then raise exception 'UNKNOWN_ITEM'; end if;

    v_item:=jsonb_build_object(
      'item_id',v_item_def.item_id,'displayName',v_item_def.display_name,
      'quantity',greatest(1,coalesce((v_entity.state->>'quantity')::integer,1)),
      'durability',coalesce((v_entity.state->>'durability')::integer,v_item_def.max_durability),
      'maxDurability',v_item_def.max_durability,
      'appearanceLayers',coalesce(v_item_def.metadata->'appearance_layers','[]'::jsonb),
      'itemType',v_item_def.item_type,'wearSlot',v_item_def.wear_slot,
      'attackBonus',v_item_def.attack_bonus,'defenseBonus',v_item_def.defense_bonus,
      'twoHanded',v_item_def.two_handed
    );
    v_wear_slot:=v_item_def.wear_slot;

    if v_item_def.item_type in ('apparel','armor') and v_wear_slot is not null
       and coalesce(v_wearables->v_wear_slot,'null'::jsonb)='null'::jsonb then
      v_wearables:=jsonb_set(v_wearables,array[v_wear_slot],v_item,true);
    else
      v_stacked:=false;
      if coalesce((v_item_def.metadata->>'stackable')::boolean,false) then
        for v_index in 0..jsonb_array_length(v_inventory)-1 loop
          if v_inventory->v_index<>'null'::jsonb
             and v_inventory->v_index->>'item_id'=v_item_def.item_id then
            v_old_item:=v_inventory->v_index;
            if coalesce((v_old_item->>'quantity')::integer,1)
               +coalesce((v_item->>'quantity')::integer,1)>99 then
              raise exception 'STACK_LIMIT';
            end if;
            v_item:=jsonb_set(v_old_item,'{quantity}',
              to_jsonb(coalesce((v_old_item->>'quantity')::integer,1)
                +coalesce((v_item->>'quantity')::integer,1)),true);
            v_inventory:=jsonb_set(v_inventory,array[v_index::text],v_item,true);
            v_stacked:=true;
            exit;
          end if;
        end loop;
      end if;
      if not v_stacked then
        v_free_slot:=-1;
        for v_index in 0..jsonb_array_length(v_inventory)-1 loop
          if v_inventory->v_index='null'::jsonb then v_free_slot:=v_index; exit; end if;
        end loop;
        if v_free_slot<0 then raise exception 'INVENTORY_FULL'; end if;
        v_inventory:=jsonb_set(v_inventory,array[v_free_slot::text],v_item,true);
      end if;
    end if;
    delete from public.ktk_v2_entities
    where world_id='main' and entity_id=v_entity_id;

  elsif p_action='drop' then
    v_slot:=coalesce((p_payload->>'slot')::integer,-1);
    if v_slot<0 or v_slot>=jsonb_array_length(v_inventory) then raise exception 'INVALID_SLOT'; end if;
    v_item:=v_inventory->v_slot;
    if v_item is null or v_item='null'::jsonb then raise exception 'EMPTY_SLOT'; end if;
    v_quantity:=greatest(1,coalesce((v_item->>'quantity')::integer,1));
    v_drop_quantity:=greatest(1,least(v_quantity,coalesce((p_payload->>'quantity')::integer,v_quantity)));
    if v_drop_quantity=v_quantity then
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],'null'::jsonb,true);
    else
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],
        jsonb_set(v_item,'{quantity}',to_jsonb(v_quantity-v_drop_quantity),true),true);
    end if;
    insert into public.ktk_v2_entities(
      world_id,entity_id,entity_type,x,y,collision_radius,state,revision
    ) values (
      'main','drop-'||gen_random_uuid()::text,'item',
      v_player.x+24,v_player.y+18,5,
      jsonb_build_object(
        'status','ground','item_id',v_item->>'item_id',
        'display_name',coalesce(v_item->>'displayName','Item'),
        'quantity',v_drop_quantity,
        'durability',coalesce((v_item->>'durability')::integer,0),
        'max_durability',coalesce((v_item->>'maxDurability')::integer,0),
        'expires_at',clock_timestamp()+make_interval(secs=>coalesce((select (settings->>'loot_ttl_seconds')::integer from public.ktk_v2_worlds where id='main'),900))
      ),1
    );

  elsif p_action='equip' then
    v_slot:=coalesce((p_payload->>'slot')::integer,-1);
    if v_slot<0 or v_slot>=jsonb_array_length(v_inventory) then raise exception 'INVALID_SLOT'; end if;
    v_item:=v_inventory->v_slot;
    if v_item is null or v_item='null'::jsonb then raise exception 'EMPTY_SLOT'; end if;
    select * into v_item_def from public.ktk_v2_item_catalog where item_id=v_item->>'item_id';
    if not found or v_item_def.wear_slot is null or v_item_def.item_type not in ('apparel','armor') then
      raise exception 'ITEM_NOT_EQUIPPABLE';
    end if;
    v_wear_slot:=v_item_def.wear_slot;
    v_old_item:=coalesce(v_wearables->v_wear_slot,'null'::jsonb);
    v_wearables:=jsonb_set(v_wearables,array[v_wear_slot],v_item,true);
    v_inventory:=jsonb_set(v_inventory,array[v_slot::text],v_old_item,true);

  elsif p_action='unequip' then
    v_wear_slot:=coalesce(p_payload->>'wear_slot','');
    if v_wear_slot not in ('head','chest','waist','legs','feet') then raise exception 'INVALID_WEAR_SLOT'; end if;
    v_item:=coalesce(v_wearables->v_wear_slot,'null'::jsonb);
    if v_item='null'::jsonb then raise exception 'EMPTY_WEAR_SLOT'; end if;
    v_free_slot:=-1;
    for v_index in 0..jsonb_array_length(v_inventory)-1 loop
      if v_inventory->v_index='null'::jsonb then v_free_slot:=v_index; exit; end if;
    end loop;
    if v_free_slot<0 then raise exception 'INVENTORY_FULL'; end if;
    v_inventory:=jsonb_set(v_inventory,array[v_free_slot::text],v_item,true);
    v_wearables:=jsonb_set(v_wearables,array[v_wear_slot],'null'::jsonb,true);

  elsif p_action='consume' then
    v_slot:=coalesce((p_payload->>'slot')::integer,-1);
    if v_slot<0 or v_slot>=jsonb_array_length(v_inventory) then raise exception 'INVALID_SLOT'; end if;
    v_item:=v_inventory->v_slot;
    select * into v_item_def from public.ktk_v2_item_catalog where item_id=v_item->>'item_id';
    if not found or v_item_def.item_type not in ('food','drink') then raise exception 'NOT_CONSUMABLE'; end if;
    if v_item_def.item_type='food' then
      v_state:=jsonb_set(v_state,'{satiety}',to_jsonb(least(99,coalesce((v_state->>'satiety')::numeric,0)+coalesce((v_item_def.metadata->>'satiety')::numeric,0))),true);
    else
      v_state:=jsonb_set(v_state,'{hydration}',to_jsonb(least(99,coalesce((v_state->>'hydration')::numeric,0)+coalesce((v_item_def.metadata->>'hydration')::numeric,0))),true);
    end if;
    v_quantity:=greatest(1,coalesce((v_item->>'quantity')::integer,1))-1;
    if v_quantity<=0 then
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],'null'::jsonb,true);
    else
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],
        jsonb_set(v_item,'{quantity}',to_jsonb(v_quantity),true),true);
    end if;

  elsif p_action='harvest' then
    v_entity_id:=left(coalesce(p_payload->>'entity_id',''),120);
    select * into v_entity from public.ktk_v2_entities
    where world_id='main' and entity_id=v_entity_id and entity_type='resource'
    for update;
    if not found or coalesce(v_entity.state->>'status','ready')<>'ready' then raise exception 'RESOURCE_DEPLETED'; end if;
    if sqrt(power(v_player.x-v_entity.x,2)+power(v_player.y-v_entity.y,2))>80 then raise exception 'RESOURCE_TOO_FAR'; end if;
    v_required_tool:=nullif(v_entity.state->>'required_tool','');
    if v_required_tool is not null then
      v_free_slot:=-1;
      for v_index in 0..jsonb_array_length(v_inventory)-1 loop
        if v_inventory->v_index->>'item_id'=v_required_tool then v_free_slot:=v_index; exit; end if;
      end loop;
      if v_free_slot<0 then raise exception 'REQUIRED_TOOL_MISSING'; end if;
      select * into v_tool_def from public.ktk_v2_item_catalog where item_id=v_required_tool;
      v_efficiency:=greatest(1,coalesce((v_tool_def.metadata->>'work_efficiency')::numeric,1));
      v_item:=v_inventory->v_free_slot;
      v_quantity:=greatest(0,coalesce((v_item->>'durability')::integer,v_tool_def.max_durability)-1);
      if v_quantity<=0 then
        v_inventory:=jsonb_set(v_inventory,array[v_free_slot::text],'null'::jsonb,true);
      else
        v_inventory:=jsonb_set(v_inventory,array[v_free_slot::text],
          jsonb_set(v_item,'{durability}',to_jsonb(v_quantity),true),true);
      end if;
    end if;
    v_health:=greatest(0,coalesce((v_entity.state->>'health')::numeric,1)-v_efficiency);
    v_drop_item_id:=coalesce(v_entity.state->>'drop_item_id','');
    v_drop_quantity_from_resource:=greatest(1,coalesce((v_entity.state->>'drop_quantity')::integer,1));
    if v_health<=0 then
      update public.ktk_v2_entities
      set state=state||jsonb_build_object('status','depleted','health',0,
            'respawn_at',clock_timestamp()+interval '5 minutes'),
          revision=revision+1,updated_at=clock_timestamp()
      where world_id='main' and entity_id=v_entity_id;
      if v_drop_item_id<>'' then
        insert into public.ktk_v2_entities(
          world_id,entity_id,entity_type,x,y,collision_radius,state,revision
        ) values (
          'main','drop-'||gen_random_uuid()::text,'item',
          v_entity.x+18,v_entity.y+12,5,
          jsonb_build_object('status','ground','item_id',v_drop_item_id,
            'display_name',(select display_name from public.ktk_v2_item_catalog where item_id=v_drop_item_id),
            'quantity',v_drop_quantity_from_resource,
            'expires_at',clock_timestamp()+interval '15 minutes'),1
        );
      end if;
    else
      update public.ktk_v2_entities
      set state=state||jsonb_build_object('health',v_health),
          revision=revision+1,updated_at=clock_timestamp()
      where world_id='main' and entity_id=v_entity_id;
    end if;
  end if;

  -- Never retain a guard flag after the last server-owned shield leaves inventory.
  if coalesce((v_state->>'guarding')::boolean,false) and not exists(
    select 1
    from jsonb_array_elements(v_inventory) inv(item)
    join public.ktk_v2_item_catalog c on c.item_id=inv.item->>'item_id'
    where c.item_type='shield'
  ) then
    v_state:=jsonb_set(v_state,'{guarding}','false'::jsonb,true);
  end if;

  v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
  v_state:=jsonb_set(v_state,'{wearables}',v_wearables,true);
  update public.ktk_v2_players
  set state=v_state,revision=revision+1
  where user_id=v_uid and world_id='main'
  returning * into v_player;
  return jsonb_build_object('ok',true,'player',to_jsonb(v_player));
end;
$function$;

create or replace function public.ktk_v2_interact()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_player public.ktk_v2_players;
  v_world public.ktk_v2_worlds;
  v_entity public.ktk_v2_entities;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_player from public.ktk_v2_players
  where user_id=v_uid and world_id='main' and is_alive;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;
  if coalesce((v_player.state->>'suspended')::boolean,false) then
    raise exception 'PLAYER_SUSPENDED';
  end if;
  select * into v_world from public.ktk_v2_worlds where id='main';

  select * into v_entity from public.ktk_v2_entities
  where world_id='main' and entity_id='crown-main' and entity_type='crown'
    and coalesce(state->>'status','ground')='ground'
    and sqrt(power(v_player.x-x,2)+power(v_player.y-y,2))<=64
  for update;
  if found and v_world.king_user_id is null then
    return public.ktk_v2_claim_crown();
  end if;

  select * into v_entity from public.ktk_v2_entities
  where world_id='main' and entity_type='item'
    and coalesce(state->>'status','ground')='ground'
    and (nullif(state->>'expires_at','') is null or (state->>'expires_at')::timestamptz>clock_timestamp())
    and sqrt(power(v_player.x-x,2)+power(v_player.y-y,2))<=64
  order by sqrt(power(v_player.x-x,2)+power(v_player.y-y,2))
  limit 1;
  if found then
    return public.ktk_v2_item_action('pickup',jsonb_build_object('entity_id',v_entity.entity_id));
  end if;

  select * into v_entity from public.ktk_v2_entities
  where world_id='main' and entity_type='resource'
    and coalesce(state->>'status','ready')='ready'
    and sqrt(power(v_player.x-x,2)+power(v_player.y-y,2))<=80
  order by sqrt(power(v_player.x-x,2)+power(v_player.y-y,2))
  limit 1;
  if found then
    return public.ktk_v2_item_action('harvest',jsonb_build_object('entity_id',v_entity.entity_id));
  end if;

  return jsonb_build_object('ok',false,'reason','NOTHING_NEARBY');
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
  if coalesce((v_state->>'suspended')::boolean,false) then
    raise exception 'PLAYER_SUSPENDED';
  end if;
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
      and not coalesce((p.state->>'suspended')::boolean,false)
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
      and not coalesce((p.state->>'suspended')::boolean,false)
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
$function$;

create or replace function ktk_v2_private.projectile_tick()
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
      and not coalesce((p.state->>'suspended')::boolean,false)
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

create or replace function ktk_v2_private.simulation_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_world public.ktk_v2_worlds;
  v_player public.ktk_v2_players;
  v_target public.ktk_v2_players;
  v_enemy public.ktk_v2_entities;
  v_state jsonb;
  v_enemy_state jsonb;
  v_dt double precision;
  v_dx double precision;
  v_dy double precision;
  v_distance double precision;
  v_step double precision;
  v_enemy_x double precision;
  v_enemy_y double precision;
  v_stamina numeric;
  v_satiety numeric;
  v_hydration numeric;
  v_health numeric;
  v_mana numeric;
  v_mana_cap numeric;
  v_magic_level integer;
  v_moving boolean;
  v_running boolean;
  v_guarding boolean;
  v_direction integer;
  v_now timestamptz:=clock_timestamp();
  v_attack_ready timestamptz;
  v_is_target_alive boolean;
begin
  perform pg_catalog.set_config('lock_timeout','750ms',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));

  select * into v_world
  from public.ktk_v2_worlds where id='main'
  for update;
  if not found then return; end if;

  v_dt:=least(2.0,greatest(0.0,extract(epoch from (v_now-v_world.last_simulation_at))));
  if v_dt<0.1 then return; end if;
  update public.ktk_v2_worlds set last_simulation_at=v_now where id='main';

  -- Expire timed loot and respawn finite world resources independently of players.
  delete from public.ktk_v2_entities
  where world_id='main' and entity_type='item'
    and nullif(state->>'expires_at','') is not null
    and (state->>'expires_at')::timestamptz<=v_now;

  update public.ktk_v2_entities
  set state=(state - 'respawn_at') ||
        jsonb_build_object('status','ready',
          'health',coalesce((state->>'max_health')::numeric,(state->>'health')::numeric,1)),
      revision=revision+1,updated_at=v_now
  where world_id='main' and entity_type='resource'
    and state->>'status'='depleted'
    and nullif(state->>'respawn_at','') is not null
    and (state->>'respawn_at')::timestamptz<=v_now;

  -- Survival values advance on the server for connected characters only.
  -- Paused/suspended clients are not killed merely because their tab is throttled.
  for v_player in
    select * from public.ktk_v2_players
    where world_id='main' and is_alive=true
      and last_seen_at>v_now-interval '30 seconds'
      and not coalesce((state->>'suspended')::boolean,false)
    for update skip locked
  loop
    v_state:=coalesce(v_player.state,'{}'::jsonb);
    v_stamina:=greatest(0,coalesce((v_state->>'stamina')::numeric,100));
    v_satiety:=greatest(0,coalesce((v_state->>'satiety')::numeric,99));
    v_hydration:=greatest(0,coalesce((v_state->>'hydration')::numeric,99));
    v_health:=greatest(0,coalesce((v_state->>'health')::numeric,100));
    v_mana:=greatest(0,coalesce((v_state->>'mana')::numeric,0));
    v_magic_level:=greatest(0,coalesce((v_state->>'magic_level')::integer,0));
    v_moving:=coalesce((v_state->>'moving')::boolean,false);
    v_running:=coalesce((v_state->>'running')::boolean,false) and v_moving;
    v_guarding:=coalesce((v_state->>'guarding')::boolean,false);

    if v_guarding then
      v_stamina:=greatest(0,v_stamina-
        (case when v_is_moving and v_is_running then 4.0 else 2.0 end)*v_dt);
    elsif v_moving and v_running then
      v_stamina:=greatest(0,v_stamina-2.0*v_dt);
    elsif v_moving then
      v_stamina:=greatest(0,v_stamina-1.0*v_dt);
    else
      v_stamina:=least(coalesce((v_state->>'max_stamina')::numeric,100),v_stamina+1.0*v_dt);
    end if;
    if v_stamina<0.5 then
      v_guarding:=false;
      v_running:=false;
    end if;

    v_satiety:=greatest(0,v_satiety-0.003*v_dt);
    v_hydration:=greatest(0,v_hydration-0.005*v_dt);
    if not v_moving and v_stamina>=50 and v_health>=10 and v_health<coalesce((v_state->>'max_health')::numeric,100) then
      v_health:=least(coalesce((v_state->>'max_health')::numeric,100),v_health+0.5*v_dt);
    elsif (v_satiety<=0 or v_hydration<=0) and v_health>0 then
      v_health:=greatest(0,v_health-0.5*v_dt);
    end if;

    v_mana_cap:=least(50.0,v_magic_level*10.0);
    if v_magic_level=0 then
      v_mana:=0;
    elsif not v_moving and v_mana<v_mana_cap then
      v_mana:=least(v_mana_cap,v_mana+(case when v_magic_level>=8 then 2.0 else 1.0 end)*v_dt);
    end if;

    v_state:=jsonb_set(v_state,'{moving}',to_jsonb(v_moving),true);
    v_state:=jsonb_set(v_state,'{running}',to_jsonb(v_running),true);
    v_state:=jsonb_set(v_state,'{guarding}',to_jsonb(v_guarding),true);
    v_state:=jsonb_set(v_state,'{stamina}',to_jsonb(round(v_stamina,2)),true);
    v_state:=jsonb_set(v_state,'{satiety}',to_jsonb(round(v_satiety,2)),true);
    v_state:=jsonb_set(v_state,'{hydration}',to_jsonb(round(v_hydration,2)),true);
    v_state:=jsonb_set(v_state,'{health}',to_jsonb(round(v_health,2)),true);
    v_state:=jsonb_set(v_state,'{mana}',to_jsonb(round(v_mana,2)),true);

    if v_health<=0 then
      perform ktk_v2_private.kill_player(v_player.user_id,'survival');
    else
      update public.ktk_v2_players
      set state=v_state,revision=revision+1
      where user_id=v_player.user_id and world_id='main';
    end if;
  end loop;

  -- Every living enemy is simulated by the server; their target selection,
  -- pursuit, attack interval and damage are never computed by clients.
  for v_enemy in
    select * from public.ktk_v2_entities
    where world_id='main' and entity_type='enemy'
      and not coalesce((state->>'defeated')::boolean,false)
    order by entity_id
    for update skip locked
  loop
    v_enemy_x:=v_enemy.x;
    v_enemy_y:=v_enemy.y;
    v_enemy_state:=coalesce(v_enemy.state,'{}'::jsonb);
    v_attack_ready:=nullif(v_enemy_state->>'attack_ready_at','')::timestamptz;

    select * into v_target
    from public.ktk_v2_players
    where world_id='main' and is_alive=true
      and last_seen_at>v_now-interval '30 seconds'
      and not coalesce((state->>'suspended')::boolean,false)
    order by sqrt(power(x-v_enemy_x,2)+power(y-v_enemy_y,2))
    limit 1
    for update skip locked;

    if found then
      v_dx:=v_target.x-v_enemy_x;
      v_dy:=v_target.y-v_enemy_y;
      v_distance:=sqrt(power(v_dx,2)+power(v_dy,2));

      if v_distance>48 and v_distance<520 then
        v_step:=least(90.0*v_dt,v_distance-42);
        v_enemy_x:=v_enemy_x+(v_dx/nullif(v_distance,0))*v_step;
        v_enemy_y:=v_enemy_y+(v_dy/nullif(v_distance,0))*v_step;
      end if;

      v_direction:=case
        when abs(v_dx)>abs(v_dy) then case when v_dx<0 then 1 else 3 end
        else case when v_dy<0 then 0 else 2 end
      end;
      v_enemy_state:=v_enemy_state||jsonb_build_object('direction',v_direction);

      if v_distance<=76 and (v_attack_ready is null or v_attack_ready<=v_now) then
        perform ktk_v2_private.apply_player_hit(
          v_target.user_id,greatest(1,coalesce((v_enemy_state->>'attack')::integer,7)),
          case when abs(v_dx)>abs(v_dy) then sign(v_dx) else 0 end,
          case when abs(v_dy)>=abs(v_dx) then sign(v_dy) else 0 end
        );
        v_enemy_state:=jsonb_set(v_enemy_state,'{attack_ready_at}',
          to_jsonb(v_now+interval '1.2 seconds'),true);
        v_enemy_state:=jsonb_set(v_enemy_state,'{attack_started_at}',to_jsonb(v_now),true);
      end if;
    end if;

    update public.ktk_v2_entities
    set x=v_enemy_x,y=v_enemy_y,state=v_enemy_state,
        revision=revision+1,updated_at=v_now
    where world_id='main' and entity_id=v_enemy.entity_id;
  end loop;
end;
$function$;

create or replace function public.ktk_v2_set_suspended(
  p_suspended boolean,
  p_sequence bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_player public.ktk_v2_players;
  v_state jsonb;
  v_previous_sequence bigint;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_sequence is null or p_sequence<1 then raise exception 'INVALID_VISIBILITY_SEQUENCE'; end if;

  perform pg_catalog.set_config('lock_timeout','500ms',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));

  select * into v_player
  from public.ktk_v2_players
  where user_id=v_uid and world_id='main' and is_alive
  for update;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  v_state:=coalesce(v_player.state,'{}'::jsonb);
  v_previous_sequence:=coalesce((v_state->>'visibility_sequence')::bigint,0);
  if p_sequence<=v_previous_sequence then
    return to_jsonb(v_player);
  end if;

  v_state:=jsonb_set(v_state,'{suspended}',to_jsonb(coalesce(p_suspended,false)),true);
  v_state:=jsonb_set(v_state,'{visibility_sequence}',to_jsonb(p_sequence),true);
  update public.ktk_v2_players
  set state=v_state,last_seen_at=clock_timestamp(),revision=revision+1
  where user_id=v_uid and world_id='main'
  returning * into v_player;
  return to_jsonb(v_player);
end;
$function$;

create or replace function ktk_v2_private.expire_disconnected_players()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player public.ktk_v2_players;
  v_count integer:=0;
begin
  perform pg_catalog.set_config('lock_timeout','750ms',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));

  for v_player in
    select *
    from public.ktk_v2_players
    where world_id='main'
      and is_alive=true
      and last_seen_at<clock_timestamp()-interval '10 minutes'
      and not coalesce((state->>'suspended')::boolean,false)
    order by last_seen_at
    for update skip locked
  loop
    if ktk_v2_private.kill_player(v_player.user_id,'disconnect') then
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end;
$function$;

revoke all on function ktk_v2_private.expire_disconnected_players() from public,anon,authenticated;
revoke all on function public.ktk_v2_set_suspended(boolean,bigint) from public,anon;
grant execute on function public.ktk_v2_set_suspended(boolean,bigint) to authenticated;

do $schedule_disconnect_expirer$
begin
  if pg_catalog.to_regnamespace('cron') is not null then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = ''ktk-v2-disconnect-expirer''';
    execute 'select cron.schedule(''ktk-v2-disconnect-expirer'',''30 seconds'',''select ktk_v2_private.expire_disconnected_players()'')';
  end if;
end;
$schedule_disconnect_expirer$;



commit;
