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

rollback;
