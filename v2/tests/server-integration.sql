begin;

do $$
declare
  v_uid uuid := '10000000-0000-4000-8000-000000000001';
  v_other_uid uuid := '10000000-0000-4000-8000-000000000002';
  v_third_uid uuid := '10000000-0000-4000-8000-000000000003';
  v_enter jsonb;
  v_step jsonb;
  v_claim jsonb;
  v_snapshot jsonb;
  v_action jsonb;
  v_attack jsonb;
  v_world public.ktk_v2_worlds;
  v_crown public.ktk_v2_entities;
  v_drop public.ktk_v2_entities;
  v_player public.ktk_v2_players;
  v_other public.ktk_v2_players;
  v_third public.ktk_v2_players;
  v_start_x double precision;
  v_start_y double precision;
  v_king_x double precision;
  v_king_y double precision;
  v_distance double precision;
  v_satiety numeric;
  v_loot_count integer;
  v_failed boolean;
  i integer;
begin
  insert into auth.users(id) values (v_uid),(v_other_uid),(v_third_uid);

  -- Character entry, appearance and clan assignment are server-owned.
  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  v_enter := public.ktk_v2_enter_world(
    'Teste V2',
    jsonb_build_object(
      'gender','male','skin','brown','eyes','brown','hair','dark_brown',
      'hairstyle','hair_pixie','clothing','#8d3030'
    )
  );

  if v_enter->>'user_id' <> v_uid::text then
    raise exception 'V2_ENTRY_DID_NOT_RETURN_NEW_PLAYER';
  end if;
  if v_enter->'appearance'->>'hairstyle' <> 'hair_pixie' then
    raise exception 'V2_APPEARANCE_NOT_PERSISTED';
  end if;
  v_start_x := (v_enter->>'x')::double precision;
  v_start_y := (v_enter->>'y')::double precision;

  v_enter := public.ktk_v2_choose_clan('#d94343');
  if v_enter->>'clan_color' <> '#d94343' then
    raise exception 'V2_CLAN_ASSIGNMENT_NOT_PERSISTED';
  end if;
  v_failed := false;
  begin
    perform public.ktk_v2_choose_clan('#3d75d6');
  exception when others then
    v_failed := sqlerrm = 'CLAN_ALREADY_CHOSEN';
  end;
  if not v_failed then raise exception 'V2_CLAN_COLOR_WAS_CHANGED'; end if;

  if not exists (
    select 1 from public.ktk_v2_item_catalog
    where item_id='test-v1-catalog-import'
      and display_name='Item legado de teste'
      and attack_bonus=7
      and (metadata->>'imported_from_v1')::boolean=true
  ) then
    raise exception 'V2_DID_NOT_IMPORT_V1_ITEM_CATALOG';
  end if;

  -- The snapshot may now contain the crown, starter loot, resources and NPC.
  v_snapshot := public.ktk_v2_world_state();
  if jsonb_array_length(v_snapshot->'players') <> 1 then
    raise exception 'V2_WORLD_SNAPSHOT_PLAYER_COUNT_WRONG';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_snapshot->'entities') entity
    where entity->>'entity_id'='crown-main'
      and entity->'state'->>'status'='ground'
  ) then
    raise exception 'V2_WORLD_SNAPSHOT_CROWN_MISSING';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_snapshot->'entities') entity
    where entity->>'entity_id'='item-starter-sword'
  ) then
    raise exception 'V2_STARTER_ITEM_MISSING';
  end if;

  -- Pickup, drop and pickup again must update the same server-owned inventory.
  v_action := public.ktk_v2_item_action('pickup',jsonb_build_object('entity_id','item-starter-sword'));
  if v_action->>'ok' <> 'true' then raise exception 'V2_STARTER_SWORD_PICKUP_FAILED'; end if;
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if not exists (
    select 1 from jsonb_array_elements(v_player.state->'inventory') item
    where item->>'item_id'='equipment-longsword'
  ) then raise exception 'V2_PICKUP_NOT_STORED_IN_INVENTORY'; end if;

  v_action := public.ktk_v2_item_action('drop',jsonb_build_object('slot',0));
  if v_action->>'ok' <> 'true' then raise exception 'V2_ITEM_DROP_FAILED'; end if;
  select * into v_drop from public.ktk_v2_entities
  where world_id='main' and entity_type='item'
    and state->>'item_id'='equipment-longsword'
    and entity_id like 'drop-%'
  order by updated_at desc limit 1;
  if not found then raise exception 'V2_DROPPED_ITEM_NOT_IN_WORLD'; end if;

  v_action := public.ktk_v2_item_action('pickup',jsonb_build_object('entity_id',v_drop.entity_id));
  if v_action->>'ok' <> 'true' then raise exception 'V2_DROPPED_ITEM_CANNOT_BE_RECOLLECTED'; end if;

  -- Consumables change server stats and are removed from the inventory.
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  update public.ktk_v2_players
  set state=jsonb_set(state,'{satiety}','20'::jsonb,true),revision=revision+1
  where user_id=v_uid;
  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main','test-food-drop','item',v_player.x+10,v_player.y+10,4,
    '{"status":"ground","item_id":"resource-berries","quantity":1,"expires_at":null}'::jsonb,1
  );
  v_action:=public.ktk_v2_item_action('pickup',jsonb_build_object('entity_id','test-food-drop'));
  if v_action->>'ok'<>'true' then raise exception 'V2_CONSUMABLE_PICKUP_FAILED'; end if;
  v_action:=public.ktk_v2_item_action('consume','{"slot":1}'::jsonb);
  if v_action->>'ok'<>'true' then raise exception 'V2_CONSUME_FAILED'; end if;
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if (v_player.state->>'satiety')::numeric <> 38 then
    raise exception 'V2_CONSUMABLE_DID_NOT_UPDATE_SATIETY';
  end if;
  if v_player.state->'inventory'->1 <> 'null'::jsonb then
    raise exception 'V2_CONSUMED_ITEM_REMAINS_IN_INVENTORY';
  end if;

  -- Wearable loot is automatically equipped, and equip/unequip swaps server state.
  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main','test-shirt-drop','item',v_player.x+10,v_player.y+10,4,
    '{"status":"ground","item_id":"cosmetic-linen-shirt","quantity":1,"expires_at":null}'::jsonb,1
  );
  v_action:=public.ktk_v2_item_action('pickup',jsonb_build_object('entity_id','test-shirt-drop'));
  if v_action->>'ok'<>'true' then raise exception 'V2_WEARABLE_PICKUP_FAILED'; end if;
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if v_player.state->'wearables'->'chest'->>'item_id' <> 'cosmetic-linen-shirt' then
    raise exception 'V2_WEARABLE_NOT_EQUIPPED';
  end if;
  perform public.ktk_v2_item_action('unequip','{"wear_slot":"chest"}'::jsonb);
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if v_player.state->'wearables'->'chest' <> 'null'::jsonb
     or v_player.state->'inventory'->1->>'item_id' <> 'cosmetic-linen-shirt' then
    raise exception 'V2_WEARABLE_UNEQUIP_FAILED';
  end if;
  perform public.ktk_v2_item_action('equip','{"slot":1}'::jsonb);
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if v_player.state->'wearables'->'chest'->>'item_id' <> 'cosmetic-linen-shirt' then
    raise exception 'V2_WEARABLE_REEQUIP_FAILED';
  end if;

  -- Server-authoritative movement and direction.
  perform pg_sleep(0.22);
  v_step := public.ktk_v2_step_player(-1::smallint,0::smallint,false,false);
  if (v_step->>'x')::double precision >= v_start_x then
    raise exception 'V2_SERVER_MOVEMENT_DID_NOT_CHANGE_X';
  end if;
  if (v_step->>'direction')::integer <> 1 then
    raise exception 'V2_SERVER_DIRECTION_NOT_LEFT';
  end if;

  -- Move close enough to the world crown through server-approved RPC steps.
  for i in 1..3 loop
    perform pg_sleep(0.22);
    v_step := public.ktk_v2_step_player(-1::smallint,0::smallint,false,false);
  end loop;

  select * into v_player
  from public.ktk_v2_players where user_id = v_uid and world_id = 'main';
  select * into v_crown
  from public.ktk_v2_entities where world_id = 'main' and entity_id = 'crown-main';
  v_distance := sqrt(power(v_player.x-v_crown.x,2)+power(v_player.y-v_crown.y,2));
  if v_distance > 64 then
    raise exception 'V2_TEST_PLAYER_DID_NOT_REACH_CROWN distance=%',v_distance;
  end if;
  v_king_x:=v_player.x;
  v_king_y:=v_player.y;

  v_claim := public.ktk_v2_claim_crown();
  if v_claim->>'ok' <> 'true' then
    raise exception 'V2_CROWN_CLAIM_NOT_CONFIRMED';
  end if;
  select * into v_world from public.ktk_v2_worlds where id = 'main';
  select * into v_crown from public.ktk_v2_entities
    where world_id = 'main' and entity_id = 'crown-main';
  if v_world.king_user_id <> v_uid then
    raise exception 'V2_CROWN_OWNER_NOT_STORED';
  end if;
  if v_crown.state->>'status' <> 'held' then
    raise exception 'V2_CROWN_ENTITY_NOT_HELD';
  end if;

  -- Same-clan members cannot damage the King.
  perform set_config('request.jwt.claim.sub',v_other_uid::text,true);
  v_enter:=public.ktk_v2_enter_world('Segundo Jogador','{}'::jsonb);
  perform public.ktk_v2_choose_clan('#d94343');
  select * into v_other from public.ktk_v2_players where user_id=v_other_uid;
  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main','test-second-player-sword','item',v_other.x+10,v_other.y+10,4,
    '{"status":"ground","item_id":"equipment-longsword","quantity":1,"durability":150,"max_durability":150}'::jsonb,1
  );
  perform public.ktk_v2_item_action('pickup','{"entity_id":"test-second-player-sword"}'::jsonb);
  update public.ktk_v2_players
  set x=v_king_x+30,y=v_king_y,direction=1,revision=revision+1
  where user_id=v_other_uid;
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  v_failed:=false;
  v_attack:=public.ktk_v2_attack();
  if v_attack->>'hit'='true' then
    raise exception 'V2_SAME_CLAN_ATTACKED_THE_KING';
  end if;
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if (v_player.state->>'health')::integer<>100 then
    raise exception 'V2_SAME_CLAN_DAMAGED_THE_KING';
  end if;

  -- A voluntary exit kills the character and drops carried items as timed loot.
  update public.ktk_v2_players
  set x=2000,y=2000,revision=revision+1
  where user_id=v_other_uid;
  v_action:=public.ktk_v2_leave_world();
  select * into v_other from public.ktk_v2_players where user_id=v_other_uid;
  if v_other.is_alive then raise exception 'V2_EXIT_DID_NOT_KILL_SECOND_CHARACTER'; end if;
  if not exists (
    select 1 from public.ktk_v2_entities
    where world_id='main' and entity_type='item'
      and state->>'dropped_by'=v_other_uid::text
      and state->>'item_id'='equipment-longsword'
      and nullif(state->>'expires_at','') is not null
  ) then raise exception 'V2_EXIT_DID_NOT_DROP_CARRIED_ITEMS'; end if;

  -- A different clan can attack the King; death drops gear and releases the crown.
  perform set_config('request.jwt.claim.sub',v_third_uid::text,true);
  perform public.ktk_v2_enter_world('Terceiro Jogador','{}'::jsonb);
  perform public.ktk_v2_choose_clan('#3d75d6');
  update public.ktk_v2_players
  set x=v_king_x+30,y=v_king_y,direction=1,revision=revision+1
  where user_id=v_third_uid;
  update public.ktk_v2_players
  set state=jsonb_set(state,'{health}','1'::jsonb,true),revision=revision+1
  where user_id=v_uid;

  v_attack:=public.ktk_v2_attack();
  if v_attack->>'hit'<>'true' or v_attack->>'target_type'<>'player' then
    raise exception 'V2_OPPOSING_CLAN_COULD_NOT_ATTACK_THE_KING';
  end if;

  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  select * into v_world from public.ktk_v2_worlds where id='main';
  select * into v_crown from public.ktk_v2_entities
    where world_id='main' and entity_id='crown-main';
  if v_player.is_alive then raise exception 'V2_ATTACK_DID_NOT_KILL_THE_KING'; end if;
  if v_world.king_user_id is not null then raise exception 'V2_DEAD_KING_STILL_OWNS_CROWN'; end if;
  if v_crown.state->>'status' <> 'ground' then raise exception 'V2_CROWN_NOT_DROPPED_ON_KING_DEATH'; end if;
  if v_crown.x <> v_king_x or v_crown.y <> v_king_y then
    raise exception 'V2_CROWN_DROP_NOT_AT_SERVER_POSITION';
  end if;
  select count(*) into v_loot_count from public.ktk_v2_entities
  where world_id='main' and entity_type='item' and state->>'dropped_by'=v_uid::text;
  if v_loot_count<2 then raise exception 'V2_KING_DID_NOT_DROP_INVENTORY_AND_EQUIPMENT'; end if;

  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  v_failed := false;
  begin
    perform public.ktk_v2_enter_world('Teste V2','{}'::jsonb);
  exception when others then
    v_failed := sqlerrm = 'CHARACTER_ALREADY_DEAD_NEW_SESSION_REQUIRED';
  end;
  if not v_failed then raise exception 'V2_DEAD_IDENTITY_WAS_REUSED'; end if;

  if has_table_privilege('authenticated','public.ktk_v2_players','INSERT')
     or has_table_privilege('authenticated','public.ktk_v2_players','UPDATE')
     or has_table_privilege('authenticated','public.ktk_v2_entities','INSERT')
     or has_table_privilege('authenticated','public.ktk_v2_entities','UPDATE')
     or has_table_privilege('authenticated','public.ktk_v2_item_catalog','INSERT')
     or has_table_privilege('authenticated','public.ktk_v2_item_catalog','UPDATE') then
    raise exception 'V2_CLIENT_HAS_DIRECT_TABLE_WRITE_PERMISSION';
  end if;
  if has_function_privilege('anon','public.ktk_v2_step_player(smallint,smallint,boolean,boolean)','EXECUTE')
     or has_function_privilege('anon','public.ktk_v2_item_action(text,jsonb)','EXECUTE')
     or has_function_privilege('anon','public.ktk_v2_attack()','EXECUTE')
     or has_function_privilege('anon','public.ktk_v2_interact()','EXECUTE') then
    raise exception 'V2_ANON_CAN_EXECUTE_GAMEPLAY_RPC';
  end if;
  if not has_function_privilege('authenticated','public.ktk_v2_item_action(text,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.ktk_v2_attack()','EXECUTE')
     or not has_function_privilege('authenticated','public.ktk_v2_interact()','EXECUTE') then
    raise exception 'V2_AUTHENTICATED_CANNOT_EXECUTE_GAMEPLAY_RPC';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='realtime' and tablename='messages'
      and policyname='KTK V2 clients can publish own presence'
  ) then
    raise exception 'V2_PRESENCE_INSERT_POLICY_MISSING';
  end if;
end
$$;

-- Server simulation is independent of an open client loop. It advances
-- survival, respawns resources, expires loot and runs the skeleton AI.
do $$
declare
  v_uid uuid := '10000000-0000-4000-8000-000000000004';
  v_player public.ktk_v2_players;
  v_tree public.ktk_v2_entities;
  v_skeleton public.ktk_v2_entities;
  v_start_x double precision;
  v_start_y double precision;
  v_health numeric;
  v_stamina numeric;
  v_satiety numeric;
  v_hydration numeric;
begin
  insert into auth.users(id) values (v_uid);
  -- Ignore characters from the earlier rule tests; this scenario has one
  -- active simulated character so the skeleton has an unambiguous target.
  update public.ktk_v2_players
  set last_seen_at=clock_timestamp()-interval '1 hour'
  where world_id='main' and is_alive;

  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  perform public.ktk_v2_enter_world('Teste Simulação','{}'::jsonb);

  select * into v_tree from public.ktk_v2_entities
  where world_id='main' and entity_id='resource-tree-1';
  update public.ktk_v2_entities
  set state=state||jsonb_build_object(
    'status','depleted','health',0,
    'respawn_at',clock_timestamp()-interval '1 second'
  ),revision=revision+1,updated_at=clock_timestamp()
  where world_id='main' and entity_id='resource-tree-1';

  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main','test-expired-loot','item',3000,3000,0,
    jsonb_build_object('status','ground','item_id','resource-wood',
      'quantity',1,'expires_at',clock_timestamp()-interval '1 second'),1
  );

  select * into v_skeleton from public.ktk_v2_entities
  where world_id='main' and entity_id='skeleton-1';
  v_start_x:=v_skeleton.x;
  v_start_y:=v_skeleton.y;

  update public.ktk_v2_entities
  set state=state||jsonb_build_object(
    'health',70,'max_health',70,'defeated',false,
    'attack',7,'attack_ready_at',clock_timestamp()-interval '1 second'
  ),revision=revision+1,updated_at=clock_timestamp()
  where world_id='main' and entity_id='skeleton-1';

  update public.ktk_v2_players
  set x=v_start_x-45,y=v_start_y,
      state=jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(state,'{stamina}','40'::jsonb,true),
                  '{satiety}','30'::jsonb,true
                ),
                '{hydration}','30'::jsonb,true
              ),
              '{health}','80'::jsonb,true
            ),
            '{mana}','0'::jsonb,true
          ),
          '{magic_level}','0'::jsonb,true
        ),
        '{moving}','false'::jsonb,true
      ) || '{"running":false,"guarding":false}'::jsonb,
      revision=revision+1,last_seen_at=clock_timestamp(),
      movement_updated_at=clock_timestamp()
  where user_id=v_uid and world_id='main';

  update public.ktk_v2_worlds
  set last_simulation_at=clock_timestamp()-interval '2 seconds'
  where id='main';

  perform ktk_v2_private.simulation_tick();

  select * into v_player from public.ktk_v2_players
  where user_id=v_uid and world_id='main';
  select * into v_tree from public.ktk_v2_entities
  where world_id='main' and entity_id='resource-tree-1';
  select * into v_skeleton from public.ktk_v2_entities
  where world_id='main' and entity_id='skeleton-1';

  v_health:=(v_player.state->>'health')::numeric;
  v_stamina:=(v_player.state->>'stamina')::numeric;
  v_satiety:=(v_player.state->>'satiety')::numeric;
  v_hydration:=(v_player.state->>'hydration')::numeric;

  if v_player.is_alive is not true then
    raise exception 'V2_SIMULATION_KILLED_HEALTHY_TEST_PLAYER';
  end if;
  if v_stamina<=40 then raise exception 'V2_SIMULATION_DID_NOT_REGENERATE_STAMINA'; end if;
  if v_satiety>=30 then raise exception 'V2_SIMULATION_DID_NOT_DECREASE_SATIETY'; end if;
  if v_hydration>=30 then raise exception 'V2_SIMULATION_DID_NOT_DECREASE_HYDRATION'; end if;
  if v_tree.state->>'status'<>'ready'
     or (v_tree.state->>'health')::numeric<>3 then
    raise exception 'V2_SIMULATION_DID_NOT_RESPAWN_RESOURCE';
  end if;
  if exists(select 1 from public.ktk_v2_entities where world_id='main' and entity_id='test-expired-loot') then
    raise exception 'V2_SIMULATION_DID_NOT_EXPIRE_GROUND_LOOT';
  end if;
  if v_health>=80 or nullif(v_player.state->>'last_knockback_at','') is null then
    raise exception 'V2_SKELETON_DID_NOT_ATTACK_NEARBY_PLAYER';
  end if;
  if v_skeleton.state->>'attack_started_at' is null
     or v_skeleton.state->>'attack_ready_at' is null then
    raise exception 'V2_SKELETON_ATTACK_COOLDOWN_NOT_STORED';
  end if;
end
$$;

-- Ranged weapons consume ammunition on the server and projectile collision
-- damages the server-owned enemy, not a client-side prediction.
do $$
declare
  v_uid uuid := '10000000-0000-4000-8000-000000000005';
  v_player public.ktk_v2_players;
  v_projectile public.ktk_v2_entities;
  v_target public.ktk_v2_entities;
  v_attack jsonb;
  v_action jsonb;
  v_projectile_id text;
  v_ammo_quantity integer;
  v_health numeric;
  v_start_x double precision;
begin
  insert into auth.users(id) values (v_uid);
  update public.ktk_v2_players
  set last_seen_at=clock_timestamp()-interval '1 hour'
  where world_id='main' and is_alive;

  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  perform public.ktk_v2_enter_world('Teste Projétil','{}'::jsonb);

  update public.ktk_v2_players
  set x=800,y=1000,direction=3,revision=revision+1,
      last_seen_at=clock_timestamp(),movement_updated_at=clock_timestamp()
  where user_id=v_uid and world_id='main';

  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values
    ('main','test-bow-ground','item',810,1000,4,
      '{"status":"ground","item_id":"equipment-bow-normal","quantity":1,"durability":120,"max_durability":120}'::jsonb,1),
    ('main','test-arrows-ground','item',811,1002,4,
      '{"status":"ground","item_id":"equipment-arrow","quantity":3,"durability":0,"max_durability":0}'::jsonb,1),
    ('main','test-projectile-target','enemy',875,1000,12,
      '{"health":50,"max_health":50,"defense":0,"attack":1,"defeated":false}'::jsonb,1);

  v_action:=public.ktk_v2_item_action('pickup','{"entity_id":"test-bow-ground"}'::jsonb);
  if v_action->>'ok'<>'true' then raise exception 'V2_PROJECTILE_BOW_PICKUP_FAILED'; end if;
  v_action:=public.ktk_v2_item_action('pickup','{"entity_id":"test-arrows-ground"}'::jsonb);
  if v_action->>'ok'<>'true' then raise exception 'V2_PROJECTILE_AMMO_PICKUP_FAILED'; end if;
  perform public.ktk_v2_item_action('select_slot','{"slot":0}'::jsonb);

  v_attack:=public.ktk_v2_attack();
  if v_attack->>'ok'<>'true' or v_attack->>'projectile_id' is null then
    raise exception 'V2_RANGED_ATTACK_DID_NOT_CREATE_PROJECTILE';
  end if;
  v_projectile_id:=v_attack->>'projectile_id';

  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  select greatest(0,coalesce((item->>'quantity')::integer,0))
  into v_ammo_quantity
  from jsonb_array_elements(v_player.state->'inventory') item
  where item->>'item_id'='equipment-arrow';
  if v_ammo_quantity<>2 then
    raise exception 'V2_RANGED_ATTACK_DID_NOT_CONSUME_ONE_ARROW quantity=%',v_ammo_quantity;
  end if;

  select * into v_projectile from public.ktk_v2_entities
  where world_id='main' and entity_id=v_projectile_id and entity_type='projectile';
  if not found then raise exception 'V2_PROJECTILE_NOT_STORED_IN_WORLD'; end if;
  if v_projectile.state->>'owner_id'<>v_uid::text then
    raise exception 'V2_PROJECTILE_OWNER_NOT_STORED';
  end if;
  if v_projectile.state->>'weapon_id'<>'equipment-bow-normal' then
    raise exception 'V2_PROJECTILE_WEAPON_NOT_STORED';
  end if;

  update public.ktk_v2_entities
  set state=jsonb_set(state,'{last_tick_at}',
      to_jsonb(clock_timestamp()-interval '0.1 seconds'),true),
      updated_at=clock_timestamp()
  where world_id='main' and entity_id=v_projectile_id;
  perform ktk_v2_private.projectile_tick();

  select * into v_target from public.ktk_v2_entities
  where world_id='main' and entity_id='test-projectile-target';
  v_health:=(v_target.state->>'health')::numeric;
  if v_health>=50 then
    raise exception 'V2_PROJECTILE_DID_NOT_DAMAGE_TARGET health=%',v_health;
  end if;
  if exists(select 1 from public.ktk_v2_entities where world_id='main' and entity_id=v_projectile_id) then
    raise exception 'V2_PROJECTILE_WAS_NOT_CONSUMED_ON_HIT';
  end if;
end
$$;

-- Boomerangs return to their owner and magic weapons spend server mana.
do $$
declare
  v_boomerang_uid uuid := '10000000-0000-4000-8000-000000000006';
  v_magic_uid uuid := '10000000-0000-4000-8000-000000000007';
  v_player public.ktk_v2_players;
  v_projectile public.ktk_v2_entities;
  v_action jsonb;
  v_attack jsonb;
  v_projectile_id text;
  v_mana numeric;
  v_start_x double precision;
begin
  insert into auth.users(id) values (v_boomerang_uid),(v_magic_uid);
  update public.ktk_v2_players
  set last_seen_at=clock_timestamp()-interval '1 hour'
  where world_id='main' and is_alive;

  perform set_config('request.jwt.claim.sub',v_boomerang_uid::text,true);
  perform public.ktk_v2_enter_world('Teste Bumerangue','{}'::jsonb);
  update public.ktk_v2_players
  set x=800,y=1300,direction=3,revision=revision+1,last_seen_at=clock_timestamp()
  where user_id=v_boomerang_uid and world_id='main';
  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main','test-boomerang-ground','item',810,1300,4,
    '{"status":"ground","item_id":"equipment-boomerang","quantity":1,"durability":160,"max_durability":160}'::jsonb,1
  );
  v_action:=public.ktk_v2_item_action('pickup','{"entity_id":"test-boomerang-ground"}'::jsonb);
  if v_action->>'ok'<>'true' then raise exception 'V2_BOOMERANG_PICKUP_FAILED'; end if;
  perform public.ktk_v2_item_action('select_slot','{"slot":0}'::jsonb);

  v_attack:=public.ktk_v2_attack();
  if v_attack->>'projectile_type'<>'boomerang' then
    raise exception 'V2_BOOMERANG_DID_NOT_USE_PROJECTILE_PATH';
  end if;
  v_projectile_id:=v_attack->>'projectile_id';
  update public.ktk_v2_entities
  set state=jsonb_set(
      jsonb_set(state,'{max_distance}','12'::jsonb,true),
      '{last_tick_at}',to_jsonb(clock_timestamp()-interval '1 second'),true
    )
  where world_id='main' and entity_id=v_projectile_id;
  perform ktk_v2_private.projectile_tick();

  select * into v_projectile from public.ktk_v2_entities
  where world_id='main' and entity_id=v_projectile_id;
  if not found or v_projectile.state->>'phase'<>'return' then
    raise exception 'V2_BOOMERANG_DID_NOT_TURN_BACK';
  end if;

  update public.ktk_v2_players
  set x=v_projectile.x+10,y=v_projectile.y,last_seen_at=clock_timestamp(),revision=revision+1
  where user_id=v_boomerang_uid and world_id='main';
  update public.ktk_v2_entities
  set state=jsonb_set(state,'{last_tick_at}',
      to_jsonb(clock_timestamp()-interval '1 second'),true)
  where world_id='main' and entity_id=v_projectile_id;
  perform ktk_v2_private.projectile_tick();
  if exists(select 1 from public.ktk_v2_entities where world_id='main' and entity_id=v_projectile_id) then
    raise exception 'V2_BOOMERANG_DID_NOT_RETURN_TO_OWNER';
  end if;

  perform set_config('request.jwt.claim.sub',v_magic_uid::text,true);
  perform public.ktk_v2_enter_world('Teste Magia','{}'::jsonb);
  update public.ktk_v2_players
  set x=800,y=1500,direction=3,
      state=jsonb_set(state,'{mana}','10'::jsonb,true),
      revision=revision+1,last_seen_at=clock_timestamp()
  where user_id=v_magic_uid and world_id='main';
  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main','test-wand-ground','item',810,1500,4,
    '{"status":"ground","item_id":"equipment-wand","quantity":1,"durability":120,"max_durability":120}'::jsonb,1
  );
  v_action:=public.ktk_v2_item_action('pickup','{"entity_id":"test-wand-ground"}'::jsonb);
  if v_action->>'ok'<>'true' then raise exception 'V2_MAGIC_WAND_PICKUP_FAILED'; end if;
  perform public.ktk_v2_item_action('select_slot','{"slot":0}'::jsonb);

  v_attack:=public.ktk_v2_attack();
  if v_attack->>'projectile_type'<>'magic' then
    raise exception 'V2_MAGIC_WEAPON_DID_NOT_CREATE_MAGIC_PROJECTILE';
  end if;
  v_projectile_id:=v_attack->>'projectile_id';
  select * into v_player from public.ktk_v2_players where user_id=v_magic_uid;
  v_mana:=(v_player.state->>'mana')::numeric;
  if v_mana<>5 then raise exception 'V2_MAGIC_WEAPON_DID_NOT_CONSUME_MANA value=%',v_mana; end if;

  select * into v_projectile from public.ktk_v2_entities
  where world_id='main' and entity_id=v_projectile_id;
  v_start_x:=v_projectile.x;
  update public.ktk_v2_entities
  set state=jsonb_set(state,'{last_tick_at}',
      to_jsonb(clock_timestamp()-interval '0.1 seconds'),true)
  where world_id='main' and entity_id=v_projectile_id;
  perform ktk_v2_private.projectile_tick();
  select * into v_projectile from public.ktk_v2_entities
  where world_id='main' and entity_id=v_projectile_id;
  if not found or v_projectile.x<=v_start_x then
    raise exception 'V2_MAGIC_PROJECTILE_DID_NOT_ADVANCE_ON_SERVER';
  end if;
end
$$;

-- A same-clan projectile is not allowed to damage its own King.
do $$
declare
  v_king_uid uuid := '10000000-0000-4000-8000-000000000008';
  v_owner_uid uuid := '10000000-0000-4000-8000-000000000009';
  v_king public.ktk_v2_players;
  v_projectile public.ktk_v2_entities;
  v_start_x double precision:=818;
begin
  insert into auth.users(id) values (v_king_uid),(v_owner_uid);
  update public.ktk_v2_players
  set last_seen_at=clock_timestamp()-interval '1 hour'
  where world_id='main' and is_alive;

  perform set_config('request.jwt.claim.sub',v_king_uid::text,true);
  perform public.ktk_v2_enter_world('Rei do Teste','{}'::jsonb);
  perform public.ktk_v2_choose_clan('#d94343');
  update public.ktk_v2_players
  set x=875,y=1700,direction=1,
      state=jsonb_set(state,'{health}','100'::jsonb,true),
      revision=revision+1,last_seen_at=clock_timestamp()
  where user_id=v_king_uid and world_id='main';

  perform set_config('request.jwt.claim.sub',v_owner_uid::text,true);
  perform public.ktk_v2_enter_world('Arqueiro Aliado','{}'::jsonb);
  perform public.ktk_v2_choose_clan('#d94343');
  update public.ktk_v2_players
  set x=800,y=1700,direction=3,revision=revision+1,last_seen_at=clock_timestamp()
  where user_id=v_owner_uid and world_id='main';

  update public.ktk_v2_worlds
  set king_user_id=v_king_uid,crown_version=crown_version+1,revision=revision+1
  where id='main';
  update public.ktk_v2_entities
  set state=jsonb_build_object('status','held','owner_id',v_king_uid::text),
      revision=revision+1,updated_at=clock_timestamp()
  where world_id='main' and entity_id='crown-main';

  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main','test-same-clan-projectile','projectile',v_start_x,1700,6,
    jsonb_build_object(
      'owner_id',v_owner_uid::text,'weapon_id','equipment-bow-normal',
      'projectile_type','arrow','vector_x',1,'vector_y',0,
      'speed',720,'max_distance',500,'distance',0,'damage',80,
      'direction',3,'phase','outbound','created_at',clock_timestamp(),
      'last_tick_at',clock_timestamp()-interval '0.1 seconds','ttl',15
    ),1
  );

  perform ktk_v2_private.projectile_tick();
  select * into v_king from public.ktk_v2_players where user_id=v_king_uid;
  select * into v_projectile from public.ktk_v2_entities
  where world_id='main' and entity_id='test-same-clan-projectile';
  if (v_king.state->>'health')::numeric<>100 then
    raise exception 'V2_SAME_CLAN_PROJECTILE_DAMAGED_THE_KING';
  end if;
  if not found or v_projectile.x<=v_start_x then
    raise exception 'V2_SAME_CLAN_PROJECTILE_DID_NOT_PASS_KING';
  end if;
end
$$;

-- Shield guarding is validated by the server and reduces movement speed.
do $$
declare
  v_uid uuid := '10000000-0000-4000-8000-000000000010';
  v_player public.ktk_v2_players;
  v_action jsonb;
  v_step jsonb;
  v_start_x double precision;
  v_guarded_dx double precision;
  v_unguarded_dx double precision;
  v_failed boolean:=false;
begin
  insert into auth.users(id) values (v_uid);
  update public.ktk_v2_players
  set last_seen_at=clock_timestamp()-interval '1 hour'
  where world_id='main' and is_alive;

  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  perform public.ktk_v2_enter_world('Teste Escudo','{}'::jsonb);
  update public.ktk_v2_players
  set x=600,y=1200,direction=3,
      state=jsonb_set(state,'{stamina}','50'::jsonb,true),
      revision=revision+1,last_seen_at=clock_timestamp(),
      movement_updated_at=clock_timestamp()-interval '0.2 seconds'
  where user_id=v_uid and world_id='main';
  select x into v_start_x from public.ktk_v2_players where user_id=v_uid;

  begin
    perform public.ktk_v2_step_player(1::smallint,0::smallint,false,true);
  exception when others then
    v_failed:=sqlerrm='SHIELD_REQUIRED';
  end;
  if not v_failed then raise exception 'V2_SERVER_ALLOWED_GUARD_WITHOUT_SHIELD'; end if;

  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main','test-shield-ground','item',610,1200,4,
    '{"status":"ground","item_id":"equipment-shield","quantity":1,"durability":100,"max_durability":100}'::jsonb,1
  );
  v_action:=public.ktk_v2_item_action('pickup','{"entity_id":"test-shield-ground"}'::jsonb);
  if v_action->>'ok'<>'true' then raise exception 'V2_SHIELD_PICKUP_FAILED'; end if;

  update public.ktk_v2_players
  set movement_updated_at=clock_timestamp()-interval '0.2 seconds',last_seen_at=clock_timestamp()
  where user_id=v_uid and world_id='main';
  v_step:=public.ktk_v2_step_player(1::smallint,0::smallint,false,true);
  v_guarded_dx:=(v_step->>'x')::double precision-v_start_x;
  if v_guarded_dx<20 or v_guarded_dx>25 then
    raise exception 'V2_SHIELD_DID_NOT_REDUCE_MOVEMENT_SPEED dx=%',v_guarded_dx;
  end if;
  if coalesce((v_step->'state'->>'guarding')::boolean,false) is not true then
    raise exception 'V2_SERVER_DID_NOT_STORE_GUARDING_STATE';
  end if;

  update public.ktk_v2_players
  set movement_updated_at=clock_timestamp()-interval '0.2 seconds',last_seen_at=clock_timestamp()
  where user_id=v_uid and world_id='main';
  select x into v_start_x from public.ktk_v2_players where user_id=v_uid;
  v_step:=public.ktk_v2_step_player(1::smallint,0::smallint,false,false);
  v_unguarded_dx:=(v_step->>'x')::double precision-v_start_x;
  if v_unguarded_dx<=v_guarded_dx then
    raise exception 'V2_UNGUARDED_MOVEMENT_NOT_FASTER_THAN_GUARDED';
  end if;
end
$$;

-- The world population is persistent and ready resources/obstacles block
-- player movement on the server instead of being cosmetic client objects.
do $$
declare
  v_uid uuid := '10000000-0000-4000-8000-000000000017';
  v_player public.ktk_v2_players;
  v_before double precision;
  v_step jsonb;
  v_resource_count integer;
  v_obstacle_count integer;
  v_enemy_count integer;
begin
  insert into auth.users(id) values (v_uid);
  update public.ktk_v2_players
  set last_seen_at=clock_timestamp()-interval '1 hour'
  where world_id='main' and is_alive;

  select count(*) into v_resource_count
  from public.ktk_v2_entities where world_id='main' and entity_type='resource';
  select count(*) into v_obstacle_count
  from public.ktk_v2_entities where world_id='main' and entity_type='obstacle';
  select count(*) into v_enemy_count
  from public.ktk_v2_entities where world_id='main' and entity_type='enemy' and not coalesce((state->>'defeated')::boolean,false);

  if v_resource_count<40 then raise exception 'V2_WORLD_HAS_TOO_FEW_RESOURCES count=%',v_resource_count; end if;
  if v_obstacle_count<20 then raise exception 'V2_WORLD_HAS_TOO_FEW_OBSTACLES count=%',v_obstacle_count; end if;
  if v_enemy_count<5 then raise exception 'V2_WORLD_HAS_TOO_FEW_ENEMIES count=%',v_enemy_count; end if;

  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  perform public.ktk_v2_enter_world('Teste Colisão','{}'::jsonb);
  update public.ktk_v2_players
  set x=1140,y=560,direction=3,revision=revision+1,
      last_seen_at=clock_timestamp(),
      movement_updated_at=clock_timestamp()-interval '0.2 seconds'
  where user_id=v_uid and world_id='main';
  select x into v_before from public.ktk_v2_players where user_id=v_uid;
  v_step:=public.ktk_v2_step_player(1::smallint,0::smallint,false,false);
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if abs(v_player.x-v_before)>0.001 then
    raise exception 'V2_PLAYER_PASSED_THROUGH_A_READY_RESOURCE x_before=% x_after=%',v_before,v_player.x;
  end if;
end
$$;

-- Hidden tabs are paused, never auto-killed. Unannounced stale sessions
-- eventually die and leave their server-owned inventory as public loot.
do $$
declare
  v_paused_uid uuid := '10000000-0000-4000-8000-000000000017';
  v_disconnected_uid uuid := '10000000-0000-4000-8000-000000000018';
  v_paused public.ktk_v2_players;
  v_disconnected public.ktk_v2_players;
  v_skeleton public.ktk_v2_entities;
  v_result jsonb;
  v_failed boolean:=false;
  v_health numeric;
  v_satiety numeric;
  v_stamina numeric;
  v_expired integer;
begin
  insert into auth.users(id) values (v_paused_uid),(v_disconnected_uid);
  update public.ktk_v2_players
  set last_seen_at=clock_timestamp()-interval '1 hour'
  where world_id='main' and is_alive;

  perform set_config('request.jwt.claim.sub',v_paused_uid::text,true);
  perform public.ktk_v2_enter_world('Teste Aba Suspensa','{}'::jsonb);
  select * into v_skeleton from public.ktk_v2_entities
  where world_id='main' and entity_id='skeleton-1';

  update public.ktk_v2_players
  set x=v_skeleton.x-45,y=v_skeleton.y,
      state=jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(state,'{health}','80'::jsonb,true),
            '{stamina}','40'::jsonb,true
          ),
          '{satiety}','30'::jsonb,true
        ),
        '{hydration}','30'::jsonb,true
      ) || '{"moving":false,"running":false,"guarding":false}'::jsonb,
      last_seen_at=clock_timestamp(),movement_updated_at=clock_timestamp(),
      revision=revision+1
  where user_id=v_paused_uid and world_id='main';

  -- The newest visibility sequence wins even if network responses arrive late.
  perform set_config('request.jwt.claim.sub',v_paused_uid::text,true);
  v_result:=public.ktk_v2_set_suspended(true,2);
  v_result:=public.ktk_v2_set_suspended(false,1);
  select * into v_paused from public.ktk_v2_players where user_id=v_paused_uid;
  if coalesce((v_paused.state->>'suspended')::boolean,false) is not true
     or (v_paused.state->>'visibility_sequence')::bigint<>2 then
    raise exception 'V2_STALE_VISIBILITY_EVENT_UNPAUSED_CHARACTER';
  end if;

  v_failed:=false;
  begin
    perform public.ktk_v2_step_player(1::smallint,0::smallint,false,false);
  exception when others then
    v_failed:=sqlerrm='PLAYER_SUSPENDED';
  end;
  if not v_failed then raise exception 'V2_SUSPENDED_CHARACTER_COULD_MOVE'; end if;

  v_failed:=false;
  begin
    perform public.ktk_v2_item_action('select_slot','{"slot":0}'::jsonb);
  exception when others then
    v_failed:=sqlerrm='PLAYER_SUSPENDED';
  end;
  if not v_failed then raise exception 'V2_SUSPENDED_CHARACTER_COULD_MUTATE_INVENTORY'; end if;

  v_failed:=false;
  begin
    perform public.ktk_v2_attack();
  exception when others then
    v_failed:=sqlerrm='PLAYER_SUSPENDED';
  end;
  if not v_failed then raise exception 'V2_SUSPENDED_CHARACTER_COULD_ATTACK'; end if;

  v_failed:=false;
  begin
    perform public.ktk_v2_choose_clan('#d94343');
  exception when others then
    v_failed:=sqlerrm='PLAYER_SUSPENDED';
  end;
  if not v_failed then raise exception 'V2_SUSPENDED_CHARACTER_COULD_CHANGE_CLAN'; end if;

  update public.ktk_v2_worlds set king_user_id=null where id='main';
  update public.ktk_v2_entities
  set state='{"status":"ground","unique":true}'::jsonb
  where world_id='main' and entity_id='crown-main';
  v_failed:=false;
  begin
    perform public.ktk_v2_claim_crown();
  exception when others then
    v_failed:=sqlerrm='PLAYER_SUSPENDED';
  end;
  if not v_failed then raise exception 'V2_SUSPENDED_CHARACTER_COULD_CLAIM_CROWN'; end if;

  v_failed:=false;
  begin
    perform public.ktk_v2_launch_projectile();
  exception when others then
    v_failed:=sqlerrm='PLAYER_SUSPENDED';
  end;
  if not v_failed then raise exception 'V2_SUSPENDED_CHARACTER_COULD_LAUNCH_PROJECTILE'; end if;

  v_failed:=false;
  begin
    perform public.ktk_v2_interact();
  exception when others then
    v_failed:=sqlerrm='PLAYER_SUSPENDED';
  end;
  if not v_failed then raise exception 'V2_SUSPENDED_CHARACTER_COULD_INTERACT'; end if;

  update public.ktk_v2_entities
  set state=state||jsonb_build_object(
    'health',70,'max_health',70,'defeated',false,
    'attack',7,'attack_ready_at',clock_timestamp()-interval '1 second',
    'attack_started_at',null
  ),revision=revision+1,updated_at=clock_timestamp()
  where world_id='main' and entity_id='skeleton-1';
  update public.ktk_v2_worlds
  set last_simulation_at=clock_timestamp()-interval '2 seconds'
  where id='main';
  perform ktk_v2_private.simulation_tick();

  select * into v_paused from public.ktk_v2_players where user_id=v_paused_uid;
  select * into v_skeleton from public.ktk_v2_entities
  where world_id='main' and entity_id='skeleton-1';
  v_health:=(v_paused.state->>'health')::numeric;
  v_stamina:=(v_paused.state->>'stamina')::numeric;
  v_satiety:=(v_paused.state->>'satiety')::numeric;
  if v_health<>80 or v_stamina<>40 or v_satiety<>30 then
    raise exception 'V2_SUSPENDED_CHARACTER_SURVIVAL_ADVANCED';
  end if;
  if nullif(v_paused.state->>'last_knockback_at','') is not null
     or nullif(v_skeleton.state->>'attack_started_at','') is not null then
    raise exception 'V2_SKELETON_TARGETED_SUSPENDED_CHARACTER';
  end if;

  -- A hidden tab remains alive even beyond the abandoned-session timeout.
  update public.ktk_v2_players
  set last_seen_at=clock_timestamp()-interval '20 minutes',revision=revision+1
  where user_id=v_paused_uid and world_id='main';

  -- A character whose browser disappeared without an exit signal expires after
  -- the grace period and drops its inventory into the shared world.
  perform set_config('request.jwt.claim.sub',v_disconnected_uid::text,true);
  perform public.ktk_v2_enter_world('Teste Desconexão','{}'::jsonb);
  update public.ktk_v2_players
  set state=jsonb_set(
    state,'{inventory}',
    jsonb_build_array(
      jsonb_build_object(
        'item_id','equipment-longsword','displayName','Espada longa',
        'quantity',1,'durability',100,'maxDurability',150
      ),null
    ),true
  ),
  last_seen_at=clock_timestamp()-interval '20 minutes',
  movement_updated_at=clock_timestamp()-interval '20 minutes',
  revision=revision+1
  where user_id=v_disconnected_uid and world_id='main';

  select ktk_v2_private.expire_disconnected_players() into v_expired;

  select * into v_paused from public.ktk_v2_players where user_id=v_paused_uid;
  select * into v_disconnected from public.ktk_v2_players where user_id=v_disconnected_uid;
  if v_paused.is_alive is not true then
    raise exception 'V2_SUSPENDED_CHARACTER_WAS_AUTO_KILLED';
  end if;
  if v_disconnected.is_alive is not false then
    raise exception 'V2_ABANDONED_CHARACTER_WAS_NOT_EXPIRED';
  end if;
  if not exists (
    select 1 from public.ktk_v2_entities
    where world_id='main' and entity_type='item'
      and state->>'dropped_by'=v_disconnected_uid::text
      and state->>'item_id'='equipment-longsword'
      and nullif(state->>'expires_at','') is not null
  ) then
    raise exception 'V2_DISCONNECT_DID_NOT_DROP_INVENTORY_AS_LOOT';
  end if;

  -- A resume request uses a later sequence and reactivates the same character.
  perform set_config('request.jwt.claim.sub',v_paused_uid::text,true);
  v_result:=public.ktk_v2_set_suspended(false,3);
  select * into v_paused from public.ktk_v2_players where user_id=v_paused_uid;
  if coalesce((v_paused.state->>'suspended')::boolean,true) is not false
     or (v_paused.state->>'visibility_sequence')::bigint<>3 then
    raise exception 'V2_RESUME_DID_NOT_REACTIVATE_CHARACTER';
  end if;
  perform public.ktk_v2_step_player(1::smallint,0::smallint,false,false);
end
$$;

rollback;
